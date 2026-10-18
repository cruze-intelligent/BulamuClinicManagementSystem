import { FastifyInstance } from 'fastify';
import { prisma, isUniqueConstraintError } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';
import { authenticate, getAuthUser, resolveClinicScope } from '../middleware/auth.middleware';
import { recordAudit } from '../lib/audit';
import { sendMail, facilityApprovedEmail, facilityRejectedEmail, facilityStatusEmail, facilityRemovedEmail, formatEmailDate, MailResult } from '../lib/mailer';
import { alertOperator, deliveryNote, frontendUrl } from '../lib/operator-alerts';
import { generateReceiptPdf } from '../lib/pdf';
import { generateFacilityCode, normalizePhoneKey, findDuplicateFacility, duplicateFacilityMessage, facilityTypeLabel, REAL_FACILITY } from '../lib/facility';
import { buildCsv, sendCsv } from '../lib/csv';
import bcrypt from 'bcrypt';
import { sendRouteError } from '../lib/http-error';

const TRIAL_LENGTH_MS = 14 * 24 * 60 * 60 * 1000; // 2-week free trial
const DEFAULT_SUBSCRIPTION_AMOUNT = 100000; // UGX/month

// The facility's administrator - the person facility emails go to.
const facilityAdmin = (clinicId: string) =>
  prisma.user.findFirst({ where: { clinicId, role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { email: true, name: true } });

// An optional operator-typed reason, as it will appear in the facility's email.
const cleanReason = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;

const actorName = async (userId: string) =>
  (await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }))?.name ?? 'A platform administrator';

