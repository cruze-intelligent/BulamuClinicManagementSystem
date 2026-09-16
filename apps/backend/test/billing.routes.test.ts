import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

process.env.PESAPAL_CONSUMER_KEY = 'test-consumer-key';
process.env.PESAPAL_CONSUMER_SECRET = 'test-consumer-secret';
process.env.PESAPAL_IPN_ID = 'test-ipn-id';

describe('billing routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the current subscription status for the caller\'s clinic', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: '/billing/status', headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().subscription.status).toBe('ACTIVE');
  });

  it('rejects a non-ADMIN from starting a subscription payment', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'POST', url: '/billing/subscribe', headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });

  it('starts a Pesapal order and returns a redirect url for ADMIN', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: 'access-token' }) }) // getAccessToken
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ order_tracking_id: 'track-1', redirect_url: 'https://pay.pesapal.com/checkout/track-1' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.inject({ method: 'POST', url: '/billing/subscribe', headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().redirectUrl).toBe('https://pay.pesapal.com/checkout/track-1');

    const payment = await prisma.payment.findFirst({ where: { clinicId: clinic.id } });
    expect(payment?.pesapalOrderTrackingId).toBe('track-1');
    expect(payment?.status).toBe('PENDING');
  });

  it('activates the subscription when the Pesapal IPN reports a completed payment', async () => {
    const clinic = await seedClinic();
    await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });
    const payment = await prisma.payment.create({
      data: {
        clinicId: clinic.id, subscriptionId: subscription.id, amount: 100000, currency: 'UGX',
        status: 'PENDING', pesapalOrderTrackingId: 'track-2',
      },
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: 'access-token' }) }) // getAccessToken
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ status_code: 1, payment_status_description: 'Completed', merchant_reference: 'ref', amount: 100000, currency: 'UGX' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.inject({ method: 'GET', url: `/billing/pesapal/ipn?OrderTrackingId=track-2&OrderMerchantReference=ref` });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(200);

    const updatedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updatedPayment?.status).toBe('COMPLETED');

    const updatedSubscription = await prisma.subscription.findUnique({ where: { clinicId: clinic.id } });
    expect(updatedSubscription?.status).toBe('ACTIVE');
    expect(updatedSubscription?.lastPaymentAt).not.toBeNull();
  });

  it('marks the payment failed when Pesapal reports the transaction failed', async () => {
    const clinic = await seedClinic();
    await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });
    const payment = await prisma.payment.create({
      data: {
        clinicId: clinic.id, subscriptionId: subscription.id, amount: 100000, currency: 'UGX',
        status: 'PENDING', pesapalOrderTrackingId: 'track-3',
      },
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: 'access-token' }) })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ status_code: 2, payment_status_description: 'Failed', merchant_reference: 'ref', amount: 100000, currency: 'UGX' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({ method: 'GET', url: `/billing/pesapal/ipn?OrderTrackingId=track-3&OrderMerchantReference=ref` });

    const updatedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updatedPayment?.status).toBe('FAILED');

    const updatedSubscription = await prisma.subscription.findUnique({ where: { clinicId: clinic.id } });
    expect(updatedSubscription?.status).toBe('ACTIVE'); // unchanged - was already ACTIVE from seedClinic
  });
});
