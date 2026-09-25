import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { normalizeAllergies } from '../src/lib/clinical';

vi.setConfig({ testTimeout: 60_000 });

const AMOXICILLIN = {
  medication: 'Amoxicillin', strength: '500 mg', form: 'capsule', dosage: '1 capsule', route: 'PO',
  frequency: 'TDS', duration: '5 days', quantity: 15, instructions: 'Take after food',
};

describe('normalizeAllergies', () => {
  it('only a KNOWN status carries a list, and the list cannot be empty', () => {
    expect(normalizeAllergies('UNKNOWN', [{ substance: 'Penicillin' }])).toEqual({ ok: true, value: { status: 'UNKNOWN', allergies: [] } });
    expect(normalizeAllergies('NONE_KNOWN', undefined)).toEqual({ ok: true, value: { status: 'NONE_KNOWN', allergies: [] } });
    expect(normalizeAllergies('KNOWN', [])).toMatchObject({ ok: false });
    expect(normalizeAllergies('KNOWN', [{ substance: '  ' }])).toMatchObject({ ok: false });
    expect(normalizeAllergies('KNOWN', undefined)).toMatchObject({ ok: false });
    expect(normalizeAllergies('MAYBE', [])).toMatchObject({ ok: false });
  });

  it('tidies the list: trims, drops blank rows and repeats, keeps reaction and severity', () => {
    const result = normalizeAllergies('KNOWN', [
      { substance: ' Penicillin ', reaction: 'Anaphylaxis', severity: 'SEVERE' },
      { substance: '' },
      { substance: 'penicillin' },
      { substance: 'Sulfa drugs', severity: '' },
    ]);
    expect(result.ok && result.value.allergies).toEqual([
      { substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'SEVERE' },
      { substance: 'Sulfa drugs', reaction: null, severity: null },
    ]);
  });

  it('rejects an unknown severity, an over-long value and too many allergies', () => {
    expect(normalizeAllergies('KNOWN', [{ substance: 'X', severity: 'DEADLY' }])).toMatchObject({ ok: false });
    expect(normalizeAllergies('KNOWN', [{ substance: 'x'.repeat(81) }])).toMatchObject({ ok: false });
    expect(normalizeAllergies('KNOWN', Array.from({ length: 21 }, (_, i) => ({ substance: `S${i}` })))).toMatchObject({ ok: false });
  });
});