export async function clinicRoutes(fastify: FastifyInstance) {
  // Facilities awaiting approval (SUPER_ADMIN only - this is the private
  // approvals queue, never linked from anywhere public).
  fastify.get('/super-admin/pending-clinics', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const clinics = await prisma.clinic.findMany({
        where: { registrationStatus: 'PENDING', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          users: { where: { role: 'ADMIN' }, select: { id: true, name: true, email: true }, take: 1 },
        },
      });
      return {
        success: true,
        clinics: clinics.map((clinic) => ({
          id: clinic.id, facilityCode: clinic.facilityCode, name: clinic.name, facilityType: clinic.facilityType,
          phone: clinic.phone, address: clinic.address,
          district: clinic.district, subCounty: clinic.subCounty, parish: clinic.parish,
          createdAt: clinic.createdAt, admin: clinic.users[0] || null,
        })),
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Approve a pending facility: activates it and starts its 2-week trial.
  fastify.patch('/clinics/:id/approve', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    try {
      const existing = await prisma.clinic.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Facility not found' });
      if (existing.registrationStatus !== 'PENDING') {
        return reply.status(400).send({ error: 'Only a pending facility can be approved' });
      }

      const authUser = getAuthUser(request);
      const { clinic, subscription, trialReceipt } = await prisma.$transaction(async (tx) => {
        const clinic = await tx.clinic.update({
          where: { id },
          data: { registrationStatus: 'APPROVED', isActive: true, approvedAt: new Date(), approvedBy: authUser.userId },
        });
        await tx.user.updateMany({ where: { clinicId: id, role: { not: 'SUPER_ADMIN' } }, data: { isActive: true } });
        const subscription = await tx.subscription.upsert({
          where: { clinicId: id },
          update: {},
          create: {
            clinicId: id,
            status: 'TRIALING',
            trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_MS),
            amount: DEFAULT_SUBSCRIPTION_AMOUNT,
            currency: 'UGX',
          },
        });
        // The free trial is the facility's first receipt: a zero-amount,
        // already-completed Payment, so it lists in payment history and
        // downloads like any other receipt. One per subscription.
        const trialReceipt =
          (await tx.payment.findFirst({ where: { subscriptionId: subscription.id, amount: 0 } })) ??
          (await tx.payment.create({
            data: { clinicId: id, subscriptionId: subscription.id, amount: 0, currency: subscription.currency, status: 'COMPLETED', periodStart: new Date(), periodEnd: subscription.trialEndsAt },
          }));
        return { clinic, subscription, trialReceipt };
      }, { timeout: 15000 });

      await recordAudit({ entity: 'Clinic', recordId: id, clinicId: id, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { registrationStatus: 'APPROVED' } });

      // Approval is already committed - the email (and the PDF it carries) is
      // a best-effort side channel, so don't make the super admin wait on it.
      // The operator is then told whether the facility's email went out.
      void (async () => {
        const admin = await facilityAdmin(id);
        let result: MailResult | null = null;
        if (admin) {
          const receiptPdf = await generateReceiptPdf({
            paymentId: trialReceipt.id,
            clinicName: clinic.name,
            facilityCode: clinic.facilityCode,
            amount: 0,
            currency: subscription.currency,
            paidAt: trialReceipt.createdAt,
            periodStart: trialReceipt.periodStart ?? trialReceipt.createdAt,
            periodEnd: trialReceipt.periodEnd ?? subscription.trialEndsAt,
          });
          result = await sendMail({
            to: admin.email,
            subject: `${clinic.name} is approved on Bulamu`,
            html: facilityApprovedEmail(clinic.name, frontendUrl('/auth/login'), subscription.trialEndsAt, { facilityCode: clinic.facilityCode, adminEmail: admin.email }),
            attachments: [{ filename: `free-trial-receipt-${trialReceipt.id}.pdf`, content: receiptPdf, contentType: 'application/pdf' }],
          });
          if (!result.sent) fastify.log.warn(`Approval email to ${admin.email} not sent: ${result.reason}`);
        }
        await alertOperator({
          subject: `Facility approved - ${clinic.name}`,
          heading: 'Facility approved',
          facts: [
            ['Facility', clinic.name],
            ['Facility ID', clinic.facilityCode],
            ['Approved by', await actorName(authUser.userId)],
            ['Free trial ends', subscription.trialEndsAt ? formatEmailDate(subscription.trialEndsAt) : null],
            ['Administrator', admin ? `${admin.name} <${admin.email}>` : null],
            ['Approval email to the facility', deliveryNote(result)],
          ],
          ctaPath: '/super-admin',
          ctaLabel: 'Open Facility Management',
        });
      })().catch((error) => fastify.log.error(error, 'Approval email failed'));

      return { success: true, clinic };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Reject a pending facility.
  fastify.patch('/clinics/:id/reject', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const { reason } = request.body as any;
    try {
      const existing = await prisma.clinic.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Facility not found' });
      if (existing.registrationStatus !== 'PENDING') {
        return reply.status(400).send({ error: 'Only a pending facility can be rejected' });
      }

      const authUser = getAuthUser(request);
      const clinic = await prisma.clinic.update({
        where: { id },
        data: { registrationStatus: 'REJECTED', isActive: false, rejectionReason: reason || null },
      });

      await recordAudit({ entity: 'Clinic', recordId: id, clinicId: id, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { registrationStatus: 'REJECTED', reason } });

      void (async () => {
        const admin = await facilityAdmin(id);
        let result: MailResult | null = null;
        if (admin) {
          result = await sendMail({
            to: admin.email,
            subject: `${clinic.name} registration update - Bulamu`,
            html: facilityRejectedEmail(clinic.name, reason || undefined),
          });
          if (!result.sent) fastify.log.warn(`Rejection email to ${admin.email} not sent: ${result.reason}`);
        }
        await alertOperator({
          subject: `Facility rejected - ${clinic.name}`,
          heading: 'Facility registration rejected',
          facts: [
            ['Facility', clinic.name],
            ['Facility ID', clinic.facilityCode],
            ['Rejected by', await actorName(authUser.userId)],
            ['Reason given', reason || 'None'],
            ['Email to the facility', deliveryNote(result)],
          ],
        });
      })().catch((error) => fastify.log.error(error, 'Rejection email failed'));

      return { success: true, clinic };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Facility directory: non-sensitive listing any authenticated staff member
  // can see, so a clinic can pick a destination when referring a patient.
  fastify.get('/clinics', { preHandler: [authenticate] }, async (_request, reply) => {
    try {
      const clinics = await prisma.clinic.findMany({
        where: { ...REAL_FACILITY, isActive: true },
        select: { id: true, name: true, facilityType: true, district: true, subCounty: true, parish: true },
        orderBy: { name: 'asc' },
      });

      return { success: true, clinics };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Full facility record, including everything entered at sign-up (address,
  // district/sub-county/parish, registration history) - not just the summary
  // columns the facilities table shows. SUPER_ADMIN for any facility; ADMIN
  // for their own only, via resolveClinicScope. This backs the "view details"
  // card on the facilities table and, for an ADMIN, on their own Billing page.
  async function fetchFacilityDetail(clinicId: string) {
    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      include: {
        users: { where: { role: 'ADMIN' }, select: { id: true, name: true, email: true, isActive: true }, take: 1 },
        subscription: { select: { status: true, plan: true, amount: true, currency: true, trialEndsAt: true, currentPeriodEnd: true, planNotes: true } },
        _count: { select: { users: true, patients: { where: { deletedAt: null } } } },
      },
    });
    if (!clinic) return null;
    return {
      id: clinic.id,
      facilityCode: clinic.facilityCode,
      name: clinic.name,
      facilityType: clinic.facilityType,
      phone: clinic.phone,
      address: clinic.address,
      district: clinic.district,
      subCounty: clinic.subCounty,
      parish: clinic.parish,
      registrationStatus: clinic.registrationStatus,
      rejectionReason: clinic.rejectionReason,
      isActive: clinic.isActive,
      createdAt: clinic.createdAt,
      approvedAt: clinic.approvedAt,
      deletedAt: clinic.deletedAt,
      admin: clinic.users[0] || null,
      subscription: clinic.subscription,
      users: clinic._count.users,
      patients: clinic._count.patients,
    };
  }

  fastify.get('/clinics/:id', { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, id);
    if (!clinicId) return;
    try {
      const facility = await fetchFacilityDetail(clinicId);
      if (!facility) return reply.status(404).send({ error: 'Facility not found' });
      return { success: true, facility };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // The same facility record as a single-row CSV download.
  fastify.get('/clinics/:id/export', { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, id);
    if (!clinicId) return;
    try {
      const facility = await fetchFacilityDetail(clinicId);
      if (!facility) return reply.status(404).send({ error: 'Facility not found' });

      const csv = buildCsv<typeof facility>(
        [
          ['Facility ID', (f) => f.facilityCode],
          ['Name', (f) => f.name],
          ['Type', (f) => f.facilityType],
          ['Phone', (f) => f.phone],
          ['Address', (f) => f.address],
          ['District', (f) => f.district],
          ['Sub-county', (f) => f.subCounty],
          ['Parish', (f) => f.parish],
          ['Registration status', (f) => f.registrationStatus],
          ['Rejection reason', (f) => f.rejectionReason],
          ['Active', (f) => (f.isActive ? 'Yes' : 'No')],
          ['Registered on', (f) => f.createdAt],
          ['Approved on', (f) => f.approvedAt],
          ['Deleted on', (f) => f.deletedAt],
          ['Administrator name', (f) => f.admin?.name],
          ['Administrator email', (f) => f.admin?.email],
          ['Administrator active', (f) => (f.admin ? (f.admin.isActive ? 'Yes' : 'No') : '')],
          ['Subscription status', (f) => f.subscription?.status],
          ['Subscription plan', (f) => f.subscription?.plan],
          ['Monthly amount', (f) => f.subscription?.amount],
          ['Currency', (f) => f.subscription?.currency],
          ['Trial ends', (f) => f.subscription?.trialEndsAt],
          ['Current period ends', (f) => f.subscription?.currentPeriodEnd],
          ['Staff count', (f) => f.users],
          ['Patient count', (f) => f.patients],
        ],
        [facility]
      );
      return sendCsv(reply, `bulamu-facility-${facility.facilityCode}.csv`, csv);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  fastify.get('/super-admin/overview', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const [clinicCount, activeClinicCount, userCount, patientCount, appointmentCount, consultationCount, revenue, clinics] =
        await Promise.all([
          prisma.clinic.count({ where: REAL_FACILITY }),
          prisma.clinic.count({ where: { ...REAL_FACILITY, isActive: true } }),
          // Real facilities only, and nothing deleted - the same rules as the
          // analytics page, so removed test facilities and Bulamu HQ don't count.
          prisma.user.count({ where: { isActive: true, role: { not: 'SUPER_ADMIN' }, clinic: { is: REAL_FACILITY } } }),
          prisma.patient.count({ where: { deletedAt: null, clinic: { is: REAL_FACILITY } } }),
          prisma.appointment.count({ where: { deletedAt: null, patient: { deletedAt: null, clinic: { is: REAL_FACILITY } } } }),
          prisma.consultation.count({ where: { deletedAt: null, patient: { deletedAt: null, clinic: { is: REAL_FACILITY } } } }),
          // Bulamu's own income: subscription payments received through Pesapal.
          // (Facilities' patient invoices are their money, not Bulamu's.)
          prisma.payment.aggregate({ where: { status: 'COMPLETED', amount: { gt: 0 }, clinic: { is: REAL_FACILITY } }, _sum: { amount: true } }),
          prisma.clinic.findMany({
            where: REAL_FACILITY,
            orderBy: { createdAt: 'desc' },
            include: {
              _count: {
                select: {
                  users: true,
                  patients: { where: { deletedAt: null } }
                }
              },
              users: {
                where: { role: 'ADMIN' },
                select: {
                  id: true,
                  name: true,
                  email: true,
                  isActive: true
                },
                take: 1
              },
              subscription: {
                select: { status: true, plan: true, amount: true, trialEndsAt: true, currentPeriodEnd: true, trialExtendedDays: true, lastPaymentAt: true }
              }
            }
          })
        ]);

      return {
        success: true,
        overview: {
          clinicCount,
          activeClinicCount,
          userCount,
          patientCount,
          appointmentCount,
          consultationCount,
          revenue: revenue._sum.amount || 0,
          clinics: clinics.map((clinic) => ({
            id: clinic.id,
            facilityCode: clinic.facilityCode,
            name: clinic.name,
            facilityType: clinic.facilityType,
            phone: clinic.phone,
            address: clinic.address,
            isActive: clinic.isActive,
            createdAt: clinic.createdAt,
            users: clinic._count.users,
            patients: clinic._count.patients,
            admin: clinic.users[0] || null,
            subscription: clinic.subscription
          }))
        }
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
  
  // Register new clinic (SUPER_ADMIN only)
  fastify.post('/clinics/register', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { name, facilityType = 'CLINIC', phone, address, adminEmail, adminPassword, adminName } = request.body as any;

    try {
      const duplicate = await findDuplicateFacility(phone);
      if (duplicate) {
        return reply.status(409).send({ error: duplicateFacilityMessage(duplicate) });
      }

      const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });
      if (existingUser) {
        return reply.status(409).send({ error: 'An account with this email already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      const facilityCode = await generateFacilityCode();

      const clinic = await prisma.clinic.create({
        data: {
          facilityCode,
          name,
          facilityType,
          phone,
          phoneKey: normalizePhoneKey(phone),
          address,
          registrationStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: getAuthUser(request).userId,
          users: {
            create: {
              email: adminEmail,
              password: hashedPassword,
              name: adminName,
              role: 'ADMIN'
            }
          },
          subscription: {
            create: {
              status: 'TRIALING',
              trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_MS),
              amount: DEFAULT_SUBSCRIPTION_AMOUNT,
              currency: 'UGX',
            },
          },
        },
        include: {
          users: true,
          subscription: true,
        }
      });

      // Created already approved, so the new administrator is told straight
      // away (their password is never emailed - the operator shares it), and
      // the operator gets a record of it.
      const authUser = getAuthUser(request);
      void (async () => {
        const result = await sendMail({
          to: adminEmail,
          subject: `${clinic.name} is approved on Bulamu`,
          html: facilityApprovedEmail(clinic.name, frontendUrl('/auth/login'), clinic.subscription?.trialEndsAt, {
            facilityCode: clinic.facilityCode, adminEmail, receiptAttached: false,
          }),
        });
        await alertOperator({
          subject: `Facility added - ${clinic.name}`,
          heading: 'Facility added by an administrator',
          facts: [
            ['Facility', clinic.name],
            ['Facility ID', clinic.facilityCode],
            ['Type', facilityTypeLabel(clinic.facilityType)],
            ['Added by', await actorName(authUser.userId)],
            ['Administrator', `${adminName} <${adminEmail}>`],
            ['Welcome email to the facility', deliveryNote(result)],
          ],
          ctaPath: '/super-admin',
          ctaLabel: 'Open Facility Management',
        });
      })().catch((error) => fastify.log.error(error, 'New facility emails failed'));

      // Never send password hashes back, even to the operator.
      const { users, ...rest } = clinic;
      return { success: true, clinic: { ...rest, users: users.map(({ password: _password, ...user }) => user) } };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ error: 'An account with this email already exists' });
      }
      return sendRouteError(reply, error, 400);
    }
  });

  fastify.patch('/clinics/:id/status', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const { isActive } = request.body as any;
    const reason = cleanReason((request.body as any)?.reason);

    try {
      const existing = await prisma.clinic.findUnique({ where: { id }, select: { isActive: true, deletedAt: true } });
      if (!existing || existing.deletedAt) return reply.status(404).send({ error: 'Facility not found' });

      const clinic = await prisma.clinic.update({
        where: { id },
        data: { isActive: Boolean(isActive) },
        select: {
          id: true,
          name: true,
          facilityCode: true,
          isActive: true
        }
      });

      await prisma.user.updateMany({
        where: { clinicId: id, role: { not: 'SUPER_ADMIN' } },
        data: { isActive: Boolean(isActive) }
      });

      // Only an actual change is announced (pressing "suspend" twice sends nothing new).
      if (existing.isActive !== clinic.isActive) {
        const authUser = getAuthUser(request);
        await recordAudit({ entity: 'Clinic', recordId: id, clinicId: id, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { isActive: clinic.isActive, ...(reason ? { reason } : {}) } });
        void (async () => {
          const admin = await facilityAdmin(id);
          const result = admin
            ? await sendMail({
                to: admin.email,
                subject: clinic.isActive ? `Access restored - ${clinic.name} - Bulamu` : `Access suspended - ${clinic.name} - Bulamu`,
                html: facilityStatusEmail(clinic.name, clinic.isActive, frontendUrl('/auth/login'), { adminName: admin.name, facilityCode: clinic.facilityCode, reason }),
              })
            : null;
          await alertOperator({
            subject: `Facility ${clinic.isActive ? 'reactivated' : 'suspended'} - ${clinic.name}`,
            heading: clinic.isActive ? 'Facility reactivated' : 'Facility suspended',
            facts: [
              ['Facility', clinic.name],
              ['Facility ID', clinic.facilityCode],
              [clinic.isActive ? 'Reactivated by' : 'Suspended by', await actorName(authUser.userId)],
              ['Reason given', reason],
              ['Email to the facility', deliveryNote(result)],
            ],
          });
        })().catch((error) => fastify.log.error(error, 'Facility status emails failed'));
      }

      return { success: true, clinic };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Permanently remove a facility from the active system (SUPER_ADMIN only).
  // This is a soft delete: clinical records are retained for audit/legal
  // retention, but the facility disappears from every listing and its staff
  // lose access immediately. Requires typing the exact facility name back as
  // confirmation, same pattern as GitHub's "delete this repository".
  fastify.delete('/clinics/:id', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const { confirmName, notifyFacility } = request.body as any;
    const reason = cleanReason((request.body as any)?.reason);

    try {
      const clinic = await prisma.clinic.findUnique({
        where: { id },
        include: { users: { where: { role: 'SUPER_ADMIN' }, select: { id: true } } },
      });
      if (!clinic || clinic.deletedAt) return reply.status(404).send({ error: 'Facility not found' });
      if (clinic.users.length > 0) {
        return reply.status(400).send({ error: 'This facility hosts administrator accounts and cannot be deleted' });
      }
      if (confirmName !== clinic.name) {
        return reply.status(400).send({ error: 'Facility name confirmation did not match' });
      }

      const authUser = getAuthUser(request);
      await prisma.$transaction([
        prisma.clinic.update({
          where: { id },
          data: { deletedAt: new Date(), deletedBy: authUser.userId, isActive: false },
        }),
        prisma.user.updateMany({ where: { clinicId: id }, data: { isActive: false } }),
      ]);

      await recordAudit({ entity: 'Clinic', recordId: id, clinicId: id, action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { name: clinic.name, facilityCode: clinic.facilityCode, ...(reason ? { reason } : {}) } });

      // The facility is told unless the operator chose not to (e.g. removing
      // a test facility whose address is not a real inbox).
      void (async () => {
        const admin = notifyFacility === false ? null : await facilityAdmin(id);
        const result = admin
          ? await sendMail({
              to: admin.email,
              subject: `Account closed - ${clinic.name} - Bulamu`,
              html: facilityRemovedEmail(clinic.name, { adminName: admin.name, facilityCode: clinic.facilityCode, reason }),
            })
          : null;
        await alertOperator({
          subject: `Facility deleted - ${clinic.name}`,
          heading: 'Facility deleted',
          intro: 'The facility has been removed from Bulamu and its staff can no longer sign in. Its records are retained under the data retention policy.',
          facts: [
            ['Facility', clinic.name],
            ['Facility ID', clinic.facilityCode],
            ['Deleted by', await actorName(authUser.userId)],
            ['Reason given', reason],
            ['Email to the facility', notifyFacility === false ? 'Not sent (you chose not to notify the facility)' : deliveryNote(result)],
          ],
        });
      })().catch((error) => fastify.log.error(error, 'Deletion emails failed'));

      return { success: true };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });
}
