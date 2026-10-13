import { prisma } from './prisma';
import { invalidateSubscriptionCache, paidPeriodEnd, SUBSCRIPTION_PERIOD_MS } from './subscription';
import { formatEmailDate, MailResult, sendMail, subscriptionReceiptEmail } from './mailer';
import { alertOperator, deliveryNote } from './operator-alerts';
import { notifyStaff } from './notifications';
import { generateReceiptPdf } from './pdf';
import { getAccessToken, getTransactionStatus, PesapalTransactionStatus } from '../services/pesapal.service';

// Pesapal's transaction status codes.
const PENDING = 0;
const COMPLETED = 1;
const FAILED = 2;
const REVERSED = 3;

export type PaymentOutcome = 'activated' | 'already-applied' | 'pending' | 'failed' | 'amount-mismatch' | 'reversed' | 'unknown' | 'unavailable';

type Log = (message: string) => void;

function pesapalCredentials() {
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
  return consumerKey && consumerSecret ? { consumerKey, consumerSecret } : null;
}

/**
 * Looks a Pesapal order up (never trusting what a browser or the notification
 * says about it) and applies the result to the subscription. Safe to call any
 * number of times for the same order: Pesapal notifies more than once, and the
 * Billing page also asks when the admin returns from paying.
 */
export async function applyPesapalStatus(orderTrackingId: string, log: Log): Promise<PaymentOutcome> {
  const credentials = pesapalCredentials();
  if (!credentials) return 'unavailable';
  const payment = await prisma.payment.findUnique({ where: { pesapalOrderTrackingId: orderTrackingId } });
  if (!payment) return 'unknown';

  const tokenResult = await getAccessToken(credentials);
  if (!tokenResult.success || !tokenResult.token) return 'unavailable';
  const statusResult = await getTransactionStatus(tokenResult.token, orderTrackingId);
  if (!statusResult.success || !statusResult.status) return 'unavailable';
  const status = statusResult.status;

  if (payment.status === 'COMPLETED' || payment.status === 'REVERSED') {
    if (payment.status === 'COMPLETED' && status.statusCode === REVERSED) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REVERSED', rawCallback: status as any } });
      await alertAboutPayment(payment.clinicId, 'Payment reversed', 'Pesapal reversed a subscription payment (a refund or a chargeback). The facility is still marked as paid - decide whether to follow up or change their plan.', payment, status, orderTrackingId);
      return 'reversed';
    }
    return 'already-applied';
  }

  if (status.statusCode === PENDING) {
    await prisma.payment.update({ where: { id: payment.id }, data: { rawCallback: status as any } });
    return 'pending';
  }
  if (status.statusCode !== COMPLETED) {
    await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED', rawCallback: status as any } });
    return status.statusCode === FAILED ? 'failed' : 'unknown';
  }

  // Completed - but only for exactly what was charged.
  const paidEnough = Number(status.amount) >= payment.amount && String(status.currency || '').toUpperCase() === payment.currency.toUpperCase();
  if (!paidEnough) {
    await prisma.payment.updateMany({ where: { id: payment.id, status: { not: 'COMPLETED' } }, data: { status: 'FAILED', rawCallback: status as any } });
    await alertAboutPayment(payment.clinicId, 'Payment amount did not match', `Pesapal reports ${status.currency} ${status.amount} for an order of ${payment.currency} ${payment.amount.toLocaleString()}, so the subscription was not activated. Check the transaction in Pesapal.`, payment, status, orderTrackingId);
    log(`Pesapal order ${orderTrackingId}: amount mismatch, not activated`);
    return 'amount-mismatch';
  }

  const subscription = await prisma.subscription.findUnique({ where: { id: payment.subscriptionId } });
  if (!subscription) return 'unknown';
  const periodEnd = paidPeriodEnd(subscription);
  const periodStart = new Date(periodEnd.getTime() - SUBSCRIPTION_PERIOD_MS);

  // Conditional, so a second notification arriving at the same moment can't
  // add another 30 days or send another receipt.
  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: { not: 'COMPLETED' } },
    data: { status: 'COMPLETED', rawCallback: status as any, periodStart, periodEnd },
  });
  if (count !== 1) return 'already-applied';

  await prisma.subscription.update({
    where: { id: payment.subscriptionId },
    data: { status: 'ACTIVE', lastPaymentAt: new Date(), currentPeriodEnd: periodEnd },
  });
  invalidateSubscriptionCache(payment.clinicId);

  await notifyStaff({
    type: 'PAYMENT_RECEIVED',
    clinicId: payment.clinicId,
    title: 'Subscription payment received',
    body: `${payment.currency} ${payment.amount.toLocaleString()} was received. Your subscription is active through ${formatEmailDate(periodEnd)}. The receipt has been emailed and is on the Billing page.`,
    link: '/billing',
    emailSummary: 'A subscription payment was received.',
    log,
  });

  // The caller (Pesapal, or the admin's browser) is waiting - the receipt and
  // the operator alert go out in the background.
  void sendReceiptAndAlert(payment, periodStart, periodEnd, orderTrackingId).catch((error) => log(`Payment emails failed: ${error?.message}`));
  return 'activated';
}

