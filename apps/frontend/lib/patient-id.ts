// The facility's own Patient ID, as printed on its documents: 42 -> "00042".
export function patientIdText(number: number | null | undefined): string | null {
  return number ? String(number).padStart(5, '0') : null;
}

/** A search that is a Patient ID ("42", "00042") - the number it stands for, or null. */
export function patientIdQuery(query: string): number | null {
  const digits = query.trim();
  return /^\d{1,7}$/.test(digits) && Number(digits) > 0 ? Number(digits) : null;
}
