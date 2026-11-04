import { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/rbac.middleware';
import { allPayments, buildPlatformFinances } from '../lib/platform-finances';
import { buildCsv, sendCsv } from '../lib/csv';
import { eastAfricaDay } from '../lib/usage-tracking';
import { sendRouteError } from '../lib/http-error';

/**
 * Bulamu's own finances - the subscriptions facilities pay - for the platform
 * operator (SUPER_ADMIN only). Receipts download through /billing/receipts.
 */
export async function superAdminFinanceRoutes(fastify: FastifyInstance) {
  fastify.get('/super-admin/finances', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      return { success: true, finances: await buildPlatformFinances() };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  fastify.get('/super-admin/finances/payments.csv', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const rows = await allPayments();
      const day = (d: Date | null) => (d ? eastAfricaDay(d) : '');
      const csv = buildCsv<(typeof rows)[number]>(
        [
          ['Started', (r) => day(r.startedAt)],
          ['Paid on', (r) => day(r.paidAt)],
          ['Facility', (r) => r.facility.name],
          ['Facility code', (r) => r.facility.facilityCode],
          ['Amount', (r) => r.amount],
          ['Currency', (r) => r.currency],
          ['Status', (r) => r.status],
          ['Period from', (r) => day(r.periodStart)],
          ['Period to', (r) => day(r.periodEnd)],
          ['Pesapal reference', (r) => r.reference],
          ['Payment ID', (r) => r.id],
        ],
        rows
      );
      return sendCsv(reply, `bulamu-subscription-payments-${eastAfricaDay()}.csv`, csv);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
}
