// Patient invoices are the facility's own bills to its patients. Bulamu keeps
// the record (amount, paid or not) - the facility charges and collects.

const MAX_FEE = 100_000_000; // UGX - far above any single visit; catches a mistyped extra zero or two.

/** A fee in whole UGX, or null if none was given. Throws on an impossible amount. */
export function parseFee(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const fee = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : Number(value);
  if (!Number.isFinite(fee) || !Number.isInteger(fee) || fee < 0) throw new Error('The fee must be a whole number of shillings');
  if (fee > MAX_FEE) throw new Error('That fee looks too large - check the amount');
  return fee === 0 ? null : fee;
}
