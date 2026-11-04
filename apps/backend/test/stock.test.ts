import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { runPeriodicChecks } from '../src/lib/notifications';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

vi.setConfig({ testTimeout: 60_000 });

const DAY = 24 * 60 * 60 * 1000;
const days = (n: number) => new Date(Date.now() + n * DAY);
const AMOXICILLIN = { medication: 'Amoxicillin', strength: '500 mg', form: 'capsule', dosage: '1 capsule', route: 'PO', frequency: 'TDS', duration: '5 days', instructions: 'After food' };

let app: FastifyInstance;

beforeEach(async () => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ sent: true, via: 'relay' });
  await resetDb();
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

type Role = 'ADMIN' | 'PHARMACIST' | 'DOCTOR' | 'NURSE' | 'STAFF' | 'LAB_TECH';

async function facility(name = 'Mbarara Family Clinic') {
  const clinic = await seedClinic({ name });
  const users = {} as Record<Role, { id: string; token: string }>;
  for (const role of ['ADMIN', 'PHARMACIST', 'DOCTOR', 'NURSE', 'STAFF', 'LAB_TECH'] as Role[]) {
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name: `${role[0]}${role.slice(1).toLowerCase()} Person` });
    users[role] = { id: user.id, token: (await loginAs(app, user.email, password)).token };
  }
  const patient = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700 000 001', clinicId: clinic.id } });
  return { clinic, users, patient };
}
type Facility = Awaited<ReturnType<typeof facility>>;

const call = (token: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: authHeader(token), ...(payload ? { payload } : {}) });

/** A stock item added the normal way, with its opening stock. */
async function addItem(f: Facility, payload: Record<string, unknown> = {}) {
  const res = await call(f.users.PHARMACIST.token, 'POST', '/inventory', { name: 'Amoxicillin 500mg', quantity: 100, unit: 'capsules', reorderLevel: 10, price: 200, expiryDate: days(200).toISOString(), ...payload });
  expect(res.statusCode).toBe(200);
  return res.json().medicine as { id: string; quantity: number };
}

const history = async (f: Facility, id: string) => (await call(f.users.PHARMACIST.token, 'GET', `/inventory/${id}/history`)).json();
const onShelf = async (id: string) => (await prisma.medicine.findUniqueOrThrow({ where: { id } })).quantity;

async function prescribe(f: Facility, medicineId: string, quantity: number) {
  const appointment = await prisma.appointment.create({ data: { patientId: f.patient.id, doctorId: f.users.DOCTOR.id, clinicId: f.clinic.id, date: new Date(), time: '09:00' } });
  const res = await call(f.users.DOCTOR.token, 'POST', '/consultations', {
    appointmentId: appointment.id, patientId: f.patient.id, symptoms: 'Cough', diagnoses: [{ icd10Code: 'J18.9', description: 'Pneumonia' }],
    prescriptions: [{ ...AMOXICILLIN, quantity, medicineId }],
  });
  expect(res.statusCode).toBe(200);
  return res.json().consultation.prescriptions[0].id as string;
}

