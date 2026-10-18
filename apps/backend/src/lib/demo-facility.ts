import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { prisma } from './prisma';
import { generateFacilityCode, normalizePhoneKey } from './facility';
import { roleTitle } from './document-signer';
import { generatePortableId } from './patient-account';

// Demonstration facilities for showing Bulamu to prospective clients. Every
// demo is private to the one person it was sent to: its own facility, made-up
// records to click through, and its own sign-ins for every role. It closes
// after DEMO_DAYS. It is marked isDemo, so it never counts in the platform's
// figures and its staff are never emailed (their addresses are placeholders).
// The recipient's own email address is not stored anywhere: what Bulamu keeps
// about a demo is only how it was used (see demoUsage). Every name is invented.

export const DEMO_FACILITY_NAME = 'Bulamu Test Facility';
export const DEMO_DAYS = 14;
export { DEMO_EMAIL_DOMAIN } from './mailer';
import { DEMO_EMAIL_DOMAIN } from './mailer';

const DAY = 24 * 60 * 60 * 1000;

const STAFF = [
  { key: 'admin', role: 'ADMIN', name: 'Grace Nankya' },
  { key: 'frontdesk', role: 'STAFF', name: 'Esther Atim' },
  { key: 'doctor', role: 'DOCTOR', name: 'Dr Samuel Okello' },
  { key: 'labtech', role: 'LAB_TECH', name: 'Ivan Kato' },
  { key: 'pharmacist', role: 'PHARMACIST', name: 'Brian Mugisha' },
  { key: 'nurse', role: 'NURSE', name: 'Sr Prossy Namubiru' },
] as const;

export type DemoAccount = { role: string; roleTitle: string; name: string; email: string };
export type DemoPatientAccount = { name: string; email: string; portableId: string };
export type DemoResult = {
  clinicId: string; facilityCode: string; demoCode: string; password: string; expiresAt: Date;
  accounts: DemoAccount[];
  /** A Patient Portal sign-in, so the patient's side can be shown too. */
  patient: DemoPatientAccount;
};

/** The demo patient who gets a Patient Portal sign-in: she has visits, a verified result and a hospital stay. */
const DEMO_PORTAL_PATIENT = 'Achieng Mary';

// Easy to read aloud and type, and unlike any real password.
const WORDS = [
  'Acacia', 'Amber', 'Banana', 'Cedar', 'Coffee', 'Comet', 'Coral', 'Falcon', 'Harbour', 'Jasmine', 'Lantern', 'Maple',
  'Meadow', 'Mango', 'Orbit', 'Papaya', 'Pebble', 'Pepper', 'River', 'Savanna', 'Sunrise', 'Tamarind', 'Willow', 'Zebra',
];

/**
 * The demo password as it was meant to be typed: phone keyboards capitalise or
 * lower-case words and copying from an email can bring a space along, so
 * "  mango-river-4821" is read as "Mango-River-4821". Only ever tried for demo
 * accounts, whose passwords all have this shape.
 */
export function tidyDemoPassword(typed: string): string {
  return typed.trim().split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join('-');
}

function demoPassword(): string {
  const first = WORDS[randomInt(WORDS.length)];
  let second = WORDS[randomInt(WORDS.length)];
  while (second === first) second = WORDS[randomInt(WORDS.length)];
  return `${first}-${second}-${randomInt(1000, 10000)}`;
}

/** Six letters that make each demo's sign-ins its own: admin.kvdbmz@demo.bulamu.site. */
async function newDemoCode(): Promise<string> {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += letters[randomInt(letters.length)];
    const taken = await prisma.user.findFirst({ where: { email: { endsWith: `.${code}@${DEMO_EMAIL_DOMAIN}` } }, select: { id: true } });
    if (!taken) return code;
  }
}

export const demoEmail = (key: string, code: string) => `${key}.${code}@${DEMO_EMAIL_DOMAIN}`;

/** Whether a demo has closed (its time ran out, or it was closed early). */
export function demoHasEnded(clinic: { isDemo: boolean; demoExpiresAt: Date | null; deletedAt: Date | null }, now: Date = new Date()): boolean {
  return clinic.isDemo && (!!clinic.deletedAt || (!!clinic.demoExpiresAt && clinic.demoExpiresAt <= now));
}

/**
 * A new demo facility, private to one person: its own records and sign-ins
 * (one shared password, so switching role is easy). Creating one never
 * touches any other demo, so logins already sent out keep working.
 */
