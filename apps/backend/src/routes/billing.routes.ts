import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { invalidateSubscriptionCache } from '../lib/subscription';
import {
  getAccessToken, registerIpnUrl, submitOrderRequest, getTransactionStatus, PESAPAL_STATUS_COMPLETED,
} from '../services/pesapal.service';

const SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

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
      const subscription = await prisma.subscription.findUnique({ where: { clinicId } });
      return { success: true, subscription };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
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
        return reply.status(502).send({ error: 'Could not reach Pesapal', details: tokenResult.error });
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
        description: `Bulamu subscription - ${clinic.name}`,
        callbackUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/billing/callback`,
        notificationId,
        billing: { emailAddress: admin.email, phoneNumber: clinic.phone, firstName: firstName || admin.name, lastName: rest.join(' ') || admin.name },
      });

      if (!order.success || !order.orderTrackingId || !order.redirectUrl) {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
        return reply.status(502).send({ error: 'Could not create Pesapal order', details: order.error });
      }

      await prisma.payment.update({ where: { id: payment.id }, data: { pesapalOrderTrackingId: order.orderTrackingId } });

      return { success: true, redirectUrl: order.redirectUrl };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Pesapal calls this from their servers once a payment attempt resolves.
  // Never trust the callback query params for the actual outcome - look the
  // transaction up authoritatively via GetTransactionStatus.
  fastify.get('/billing/pesapal/ipn', async (request, reply) => {
    const { OrderTrackingId, OrderMerchantReference, OrderNotificationType } = request.query as any;
    const credentials = pesapalCredentials();

    try {
      if (credentials && OrderTrackingId) {
        const tokenResult = await getAccessToken(credentials);
        if (tokenResult.success && tokenResult.token) {
          const statusResult = await getTransactionStatus(tokenResult.token, OrderTrackingId);
          const payment = await prisma.payment.findUnique({ where: { pesapalOrderTrackingId: OrderTrackingId } });
          if (payment && statusResult.success && statusResult.status) {
            const completed = statusResult.status.statusCode === PESAPAL_STATUS_COMPLETED;
            await prisma.payment.update({
              where: { id: payment.id },
              data: { status: completed ? 'COMPLETED' : 'FAILED', rawCallback: statusResult.status as any },
            });
            if (completed) {
              await prisma.subscription.update({
                where: { id: payment.subscriptionId },
                data: { status: 'ACTIVE', lastPaymentAt: new Date(), currentPeriodEnd: new Date(Date.now() + SUBSCRIPTION_PERIOD_MS) },
              });
              invalidateSubscriptionCache(payment.clinicId);
            }
          }
        }
      }
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
      return reply.status(400).send({ error: error.message });
    }
  });
}
