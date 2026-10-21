import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { adoptLegacyFiles, readFile, storageSummary } from '../src/lib/storage';
import { storeDocument } from '../src/lib/document-files';

// Where earlier versions wrote files - the same folder lib/storage.ts reads them back from.
const LEGACY_DIR = process.env.DOCUMENT_STORAGE_DIR || path.join(__dirname, '..', 'uploads');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n% a lab result\n%%EOF');
const sha256 = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');

function buildMultipart(fields: Record<string, string>, file: { filename: string; content: Buffer; contentType: string }) {
  const boundary = '----durableboundary42';
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
  parts.push(file.content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('durable document storage', () => {
  let app: FastifyInstance;
  const legacyFiles: string[] = [];

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterEach(() => {
    for (const file of legacyFiles.splice(0)) fs.rmSync(file, { force: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  async function setup() {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const created = await app.inject({ method: 'POST', url: '/patients', headers: authHeader(token), payload: { name: 'Jane Mukasa', phone: '0756111222', sex: 'FEMALE' } });
    return { clinic, token, userId: user.id, patientId: created.json().patient.id as string };
  }

  const upload = (token: string, patientId: string, content = PDF) => {
    const { payload, headers } = buildMultipart({ category: 'LAB_RESULT' }, { filename: 'result.pdf', content, contentType: 'application/pdf' });
    return app.inject({ method: 'POST', url: `/patients/${patientId}/documents`, headers: { ...authHeader(token), ...headers }, payload });
  };
  const download = (token: string, id: string) => app.inject({ method: 'GET', url: `/documents/${id}/download`, headers: authHeader(token) });

  /** An earlier version's file, left on this machine's disk. */
  function legacyFile(storageKey: string, content: Buffer) {
    fs.mkdirSync(LEGACY_DIR, { recursive: true });
    const file = path.join(LEGACY_DIR, storageKey);
    fs.writeFileSync(file, content);
    legacyFiles.push(file);
    return file;
  }

  it('keeps an uploaded file through a restart: it is in the database, not on the server\'s disk', async () => {
    const { token, patientId } = await setup();
    const uploaded = await upload(token, patientId);
    expect(uploaded.statusCode).toBe(200);
    const { document } = uploaded.json();
    expect(document.available).toBe(true);
    expect(document.storageKey).toBeUndefined(); // internal, never sent

    const row = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    const stored = await prisma.storedFile.findUniqueOrThrow({ where: { storageKey: row.storageKey } });
    expect(Buffer.from(stored.data).equals(PDF)).toBe(true);
    expect(stored).toMatchObject({ size: PDF.length, sha256: sha256(PDF) });
    expect(fs.existsSync(path.join(LEGACY_DIR, row.storageKey))).toBe(false);

    // A restart: a new server, nothing carried over in memory or on disk.
    await app.close();
    app = await buildTestApp();
    const after = await download(token, document.id);
    expect(after.statusCode).toBe(200);
    expect(after.rawPayload.equals(PDF)).toBe(true);
    expect(after.headers['content-length']).toBe(String(PDF.length));
  });

  it('deleting a document removes its bytes too - nothing is left behind', async () => {
    const { token, patientId } = await setup();
    const { document } = (await upload(token, patientId)).json();
    expect(await prisma.storedFile.count()).toBe(1);

    expect((await app.inject({ method: 'DELETE', url: `/documents/${document.id}`, headers: authHeader(token) })).statusCode).toBe(200);
    expect(await prisma.storedFile.count()).toBe(0);
    expect(await prisma.document.count()).toBe(0);
    expect((await download(token, document.id)).statusCode).toBe(404);
  });

  it('saves a record and its file together: if the record cannot be saved, neither is the file', async () => {
    const { patientId } = await setup();
    await expect(storeDocument({
      clinicId: 'no-such-clinic', patientId, category: 'OTHER', fileName: 'x.pdf', mimeType: 'application/pdf',
      fileSize: PDF.length, storageKey: 'orphan-check.pdf', uploadedByUserId: null,
    }, PDF)).rejects.toThrow();
    expect(await prisma.storedFile.count()).toBe(0);
  });

  it('says plainly when a file was lost before files were kept permanently, in the list and on download', async () => {
    const { clinic, token, userId, patientId } = await setup();
    const lost = await prisma.document.create({
      data: { clinicId: clinic.id, patientId, category: 'LAB_RESULT', fileName: 'old-scan.pdf', mimeType: 'application/pdf', fileSize: 999, storageKey: 'wiped-by-a-restart.pdf', uploadedByUserId: userId },
    });

    const list = (await app.inject({ method: 'GET', url: `/patients/${patientId}/documents`, headers: authHeader(token) })).json();
    expect(list.documents).toEqual([expect.objectContaining({ id: lost.id, available: false })]);

    const res = await download(token, lost.id);
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ reason: 'FILE_MISSING', error: expect.stringContaining('upload it again') });

    // The operator sees how many, on the System page.
    expect(await storageSummary()).toMatchObject({ documents: 1, storedFiles: 0, missing: 1 });
    // ...and the file can be deleted and uploaded again.
    expect((await app.inject({ method: 'DELETE', url: `/documents/${lost.id}`, headers: authHeader(token) })).statusCode).toBe(200);
  });

  it('never serves damaged bytes: a file that no longer matches its checksum is reported, not sent', async () => {
    const { token, patientId } = await setup();
    const { document } = (await upload(token, patientId)).json();
    const row = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    const damaged = Buffer.from(PDF);
    damaged[10] ^= 0xff;
    await prisma.storedFile.update({ where: { storageKey: row.storageKey }, data: { data: damaged } });

    const res = await download(token, document.id);
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toContain('damaged');
  });

  it('moves files an earlier version left on disk into the database - at start-up, or when first opened', async () => {
    const { clinic, token, userId, patientId } = await setup();
    const make = (storageKey: string) => prisma.document.create({
      data: { clinicId: clinic.id, patientId, category: 'OTHER', fileName: storageKey, mimeType: 'application/pdf', fileSize: PDF.length, storageKey, uploadedByUserId: userId },
    });
    const atStartup = await make(`legacy-${crypto.randomUUID()}.pdf`);
    const onFirstOpen = await make(`legacy-${crypto.randomUUID()}.pdf`);
    const startupFile = legacyFile(atStartup.storageKey, PDF);
    await make(`gone-${crypto.randomUUID()}.pdf`); // no longer on disk anywhere

    // Start-up adopts what it finds (the second file appears only afterwards).
    expect(await adoptLegacyFiles(() => {})).toEqual({ adopted: 1, missing: 2 });
    legacyFile(onFirstOpen.storageKey, PDF);
    fs.rmSync(startupFile); // the disk is wiped - the database copy remains
    expect((await download(token, atStartup.id)).rawPayload.equals(PDF)).toBe(true);

    // Opened before any sweep: served from disk and moved in at the same time.
    expect((await download(token, onFirstOpen.id)).rawPayload.equals(PDF)).toBe(true);
    expect(await prisma.storedFile.count({ where: { storageKey: onFirstOpen.storageKey } })).toBe(1);

    // Deleting one removes the leftover disk copy too.
    expect((await app.inject({ method: 'DELETE', url: `/documents/${onFirstOpen.id}`, headers: authHeader(token) })).statusCode).toBe(200);
    expect(fs.existsSync(path.join(LEGACY_DIR, onFirstOpen.storageKey))).toBe(false);

    // Running it again changes nothing.
    expect(await adoptLegacyFiles(() => {})).toEqual({ adopted: 0, missing: 1 });
  });

  it('never reads outside its own folder, whatever a storage key says', async () => {
    expect(await readFile('../package.json')).toEqual({ missing: true, reason: 'NOT_STORED' });
    expect(await readFile('../../package.json')).toEqual({ missing: true, reason: 'NOT_STORED' });
  });
});