export async function createDemoFacility(now: Date = new Date()): Promise<DemoResult> {
  const demoCode = await newDemoCode();
  const password = demoPassword();
  const hash = await bcrypt.hash(password, 10);
  const expiresAt = new Date(now.getTime() + DEMO_DAYS * DAY);

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
      demoExpiresAt: expiresAt,
      subscription: {
        create: {
          status: 'ACTIVE', plan: 'CUSTOM', planNotes: 'Demonstration facility - not billed.',
          trialEndsAt: now, currentPeriodEnd: expiresAt, amount: 0, currency: 'UGX',
        },
      },
    },
  });

  const users = {} as Record<(typeof STAFF)[number]['key'], { id: string; role: string }>;
  const accounts: DemoAccount[] = [];
  for (const s of STAFF) {
    const email = demoEmail(s.key, demoCode);
    const user = await prisma.user.create({ data: { email, password: hash, name: s.name, role: s.role, clinicId: clinic.id } });
    users[s.key] = { id: user.id, role: s.role };
    accounts.push({ role: s.role, roleTitle: roleTitle(s.role), name: s.name, email });
  }

  await seedDemoRecords(clinic.id, users, now);
  await seedReferralPartner(clinic.id, users, now);

  // The patient's side: a Patient Portal account for one of the demo patients,
  // with the same password, ready to use (no first-time password change).
  const portalPatient = await prisma.patient.findFirstOrThrow({ where: { clinicId: clinic.id, name: DEMO_PORTAL_PATIENT } });
  const portal = await prisma.patientAccount.create({
    data: {
      portableId: await generatePortableId(),
      email: demoEmail('patient', demoCode),
      phone: portalPatient.phone,
      phoneKey: normalizePhoneKey(portalPatient.phone),
      password: hash,
      mustResetPassword: false,
      createdByClinicId: clinic.id,
      createdByUserId: users.frontdesk.id,
      patients: { connect: { id: portalPatient.id } },
    },
  });
  const patient = { name: DEMO_PORTAL_PATIENT, email: portal.email, portableId: portal.portableId };
  return { clinicId: clinic.id, facilityCode: clinic.facilityCode, demoCode, password, expiresAt, accounts, patient };
}

export const DEMO_PARTNER_NAME = 'Bulamu Referral Hospital';

/**
 * A made-up hospital that belongs to one demo, so referrals can be shown in
 * both directions without a demo ever reaching a real facility. It has no
 * staff, closes with its demo and is not a demo of its own (parentFacilityId).
 */
async function seedReferralPartner(clinicId: string, users: Record<string, { id: string; role: string }>, now: Date) {
  const demo = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { demoExpiresAt: true } });
  const phone = '0700 000 950';
  const partner = await prisma.clinic.create({
    data: {
      facilityCode: await generateFacilityCode(), name: DEMO_PARTNER_NAME, facilityType: 'HOSPITAL', phone, phoneKey: normalizePhoneKey(phone),
      address: 'Plot 2, Demo Hill, Kampala', district: 'Kampala', isActive: true, registrationStatus: 'APPROVED', approvedAt: now,
      isDemo: true, demoExpiresAt: demo.demoExpiresAt, parentFacilityId: clinicId,
    },
  });
  const day = (n: number) => new Date(now.getTime() + n * DAY);

  // Sent: Opio Daniel, referred on for a scan and accepted.
  const opio = await prisma.patient.findFirstOrThrow({ where: { clinicId, name: 'Opio Daniel' } });
  await prisma.referral.create({
    data: {
      patientId: opio.id, fromClinicId: clinicId, toClinicId: partner.id, urgency: 'ROUTINE', status: 'ACCEPTED',
      reason: 'Abdominal ultrasound for recurrent urinary infections',
      clinicalSummary: 'Three urinary tract infections in six months. Treated with metronidazole this visit. Please assess for a structural cause.',
      referredByUserId: users.doctor.id, consentRecordedAt: day(-1), respondedAt: day(-1), responseNote: 'Booked for an ultrasound on Thursday.', createdAt: day(-1),
    },
  });

  // Received: a patient referred in from the hospital, waiting for the front desk.
  const incoming = await prisma.patient.create({
    data: {
      clinicId: partner.id, name: 'Kisakye Ruth', phone: '0700 000 951', sex: 'FEMALE', dateOfBirth: new Date('1990-03-09'),
      district: 'Kampala', allergyStatus: 'NONE_KNOWN', consentGivenAt: day(-2),
    },
  });
  await prisma.referral.create({
    data: {
      patientId: incoming.id, fromClinicId: partner.id, toClinicId: clinicId, urgency: 'URGENT', status: 'PENDING',
      reason: 'Follow-up of hypertension closer to home',
      clinicalSummary: 'Admitted with blood pressure 190/110, now 140/90 on amlodipine 5 mg daily. Please review in two weeks and continue treatment.',
      consentRecordedAt: day(0), createdAt: day(0),
    },
  });
}

