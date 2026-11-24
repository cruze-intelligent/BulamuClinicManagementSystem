/**
 * How every search box finds records - the same way everywhere: by the words
 * typed, in any order ("ogwal francis" finds Francis Ogwal; "amox 500" finds
 * Amoxicillin 500 mg capsule), by a phone number however it is written
 * ("0772 340 349", "772340349", "+256772340349"), or by a Patient ID ("19",
 * "00019", "ID 00019", "#19"). Letter case and accents do not matter.
 */

/** Lower case, without accents, spaces tidied. */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const wordsOf = (text: string) => normalizeText(text).split(/[\s,;/()]+/).filter(Boolean);

/** Every word of the search appears somewhere in the record's text, in any order. */
export function hasAllWords(text: string | Array<string | null | undefined>, query: string): boolean {
  const haystack = normalizeText(Array.isArray(text) ? text.filter(Boolean).join(' ') : text);
  const wanted = wordsOf(query);
  return wanted.every((w) => haystack.includes(w));
}

/** A phone number's digits as dialled in Uganda, without the country code or the leading 0. */
export function phoneDigits(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('256') && digits.length > 9) return digits.slice(3);
  return digits.replace(/^0+/, '');
}

/** A search that is a Patient ID - "42", "00042", "ID 00042", "#42" - the number it stands for, or null. */
export function patientIdFrom(query: string): number | null {
  const match = /^(?:id|patient\s*id|pid|#)?\s*[:#-]?\s*(\d{1,7})$/i.exec(query.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return n > 0 ? n : null;
}

/** Whether a search finds this patient: by name (any order), phone, Patient ID, email or where they live. */
export function matchesPatient(
  patient: { name: string; phone?: string | null; patientNumber?: number | null; email?: string | null; village?: string | null; district?: string | null },
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  const id = patientIdFrom(q);
  if (id !== null && patient.patientNumber === id) return true;
  const digits = q.replace(/[\s()+-]/g, '');
  if (/^\d{4,}$/.test(digits) && phoneDigits(patient.phone).includes(phoneDigits(digits))) return true;
  return hasAllWords([patient.name, patient.email, patient.village, patient.district], q);
}
