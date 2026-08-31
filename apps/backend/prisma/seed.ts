import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SUPER_ADMIN_PASSWORD = 'BulamuSuperAdmin2025!';
const FACILITY_PASSWORD = 'BulamuAccess2026!';

async function ensureClinic(input: {
  name: string;
  facilityType: 'HOSPITAL' | 'HEALTH_CENTRE_III';
  phone: string;
  address: string;
}) {
  const existing = await prisma.clinic.findFirst({ where: { name: input.name } });
  if (existing) {
    return prisma.clinic.update({
      where: { id: existing.id },
      data: {
        facilityType: input.facilityType,
        phone: input.phone,
        address: input.address,
        isActive: true,
      },
    });
  }

  return prisma.clinic.create({
    data: {
      name: input.name,
      facilityType: input.facilityType,
      phone: input.phone,
      address: input.address,
      isActive: true,
    },
  });
}

async function ensureUser(input: {
  email: string;
  password: string;
  name: string;
  role: Role;
  clinicId: string;
}) {
  const hashedPassword = await bcrypt.hash(input.password, 10);

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      password: hashedPassword,
      name: input.name,
      role: input.role,
      clinicId: input.clinicId,
      isActive: true,
    },
    create: {
      email: input.email,
      password: hashedPassword,
      name: input.name,
      role: input.role,
      clinicId: input.clinicId,
      isActive: true,
    },
  });
}

async function main() {
  const hq = await ensureClinic({
    name: 'Bulamu HQ',
    facilityType: 'HOSPITAL',
    phone: '0700000000',
    address: 'Kampala, Uganda',
  });

  const evaluationFacility = await ensureClinic({
    name: 'Kawempe Health Centre III',
    facilityType: 'HEALTH_CENTRE_III',
    phone: '0700123456',
    address: 'Kawempe Division, Kampala',
  });

  await ensureUser({
    email: 'superadmin@bulamu.ug',
    password: SUPER_ADMIN_PASSWORD,
    name: 'Super Admin',
    role: 'SUPER_ADMIN',
    clinicId: hq.id,
  });

  await Promise.all([
    ensureUser({
      email: 'admin@kawempe.bulamu.ug',
      password: FACILITY_PASSWORD,
      name: 'Facility Admin',
      role: 'ADMIN',
      clinicId: evaluationFacility.id,
    }),
    ensureUser({
      email: 'doctor@kawempe.bulamu.ug',
      password: FACILITY_PASSWORD,
      name: 'Dr. Facility Clinician',
      role: 'DOCTOR',
      clinicId: evaluationFacility.id,
    }),
    ensureUser({
      email: 'nurse@kawempe.bulamu.ug',
      password: FACILITY_PASSWORD,
      name: 'Facility Nurse',
      role: 'NURSE',
      clinicId: evaluationFacility.id,
    }),
    ensureUser({
      email: 'pharmacist@kawempe.bulamu.ug',
      password: FACILITY_PASSWORD,
      name: 'Facility Pharmacist',
      role: 'PHARMACIST',
      clinicId: evaluationFacility.id,
    }),
    ensureUser({
      email: 'staff@kawempe.bulamu.ug',
      password: FACILITY_PASSWORD,
      name: 'Front Desk Officer',
      role: 'STAFF',
      clinicId: evaluationFacility.id,
    }),
  ]);

  console.log('Seeded access accounts ready');
  console.log(`Super Admin: superadmin@bulamu.ug / ${SUPER_ADMIN_PASSWORD}`);
  console.log(`Facility roles: admin|doctor|nurse|pharmacist|staff@kawempe.bulamu.ug / ${FACILITY_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
