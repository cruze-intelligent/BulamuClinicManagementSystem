import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Check if super admin already exists
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });

  if (existingSuperAdmin) {
    console.log('Super admin already exists!');
    return;
  }

  // Create a dummy clinic for super admin
  const superClinic = await prisma.clinic.create({
    data: {
      name: 'Bulamu HQ',
      phone: '0700000000',
      address: 'Kampala, Uganda',
      isActive: true
    }
  });

  // Create super admin
  const hashedPassword = await bcrypt.hash('BulamuSuperAdmin2025!', 10);
  
  const superAdmin = await prisma.user.create({
    data: {
      email: 'superadmin@bulamu.ug',
      password: hashedPassword,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      clinicId: superClinic.id,
      isActive: true
    }
  });

  console.log('✅ Super Admin created!');
  console.log('Email: superadmin@bulamu.ug');
  console.log('Password: BulamuSuperAdmin2025!');
  console.log('IMPORTANT: Change this password after first login!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });