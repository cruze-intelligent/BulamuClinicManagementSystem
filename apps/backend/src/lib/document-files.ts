import type { FastifyReply } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { deleteFile, readFile, removeLegacyCopy, saveFile, storedKeys } from './storage';
import { setDownloadHeaders } from './document-format';

/** A document and its file, saved together: neither exists without the other. */
export async function storeDocument(data: Prisma.DocumentUncheckedCreateInput, file: Buffer) {
  return prisma.$transaction(async (tx) => {
    await saveFile(data.storageKey, file, tx);
    return tx.document.create({ data });
  }, { timeout: 30_000 });
}

/** A document and its file, deleted together - nothing of the file is left behind. */
export async function removeDocument(document: { id: string; storageKey: string }) {
  await prisma.$transaction(async (tx) => {
    await tx.document.delete({ where: { id: document.id } });
    await deleteFile(document.storageKey, tx);
  });
  await removeLegacyCopy(document.storageKey);
}

const MISSING_MESSAGES = {
  NOT_STORED: 'This file is no longer stored - it was uploaded before Bulamu began keeping files permanently. Please upload it again.',
  DAMAGED: 'This file is damaged and cannot be opened. Please upload it again.',
};

/** Sends a document's file, or says plainly that it is missing (410), never a broken download. */
export async function sendDocumentFile(reply: FastifyReply, document: { mimeType: string; fileName: string; storageKey: string }) {
  const file = await readFile(document.storageKey);
  if ('missing' in file) {
    return reply.status(410).send({ error: MISSING_MESSAGES[file.reason], reason: 'FILE_MISSING' });
  }
  setDownloadHeaders(reply, document);
  reply.header('Content-Length', String(file.data.length));
  return reply.send(file.data);
}

/**
 * Documents for a list, each marked with whether its file is stored. The
 * internal storage key is not sent.
 */
export async function withAvailability<T extends { storageKey: string }>(documents: T[]): Promise<Array<Omit<T, 'storageKey'> & { available: boolean }>> {
  const stored = await storedKeys(documents.map((d) => d.storageKey));
  return documents.map(({ storageKey, ...rest }) => ({ ...rest, available: stored.has(storageKey) }));
}
