import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { invalidateSubscriptionCache, lapseIfDue } from '../lib/subscription';
import { applyPesapalStatus } from '../lib/subscription-payments';
import { generateReceiptPdf } from '../lib/pdf';
import { getAccessToken, registerIpnUrl, submitOrderRequest, describePesapalError } from '../services/pesapal.service';
import { REAL_FACILITY } from '../lib/facility';
import { recordAudit } from '../lib/audit';
import { sendMail, trialExtendedEmail } from '../lib/mailer';
import { frontendUrl } from '../lib/operator-alerts';
import { sendRouteError } from '../lib/http-error';

/** The most days the platform operator may add to one facility's free trial, in all. */
export const MAX_TRIAL_EXTENSION_DAYS = 14;

function pesapalCredentials() {
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return null;
  return { consumerKey, consumerSecret };
}

export async function billingRoutes(fastify: FastifyInstance) {
  // Current trial/subscription snapshot, used to render the trial banner and
  // the billing page.
  fastify.get('/billing/status', { preHandler: [authenticate] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.query as any)?.clinicId);
    if (!clinicId) return;
    try {
      let subscription = await prisma.subscription.findUnique({ where: { clinicId } });
      // A trial that ended overnight shows as ended straight away, not only
      // after someone's save is refused.
      if (subscription) {
        const status = await lapseIfDue(subscription);
        if (status !== subscription.status) subscription = { ...subscription, status };
      }
      return { success: true, subscription };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Kick off a Pesapal-hosted payment for the caller's clinic subscription.
  fastify.post('/billing/subscribe', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const credentials = pesapalCredentials();
    if (!credentials) {
      return reply.status(500).send({ error: 'Payment processing is not configured yet' });
    }
    const notificationId = process.env.PESAPAL_IPN_ID;
    if (!notificationId) {
      return reply.status(500).send({ error: 'Pesapal IPN is not registered yet - run /billing/pesapal/register-ipn first' });
    }

    try {
      const [clinic, subscription, admin] = await Promise.all([
        prisma.clinic.findUnique({ where: { id: authUser.clinicId } }),
        prisma.subscription.findUnique({ where: { clinicId: authUser.clinicId } }),
        prisma.user.findUnique({ where: { id: authUser.userId } }),
      ]);
      if (!clinic || !subscription || !admin) {
        return reply.status(404).send({ error: 'Facility or subscription not found' });
      }

      const tokenResult = await getAccessToken(credentials);
      if (!tokenResult.success || !tokenResult.token) {
        fastify.log.error({ pesapal: tokenResult.error }, 'Pesapal authentication failed');
        return reply.status(502).send({
          error: `Could not authenticate with Pesapal: ${describePesapalError(tokenResult.error)}`,
          details: tokenResult.error,
        });
      }

      const merchantReference = `bulamu-${clinic.id}-${randomUUID()}`;
      const payment = await prisma.payment.create({
        data: {
          clinicId: clinic.id,
          subscriptionId: subscription.id,
          amount: subscription.amount,
          currency: subscription.currency,
          status: 'PENDING',
          pesapalMerchantReference: merchantReference,
        },
      });

      const [firstName, ...rest] = admin.name.split(' ');
      const order = await submitOrderRequest(tokenResult.token, {
        id: merchantReference,
        amount: subscription.amount,
        currency: subscription.currency,
        // Pesapal rejects descriptions over 100 characters.
        description: `Bulamu subscription - ${clinic.name}`.slice(0, 100),
        callbackUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/billing/callback`,
        notificationId,
        billing: { emailAddress: admin.email, phoneNumber: clinic.phone, firstName: firstName || admin.name, lastName: rest.join(' ') || admin.name },
      });

      if (!order.success || !order.orderTrackingId || !order.redirectUrl) {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
        fastify.log.error({ pesapal: order.error, merchantReference }, 'Pesapal rejected the order request');
        return reply.status(502).send({
          error: `Pesapal could not create the payment order: ${describePesapalError(order.error)}`,
          details: order.error,
        });
      }

      await prisma.payment.update({ where: { id: payment.id }, data: { pesapalOrderTrackingId: order.orderTrackingId } });

      return { success: true, redirectUrl: order.redirectUrl };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Pesapal calls this from their servers once a payment attempt resolves.
  // Never trust the callback query params for the actual outcome - the order
  // is looked up authoritatively via GetTransactionStatus.
  fastify.get('/billing/pesapal/ipn', async (request, reply) => {
    const { OrderTrackingId, OrderMerchantReference, OrderNotificationType } = request.query as any;
    try {
      if (OrderTrackingId) await applyPesapalStatus(String(OrderTrackingId), (message) => fastify.log.warn(message));
    } catch (error) {
      fastify.log.error(error, 'Pesapal IPN processing failed');
    }

    return reply.send({
      orderNotificationType: OrderNotificationType || 'IPNCHANGE',
      orderTrackingId: OrderTrackingId,
      orderMerchantReference: OrderMerchantReference,
      status: 200,
    });
  });

  // The admin is back from Pesapal (the callback page passes the order's
  // tracking id): check the order now rather than waiting for Pesapal's
  // notification, which can be late - or never arrive.
  fastify.post('/billing/confirm', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { orderTrackingId } = (request.body ?? {}) as { orderTrackingId?: unknown };
    if (typeof orderTrackingId !== 'string' || !orderTrackingId) {
      return reply.status(400).send({ error: 'orderTrackingId is required' });
    }
    const payment = await prisma.payment.findUnique({ where: { pesapalOrderTrackingId: orderTrackingId } });
    if (!payment) return reply.status(404).send({ error: 'Payment not found' });
    if (!assertClinicMatch(request, reply, payment.clinicId)) return;

    try {
      const outcome = await applyPesapalStatus(orderTrackingId, (message) => fastify.log.warn(message));
      return { success: true, outcome };
    } catch (error: any) {
      return reply.status(502).send({ error: 'Could not check the payment with Pesapal - please try again shortly' });
    }
  });

  // Payment history for the caller's facility, for the Billing page's
  // "Receipts" list.
  fastify.get('/billing/payments', { preHandler: [authenticate] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.query as any)?.clinicId);
    if (!clinicId) return;
    try {
      const payments = await prisma.payment.findMany({
        where: { clinicId, status: 'COMPLETED' },
        orderBy: { updatedAt: 'desc' },
      });
      return { success: true, payments };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Re-download a past subscription payment's receipt (also emailed at the
  // time of payment, but not everyone keeps that email).
  fastify.get('/billing/receipts/:paymentId/pdf', { preHandler: [authenticate] }, async (request, reply) => {
    const { paymentId } = request.params as any;
    try {
      const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.status !== 'COMPLETED') {
        return reply.status(404).send({ error: 'Receipt not found' });
      }
      if (!assertClinicMatch(request, reply, payment.clinicId)) return;

      const [clinic, subscription] = await Promise.all([
        prisma.clinic.findUnique({ where: { id: payment.clinicId } }),
        prisma.subscription.findUnique({ where: { id: payment.subscriptionId } }),
      ]);
      if (!clinic || !subscription) return reply.status(404).send({ error: 'Receipt not found' });

      const pdf = await generateReceiptPdf({
        paymentId: payment.id,
        clinicName: clinic.name,
        facilityCode: clinic.facilityCode,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.updatedAt,
        // Each receipt shows the period that payment paid for. Payments from
        // before that was recorded fall back to what is known: the trial's
        // end for the free-trial receipt, the current period otherwise.
        periodStart: payment.periodStart,
        periodEnd: payment.periodEnd ?? (payment.amount === 0 ? subscription.trialEndsAt : subscription.currentPeriodEnd || payment.updatedAt),
        pesapalReference: payment.pesapalOrderTrackingId,
      });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="bulamu-receipt-${payment.id.slice(0, 8)}.pdf"`);
      return reply.send(pdf);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Set a facility onto a custom-priced/custom-feature plan (SUPER_ADMIN
  // only) - used after an off-platform conversation about needs the standard
  // plan doesn't cover. Standard facilities can also be moved back with plan:
  // 'STANDARD'.
  fastify.patch('/billing/plan/:clinicId', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId } = request.params as any;
    const { plan, amount, notes } = request.body as any;

    if (plan !== 'STANDARD' && plan !== 'CUSTOM') {
      return reply.status(400).send({ error: 'plan must be STANDARD or CUSTOM' });
    }

    try {
      const subscription = await prisma.subscription.update({
        where: { clinicId },
        data: {
          plan,
          amount: amount != null ? Number(amount) : undefined,
          planNotes: notes ?? undefined,
        },
      });
      invalidateSubscriptionCache(clinicId);
      return { success: true, subscription };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Gives a facility on its free trial more days (SUPER_ADMIN only) - at most
  // MAX_TRIAL_EXTENSION_DAYS in all, however many times it is asked. A trial
  // that already ran out unpaid opens again from today.
  fastify.post('/billing/trial/:clinicId/extend', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId } = request.params as { clinicId: string };
    const days = Number((request.body as { days?: unknown } | undefined)?.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_TRIAL_EXTENSION_DAYS) {
      return reply.status(400).send({ error: `Choose between 1 and ${MAX_TRIAL_EXTENSION_DAYS} days` });
    }

    try {
      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId, ...REAL_FACILITY, registrationStatus: 'APPROVED' },
        include: { subscription: true, users: { where: { role: 'ADMIN', isActive: true }, select: { email: true } } },
      });
      const subscription = clinic?.subscription;
      if (!clinic || !subscription) return reply.status(404).send({ error: 'Facility not found' });

      const onTrial = subscription.status === 'TRIALING' || (subscription.status === 'PAST_DUE' && !subscription.lastPaymentAt);
      if (!onTrial) {
        return reply.status(409).send({ error: 'Only a free trial can be extended - this facility has a paid subscription' });
      }
      const remaining = MAX_TRIAL_EXTENSION_DAYS - subscription.trialExtendedDays;
      if (days > remaining) {
        return reply.status(409).send({
          error: remaining <= 0
            ? `This trial has already been extended by the full ${MAX_TRIAL_EXTENSION_DAYS} days`
            : `This trial can be extended by at most ${remaining} more day${remaining === 1 ? '' : 's'} (${MAX_TRIAL_EXTENSION_DAYS} in all)`,
          remaining: Math.max(0, remaining),
        });
      }

      const now = new Date();
      const from = subscription.trialEndsAt > now ? subscription.trialEndsAt : now;
      const trialEndsAt = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
      // Conditional on nothing having changed since it was read, so two quick
      // clicks can never add up to more than the limit.
      const { count } = await prisma.subscription.updateMany({
        where: { id: subscription.id, trialExtendedDays: subscription.trialExtendedDays, status: subscription.status },
        data: { trialEndsAt, status: 'TRIALING', trialExtendedDays: { increment: days } },
      });
      if (count !== 1) return reply.status(409).send({ error: 'The trial was changed a moment ago - reload and try again' });
      invalidateSubscriptionCache(clinicId);

      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Subscription', recordId: subscription.id, clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { trialExtendedByDays: days, trialEndsAt: trialEndsAt.toISOString() },
      });

      const to = clinic.users.map((u) => u.email).join(', ');
      const mail = to
        ? await sendMail({ to, subject: `Your Bulamu free trial has been extended - ${clinic.name}`, html: trialExtendedEmail(clinic.name, days, trialEndsAt, frontendUrl('/auth/login')) })
        : null;
      return {
        success: true,
        trialEndsAt: trialEndsAt.toISOString(),
        trialExtendedDays: subscription.trialExtendedDays + days,
        remaining: remaining - days,
        emailed: !!mail?.sent,
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // One-time bootstrap: registers Bulamu's IPN URL with Pesapal. Run this
  // once per environment (sandbox and again once live), then store the
  // returned ipnId as the PESAPAL_IPN_ID env var.
  fastify.post('/billing/pesapal/register-ipn', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    const credentials = pesapalCredentials();
    if (!credentials) {
      return reply.status(500).send({ error: 'PESAPAL_CONSUMER_KEY/SECRET are not configured' });
    }
    try {
      const tokenResult = await getAccessToken(credentials);
      if (!tokenResult.success || !tokenResult.token) {
        return reply.status(502).send({ error: 'Could not reach Pesapal', details: tokenResult.error });
      }
      const ipnUrl = `${process.env.BACKEND_URL || 'http://localhost:4000'}/billing/pesapal/ipn`;
      const result = await registerIpnUrl(tokenResult.token, ipnUrl);
      if (!result.success) {
        return reply.status(502).send({ error: 'Could not register IPN', details: result.error });
      }
      return { success: true, ipnId: result.ipnId, ipnUrl };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });
}