/** Closes every demo whose time has run out: nobody can sign in to it any more. */
export async function closeExpiredDemos(now: Date = new Date()): Promise<number> {
  const expired = await prisma.clinic.findMany({
    where: { isDemo: true, deletedAt: null, demoExpiresAt: { lte: now } },
    select: { id: true },
  });
  if (!expired.length) return 0;
  const ids = expired.map((c) => c.id);
  await prisma.$transaction([
    prisma.user.updateMany({ where: { clinicId: { in: ids } }, data: { isActive: false } }),
    prisma.patientAccount.updateMany({ where: { createdByClinicId: { in: ids }, status: 'ACTIVE' }, data: { status: 'SUSPENDED' } }),
    prisma.clinic.updateMany({ where: { id: { in: ids } }, data: { isActive: false, deletedAt: now } }),
  ]);
  return ids.length;
}

export type DemoUsage = {
  clinicId: string;
  facilityCode: string;
  demoCode: string | null;
  createdAt: string;
  expiresAt: string | null;
  open: boolean;
  signIns: number;
  failedSignIns: number;
  daysActive: number;
  lastSeenAt: string | null;
  rolesTried: string[];
  recordsAdded: number;
  areasUsed: Array<{ area: string; count: number }>;
};

/**
 * How each demo has been used - the only thing kept about a demo: sign-ins,
 * days active, which roles were tried and how many records the visitor added
 * (by kind). Never who it was sent to.
 */
export async function demoUsage(now: Date = new Date(), limit = 50): Promise<DemoUsage[]> {
  const demos = await prisma.clinic.findMany({
    where: { isDemo: true, parentFacilityId: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, facilityCode: true, createdAt: true, demoExpiresAt: true, deletedAt: true, isDemo: true,
      users: { select: { email: true, role: true, lastLoginAt: true, lastSeenAt: true } },
    },
  });
  if (!demos.length) return [];
  const ids = demos.map((d) => d.id);
  const [logins, activeDays, records] = await Promise.all([
    prisma.loginEvent.groupBy({ by: ['clinicId', 'outcome'], where: { clinicId: { in: ids } }, _count: true }),
    prisma.userActivityDay.groupBy({ by: ['clinicId', 'day'], where: { clinicId: { in: ids } } }),
    // Records the visitor added or changed - not the operator's own setup entry.
    prisma.auditLog.groupBy({ by: ['clinicId', 'entity'], where: { clinicId: { in: ids }, actorRole: { not: 'SUPER_ADMIN' } }, _count: true }),
  ]);
  return demos.map((d) => {
    const signIns = logins.filter((l) => l.clinicId === d.id && l.outcome === 'SUCCESS').reduce((a, l) => a + l._count, 0);
    const failedSignIns = logins.filter((l) => l.clinicId === d.id && l.outcome !== 'SUCCESS').reduce((a, l) => a + l._count, 0);
    const areas = records.filter((r) => r.clinicId === d.id).map((r) => ({ area: r.entity, count: r._count })).sort((a, b) => b.count - a.count);
    const seen = d.users.map((u) => u.lastSeenAt?.getTime() ?? 0).filter(Boolean);
    const code = d.users.map((u) => /^[a-z]+\.([a-z]+)@demo\.bulamu\.site$/.exec(u.email)?.[1]).find(Boolean) ?? null;
    return {
      clinicId: d.id,
      facilityCode: d.facilityCode,
      demoCode: code,
      createdAt: d.createdAt.toISOString(),
      expiresAt: d.demoExpiresAt ? d.demoExpiresAt.toISOString() : null,
      open: !demoHasEnded(d, now),
      signIns,
      failedSignIns,
      daysActive: activeDays.filter((a) => a.clinicId === d.id).length,
      lastSeenAt: seen.length ? new Date(Math.max(...seen)).toISOString() : null,
      rolesTried: [...new Set(d.users.filter((u) => u.lastLoginAt).map((u) => roleTitle(u.role)))],
      recordsAdded: areas.reduce((a, r) => a + r.count, 0),
      areasUsed: areas,
    };
  });
}

