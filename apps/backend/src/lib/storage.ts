import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Uploaded documents' bytes live in the database (StoredFile), beside the
 * records they belong to, so they survive restarts and redeploys: the API
 * host's own disk is wiped on every one (Render), and a document is only kept
 * if it is kept everywhere the record is - including the database's backups.
 *
 * A file is written in the same transaction as its Document row and deleted in
 * the same transaction as it, so a record never points at a file that was not
 * saved, and deleting a document really removes its bytes. Each file's SHA-256
 * is stored and checked on every read: damaged bytes are never served.
 *
 * Files written by earlier versions went to local disk (DOCUMENT_STORAGE_DIR,
 * or ./uploads). Where that disk still has them - the edge micro-server, a
 * developer's machine - they are moved into the database on first read and by
 * adoptLegacyFiles() at start-up.
 */
type Db = Prisma.TransactionClient | typeof prisma;

const LEGACY_DIR = process.env.DOCUMENT_STORAGE_DIR || path.join(__dirname, '..', '..', 'uploads');

const sha256 = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');

export function generateStorageKey(originalFileName: string): string {
  const ext = path.extname(originalFileName);
  return `${crypto.randomUUID()}${ext}`;
}

/** Stores a file. Pass the transaction that creates its Document row. */
export async function saveFile(storageKey: string, data: Buffer, db: Db = prisma): Promise<void> {
  const record = { data, size: data.length, sha256: sha256(data) };
  await db.storedFile.upsert({ where: { storageKey }, create: { storageKey, ...record }, update: record });
}

/** A key from the legacy disk store, resolved safely inside its folder (never outside it). */
function legacyPath(storageKey: string): string | null {
  const resolved = path.resolve(LEGACY_DIR, storageKey);
  return resolved.startsWith(path.resolve(LEGACY_DIR) + path.sep) ? resolved : null;
}

async function readLegacy(storageKey: string): Promise<Buffer | null> {
  const file = legacyPath(storageKey);
  if (!file) return null;
  try {
    return await fs.promises.readFile(file);
  } catch {
    return null;
  }
}

export type ReadResult = { data: Buffer } | { missing: true; reason: 'NOT_STORED' | 'DAMAGED' };

/**
 * A stored file's bytes. A file only on the legacy disk is moved into the
 * database as it is read. Bytes that don't match their checksum are reported,
 * never returned.
 */
export async function readFile(storageKey: string): Promise<ReadResult> {
  const stored = await prisma.storedFile.findUnique({ where: { storageKey } });
  if (stored) {
    const data = Buffer.from(stored.data);
    if (data.length !== stored.size || sha256(data) !== stored.sha256) {
      console.error(`[storage] ${storageKey} does not match its checksum - not served`);
      return { missing: true, reason: 'DAMAGED' };
    }
    return { data };
  }
  const legacy = await readLegacy(storageKey);
  if (!legacy) return { missing: true, reason: 'NOT_STORED' };
  await saveFile(storageKey, legacy).catch((error) => console.error(`[storage] could not move ${storageKey} into the database`, error));
  return { data: legacy };
}

/**
 * Deletes a file. Pass the transaction that deletes its Document row; the
 * legacy disk copy, if there is one, goes after it is committed (see removeLegacyCopy).
 */
export async function deleteFile(storageKey: string, db: Db = prisma): Promise<void> {
  await db.storedFile.deleteMany({ where: { storageKey } });
}

/** Removes an old disk copy of a deleted file, so deleting a document leaves nothing behind. */
export async function removeLegacyCopy(storageKey: string): Promise<void> {
  const file = legacyPath(storageKey);
  if (file) await fs.promises.unlink(file).catch(() => {});
}

/** Which of these files are stored (for marking documents whose file was lost). */
export async function storedKeys(storageKeys: string[]): Promise<Set<string>> {
  if (storageKeys.length === 0) return new Set();
  const rows = await prisma.storedFile.findMany({ where: { storageKey: { in: storageKeys } }, select: { storageKey: true } });
  return new Set(rows.map((r) => r.storageKey));
}

/**
 * Moves every document still only on the legacy disk into the database.
 * Run at start-up; safe to run again (it skips files already moved).
 */
export async function adoptLegacyFiles(log: (message: string) => void = console.log): Promise<{ adopted: number; missing: number }> {
  const documents = await prisma.document.findMany({ select: { storageKey: true } });
  const have = await storedKeys(documents.map((d) => d.storageKey));
  let adopted = 0;
  let missing = 0;
  for (const { storageKey } of documents) {
    if (have.has(storageKey)) continue;
    const legacy = await readLegacy(storageKey);
    if (!legacy) {
      missing += 1;
      continue;
    }
    await saveFile(storageKey, legacy);
    adopted += 1;
  }
  if (adopted || missing) log(`[storage] moved ${adopted} document file(s) from disk into the database; ${missing} were no longer on disk`);
  return { adopted, missing };
}

/** How much is stored, for the platform's System page. */
export async function storageSummary(): Promise<{ documents: number; storedFiles: number; bytes: number; missing: number }> {
  const [documents, files, missingRows] = await Promise.all([
    prisma.document.count(),
    prisma.storedFile.aggregate({ _count: true, _sum: { size: true } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Document" d
      WHERE NOT EXISTS (SELECT 1 FROM "StoredFile" f WHERE f."storageKey" = d."storageKey")`,
  ]);
  return { documents, storedFiles: files._count, bytes: files._sum.size ?? 0, missing: Number(missingRows[0]?.count ?? 0) };
}
