/**
 * Why a subscription payment did not go through (or was undone), in words for
 * the facility's administrator and the Bulamu operator. Read from what Pesapal
 * told us when the payment was checked; never shows anything secret.
 */
type Checked = { statusCode?: unknown; paymentStatusDescription?: unknown; description?: unknown; amount?: unknown; currency?: unknown };

const text = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 160) : '');

export function paymentReason(p: {
  status: string;
  method?: string | null;
  amount: number;
  currency: string;
  pesapalOrderTrackingId?: string | null;
  rawCallback?: unknown;
}): string | null {
  if (p.status === 'REVERSED') return 'Pesapal reversed this payment (a refund or a chargeback).';
  if (p.status !== 'FAILED') return null;

  if (!p.pesapalOrderTrackingId) return 'Pesapal could not open the payment page, so nothing was charged. Try again.';

  const checked = (p.rawCallback && typeof p.rawCallback === 'object' ? p.rawCallback : {}) as Checked;
  if (Number(checked.statusCode) === 1) {
    return `Pesapal reported ${text(checked.currency) || p.currency} ${Number(checked.amount).toLocaleString('en-US')}, not the ${p.currency} ${p.amount.toLocaleString('en-US')} due, so the subscription was not renewed. Contact Bulamu.`;
  }
  const said = [text(checked.paymentStatusDescription), text(checked.description)].filter(Boolean);
  const unique = said.filter((s, i) => said.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === i);
  const detail = unique.length ? `Pesapal: ${unique.join(' - ')}. ` : '';
  return `${detail}The payment was declined or not completed (for example a wrong PIN, too little balance, the prompt timing out or a cancelled card), so nothing was charged. Try again.`;
}
