'use client';

import { useState } from 'react';
import { Download, Info, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ugx } from '@/lib/finance';
import { openDocumentPreview } from '@/lib/document-preview';
import { billState, billsSummary, gather, portalDate, type PortalRecord } from '@/lib/patient-portal';
import { EmptyState, FacilityTag, PortalCard, StateBadge, TabIntro } from './ui';

/** Every bill, line by line, with what was paid and a copy of each receipt. */
export function PortalBills({ records, onError }: { records: PortalRecord[]; onError: (message: string) => void }) {
  const [opening, setOpening] = useState<string | null>(null);
  const bills = gather(records, (r) => r.invoices, (b) => b.createdAt);
  const visits = new Map(records.flatMap((r) => r.consultations.map((c) => [c.id, c.createdAt] as const)));
  const summary = billsSummary(records);
  const several = records.length > 1;

  const openReceipt = async (paymentId: string) => {
    setOpening(paymentId);
    try {
      await openDocumentPreview(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/payments/${paymentId}/receipt/pdf`, localStorage.getItem('patientToken'));
    } catch (err: any) {
      onError(err?.message || "The receipt couldn't be opened just now. Please try again.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <section aria-labelledby="bills-heading">
      <TabIntro title="Bills and receipts">What each visit cost, what you have paid, and a copy of every receipt.</TabIntro>

      <p className="mb-4 flex gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>Bills are paid at the facility, which gives you a numbered receipt. Bulamu never asks you to pay online or by phone.</span>
      </p>

      {bills.length === 0 ? (
        <EmptyState icon={Receipt} title="No bills yet">When your facility bills you for a visit, a test or medicine, it appears here with each charge listed.</EmptyState>
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: 'Billed', value: summary.billed },
              { label: 'Paid', value: summary.paid },
              { label: 'Still to pay', value: summary.owed, owed: summary.owed > 0 },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                <dt className="text-xs text-slate-500 dark:text-slate-400">{s.label}</dt>
                <dd className={`mt-0.5 text-sm font-semibold tabular-nums sm:text-base ${s.owed ? 'text-amber-700 dark:text-amber-300' : 'text-slate-950 dark:text-slate-50'}`}>{ugx(s.value)}</dd>
              </div>
            ))}
          </dl>

          <ul className="space-y-3">
            {bills.map((bill) => {
              const state = billState(bill);
              const visitDate = bill.consultationId ? visits.get(bill.consultationId) : undefined;
              return (
                <li key={bill.id}>
                  <PortalCard>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-950 dark:text-slate-50">
                          {visitDate ? `Visit on ${portalDate(visitDate)}` : `Bill of ${portalDate(bill.createdAt)}`}
                        </p>
                        <FacilityTag name={bill.facility} show={several} />
                      </div>
                      <StateBadge tone={state.tone}>{state.label}</StateBadge>
                    </div>

                    <table className="mt-3 w-full text-sm">
                      <caption className="sr-only">Charges</caption>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {bill.items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-1.5 pr-3 text-slate-700 dark:text-slate-300">
                              {item.description}
                              {item.quantity > 1 && <span className="text-slate-500 dark:text-slate-400"> &times; {item.quantity}</span>}
                              {item.kindLabel !== item.description && <span className="block text-xs text-slate-400">{item.kindLabel}</span>}
                            </td>
                            <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{ugx(item.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 dark:border-slate-700">
                          <th scope="row" className="pt-2 text-left font-semibold text-slate-900 dark:text-slate-100">Total</th>
                          <td className="whitespace-nowrap pt-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">{ugx(bill.amount)}</td>
                        </tr>
                      </tfoot>
                    </table>

                    {bill.payments.length > 0 && (
                      <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payments</p>
                        <ul className="mt-1.5 space-y-1.5">
                          {bill.payments.map((p) => (
                            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span className="text-slate-700 dark:text-slate-300">
                                <span className="font-medium tabular-nums">{ugx(p.amount)}</span>
                                <span className="text-slate-500 dark:text-slate-400"> on {portalDate(p.receivedAt)}{p.method ? `, ${p.method.toLowerCase()}` : ''}</span>
                                <span className="block text-xs text-slate-500 dark:text-slate-400">Receipt No. {p.receiptNumber}</span>
                              </span>
                              <Button size="sm" variant="outline" disabled={opening === p.id} onClick={() => openReceipt(p.id)}>
                                <Download className="size-4" aria-hidden="true" />
                                {opening === p.id ? 'Opening...' : 'Receipt'}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {bill.balance > 0 && (
                      <p className="mt-3 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        <span>Still to pay at the facility</span>
                        <span className="tabular-nums">{ugx(bill.balance)}</span>
                      </p>
                    )}
                  </PortalCard>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
