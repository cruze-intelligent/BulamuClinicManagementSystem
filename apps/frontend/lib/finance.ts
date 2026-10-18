// Shared by the Bills & Payments and Finances pages: the words for payment
// methods, kinds of charge and expense categories (as the server names them),
// money as people write it, and the text of a receipt sent by SMS or WhatsApp.

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile money' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'INSURANCE', label: 'Insurance' },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];

/** What the reference box asks for, by method - a payment can be traced later only by this. */
export const REFERENCE_HINTS: Record<PaymentMethod, { label: string; placeholder: string } | null> = {
  CASH: null,
  MOBILE_MONEY: { label: 'Transaction ID', placeholder: 'From the mobile money message' },
  CARD: { label: 'Card slip number', placeholder: 'Optional' },
  BANK: { label: 'Bank reference', placeholder: 'From the deposit slip or transfer' },
  INSURANCE: { label: 'Insurer and member or claim number', placeholder: 'e.g. Jubilee - 12345' },
};

export const CHARGE_KINDS = [
  { value: 'CONSULTATION', label: 'Consultation' },
  { value: 'LAB', label: 'Lab test' },
  { value: 'MEDICINE', label: 'Medicine' },
  { value: 'PROCEDURE', label: 'Procedure' },
  { value: 'ADMISSION', label: 'Admission / ward' },
  { value: 'OTHER', label: 'Other' },
] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number]['value'];

export const EXPENSE_CATEGORIES = [
  { value: 'MEDICINES_SUPPLIES', label: 'Medicines and supplies' },
  { value: 'SALARIES', label: 'Salaries and wages' },
  { value: 'RENT', label: 'Rent' },
  { value: 'UTILITIES', label: 'Utilities (power, water, internet)' },
  { value: 'EQUIPMENT', label: 'Equipment and repairs' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const methodLabel = (method: string | null | undefined) =>
  PAYMENT_METHODS.find((m) => m.value === method)?.label ?? 'Not recorded';
export const kindLabel = (kind: string) => CHARGE_KINDS.find((k) => k.value === kind)?.label ?? kind;
export const categoryLabel = (category: string) => EXPENSE_CATEGORIES.find((c) => c.value === category)?.label ?? category;

/** UGX 25,000 */
export const ugx = (amount: number) => `UGX ${Math.round(amount).toLocaleString('en-US')}`;

/** "25,000" or "25000" or " 25 000 " -> 25000; anything else (or nothing) -> null. */
export function parseShillings(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 ? value : null;
}

const KAMPALA = 'Africa/Kampala';

/** Today's date in Kampala as YYYY-MM-DD - what the date and month pickers start on. */
export function kampalaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: KAMPALA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** 18 Oct 2026 */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: KAMPALA });
/** 14:05 */
export const shortTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: KAMPALA });

/** A receipt in one short message, for SMS or WhatsApp - what the patient needs, nothing clinical. */
export function receiptMessage(input: {
  clinicName: string; patientName: string; receiptNumber: string; amount: number; method: string | null; receivedAt: string; balance: number;
}): string {
  const when = `${shortDate(input.receivedAt)} ${shortTime(input.receivedAt)}`;
  const balance = input.balance > 0 ? `Balance ${ugx(input.balance)}.` : 'Paid in full.';
  return `${input.clinicName}: receipt ${input.receiptNumber} for ${input.patientName}. ${ugx(input.amount)} received by ${methodLabel(input.method).toLowerCase()} on ${when}. ${balance} Thank you.`;
}

/** A phone number as WhatsApp links need it: 2567XXXXXXXX (Uganda by default). */
export function internationalPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (/^256\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `256${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits)) return `256${digits}`;
  return null;
}

/** Opens the phone's messages app with the receipt written in. */
export function smsLink(phone: string | null | undefined, message: string): string {
  const to = internationalPhone(phone);
  return `sms:${to ? `+${to}` : ''}?body=${encodeURIComponent(message)}`;
}

/** Opens WhatsApp with the receipt written in, to the patient's number when it is one. */
export function whatsappLink(phone: string | null | undefined, message: string): string {
  const to = internationalPhone(phone);
  return `https://wa.me/${to ?? ''}?text=${encodeURIComponent(message)}`;
}