async function seedDemoRecords(clinicId: string, users: Record<string, { id: string; role: string }>, now: Date) {
  // The given hour (East Africa Time) on the Kampala day `days` from today.
  const at = (days: number, hour = 9) => {
    const kampala = new Date(now.getTime() + days * DAY + 3 * 60 * 60 * 1000);
    return new Date(Date.UTC(kampala.getUTCFullYear(), kampala.getUTCMonth(), kampala.getUTCDate(), hour - 3));
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
    { patient: 0, days: -6, symptoms: 'Fever and headache for 3 days', dx: [{ code: 'B54', description: 'Malaria, unspecified' }], rx: ['Artemether/Lumefantrine', 'Paracetamol'], fee: 20000, labFee: 5000, payments: [{ days: -6, hour: 12, amount: 31900, method: 'MOBILE_MONEY', reference: 'MP2610.1432.A71234' }], lab: { test: 'Malaria RDT', result: 'Positive' } },
    { patient: 1, days: -5, symptoms: 'Cough for two weeks, night sweats', dx: [{ code: 'J20.9', description: 'Acute bronchitis, unspecified' }], rx: ['Amoxicillin'], fee: 25000, labFee: 0, payments: [{ days: -5, hour: 12, amount: 28000, method: 'CASH' }], lab: { test: 'Sputum GeneXpert', result: 'MTB not detected' } },
    { patient: 2, days: -3, symptoms: 'Diarrhoea and vomiting since yesterday', dx: [{ code: 'A09', description: 'Gastroenteritis and colitis of unspecified origin' }], rx: ['ORS'], fee: 15000, labFee: 0, payments: [{ days: -3, hour: 11, amount: 10000, method: 'CASH' }], lab: null },
    { patient: 4, days: -2, symptoms: 'Tiredness, dizziness', dx: [{ code: 'D50.9', description: 'Iron deficiency anaemia, unspecified' }], rx: ['Ferrous sulphate'], fee: 20000, labFee: 8000, payments: [{ days: 0, hour: 10, amount: 10000, method: 'MOBILE_MONEY', reference: 'MP2610.0915.K20981' }], lab: { test: 'Haemoglobin', result: '9.4 g/dL', awaitingVerification: true } },
    { patient: 3, days: -1, symptoms: 'Burning on passing urine', dx: [{ code: 'N39.0', description: 'Urinary tract infection, site not specified' }], rx: ['Metronidazole'], fee: 20000, labFee: 6000, payments: [], lab: { test: 'Urinalysis', result: null } },
  ];
  const DOSES: Record<string, { strength: string; form: string; dosage: string; frequency: string; duration: string; quantity: number }> = {
    'Artemether/Lumefantrine': { strength: '20/120 mg', form: 'tablet', dosage: '4 tablets', frequency: 'twice daily', duration: '3 days', quantity: 24 },
    Paracetamol: { strength: '500 mg', form: 'tablet', dosage: '2 tablets', frequency: 'three times daily', duration: '3 days', quantity: 18 },
    Amoxicillin: { strength: '500 mg', form: 'capsule', dosage: '1 capsule', frequency: 'three times daily', duration: '5 days', quantity: 15 },
    ORS: { strength: '1 sachet', form: 'sachet', dosage: '1 sachet in 1 litre of water', frequency: 'after each loose stool', duration: '3 days', quantity: 10 },
    'Ferrous sulphate': { strength: '200 mg', form: 'tablet', dosage: '1 tablet', frequency: 'once daily', duration: '30 days', quantity: 30 },
    Metronidazole: { strength: '400 mg', form: 'tablet', dosage: '1 tablet', frequency: 'three times daily', duration: '7 days', quantity: 21 },
  };
  // Payments are numbered in the order they were taken, once every bill exists.
  const takings: Array<{ invoiceId: string; at: Date; amount: number; method: 'CASH' | 'MOBILE_MONEY'; reference?: string }> = [];
  const priceOf = (id: string | null) => medicines.find((m) => m.id === id)?.price ?? 0;
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
      },
      include: { prescriptions: true },
    });
    let labTestId: string | null = null;
    if (v.lab) {
      labTestId = (await prisma.labTest.create({
        data: {
          patientId: patient.id, consultationId: consultation.id, testName: v.lab.test, results: v.lab.result ?? '',
          status: v.lab.result ? 'COMPLETED' : 'PENDING', orderedBy: 'Dr Samuel Okello', orderedByUserId: doctor,
          completedAt: v.lab.result ? at(v.days, 12) : null, createdAt: at(v.days, 10),
          // Entered by the lab technician; verified by the doctor - except one, left
          // waiting so the verification step can be shown.
          ...(v.lab.result ? { resultedByUserId: users.labtech.id, resultedAt: at(v.days, 12) } : {}),
          ...(v.lab.result && !('awaitingVerification' in v.lab) ? { verifiedByUserId: doctor, verifiedAt: at(v.days, 13) } : {}),
        },
      })).id;
    }
    // The bill: the consultation, the lab test (when the facility charges for it) and the medicines.
    const lines = [
      { kind: 'CONSULTATION' as const, description: 'Consultation', quantity: 1, unitPrice: v.fee },
      ...(v.lab && v.labFee ? [{ kind: 'LAB' as const, description: v.lab.test, quantity: 1, unitPrice: v.labFee, labTestId }] : []),
      ...consultation.prescriptions.filter((rx) => priceOf(rx.medicineId) > 0).map((rx) => ({
        kind: 'MEDICINE' as const, description: `${rx.medication} ${rx.strength ?? ''}`.trim(), quantity: rx.quantity ?? 1, unitPrice: priceOf(rx.medicineId), prescriptionId: rx.id,
      })),
    ];
    const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const invoice = await prisma.invoice.create({
      data: {
        clinicId, patientId: patient.id, consultationId: consultation.id, amount: total, createdAt: at(v.days, 10), createdByUserId: doctor,
        items: { create: lines.map((l) => ({ ...l, amount: l.quantity * l.unitPrice, addedByUserId: doctor, createdAt: at(v.days, 10) })) },
      },
    });
    for (const p of v.payments) takings.push({ invoiceId: invoice.id, at: at(p.days, p.hour), amount: p.amount, method: p.method as 'CASH' | 'MOBILE_MONEY', reference: 'reference' in p ? p.reference : undefined });
  }

  // A walk-in buying paracetamol over the counter this morning - a bill without a visit.
  const walkIn = await prisma.invoice.create({
    data: {
      clinicId, patientId: patients[5].id, amount: 1000, createdAt: at(0, 9), createdByUserId: users.pharmacist.id,
      items: { create: { kind: 'MEDICINE', description: 'Paracetamol 500 mg', quantity: 20, unitPrice: 50, amount: 1000, addedByUserId: users.pharmacist.id, createdAt: at(0, 9) } },
    },
  });
  takings.push({ invoiceId: walkIn.id, at: at(0, 9), amount: 1000, method: 'CASH' });

  // Nothing is received in the future: this morning's payments, for a demo opened at dawn, are just now.
  for (const t of takings) if (t.at > now) t.at = new Date(now.getTime() - 60 * 1000);
  takings.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const [n, t] of takings.entries()) {
    await prisma.patientPayment.create({
      data: {
        clinicId, invoiceId: t.invoiceId, receiptNumber: n + 1, amount: t.amount, method: t.method, reference: t.reference ?? null,
        receivedByUserId: t.invoiceId === walkIn.id ? users.pharmacist.id : users.frontdesk.id, receivedAt: t.at, createdAt: t.at,
      },
    });
  }
  await prisma.clinic.update({ where: { id: clinicId }, data: { lastReceiptNumber: takings.length } });
  for (const invoice of await prisma.invoice.findMany({ where: { clinicId }, include: { payments: true } })) {
    const paid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const last = invoice.payments.map((p) => p.receivedAt.getTime()).sort().pop();
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: paid, status: paid >= invoice.amount ? 'PAID' : 'PENDING', paidAt: paid >= invoice.amount && last ? new Date(last) : null },
    });
  }

  // Money paid out this month, so the month's income can be set against it.
  await prisma.expense.createMany({
    data: [
      { clinicId, category: 'MEDICINES_SUPPLIES', description: 'Restock: antimalarials and antibiotics', amount: 350000, spentOn: at(-8, 12), method: 'BANK', paidTo: 'Joint Medical Store', reference: 'TRF 004512', recordedByUserId: users.admin.id },
      { clinicId, category: 'UTILITIES', description: 'Electricity (Yaka tokens)', amount: 85000, spentOn: at(-4, 12), method: 'MOBILE_MONEY', paidTo: 'UMEME', recordedByUserId: users.admin.id },
      { clinicId, category: 'TRANSPORT', description: 'Delivery of lab reagents', amount: 20000, spentOn: at(-1, 12), method: 'CASH', paidTo: 'Boda boda', recordedByUserId: users.admin.id },
    ],
  });

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
