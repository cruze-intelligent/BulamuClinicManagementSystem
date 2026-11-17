import type { ChargeKind } from '@prisma/client';
import { prisma } from './prisma';
import { cleanText, isChargeKind, parseAmount } from './invoices';

/**
 * A facility's price list: what it charges for each consultation, lab test,
 * imaging examination, procedure and ward night, set once by its administrator
 * and offered whenever that charge goes on a bill. Medicines are not on it -
 * their price is kept with the stock item.
 */
export const PRICED_KINDS: ChargeKind[] = ['CONSULTATION', 'LAB', 'IMAGING', 'PROCEDURE', 'ADMISSION', 'OTHER'];
export const MAX_PRICES = 1000;

export type PriceInput = { kind: ChargeKind; name: string; price: number };

/** One price from a form, checked. */
export function parseServicePrice(body: unknown): PriceInput | { error: string } {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (input.kind === 'MEDICINE') return { error: 'Medicines are priced in stock (Inventory), so each batch keeps its own price' };
  if (!isChargeKind(input.kind) || !PRICED_KINDS.includes(input.kind)) return { error: 'Choose what the price is for' };
  const name = cleanText(input.name, 120);
  if (!name) return { error: 'Name the service, for example "General consultation" or "Malaria RDT"' };
  try {
    return { kind: input.kind, name, price: parseAmount(input.price) };
  } catch (error: any) {
    return { error: error.message };
  }
}

const key = (kind: string, name: string) => `${kind}|${name.trim().toLowerCase()}`;

/**
 * The price to suggest for each charge: the facility's price list, else what
 * it last charged for the same thing. Returns a lookup; null when neither has one.
 */
export async function priceLookup(clinicId: string, wanted: Array<{ kind: ChargeKind; description: string }>): Promise<(kind: ChargeKind, description: string) => number | null> {
  if (wanted.length === 0) return () => null;
  const kinds = [...new Set(wanted.map((w) => w.kind))];
  const names = [...new Set(wanted.map((w) => w.description))];
  const [listed, charged] = await Promise.all([
    prisma.servicePrice.findMany({ where: { clinicId, kind: { in: kinds } }, select: { kind: true, name: true, price: true } }),
    prisma.invoiceItem.findMany({
      where: { kind: { in: kinds }, description: { in: names, mode: 'insensitive' }, invoice: { clinicId } },
      orderBy: { createdAt: 'desc' },
      select: { kind: true, description: true, unitPrice: true },
      take: 500,
    }),
  ]);
  const prices = new Map<string, number>();
  // Oldest first, so the most recent charge wins; then the price list over both.
  for (const item of [...charged].reverse()) prices.set(key(item.kind, item.description), item.unitPrice);
  for (const item of listed) prices.set(key(item.kind, item.name), item.price);
  return (kind, description) => prices.get(key(kind, description)) ?? null;
}