describe('who may change stock', () => {
  it('lets anyone at the facility see it, and only pharmacists and administrators change it', async () => {
    const f = await facility();
    const item = await addItem(f);
    for (const role of ['DOCTOR', 'NURSE', 'STAFF', 'LAB_TECH'] as Role[]) {
      const token = f.users[role].token;
      expect((await call(token, 'GET', `/inventory/${f.clinic.id}`)).statusCode).toBe(200);
      expect((await call(token, 'POST', '/inventory', { name: 'X', quantity: 1, unit: 'tabs', reorderLevel: 0, price: 1 })).statusCode, role).toBe(403);
      expect((await call(token, 'POST', `/inventory/${item.id}/receive`, { quantity: 10 })).statusCode, role).toBe(403);
      expect((await call(token, 'POST', `/inventory/${item.id}/remove`, { quantity: 1, reason: 'LOST' })).statusCode, role).toBe(403);
      expect((await call(token, 'POST', `/inventory/${item.id}/count`, { counted: 0, note: 'x' })).statusCode, role).toBe(403);
      expect((await call(token, 'PATCH', `/inventory/${item.id}`, { price: 1 })).statusCode, role).toBe(403);
      expect((await call(token, 'DELETE', `/inventory/${item.id}`)).statusCode, role).toBe(403);
    }
    expect(await onShelf(item.id)).toBe(100);
    expect((await call(f.users.ADMIN.token, 'POST', `/inventory/${item.id}/receive`, { quantity: 10 })).statusCode).toBe(200);
  });

  it('refuses the same from a device syncing changes made offline', async () => {
    const f = await facility();
    const push = (token: string, payload: object, action = 'upsert') =>
      call(token, 'POST', '/sync/push', { operations: [{ id: `m-${Math.random()}`, entity: 'inventory', clinicId: f.clinic.id, action, payload }] });
    const id = '00000000-0000-4000-8000-0000000000a1';
    const offline = { id, name: 'ORS sachets', quantity: 40, unit: 'sachets', reorderLevel: 10, price: 500, updatedAt: new Date().toISOString() };

    expect((await push(f.users.NURSE.token, offline)).json().applied).toHaveLength(0);
    expect(await prisma.medicine.count()).toBe(0);

    // A pharmacist's offline addition arrives with its opening stock recorded...
    expect((await push(f.users.PHARMACIST.token, offline)).json().applied).toHaveLength(1);
    expect(await onShelf(id)).toBe(40);
    expect((await history(f, id)).movements.map((m: any) => [m.kind, m.change, m.balanceAfter])).toEqual([['OPENING', 40, 40]]);

    // ...and a later offline edit changes the details, never the count.
    await push(f.users.PHARMACIST.token, { ...offline, quantity: 999, price: 600, updatedAt: new Date(Date.now() + 1000).toISOString() });
    const stored = await prisma.medicine.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ quantity: 40, price: 600 });
  });
});

