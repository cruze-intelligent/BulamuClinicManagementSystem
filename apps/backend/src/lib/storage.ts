import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Local-disk document storage. This is the right default for the edge
 * micro-server deployment (Raspberry Pi, section 4 of DEPLOYMENT.md) where
 * disk is the only option and persists across restarts.
 *
 * Render's free-tier disk is ephemeral (wiped on redeploy/restart), so a
 * cloud deployment meant to keep uploaded documents long-term needs an
 * object-storage-backed implementation of this same read/write/delete
 * contract (e.g. Cloudflare R2 or Supabase Storage) swapped in via
 * DOCUMENT_STORAGE_DIR pointing at a mounted volume, or a future storage
 * driver - not addressed here since no such account exists yet.
 */
const STORAGE_DIR = process.env.DOCUMENT_STORAGE_DIR || path.join(__dirname, '..', '..', 'uploads');

function ensureStorageDir() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

export function generateStorageKey(originalFileName: string): string {
  const ext = path.extname(originalFileName);
  return `${crypto.randomUUID()}${ext}`;
}

export async function saveFile(storageKey: string, data: Buffer): Promise<void> {
  ensureStorageDir();
  const filePath = path.join(STORAGE_DIR, storageKey);
  await fs.promises.writeFile(filePath, data);
}

export function getFileStream(storageKey: string): fs.ReadStream {
  const filePath = path.join(STORAGE_DIR, storageKey);
  return fs.createReadStream(filePath);
}

export async function deleteFile(storageKey: string): Promise<void> {
  const filePath = path.join(STORAGE_DIR, storageKey);
  await fs.promises.unlink(filePath).catch(() => {});
}
