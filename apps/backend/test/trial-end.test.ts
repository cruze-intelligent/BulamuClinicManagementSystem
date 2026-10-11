import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { paidPeriodEnd, sweepLapsedSubscriptions, SUBSCRIPTION_PERIOD_MS } from '../src/lib/subscription';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

process.env.PESAPAL_CONSUMER_KEY = 'test-consumer-key';
process.env.PESAPAL_CONSUMER_SECRET = 'test-consumer-secret';
process.env.PESAPAL_IPN_ID = 'test-ipn-id';

const DAY = 24 * 60 * 60 * 1000;
const OPERATOR = 'starplay.stargames@gmail.com';

describe('when a trial or paid period ends', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ sent: true, via: 'relay' });
    await resetDb();
    app = await buildTestApp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await app?.close();
  });

  const lapseAlerts = () =>
    sendMailMock.mock.calls.map(([mail]) => mail).filter((m: any) => m.to === OPERATOR && /Trial ended unpaid|Subscription lapsed/.test(m.subject));

  async function facilityWithTrialEnding(trialEndsAt: Date, name = 'Gulu Medical Centre') {
    const clinic = await seedClinic({ name });
    await prisma.subscription.update({ where: { clinicId: clinic.id }, data: { status: 'TRIALING', trialEndsAt } });
    return clinic;
  }

  it('explains a refused save in words staff can act on', async () => {
    const clinic = await facilityWithTrialEnding(new Date(Date.now() - 1000));
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const write = await app.inject({
      method: 'POST', url: '/patients', headers: authHeader(token),
      payload: { name: 'Blocked Patient', phone: '0700000000', clinicId: clinic.id },
    });
    expect(write.statusCode).toBe(402);
    expect(write.json().reason).toBe('SUBSCRIPTION_REQUIRED');
    expect(write.json().error).toMatch(/subscription has ended/);
    expect(write.json().error).toMatch(/Billing page/);
  });

  it('shows the billing page an ended trial as past due straight away, before anyone tries to save', async () => {
    const clinic = await facilityWithTrialEnding(new Date(Date.now() - 1000));
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const status = await app.inject({ method: 'GET', url: '/billing/status', headers: authHeader(token) });
    expect(status.json().subscription.status).toBe('PAST_DUE');
    expect((await prisma.subscription.findUnique({ where: { clinicId: clinic.id } }))?.status).toBe('PAST_DUE');
  });

  it('tells the operator once when a trial ends unpaid, however many times it is noticed', async () => {
    const clinic = await facilityWithTrialEnding(new Date(Date.now() - 1000), 'Arua Health Centre');
    await seedUser({ clinicId: clinic.id, role: 'ADMIN', name: 'Ruth Admin', email: 'ruth@arua.ug' });

    expect(await sweepLapsedSubscriptions()).toBe(1);
    expect(await sweepLapsedSubscriptions()).toBe(0);
    await vi.waitFor(() => expect(lapseAlerts()).toHaveLength(1));

    const alert = lapseAlerts()[0] as any;
    expect(alert.subject).toContain('Trial ended unpaid - Arua Health Centre');
    expect(alert.html).toContain('ruth@arua.ug');
    expect(alert.html).toContain(clinic.facilityCode);
    expect((await prisma.subscription.findUnique({ where: { clinicId: clinic.id } }))?.status).toBe('PAST_DUE');
  });

  it('marks a paid month that ran out as past due too', async () => {
    const clinic = await seedClinic();
    await prisma.subscription.update({ where: { clinicId: clinic.id }, data: { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - DAY) } });

    await sweepLapsedSubscriptions();
    expect((await prisma.subscription.findUnique({ where: { clinicId: clinic.id } }))?.status).toBe('PAST_DUE');
    await vi.waitFor(() => expect(lapseAlerts()).toHaveLength(1));
    expect((lapseAlerts()[0] as any).subject).toContain('Subscription lapsed');
  });

  it('leaves running trials and paid months alone, and does not alert about internal facilities', async () => {
    const running = await facilityWithTrialEnding(new Date(Date.now() + 5 * DAY));
    const hq = await facilityWithTrialEnding(new Date(Date.now() - DAY), 'Bulamu HQ');
    await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });

    await sweepLapsedSubscriptions();
    expect((await prisma.subscription.findUnique({ where: { clinicId: running.id } }))?.status).toBe('TRIALING');
    // Wait for the (skipped) alert lookup to finish before asserting nothing went out.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(lapseAlerts()).toHaveLength(0);
  });

  describe('paying', () => {
    it('adds the 30 days after whatever is left of the trial or the paid month', () => {
      const now = new Date('2026-10-11T08:00:00Z');
      const trialEnd = new Date('2026-10-15T08:00:00Z');
      expect(paidPeriodEnd({ status: 'TRIALING', trialEndsAt: trialEnd, currentPeriodEnd: null }, now).getTime())
        .toBe(trialEnd.getTime() + SUBSCRIPTION_PERIOD_MS);

      const periodEnd = new Date('2026-10-20T08:00:00Z');
      expect(paidPeriodEnd({ status: 'ACTIVE', trialEndsAt: trialEnd, currentPeriodEnd: periodEnd }, now).getTime())
        .toBe(periodEnd.getTime() + SUBSCRIPTION_PERIOD_MS);

      // Already ended: the 30 days start from the payment.
      expect(paidPeriodEnd({ status: 'PAST_DUE', trialEndsAt: new Date('2026-10-01T00:00:00Z'), currentPeriodEnd: null }, now).getTime())
        .toBe(now.getTime() + SUBSCRIPTION_PERIOD_MS);
    });

    async function pendingPayment(trackingId: string, trialEndsAt: Date) {
      const clinic = await facilityWithTrialEnding(trialEndsAt);
      await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
      const subscription = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });
      await prisma.payment.create({
        data: { clinicId: clinic.id, subscriptionId: subscription.id, amount: 100000, currency: 'UGX', status: 'PENDING', pesapalOrderTrackingId: trackingId },
      });
      return clinic;
    }

    function pesapalSaysCompleted() {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
        ok: true, status: 200,
        json: async () => url.includes('RequestToken')
          ? { token: 'access-token' }
          : { status_code: 1, payment_status_description: 'Completed', merchant_reference: 'ref', amount: 100000, currency: 'UGX' },
      })));
    }

    it('keeps the trial days left when a facility pays early', async () => {
      const trialEndsAt = new Date(Date.now() + 5 * DAY);
      const clinic = await pendingPayment('track-early', trialEndsAt);
      pesapalSaysCompleted();

      await app.inject({ method: 'GET', url: '/billing/pesapal/ipn?OrderTrackingId=track-early&OrderMerchantReference=ref' });

      const subscription = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });
      expect(subscription.status).toBe('ACTIVE');
      expect(subscription.currentPeriodEnd?.getTime()).toBe(trialEndsAt.getTime() + SUBSCRIPTION_PERIOD_MS);
    });

    it('applies a payment once, however many times Pesapal reports it', async () => {
      const clinic = await pendingPayment('track-twice', new Date(Date.now() - DAY));
      pesapalSaysCompleted();

      await app.inject({ method: 'GET', url: '/billing/pesapal/ipn?OrderTrackingId=track-twice&OrderMerchantReference=ref' });
      const first = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });
      await app.inject({ method: 'GET', url: '/billing/pesapal/ipn?OrderTrackingId=track-twice&OrderMerchantReference=ref' });
      const second = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });

      expect(second.currentPeriodEnd?.getTime()).toBe(first.currentPeriodEnd?.getTime());
      expect(await prisma.notification.count({ where: { clinicId: clinic.id, type: 'PAYMENT_RECEIVED' } })).toBe(1);
    });

    it('lets saving resume as soon as the payment is confirmed', async () => {
      const clinic = await pendingPayment('track-unblock', new Date(Date.now() - DAY));
      const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
      const { token } = await loginAs(app, user.email, password);
      const save = () => app.inject({
        method: 'POST', url: '/patients', headers: authHeader(token),
        payload: { name: 'New Patient', phone: '0700000001', clinicId: clinic.id },
      });

      expect((await save()).statusCode).toBe(402);
      pesapalSaysCompleted();
      await app.inject({ method: 'GET', url: '/billing/pesapal/ipn?OrderTrackingId=track-unblock&OrderMerchantReference=ref' });
      vi.unstubAllGlobals();
      expect((await save()).statusCode).toBe(200);
    });
  });
});
