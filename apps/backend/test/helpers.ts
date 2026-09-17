import bcrypt from 'bcrypt';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function seedClinic(overrides: Partial<{ name: string; facilityType: string; phone: string; address: string; registrationStatus: 'PENDING' | 'APPROVED' | 'REJECTED'; isActive: boolean }> = {}) {
  const phone = overrides.phone ?? '0700000000';
  const clinic = await prisma.clinic.create({
    data: {
      facilityCode: `BLM-TEST${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
      name: overrides.name ?? `Test Clinic ${Math.random().toString(16).slice(2)}`,
      facilityType: (overrides.facilityType as any) ?? 'CLINIC',
      phone,
      phoneKey: phone.replace(/\D/g, '').slice(-9),
      address: overrides.address ?? 'Test Address',
      registrationStatus: overrides.registrationStatus ?? 'APPROVED',
      isActive: overrides.isActive ?? true,
    },
  });

  // Approved test clinics get an active subscription by default so existing
  // write-path tests aren't blocked by the subscription gate - tests that
  // specifically exercise trial/past-due behavior create their own Subscription row.
  if (clinic.registrationStatus === 'APPROVED') {
    await prisma.subscription.create({
      data: { clinicId: clinic.id, status: 'ACTIVE', trialEndsAt: new Date() },
    });
  }

  return clinic;
}

export async function seedUser(input: {
  clinicId: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'DOCTOR' | 'PHARMACIST' | 'NURSE' | 'STAFF';
  email?: string;
  password?: string;
  name?: string;
}) {
  const password = input.password ?? 'TestPassword123!';
  const email = input.email ?? `${input.role.toLowerCase()}-${Math.random().toString(16).slice(2)}@test.bulamu.ug`;
  const hashed = await bcrypt.hash(password, 4); // low cost factor: tests only

  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      name: input.name ?? `Test ${input.role}`,
      role: input.role as any,
      clinicId: input.clinicId,
    },
  });

  return { user, password };
}

export async function loginAs(app: FastifyInstance, email: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });

  const body = response.json();
  if (!body.success) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
  }

  return { token: body.token as string, user: body.user };
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}