describe('receiving, removing and counting stock', () => {
  it('checks what is typed', async () => {
    const f = await facility();
    const add = async (payload: object) => (await call(f.users.PHARMACIST.token, 'POST', '/inventory', { name: 'Zinc', quantity: 5, unit: 'tablets', reorderLevel: 1, price: 10, ...payload })).json().error;
    expect(await add({ quantity: -5 })).toBe('The quantity on the shelf must be a whole number, 0 or more');
    expect(await add({ quantity: 2.5 })).toBe('The quantity on the shelf must be a whole number, 0 or more');
    expect(await add({ price: -1 })).toBe('The price must be 0 or more, in shillings');
    expect(await add({ name: '  ' })).toBe('Enter the name of the medicine or item');
    expect(await add({ unit: '' })).toBe('Enter the unit it is counted in (tablets, bottles...)');
    expect(await add({ reorderLevel: 'lots' })).toBe('The reorder level must be a whole number, 0 or more');
    expect(await add({ expiryDate: 'soon' })).toBe('The expiry date is not a date');
    expect(await prisma.medicine.count()).toBe(0);
  });

  it('receives a delivery as a new batch with its own expiry, and writes it in the history with who did it', async () => {
    const f = await facility();
    const item = await addItem(f, { quantity: 20, expiryDate: days(30).toISOString() });
    const res = await call(f.users.PHARMACIST.token, 'POST', `/inventory/${item.id}/receive`, {
      quantity: '1,000', expiryDate: days(400).toISOString(), supplier: 'Joint Medical Store', reference: 'INV 778', unitCost: 150,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().medicine.quantity).toBe(1020);

    const h = await history(f, item.id);
    expect(h.batches.map((b: any) => b.quantity)).toEqual([20, 1000]); // soonest expiry first
    expect(h.movements[0]).toMatchObject({ kind: 'RECEIVED', label: 'Received', change: 1000, balanceAfter: 1020, supplier: 'Joint Medical Store', reference: 'INV 778', unitCost: 150, by: 'Pharmacist Person' });
    // The item shows the soonest expiry of what is on the shelf.
    expect((await prisma.medicine.findUniqueOrThrow({ where: { id: item.id } })).expiryDate?.getTime()).toBe(new Date(h.batches[0].expiryDate).getTime());

    expect((await call(f.users.PHARMACIST.token, 'POST', `/inventory/${item.id}/receive`, { quantity: 0 })).json().error).toBe('The quantity received must be a whole number, 1 or more');
    expect((await call(f.users.PHARMACIST.token, 'POST', `/inventory/${item.id}/receive`, { quantity: 5, expiryDate: days(-1).toISOString() })).json().error).toMatch(/already passed/);
  });

  it('removes stock only with a reason, never more than is there', async () => {
    const f = await facility();
    const item = await addItem(f, { quantity: 50 });
    const remove = (payload: object) => call(f.users.PHARMACIST.token, 'POST', `/inventory/${item.id}/remove`, payload);
    expect((await remove({ quantity: 5 })).json().error).toBe('Choose why the stock is being removed');
    expect((await remove({ quantity: 5, reason: 'OTHER' })).json().error).toBe('Say why the stock is being removed');
    expect((await remove({ quantity: 51, reason: 'DAMAGED' })).json().error).toBe('Only 50 capsules of Amoxicillin 500mg are on the shelf');
    expect((await remove({ quantity: 5, reason: 'DAMAGED', note: 'Bottle broke' })).statusCode).toBe(200);
    expect(await onShelf(item.id)).toBe(45);
    expect((await history(f, item.id)).movements[0]).toMatchObject({ kind: 'REMOVED', change: -5, balanceAfter: 45, reason: 'DAMAGED', reasonLabel: 'Damaged', note: 'Bottle broke' });
  });

  it('records a stock count - a difference needs a reason; a count that matches is recorded too', async () => {
    const f = await facility();
    const item = await addItem(f, { quantity: 50 });
    const count = (payload: object) => call(f.users.PHARMACIST.token, 'POST', `/inventory/${item.id}/count`, payload);
    expect((await count({ counted: 47 })).json().error).toMatch(/^Say why the count differs/);
    expect((await count({ counted: 47, note: 'Three missing at month-end count' })).statusCode).toBe(200);
    expect((await count({ counted: 47 })).statusCode).toBe(200);
    expect((await count({ counted: 60, note: 'Found a box in the store' })).statusCode).toBe(200);
    expect((await history(f, item.id)).movements.map((m: any) => [m.kind, m.change, m.balanceAfter])).toEqual([
      ['COUNTED', 13, 60], ['COUNTED', 0, 47], ['COUNTED', -3, 47], ['OPENING', 50, 50],
    ]);
  });

  it('no longer lets a quantity be overwritten - details still change, and are recorded', async () => {
    const f = await facility();
    const item = await addItem(f);
    expect((await call(f.users.PHARMACIST.token, 'PATCH', `/inventory/${item.id}`, { quantity: 0 })).json().error).toMatch(/^Quantities change by receiving stock/);
    const edited = await call(f.users.PHARMACIST.token, 'PATCH', `/inventory/${item.id}`, { price: '250', reorderLevel: 30 });
    expect(edited.json().medicine).toMatchObject({ price: 250, reorderLevel: 30, quantity: 100 });
    expect(await prisma.auditLog.count({ where: { entity: 'Medicine', recordId: item.id, action: 'UPDATE' } })).toBe(1);
  });

  it('discontinues an item and keeps its history', async () => {
    const f = await facility();
    const item = await addItem(f, { quantity: 4 });
    expect((await call(f.users.PHARMACIST.token, 'DELETE', `/inventory/${item.id}`)).statusCode).toBe(200);
    expect((await call(f.users.PHARMACIST.token, 'GET', `/inventory/${f.clinic.id}`)).json().medicines).toHaveLength(0);
    expect((await history(f, item.id)).movements.map((m: any) => m.kind)).toEqual(['DISCONTINUED', 'OPENING']);
  });

  it('never loses a change when several happen at once', async () => {
    const f = await facility();
    const item = await addItem(f, { quantity: 100 });
    await Promise.all([
      ...Array.from({ length: 5 }, () => call(f.users.PHARMACIST.token, 'POST', `/inventory/${item.id}/receive`, { quantity: 10 })),
      ...Array.from({ length: 5 }, () => call(f.users.ADMIN.token, 'POST', `/inventory/${item.id}/remove`, { quantity: 3, reason: 'DAMAGED' })),
    ]);
    expect(await onShelf(item.id)).toBe(100 + 50 - 15);
    const balances = (await history(f, item.id)).movements.map((m: any) => m.balanceAfter);
    expect(balances[0]).toBe(135);
    expect(new Set(balances).size).toBe(balances.length); // every step its own balance: none overwrote another
  });
});

describe('expiry', () => {
  /** Two batches: 30 that expired yesterday, 70 good for a year. */
  async function mixedStock(f: Facility) {
    const item = await addItem(f, { quantity: 0 });
    await call(f.users.PHARMACIST.token, 'POST', `/inventory/${item.id}/receive`, { quantity: 30, expiryDate: days(5).toISOString() });
    await call(f.users.PHARMACIST.token, 'POST', `/inventory/${item.id}/receive`, { quantity: 70, expiryDate: days(365).toISOString() });
    const soon = await prisma.medicineBatch.findFirstOrThrow({ where: { medicineId: item.id, quantity: 30 } });
    await prisma.medicineBatch.update({ where: { id: soon.id }, data: { expiryDate: days(-1) } });
    await prisma.medicine.update({ where: { id: item.id }, data: { expiryDate: days(-1) } });
    return item;
  }

  it('never dispenses expired stock, and takes the batch that expires first', async () => {
    const f = await facility();
    const item = await mixedStock(f);
    const tooMany = await prescribe(f, item.id, 80);
    const refused = await call(f.users.PHARMACIST.token, 'POST', `/prescriptions/${tooMany}/dispense`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('Not enough Amoxicillin 500mg in date: 70 capsules can be used, 80 needed - 30 capsules have expired. Remove the expired stock under Inventory.');
    expect(await onShelf(item.id)).toBe(100);

    const rx = await prescribe(f, item.id, 20);
    expect((await call(f.users.PHARMACIST.token, 'POST', `/prescriptions/${rx}/dispense`, {})).statusCode).toBe(200);
    const batches = await prisma.medicineBatch.findMany({ where: { medicineId: item.id }, orderBy: { quantity: 'asc' } });
    expect(batches.map((b) => b.quantity)).toEqual([30, 50]); // the expired 30 untouched

    // Undo puts it back where it came from.
    expect((await call(f.users.PHARMACIST.token, 'POST', `/prescriptions/${rx}/undo-dispense`)).statusCode).toBe(200);
    expect((await prisma.medicineBatch.findMany({ where: { medicineId: item.id } })).map((b) => b.quantity).sort((a, b) => a - b)).toEqual([30, 70]);
    expect((await history(f, item.id)).movements.slice(0, 2).map((m: any) => [m.kind, m.change])).toEqual([['DISPENSE_REVERSED', 20], ['DISPENSED', -20]]);
  });

  it('removes expired stock from the expired batch, and warns about only what is expiring', async () => {
    const f = await facility();
    const item = await mixedStock(f);
    await runPeriodicChecks(f.clinic.id, new Date());
    const warning = await prisma.notification.findFirstOrThrow({ where: { userId: f.users.PHARMACIST.id, type: 'STOCK_EXPIRING' } });
    expect(warning.body).toMatch(/^30 capsules of Amoxicillin 500mg expired on/);

    expect((await call(f.users.PHARMACIST.token, 'POST', `/inventory/${item.id}/remove`, { quantity: 30, reason: 'EXPIRED' })).statusCode).toBe(200);
    const left = await prisma.medicineBatch.findMany({ where: { medicineId: item.id, quantity: { gt: 0 } } });
    expect(left.map((b) => b.quantity)).toEqual([70]);
    const list = (await call(f.users.DOCTOR.token, 'GET', `/inventory/${f.clinic.id}`)).json().medicines[0];
    expect(list).toMatchObject({ quantity: 70, expiredQuantity: 0 });
  });

  it('brings stock recorded before batches were kept into one, the first time it changes', async () => {
    const f = await facility();
    const legacy = await prisma.medicine.create({ data: { clinicId: f.clinic.id, name: 'Paracetamol', quantity: 50, unit: 'tablets', reorderLevel: 5, price: 50, expiryDate: days(100) } });
    const rx = await prescribe(f, legacy.id, 20);
    expect((await call(f.users.PHARMACIST.token, 'POST', `/prescriptions/${rx}/dispense`, {})).statusCode).toBe(200);
    expect(await onShelf(legacy.id)).toBe(30);
    const batches = await prisma.medicineBatch.findMany({ where: { medicineId: legacy.id } });
    expect(batches.map((b) => b.quantity)).toEqual([30]);
  });
});

describe('medicine sold over the counter', () => {
  const newBill = (f: Facility, items: object[]) => call(f.users.PHARMACIST.token, 'POST', '/invoices', { patientId: f.patient.id, items });

  it('comes off the shelf when sold, and goes back if the line is taken off the bill', async () => {
    const f = await facility();
    const item = await addItem(f, { quantity: 100 });
    const bill = await newBill(f, [
      { kind: 'MEDICINE', description: 'Amoxicillin 500mg', quantity: 21, unitPrice: 200, medicineId: item.id },
      { kind: 'OTHER', description: 'Dressing', unitPrice: 3000 },
    ]);
    expect(bill.statusCode).toBe(200);
    expect(await onShelf(item.id)).toBe(79);
    const line = bill.json().invoice.items.find((i: any) => i.kind === 'MEDICINE');
    expect((await history(f, item.id)).movements[0]).toMatchObject({ kind: 'SOLD', label: 'Sold over the counter', change: -21, invoiceItemId: line.id, by: 'Pharmacist Person' });

    // Added later to the same bill: off the shelf too.
    await call(f.users.PHARMACIST.token, 'POST', `/invoices/${bill.json().invoice.id}/items`, { kind: 'MEDICINE', description: 'Amoxicillin 500mg', quantity: 9, unitPrice: 200, medicineId: item.id });
    expect(await onShelf(item.id)).toBe(70);

    expect((await call(f.users.PHARMACIST.token, 'DELETE', `/invoices/${bill.json().invoice.id}/items/${line.id}`)).statusCode).toBe(200);
    expect(await onShelf(item.id)).toBe(91);
    expect((await history(f, item.id)).movements[0]).toMatchObject({ kind: 'SALE_REVERSED', change: 21 });
  });

  it('refuses to sell more than is in date, and opens no bill', async () => {
    const f = await facility();
    const item = await addItem(f, { quantity: 5 });
    const res = await newBill(f, [{ kind: 'MEDICINE', description: 'Amoxicillin 500mg', quantity: 6, unitPrice: 200, medicineId: item.id }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Not enough Amoxicillin 500mg in stock: 5 capsules available, 6 needed');
    expect(await prisma.invoice.count()).toBe(0);
    expect(await onShelf(item.id)).toBe(5);
  });

  it("only from this facility's stock, only as a medicine charge, and never a prescribed medicine twice", async () => {
    const f = await facility();
    const other = await facility('Gulu Clinic');
    const theirs = await addItem(other);
    const mine = await addItem(f);
    expect((await newBill(f, [{ kind: 'MEDICINE', description: 'X', unitPrice: 1, medicineId: theirs.id }])).json().error).toBe("That medicine isn't in this facility's stock");
    expect((await newBill(f, [{ kind: 'OTHER', description: 'X', unitPrice: 1, medicineId: mine.id }])).json().error).toBe('Only a medicine charge can be taken from stock');
    const rx = await prescribe(f, mine.id, 15);
    const appointment = await prisma.prescription.findUniqueOrThrow({ where: { id: rx }, select: { consultationId: true } });
    const visitBill = await call(f.users.DOCTOR.token, 'POST', '/invoices', { consultationId: appointment.consultationId, amount: 10000 });
    const both = await call(f.users.PHARMACIST.token, 'POST', `/invoices/${visitBill.json().invoice.id}/items`, { kind: 'MEDICINE', description: 'Amoxicillin', quantity: 15, unitPrice: 200, prescriptionId: rx, medicineId: mine.id });
    expect(both.json().error).toBe('Prescribed medicine comes off stock when it is dispensed, not when it is billed');
    expect(await onShelf(mine.id)).toBe(100);
  });

  it('a cancelled bill puts its medicine back only when told it came back to the shelf', async () => {
    const f = await facility();
    const item = await addItem(f, { quantity: 100 });
    const sell = async () => (await newBill(f, [{ kind: 'MEDICINE', description: 'Amoxicillin 500mg', quantity: 10, unitPrice: 200, medicineId: item.id }])).json().invoice.id as string;

    const waived = await sell();
    expect((await call(f.users.ADMIN.token, 'PATCH', `/invoices/${waived}/cancel`, {})).statusCode).toBe(200);
    expect(await onShelf(item.id)).toBe(90); // handed out free: still gone

    const mistake = await sell();
    expect((await call(f.users.ADMIN.token, 'PATCH', `/invoices/${mistake}/cancel`, { restock: true })).statusCode).toBe(200);
    expect(await onShelf(item.id)).toBe(90);
  });
});