async function sendReceiptAndAlert(
  payment: { id: string; clinicId: string; amount: number; currency: string },
  periodStart: Date,
  periodEnd: Date,
  orderTrackingId: string
) {
  const [clinic, admin] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: payment.clinicId } }),
    prisma.user.findFirst({ where: { clinicId: payment.clinicId, role: 'ADMIN', isActive: true } }),
  ]);
  if (!clinic) return;
  let receipt: MailResult | null = null;
  if (admin) {
    const receiptPdf = await generateReceiptPdf({
      paymentId: payment.id,
      clinicName: clinic.name,
      facilityCode: clinic.facilityCode,
      amount: payment.amount,
      currency: payment.currency,
      paidAt: new Date(),
      periodStart,
      periodEnd,
      pesapalReference: orderTrackingId,
    });
    receipt = await sendMail({
      to: admin.email,
      subject: `Bulamu payment receipt - ${clinic.name}`,
      html: subscriptionReceiptEmail(clinic.name, payment.amount, payment.currency, periodEnd),
      attachments: [{ filename: `bulamu-receipt-${payment.id.slice(0, 8)}.pdf`, content: receiptPdf, contentType: 'application/pdf' }],
    });
  }
  await alertOperator({
    subject: `Payment received - ${clinic.name} - ${payment.currency} ${payment.amount.toLocaleString()}`,
    heading: 'Subscription payment received',
    facts: [
      ['Facility', clinic.name],
      ['Facility ID', clinic.facilityCode],
      ['Amount', `${payment.currency} ${payment.amount.toLocaleString()}`],
      ['Period covered', `${formatEmailDate(periodStart)} to ${formatEmailDate(periodEnd)}`],
      ['Pesapal reference', orderTrackingId],
      ['Receipt to the facility', deliveryNote(receipt)],
    ],
    ctaPath: '/super-admin',
    ctaLabel: 'Open Facility Management',
  });
}

async function alertAboutPayment(
  clinicId: string,
  heading: string,
  intro: string,
  payment: { amount: number; currency: string },
  status: PesapalTransactionStatus,
  orderTrackingId: string
) {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  await alertOperator({
    subject: `${heading} - ${clinic?.name ?? 'a facility'}`,
    heading,
    intro,
    facts: [
      ['Facility', clinic?.name],
      ['Facility ID', clinic?.facilityCode],
      ['Charged', `${payment.currency} ${payment.amount.toLocaleString()}`],
      ['Pesapal reports', `${status.currency} ${status.amount} - ${status.paymentStatusDescription}`],
      ['Pesapal reference', orderTrackingId],
    ],
    ctaPath: '/super-admin',
    ctaLabel: 'Open Facility Management',
  });
}