describe('allergies and dispensing', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function facility(name = 'Clinic') {
    const clinic = await seedClinic({ name });
    const users: Record<string, { id: string; token: string; name: string }> = {};
    for (const role of ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN', 'STAFF'] as const) {
      const { user, password } = await seedUser({ clinicId: clinic.id, role, name: `${role} Person` });
      users[role] = { id: user.id, token: (await loginAs(app, user.email, password)).token, name: user.name };
    }
    const patient = await prisma.patient.create({ data: { name: 'Jane Mukasa', phone: '0756111222', sex: 'FEMALE', dateOfBirth: new Date('1990-01-01'), clinicId: clinic.id } });
    return { clinic, users, patient };
  }

  async function prescribe(ctx: Awaited<ReturnType<typeof facility>>, items: Array<Record<string, unknown>>) {
    const appointment = await prisma.appointment.create({
      data: { patientId: ctx.patient.id, doctorId: ctx.users.DOCTOR.id, clinicId: ctx.clinic.id, date: new Date(), time: '09:00' },
    });
    const response = await app.inject({
      method: 'POST', url: '/consultations', headers: authHeader(ctx.users.DOCTOR.token),
      payload: { appointmentId: appointment.id, patientId: ctx.patient.id, symptoms: 'Cough', diagnoses: [{ icd10Code: 'J18.9', description: 'Pneumonia' }], prescriptions: items },
    });
    expect(response.statusCode).toBe(200);
    return response.json().consultation as { id: string; prescriptions: Array<{ id: string }> };
  }

  const push = (token: string, clinicId: string, entity: string, payload: Record<string, unknown>, mutationId = `m-${Math.random()}`) =>
    app.inject({ method: 'POST', url: '/sync/push', headers: authHeader(token), payload: { operations: [{ id: mutationId, entity, clinicId, payload }] } });

  const recordAllergies = (token: string, clinicId: string, patientId: string, body: Record<string, unknown>, updatedAt = new Date().toISOString()) =>
    push(token, clinicId, 'patientAllergies', { id: patientId, updatedAt, ...body });

  // -------------------------------------------------------------------------
  describe('recording allergies', () => {
    it('saves a list of known allergies on the patient, and the record comes back to the device', async () => {
      const { clinic, users, patient } = await facility();

      const response = await recordAllergies(users.NURSE.token, clinic.id, patient.id, {
        allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'SEVERE' }, { substance: 'Sulfa drugs' }],
      });
      expect(response.json().applied).toHaveLength(1);
      expect(response.json().applied[0].record.allergyStatus).toBe('KNOWN');

      const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(stored.allergyStatus).toBe('KNOWN');
      expect(stored.allergies).toEqual([
        { substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'SEVERE' },
        { substance: 'Sulfa drugs', reaction: null, severity: null },
      ]);
      expect(stored.allergiesUpdatedBy).toBe(users.NURSE.id);

      const pulled = await app.inject({ method: 'GET', url: `/sync/pull?clinicId=${clinic.id}`, headers: authHeader(users.DOCTOR.token) });
      expect(pulled.json().patients.find((p: any) => p.id === patient.id).allergyStatus).toBe('KNOWN');
    });

    it('records "no known allergies", which clears any earlier list', async () => {
      const { clinic, users, patient } = await facility();
      await recordAllergies(users.DOCTOR.token, clinic.id, patient.id, { allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin' }] }, '2026-09-25T08:00:00Z');
      await recordAllergies(users.DOCTOR.token, clinic.id, patient.id, { allergyStatus: 'NONE_KNOWN' }, '2026-09-25T09:00:00Z');

      const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(stored.allergyStatus).toBe('NONE_KNOWN');
      expect(stored.allergies).toBeNull();
    });

    it('starts as "not recorded" for a patient nobody has asked', async () => {
      const { patient } = await facility();
      const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(stored.allergyStatus).toBe('UNKNOWN');
    });

    it('refuses an invalid record and leaves the existing one alone', async () => {
      const { clinic, users, patient } = await facility();
      await recordAllergies(users.DOCTOR.token, clinic.id, patient.id, { allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin' }] }, '2026-09-25T08:00:00Z');

      const empty = await recordAllergies(users.DOCTOR.token, clinic.id, patient.id, { allergyStatus: 'KNOWN', allergies: [] }, '2026-09-25T09:00:00Z');
      const badSeverity = await recordAllergies(users.DOCTOR.token, clinic.id, patient.id, { allergyStatus: 'KNOWN', allergies: [{ substance: 'X', severity: 'DEADLY' }] }, '2026-09-25T09:30:00Z');
      expect(empty.json().applied).toHaveLength(0);
      expect(badSeverity.json().applied).toHaveLength(0);

      const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect((stored.allergies as any[])[0].substance).toBe('Penicillin');
    });

    it('is limited to clinical roles, and to patients of the caller\'s own facility', async () => {
      const { clinic, users, patient } = await facility();
      const frontDesk = await recordAllergies(users.STAFF.token, clinic.id, patient.id, { allergyStatus: 'NONE_KNOWN' });
      expect(frontDesk.json().applied).toHaveLength(0);

      const other = await facility('Other Clinic');
      const crossClinic = await recordAllergies(other.users.NURSE.token, other.clinic.id, patient.id, { allergyStatus: 'NONE_KNOWN' });
      expect(crossClinic.json().applied).toHaveLength(0);

      expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).allergyStatus).toBe('UNKNOWN');
    });

    it('does not let an older, late-arriving edit overwrite a newer one', async () => {
      const { clinic, users, patient } = await facility();
      await recordAllergies(users.DOCTOR.token, clinic.id, patient.id, { allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin' }] }, '2026-09-25T10:00:00Z');
      const stale = await recordAllergies(users.NURSE.token, clinic.id, patient.id, { allergyStatus: 'NONE_KNOWN' }, '2026-09-25T08:00:00Z');
      expect(stale.json().applied).toHaveLength(0);

      expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).allergyStatus).toBe('KNOWN');
      expect(await prisma.syncConflictLog.count({ where: { entity: 'PatientAllergies' } })).toBe(1);
    });

    it('writes the change to the audit trail without writing the allergy names into it', async () => {
      const { clinic, users, patient } = await facility();
      await recordAllergies(users.NURSE.token, clinic.id, patient.id, { allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin' }] });

      const entries = await prisma.auditLog.findMany({ where: { recordId: patient.id } });
      const entry = entries.find((e) => (e.metadata as any)?.event === 'ALLERGIES_UPDATED');
      expect(entry).toBeTruthy();
      expect(JSON.stringify(entry!.metadata)).not.toContain('Penicillin');
    });

    it('is not overwritten when the rest of the patient is edited', async () => {
      const { clinic, users, patient } = await facility();
      await recordAllergies(users.DOCTOR.token, clinic.id, patient.id, { allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin' }] });

      await push(users.DOCTOR.token, clinic.id, 'patient', { id: patient.id, name: 'Jane Renamed', phone: '0700', clinicId: clinic.id, updatedAt: new Date(Date.now() + 5000).toISOString() });

      const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(stored.name).toBe('Jane Renamed');
      expect(stored.allergyStatus).toBe('KNOWN');
    });

    it('exports allergies, and "no known allergy", in the FHIR bundle', async () => {
      const { clinic, users, patient } = await facility();
      const second = await prisma.patient.create({ data: { name: 'No Allergies', phone: '0701', clinicId: clinic.id } });
      await recordAllergies(users.DOCTOR.token, clinic.id, patient.id, { allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'MILD' }] });
      await recordAllergies(users.DOCTOR.token, clinic.id, second.id, { allergyStatus: 'NONE_KNOWN' });

      const bundle = await app.inject({ method: 'GET', url: `/reports/fhir/patients/${clinic.id}`, headers: authHeader(users.DOCTOR.token) });
      const allergies = bundle.json().entry.map((e: any) => e.resource).filter((r: any) => r.resourceType === 'AllergyIntolerance');
      const penicillin = allergies.find((r: any) => r.code.text === 'Penicillin');
      expect(penicillin.reaction[0]).toMatchObject({ manifestation: [{ text: 'Rash' }], severity: 'mild' });
      expect(penicillin.patient.reference).toBe(`urn:uuid:${patient.id}`);
      expect(allergies.find((r: any) => r.code.coding?.[0]?.display === 'No known allergy').patient.reference).toBe(`urn:uuid:${second.id}`);
    });
  });

  // -------------------------------------------------------------------------
  describe('prescribing against an allergy', () => {
    it('stores that the prescriber saw a matching allergy and prescribed anyway, and shows it on read-back', async () => {
      const ctx = await facility();
      const consultation = await prescribe(ctx, [{ ...AMOXICILLIN, allergyOverride: true }, { ...AMOXICILLIN, medication: 'Paracetamol' }]);

      const stored = await prisma.prescription.findMany({ where: { consultationId: consultation.id }, orderBy: { medication: 'asc' } });
      expect(stored.map((r) => [r.medication, r.allergyOverride])).toEqual([['Amoxicillin', true], ['Paracetamol', false]]);

      const history = await app.inject({ method: 'GET', url: `/consultations/patient/${ctx.patient.id}`, headers: authHeader(ctx.users.DOCTOR.token) });
      expect(history.json().consultations[0].prescriptions.find((r: any) => r.medication === 'Amoxicillin').allergyOverride).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('dispensing', () => {
    async function withStock(ctx: Awaited<ReturnType<typeof facility>>, quantity = 100, reorderLevel = 10) {
      const stock = await prisma.medicine.create({ data: { clinicId: ctx.clinic.id, name: 'Amoxicillin 500mg', quantity, unit: 'capsules', reorderLevel, price: 200 } });
      const consultation = await prescribe(ctx, [{ ...AMOXICILLIN, medicineId: stock.id }]);
      return { stock, consultation, rxId: consultation.prescriptions[0].id };
    }

    const dispense = (token: string, id: string, body: Record<string, unknown> = {}) =>
      app.inject({ method: 'POST', url: `/prescriptions/${id}/dispense`, headers: authHeader(token), payload: body });

    it('shows the pharmacist what is waiting, with the patient\'s allergies beside it', async () => {
      const ctx = await facility();
      await recordAllergies(ctx.users.NURSE.token, ctx.clinic.id, ctx.patient.id, { allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin', severity: 'SEVERE' }] });
      const { stock } = await withStock(ctx);

      const queue = await app.inject({ method: 'GET', url: '/prescriptions', headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(queue.statusCode).toBe(200);
      const [item] = queue.json().items;
      expect(item).toMatchObject({ medication: 'Amoxicillin', quantity: 15, medicine: { id: stock.id, quantity: 100, unit: 'capsules' } });
      expect(item.patient).toMatchObject({ name: 'Jane Mukasa', allergyStatus: 'KNOWN' });
      expect(item.patient.allergies[0].substance).toBe('Penicillin');
      expect(item.consultation).toMatchObject({ prescriber: 'DOCTOR Person', diagnosis: { icd10Code: 'J18.9' } });
    });

    it('is limited to pharmacists and admins, and to the caller\'s own facility', async () => {
      const ctx = await facility();
      const { rxId } = await withStock(ctx);
      for (const role of ['NURSE', 'DOCTOR', 'STAFF'] as const) {
        expect((await app.inject({ method: 'GET', url: '/prescriptions', headers: authHeader(ctx.users[role].token) })).statusCode).toBe(403);
        expect((await dispense(ctx.users[role].token, rxId)).statusCode).toBe(403);
      }

      const other = await facility('Other Clinic');
      expect((await app.inject({ method: 'GET', url: '/prescriptions', headers: authHeader(other.users.PHARMACIST.token) })).json().items).toHaveLength(0);
      expect((await dispense(other.users.PHARMACIST.token, rxId)).statusCode).toBe(403);
      expect((await prisma.prescription.findUniqueOrThrow({ where: { id: rxId } })).dispensedAt).toBeNull();
    });

    it('marks the item dispensed, takes the quantity off the linked stock, and moves it to the recent list', async () => {
      const ctx = await facility();
      const { stock, rxId } = await withStock(ctx);
      const before = await prisma.medicine.findUniqueOrThrow({ where: { id: stock.id } });

      const response = await dispense(ctx.users.PHARMACIST.token, rxId);
      expect(response.statusCode).toBe(200);
      expect(response.json().prescription).toMatchObject({ dispensedQuantity: 15, dispensedBy: { name: 'PHARMACIST Person' } });
      expect(response.json().medicine.quantity).toBe(85);

      const after = await prisma.medicine.findUniqueOrThrow({ where: { id: stock.id } });
      expect(after.quantity).toBe(85);
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime()); // so devices pull the new quantity

      const pending = await app.inject({ method: 'GET', url: '/prescriptions', headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(pending.json().items).toHaveLength(0);
      const recent = await app.inject({ method: 'GET', url: '/prescriptions?status=dispensed', headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(recent.json().items[0]).toMatchObject({ id: rxId, dispensedQuantity: 15, dispensedBy: { name: 'PHARMACIST Person' } });

      const audit = await prisma.auditLog.findFirst({ where: { recordId: rxId, entity: 'Prescription' } });
      expect((audit!.metadata as any).event).toBe('DISPENSED');
    });

    it('lets the pharmacist dispense a different quantity than was written', async () => {
      const ctx = await facility();
      const { stock, rxId } = await withStock(ctx);
      const response = await dispense(ctx.users.PHARMACIST.token, rxId, { quantity: 10 });
      expect(response.statusCode).toBe(200);
      expect((await prisma.medicine.findUniqueOrThrow({ where: { id: stock.id } })).quantity).toBe(90);
      expect((await prisma.prescription.findUniqueOrThrow({ where: { id: rxId } })).dispensedQuantity).toBe(10);
    });

    it('refuses when there is not enough stock, changing nothing', async () => {
      const ctx = await facility();
      const { stock, rxId } = await withStock(ctx, 5);

      const response = await dispense(ctx.users.PHARMACIST.token, rxId);
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatch(/Not enough Amoxicillin 500mg in stock: 5 capsules available, 15 needed/);
      expect((await prisma.medicine.findUniqueOrThrow({ where: { id: stock.id } })).quantity).toBe(5);
      expect((await prisma.prescription.findUniqueOrThrow({ where: { id: rxId } })).dispensedAt).toBeNull();
    });

    it('cannot be dispensed twice - not even by two pharmacists at the same moment', async () => {
      const ctx = await facility();
      const { stock, rxId } = await withStock(ctx);

      const [a, b] = await Promise.all([dispense(ctx.users.PHARMACIST.token, rxId), dispense(ctx.users.ADMIN.token, rxId)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      expect((await prisma.medicine.findUniqueOrThrow({ where: { id: stock.id } })).quantity).toBe(85); // taken off once, not twice

      const again = await dispense(ctx.users.PHARMACIST.token, rxId);
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toMatch(/already been dispensed/);
    });

    it('needs a quantity when the item is linked to stock and none was written, but not when it is not linked', async () => {
      const ctx = await facility();
      const stock = await prisma.medicine.create({ data: { clinicId: ctx.clinic.id, name: 'Paracetamol', quantity: 50, unit: 'tablets', reorderLevel: 5, price: 50 } });
      const consultation = await prescribe(ctx, [
        { ...AMOXICILLIN, medication: 'Paracetamol', quantity: undefined, medicineId: stock.id },
        { ...AMOXICILLIN, medication: 'Cough syrup', quantity: undefined },
      ]);
      const [linked, unlinked] = await Promise.all(
        consultation.prescriptions.map((p) => prisma.prescription.findUniqueOrThrow({ where: { id: p.id } }))
      ).then((rows) => [rows.find((r) => r.medicineId)!, rows.find((r) => !r.medicineId)!]);

      const missing = await dispense(ctx.users.PHARMACIST.token, linked.id);
      expect(missing.statusCode).toBe(400);
      expect((await dispense(ctx.users.PHARMACIST.token, linked.id, { quantity: 20 })).statusCode).toBe(200);
      expect((await prisma.medicine.findUniqueOrThrow({ where: { id: stock.id } })).quantity).toBe(30);

      expect((await dispense(ctx.users.PHARMACIST.token, unlinked.id)).statusCode).toBe(200);
    });

    it('accepts an action sent as JSON with no body, as a browser button does, and still rejects malformed JSON', async () => {
      const ctx = await facility();
      const { rxId } = await withStock(ctx);
      const json = { authorization: `Bearer ${ctx.users.PHARMACIST.token}`, 'content-type': 'application/json' };

      const noBody = await app.inject({ method: 'POST', url: `/prescriptions/${rxId}/undo-dispense`, headers: json });
      expect(noBody.statusCode).toBe(409); // reached the route: "has not been dispensed"

      const malformed = await app.inject({ method: 'POST', url: `/prescriptions/${rxId}/dispense`, headers: json, payload: '{not json' });
      expect(malformed.statusCode).toBe(400);
    });

    it('rejects a nonsense quantity', async () => {
      const ctx = await facility();
      const { rxId } = await withStock(ctx);
      for (const quantity of [0, -4, 2.5, 'lots', 1_000_000]) {
        expect((await dispense(ctx.users.PHARMACIST.token, rxId, { quantity })).statusCode, String(quantity)).toBe(400);
      }
    });

    it('tells the facility when dispensing takes a medicine down to its reorder level', async () => {
      const ctx = await facility();
      const { rxId } = await withStock(ctx, 20, 10); // 20 - 15 = 5, at or below 10

      await dispense(ctx.users.PHARMACIST.token, rxId);
      const alerts = await prisma.notification.findMany({ where: { type: 'LOW_STOCK', userId: ctx.users.PHARMACIST.id } });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].title).toContain('Amoxicillin 500mg');
    });

    it('sends the prescription notification to the dispensing page', async () => {
      const ctx = await facility();
      await withStock(ctx);
      const note = await prisma.notification.findFirst({ where: { type: 'NEW_PRESCRIPTION', userId: ctx.users.PHARMACIST.id } });
      expect(note?.link).toBe('/dispensing');
    });

    it('can be reversed: stock goes back and the item returns to the queue', async () => {
      const ctx = await facility();
      const { stock, rxId } = await withStock(ctx);
      await dispense(ctx.users.PHARMACIST.token, rxId);

      const undo = await app.inject({ method: 'POST', url: `/prescriptions/${rxId}/undo-dispense`, headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(undo.statusCode).toBe(200);
      expect((await prisma.medicine.findUniqueOrThrow({ where: { id: stock.id } })).quantity).toBe(100);
      const rx = await prisma.prescription.findUniqueOrThrow({ where: { id: rxId } });
      expect([rx.dispensedAt, rx.dispensedByUserId, rx.dispensedQuantity]).toEqual([null, null, null]);

      const queue = await app.inject({ method: 'GET', url: '/prescriptions', headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(queue.json().items).toHaveLength(1);

      const again = await app.inject({ method: 'POST', url: `/prescriptions/${rxId}/undo-dispense`, headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(again.statusCode).toBe(409);
    });

    it('does not offer to reverse an item that was only marked dispensed because it predates tracking', async () => {
      const ctx = await facility();
      const { rxId } = await withStock(ctx);
      await prisma.prescription.update({ where: { id: rxId }, data: { dispensedAt: new Date() } }); // as the migration marks old ones

      const queue = await app.inject({ method: 'GET', url: '/prescriptions', headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(queue.json().items).toHaveLength(0);
      const recent = await app.inject({ method: 'GET', url: '/prescriptions?status=dispensed', headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(recent.json().items).toHaveLength(0);
      const undo = await app.inject({ method: 'POST', url: `/prescriptions/${rxId}/undo-dispense`, headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(undo.statusCode).toBe(409);
    });

    it('keeps a dispensed item dispensed when the consultation is re-sent from an offline device', async () => {
      const ctx = await facility();
      const stock = await prisma.medicine.create({ data: { clinicId: ctx.clinic.id, name: 'Amoxicillin 500mg', quantity: 100, unit: 'capsules', reorderLevel: 10, price: 200 } });
      const appointment = await prisma.appointment.create({ data: { patientId: ctx.patient.id, doctorId: ctx.users.DOCTOR.id, clinicId: ctx.clinic.id, date: new Date(), time: '09:00' } });
      const payload = {
        id: 'c-resend', appointmentId: appointment.id, patientId: ctx.patient.id, symptoms: 'Cough', updatedAt: '2026-09-25T08:00:00Z',
        diagnoses: [{ description: 'Pneumonia' }], prescriptions: [{ ...AMOXICILLIN, medicineId: stock.id }, { ...AMOXICILLIN, medication: 'Paracetamol' }],
      };
      await push(ctx.users.DOCTOR.token, ctx.clinic.id, 'consultation', payload, 'first');

      const rx = await prisma.prescription.findFirstOrThrow({ where: { consultationId: 'c-resend', medication: 'Amoxicillin' } });
      expect((await dispense(ctx.users.PHARMACIST.token, rx.id)).statusCode).toBe(200);

      // The device re-sends the whole consultation (a retry, then an edit that adds a drug).
      await push(ctx.users.DOCTOR.token, ctx.clinic.id, 'consultation', payload, 'retry');
      await push(ctx.users.DOCTOR.token, ctx.clinic.id, 'consultation', {
        ...payload, updatedAt: '2026-09-25T09:00:00Z', prescriptions: [...payload.prescriptions, { ...AMOXICILLIN, medication: 'Zinc' }],
      }, 'edit');

      const all = await prisma.prescription.findMany({ where: { consultationId: 'c-resend' }, orderBy: { medication: 'asc' } });
      expect(all.map((r) => [r.medication, r.dispensedAt !== null])).toEqual([['Amoxicillin', true], ['Paracetamol', false], ['Zinc', false]]);
      const queue = await app.inject({ method: 'GET', url: '/prescriptions', headers: authHeader(ctx.users.PHARMACIST.token) });
      expect(queue.json().items.map((i: any) => i.medication).sort()).toEqual(['Paracetamol', 'Zinc']);
    });

    it('shows patients whether their prescription has been dispensed', async () => {
      const ctx = await facility();
      const created = await app.inject({ method: 'POST', url: `/patients/${ctx.patient.id}/portal-account`, headers: authHeader(ctx.users.NURSE.token), payload: { phone: '0756111222', email: 'jane@example.com' } });
      const setToken = new URL(created.json().devSetPasswordUrl).searchParams.get('token')!;
      await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: setToken, password: 'MyNewPassword123!', phone: '0756111222' } });
      const login = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: created.json().portableId, password: 'MyNewPassword123!' } });
      const patientToken = login.json().token as string;

      await recordAllergies(ctx.users.NURSE.token, ctx.clinic.id, ctx.patient.id, { allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin' }] });
      const { rxId } = await withStock(ctx);

      const before = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
      const record = before.json().records[0];
      expect(record.allergyStatus).toBe('KNOWN');
      expect(record.allergies[0].substance).toBe('Penicillin');
      expect(record.consultations[0].prescriptions[0].dispensedAt).toBeNull();

      await dispense(ctx.users.PHARMACIST.token, rxId);
      const after = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
      expect(after.json().records[0].consultations[0].prescriptions[0].dispensedAt).toBeTruthy();
    });
  });
});
