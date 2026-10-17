import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { prisma } from './prisma';
import { generateFacilityCode, normalizePhoneKey } from './facility';
import { roleTitle } from './document-signer';

// A demonstration facility for showing Bulamu to prospective clients: every
// role has an account and enough made-up work to click through. It is marked
// isDemo, so it never counts in the platform's figures, and its staff are never
// emailed (their addresses are placeholders). Every name here is invented.

export const DEMO_FACILITY_NAME = 'Bulamu Test Facility';

const DAY = 24 * 60 * 60 * 1000;

const STAFF = [
  { key: 'admin', role: 'ADMIN', name: 'Grace Nankya', email: 'demo.admin@bulamu.site' },
  { key: 'doctor', role: 'DOCTOR', name: 'Dr Samuel Okello', email: 'demo.doctor@bulamu.site' },
  { key: 'nurse', role: 'NURSE', name: 'Sr Prossy Namubiru', email: 'demo.nurse@bulamu.site' },
  { key: 'pharmacist', role: 'PHARMACIST', name: 'Brian Mugisha', email: 'demo.pharmacist@bulamu.site' },
  { key: 'frontdesk', role: 'STAFF', name: 'Esther Atim', email: 'demo.frontdesk@bulamu.site' },
  { key: 'labtech', role: 'LAB_TECH', name: 'Ivan Kato', email: 'demo.lab@bulamu.site' },
] as const;

export type DemoAccount = { role: string; roleTitle: string; name: string; email: string; password: string };
export type DemoResult = { clinicId: string; facilityCode: string; created: boolean; accounts: DemoAccount[] };

/** Easy to read aloud or type: no 0/O, 1/l/I. */
function demoPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[randomInt(chars.length)];
  return `Demo-${out}`;
}

/**
 * Creates the demo facility (first time) or issues fresh passwords for its
 * accounts (every later time - the demo data is kept). Returns the logins.
 */
export async function createOrRefreshDemoFacility(now: Date = new Date()): Promise<DemoResult> {
  const existing = await prisma.clinic.findFirst({ where: { isDemo: true, name: DEMO_FACILITY_NAME, deletedAt: null } });
  const accounts: DemoAccount[] = STAFF.map((s) => ({ role: s.role, roleTitle: roleTitle(s.role), name: s.name, email: s.email, password: demoPassword() }));
  const hashes = await Promise.all(accounts.map((a) => bcrypt.hash(a.password, 10)));

  if (existing) {
    for (const [i, account] of accounts.entries()) {
      await prisma.user.upsert({
        where: { email: account.email },
        update: { password: hashes[i], isActive: true, clinicId: existing.id, role: account.role as any, name: account.name },
        create: { email: account.email, password: hashes[i], name: account.name, role: account.role as any, clinicId: existing.id, tourCompletedAt: null },
      });
    }
    return { clinicId: existing.id, facilityCode: existing.facilityCode, created: false, accounts };
  }

  const phone = '0700 000 900';
  const clinic = await prisma.clinic.create({
    data: {
      facilityCode: await generateFacilityCode(),
      name: DEMO_FACILITY_NAME,
      facilityType: 'HEALTH_CENTRE_III',
      phone,
      phoneKey: normalizePhoneKey(phone),
      address: 'Plot 1, Demo Road, Kampala',
      district: 'Kampala',
      subCounty: 'Central Division',
      parish: 'Nakasero',
      isActive: true,
      registrationStatus: 'APPROVED',
      approvedAt: now,
      isDemo: true,
      subscription: {
        create: {
          status: 'ACTIVE', plan: 'CUSTOM', planNotes: 'Demonstration facility - not billed.',
          trialEndsAt: now, currentPeriodEnd: new Date(now.getTime() + 3650 * DAY), amount: 0, currency: 'UGX',
        },
      },
    },
  });

  const users = {} as Record<(typeof STAFF)[number]['key'], { id: string; role: string }>;
  for (const [i, s] of STAFF.entries()) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: { password: hashes[i], isActive: true, clinicId: clinic.id, role: s.role as any, name: s.name },
      create: { email: s.email, password: hashes[i], name: s.name, role: s.role as any, clinicId: clinic.id },
    });
    users[s.key] = { id: user.id, role: s.role };
  }

  await seedDemoRecords(clinic.id, users, now);
  return { clinicId: clinic.id, facilityCode: clinic.facilityCode, created: true, accounts };
}

