import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { paymentReason } from '../src/lib/payment-reason';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

const base = { amount: 100000, currency: 'UGX', pesapalOrderTrackingId: 'PSP-1' };

describe('why a payment did not go through', () => {
  it('is said in words, from what Pesapal reported', () => {
    expect(paymentReason({ ...base, status: 'COMPLETED' })).toBeNull();
    expect(paymentReason({ ...base, status: 'PENDING' })).toBeNull();
    expect(paymentReason({ ...base, status: 'FAILED', pesapalOrderTrackingId: null })).toMatch(/could not open the payment page, so nothing was charged/);
    expect(paymentReason({ ...base, status: 'FAILED', rawCallback: { statusCode: 2, paymentStatusDescription: 'Failed', description: 'Unable to Authorize Transaction. Kindly contact your bank' } }))
      .toBe('Pesapal: Failed - Unable to Authorize Transaction. Kindly contact your bank. The payment was declined or not completed (for example a wrong PIN, too little balance, the prompt timing out or a cancelled card), so nothing was charged. Try again.');
    expect(paymentReason({ ...base, status: 'FAILED', rawCallback: { statusCode: 1, amount: 1000, currency: 'UGX' } })).toMatch(/Pesapal reported UGX 1,000, not the UGX 100,000 due/);
    expect(paymentReason({ ...base, status: 'FAILED' })).toMatch(/^The payment was declined or not completed/);
    expect(paymentReason({ ...base, status: 'REVERSED' })).toMatch(/reversed this payment/);
  });

  it('is shown to the facility administrator on Billing, and to the operator on Finances', async () => {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const clinic = await seedClinic({ name: 'Amolatar Community Medical Centre' });
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });
    await prisma.payment.create({ data: { clinicId: clinic.id, subscriptionId: subscription.id, amount: 100000, currency: 'UGX', status: 'FAILED', pesapalOrderTrackingId: 'PSP-x', rawCallback: { statusCode: 2, paymentStatusDescription: 'Failed' } } });
    const signIn = async (clinicId: string, role: 'ADMIN' | 'SUPER_ADMIN') => {
      const { user, password } = await seedUser({ clinicId, role });
      return (await loginAs(app, user.email, password)).token;
    };

    const billing = (await app.inject({ method: 'GET', url: '/billing/payments', headers: authHeader(await signIn(clinic.id, 'ADMIN')) })).json();
    expect(billing.payments).toEqual([]);
    expect(billing.unsuccessful).toEqual([expect.objectContaining({ amount: 100000, status: 'FAILED', reason: expect.stringMatching(/^Pesapal: Failed\. The payment was declined/) })]);
    expect(JSON.stringify(billing.unsuccessful)).not.toMatch(/rawCallback|PSP-x/);

    const finances = (await app.inject({ method: 'GET', url: '/super-admin/finances', headers: authHeader(await signIn(hq.id, 'SUPER_ADMIN')) })).json();
    const row = (finances.finances ?? finances).payments.find((p: any) => p.amount === 100000);
    expect(row.reason).toMatch(/^Pesapal: Failed\./);
  });
});