async function seedDemoRecords(clinicId: string, users: Record<string, { id: string; role: string }>, now: Date) {
  const at = (days: number, hour = 9) => {
    const d = new Date(now.getTime() + days * DAY);
    d.setUTCHours(hour - 3, 0, 0, 0); // East Africa Time
    return d;
  };
  const doctor = users.doctor.id;
  const nurse = users.nurse.id;

  // --- Stock (one low, one expiring soon) ---------------------------------------
  const stock = [
    { name: 'Artemether/Lumefantrine 20/120 mg', quantity: 240, unit: 'tablets', reorderLevel: 100, price: 250, expiryDays: 400 },
    { name: 'Paracetamol 500 mg', quantity: 1200, unit: 'tablets', reorderLevel: 300, price: 50, expiryDays: 600 },
    { name: 'Amoxicillin 500 mg', quantity: 60, unit: 'capsules', reorderLevel: 150, price: 200, expiryDays: 300 },
    { name: 'ORS sachets', quantity: 180, unit: 'sachets', reorderLevel: 50, price: 500, expiryDays: 45 },
    { name: 'Ferrous sulphate 200 mg', quantity: 500, unit: 'tablets', reorderLevel: 100, price: 30, expiryDays: 500 },
    { name: 'Metronidazole 400 mg', quantity: 320, unit: 'tablets', reorderLevel: 100, price: 80, expiryDays: 350 },
  ];
  const medicines = await Promise.all(stock.map((m) => prisma.medicine.create({
    data: { clinicId, name: m.name, quantity: m.quantity, unit: m.unit, reorderLevel: m.reorderLevel, price: m.price, expiryDate: new Date(now.getTime() + m.expiryDays * DAY) },
  })));
  const medicineId = (name: string) => medicines.find((m) => m.name.startsWith(name))?.id ?? null;

  // --- Patients -------------------------------------------------------------------
  const people = [
    { name: 'Achieng Mary', sex: 'FEMALE', dob: '1992-04-12', village: 'Kisenyi', kin: 'Okello John', allergies: [{ substance: 'Penicillin', severity: 'SEVERE', reaction: 'Rash and swelling' }] },
    { name: 'Mukasa Joseph', sex: 'MALE', dob: '1985-09-30', village: 'Wandegeya', kin: 'Nakato Sarah', allergies: null },
    { name: 'Nalubega Faith', sex: 'FEMALE', dob: '2019-02-08', village: 'Katanga', kin: 'Nalubega Ruth (mother)', allergies: null },
    { name: 'Opio Daniel', sex: 'MALE', dob: '1970-11-02', village: 'Bwaise', kin: 'Opio Grace', allergies: [{ substance: 'Sulfa drugs', severity: 'MODERATE', reaction: 'Itching' }] },
    { name: 'Nakimuli Agnes', sex: 'FEMALE', dob: '1998-06-21', village: 'Kamwokya', kin: 'Ssali Peter', allergies: null },
    { name: 'Tumusiime Brian', sex: 'MALE', dob: '2004-01-17', village: 'Makerere', kin: 'Tumusiime Joy', allergies: null },
    { name: 'Akello Christine', sex: 'FEMALE', dob: '1988-12-03', village: 'Ntinda', kin: 'Akello James', allergies: null },
    { name: 'Ssempijja Moses', sex: 'MALE', dob: '1963-07-14', village: 'Kawempe', kin: 'Nabukenya Rose', allergies: null },
  ] as const;
  const patients = [];
  for (const [i, p] of people.entries()) {
    patients.push(await prisma.patient.create({
      data: {
        clinicId, name: p.name, phone: `0700 000 9${String(i + 10)}`, sex: p.sex, dateOfBirth: new Date(p.dob),
        village: p.village, parish: 'Nakasero', subCounty: 'Central Division', district: 'Kampala',
        nextOfKinName: p.kin, nextOfKinPhone: `0700 000 8${String(i + 10)}`,
        consentGivenAt: at(-30 + i), consentGivenBy: users.frontdesk.id,
        allergyStatus: p.allergies ? 'KNOWN' : 'NONE_KNOWN', allergies: (p.allergies as any) ?? undefined,
        allergiesUpdatedAt: at(-30 + i), allergiesUpdatedBy: nurse,
        createdAt: at(-30 + i),
      },
    }));
  }

  // --- Past visits: consultation, diagnosis, prescriptions, fee, lab -------------------
  const visits = [
    { patient: 0, days: -6, symptoms: 'Fever and headache for 3 days', dx: [{ code: 'B54', description: 'Malaria, unspecified' }], rx: ['Artemether/Lumefantrine', 'Paracetamol'], fee: 20000, paid: true, lab: { test: 'Malaria RDT', result: 'Positive' } },
    { patient: 1, days: -5, symptoms: 'Cough for two weeks, night sweats', dx: [{ code: 'J20.9', description: 'Acute bronchitis, unspecified' }], rx: ['Amoxicillin'], fee: 25000, paid: true, lab: { test: 'Sputum GeneXpert', result: 'MTB not detected' } },
    { patient: 2, days: -3, symptoms: 'Diarrhoea and vomiting since yesterday', dx: [{ code: 'A09', description: 'Gastroenteritis and colitis of unspecified origin' }], rx: ['ORS'], fee: 15000, paid: false, lab: null },
    { patient: 4, days: -2, symptoms: 'Tiredness, dizziness', dx: [{ code: 'D50.9', description: 'Iron deficiency anaemia, unspecified' }], rx: ['Ferrous sulphate'], fee: 20000, paid: false, lab: { test: 'Haemoglobin', result: '9.4 g/dL', awaitingVerification: true } },
    { patient: 3, days: -1, symptoms: 'Burning on passing urine', dx: [{ code: 'N39.0', description: 'Urinary tract infection, site not specified' }], rx: ['Metronidazole'], fee: 20000, paid: false, lab: { test: 'Urinalysis', result: null } },
  ];
  const DOSES: Record<string, { strength: string; form: string; dosage: string; frequency: string; duration: string; quantity: number }> = {
    'Artemether/Lumefantrine': { strength: '20/120 mg', form: 'tablet', dosage: '4 tablets', frequency: 'twice daily', duration: '3 days', quantity: 24 },
    Paracetamol: { strength: '500 mg', form: 'tablet', dosage: '2 tablets', frequency: 'three times daily', duration: '3 days', quantity: 18 },
    Amoxicillin: { strength: '500 mg', form: 'capsule', dosage: '1 capsule', frequency: 'three times daily', duration: '5 days', quantity: 15 },
    ORS: { strength: '1 sachet', form: 'sachet', dosage: '1 sachet in 1 litre of water', frequency: 'after each loose stool', duration: '3 days', quantity: 10 },
    'Ferrous sulphate': { strength: '200 mg', form: 'tablet', dosage: '1 tablet', frequency: 'once daily', duration: '30 days', quantity: 30 },
    Metronidazole: { strength: '400 mg', form: 'tablet', dosage: '1 tablet', frequency: 'three times daily', duration: '7 days', quantity: 21 },
  };
  for (const [i, v] of visits.entries()) {
    const patient = patients[v.patient];
    const appointment = await prisma.appointment.create({
      data: { clinicId, patientId: patient.id, doctorId: doctor, date: at(v.days), time: `${9 + i}:00`, status: 'COMPLETED', createdAt: at(v.days - 1) },
    });
    const consultation = await prisma.consultation.create({
      data: {
        appointmentId: appointment.id, patientId: patient.id, diagnosis: v.dx[0].description, symptoms: v.symptoms,
        clinicalNotes: 'Example note for the demonstration facility.', serviceTags: [], createdAt: at(v.days, 10), recordedByUserId: doctor,
        diagnoses: { create: v.dx.map((d) => ({ icd10Code: d.code, description: d.description, type: 'PRIMARY' as const, certainty: 'CONFIRMED' as const })) },
        prescriptions: {
          create: v.rx.map((name) => ({
            medication: name,
            ...DOSES[name], route: 'oral', instructions: null, medicineId: medicineId(name),
            // The older visits have been dispensed already.
            ...(v.days <= -5 ? { dispensedAt: at(v.days, 11), dispensedByUserId: users.pharmacist.id, dispensedQuantity: DOSES[name].quantity } : {}),
          })),
        },
        invoice: { create: { clinicId, amount: v.fee, status: v.paid ? 'PAID' : 'PENDING', paidAt: v.paid ? at(v.days, 11) : null, createdAt: at(v.days, 10) } },
      },
    });
    if (v.lab) {
      await prisma.labTest.create({
        data: {
          patientId: patient.id, consultationId: consultation.id, testName: v.lab.test, results: v.lab.result ?? '',
          status: v.lab.result ? 'COMPLETED' : 'PENDING', orderedBy: 'Dr Samuel Okello', orderedByUserId: doctor,
          completedAt: v.lab.result ? at(v.days, 12) : null, createdAt: at(v.days, 10),
          // Entered by the lab technician; verified by the doctor - except one, left
          // waiting so the verification step can be shown.
          ...(v.lab.result ? { resultedByUserId: users.labtech.id, resultedAt: at(v.days, 12) } : {}),
          ...(v.lab.result && !('awaitingVerification' in v.lab) ? { verifiedByUserId: doctor, verifiedAt: at(v.days, 13) } : {}),
        },
      });
    }
  }

  // --- Today's and upcoming appointments ------------------------------------------------
  for (const [i, p] of [patients[5], patients[6], patients[7]].entries()) {
    await prisma.appointment.create({ data: { clinicId, patientId: p.id, doctorId: doctor, date: at(i === 2 ? 1 : 0), time: `${14 + i}:00`, status: 'SCHEDULED', notes: i === 0 ? 'Review visit' : null } });
  }

  // --- Wards: one patient admitted now, one discharged -------------------------------------
  const [female, male] = await Promise.all([
    prisma.ward.create({ data: { clinicId, name: 'Female Ward', type: 'FEMALE', beds: 12 } }),
    prisma.ward.create({ data: { clinicId, name: 'Male Ward', type: 'MALE', beds: 10 } }),
    prisma.ward.create({ data: { clinicId, name: 'Maternity', type: 'MATERNITY', beds: 8 } }),
  ]);
  const admitted = await prisma.admission.create({
    data: {
      clinicId, patientId: patients[0].id, wardId: female.id, bed: '3', reason: 'Severe malaria with vomiting', admissionIcd10Code: 'B50.9',
      attendingDoctorId: doctor, admittedByUserId: nurse, admittedAt: at(-1, 15),
    },
  });
  await prisma.admissionNote.createMany({
    data: [
      { admissionId: admitted.id, authorUserId: nurse, authorRole: 'NURSE', kind: 'OBSERVATION', vitals: { temperatureC: 38.9, pulse: 112, systolic: 104, diastolic: 66, spo2: 96 }, createdAt: at(-1, 16) },
      { admissionId: admitted.id, authorUserId: doctor, authorRole: 'DOCTOR', kind: 'WARD_ROUND', note: 'Started on IV artesunate. Review in the morning.', createdAt: at(-1, 17) },
      { admissionId: admitted.id, authorUserId: nurse, authorRole: 'NURSE', kind: 'OBSERVATION', vitals: { temperatureC: 37.6, pulse: 92, systolic: 112, diastolic: 70, spo2: 98 }, createdAt: at(0, 8) },
    ],
  });
  await prisma.admission.create({
    data: {
      clinicId, patientId: patients[7].id, wardId: male.id, bed: '6', reason: 'Pneumonia', admissionIcd10Code: 'J18.9',
      attendingDoctorId: doctor, admittedByUserId: nurse, admittedAt: at(-9, 11), status: 'DISCHARGED', dischargedAt: at(-4, 12), dischargedByUserId: doctor,
      outcome: 'RECOVERED', dischargeDiagnosis: 'Community-acquired pneumonia, resolved', dischargeIcd10Code: 'J18.9',
      dischargeSummary: 'Treated with IV then oral antibiotics; afebrile for 48 hours before discharge.',
      followUpInstructions: 'Complete the oral antibiotics. Return in 2 weeks for review.',
    },
  });

  // --- Reproductive health, for a female patient -------------------------------------------
  await prisma.reproductiveHealthRecord.create({
    data: {
      patientId: patients[4].id, recordedById: nurse, lastMenstrualPeriodDate: at(-20), cycleLengthDays: 28, flowDurationDays: 5,
      familyPlanningMethod: 'INJECTABLE', pregnancyStatus: 'NOT_PREGNANT', gravida: 1, para: 1, notes: 'Example record.',
    },
  });

  // --- A few notifications, so each role's inbox shows something ---------------------------
  const note = (userId: string, type: string, title: string, body: string, link: string, hoursAgo: number) => ({
    userId, clinicId, type: type as any, title, body, link, createdAt: new Date(now.getTime() - hoursAgo * 3600 * 1000),
  });
  await prisma.notification.createMany({
    data: [
      note(users.pharmacist.id, 'NEW_PRESCRIPTION', 'New prescription: Nakimuli Agnes', '1 item to dispense for Nakimuli Agnes.', '/dispensing', 30),
      note(users.pharmacist.id, 'LOW_STOCK', 'Low stock: Amoxicillin 500 mg', '60 capsules left - at or below the reorder level of 150.', '/inventory', 20),
      note(users.admin.id, 'LOW_STOCK', 'Low stock: Amoxicillin 500 mg', '60 capsules left - at or below the reorder level of 150.', '/inventory', 20),
      note(users.pharmacist.id, 'STOCK_EXPIRING', 'Expiring soon: ORS sachets', '180 sachets of ORS sachets expire within two months.', '/inventory', 10),
      note(users.labtech.id, 'LAB_TEST_ORDERED', 'New lab test: Opio Daniel', 'Urinalysis ordered by Dr Samuel Okello.', '/lab', 24),
      note(users.nurse.id, 'LAB_TEST_ORDERED', 'New lab test: Opio Daniel', 'Urinalysis ordered by Dr Samuel Okello.', '/lab', 24),
      note(users.doctor.id, 'LAB_RESULT_AVAILABLE', 'Result ready: Haemoglobin', 'The Haemoglobin result for Nakimuli Agnes has been recorded. Review and verify it on the Lab page - the patient is told once it is verified.', '/lab', 40),
      note(users.nurse.id, 'PATIENT_ADMITTED', 'Patient admitted: Achieng Mary', 'Female Ward, bed 3 - Severe malaria with vomiting.', '/wards', 18),
      note(users.doctor.id, 'APPOINTMENT_BOOKED', 'New appointment: Tumusiime Brian', 'Booked with you today at 14:00.', '/appointments', 6),
      note(users.frontdesk.id, 'APPOINTMENT_REQUESTED', 'Appointment request', 'A patient asked for an appointment through the Patient Portal.', '/appointments', 4),
    ],
  });
}
