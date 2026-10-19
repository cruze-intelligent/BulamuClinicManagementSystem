'use client';

import { ArrowRightLeft, BedDouble, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openDocumentPreview } from '@/lib/document-preview';

export type PortalReferral = { id: string; reason: string; urgency: string; status: string; responseNote: string | null; createdAt: string; toClinic: { name: string } };
export type PortalStay = {
  id: string; status: string; admittedAt: string; dischargedAt: string | null; reason: string; outcome: string | null;
  dischargeDiagnosis: string | null; dischargeSummary: string | null; followUpInstructions: string | null; ward: { name: string };
};

const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' });
const STATUS: Record<string, string> = { PENDING: 'Waiting for the facility to reply', ACCEPTED: 'Accepted', DECLINED: 'Declined', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

const open = (path: string) =>
  openDocumentPreview(`${process.env.NEXT_PUBLIC_API_URL}${path}`, localStorage.getItem('patientToken')).catch((e: any) => alert(e.message));

/** A patient's referrals and hospital stays at one facility, with their letters. */
export function PortalStaysAndReferrals({ referrals, stays }: { referrals: PortalReferral[]; stays: PortalStay[] }) {
  if (referrals.length === 0 && stays.length === 0) return null;
  return (
    <>
      {stays.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <BedDouble className="size-4" aria-hidden="true" /> Hospital stays
          </div>
          <ul className="mt-2 space-y-1.5">
            {stays.map((s) => (
              <li key={s.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                <span className="font-medium text-slate-800 dark:text-slate-200">{s.ward.name}</span>
                <span className="ml-2 text-slate-500 dark:text-slate-400">{date(s.admittedAt)}{s.dischargedAt ? ` - ${date(s.dischargedAt)}` : ' - still admitted'}</span>
                <span className="block text-slate-700 dark:text-slate-300">{s.dischargeDiagnosis || s.reason}</span>
                {s.followUpInstructions && <span className="block text-slate-600 dark:text-slate-400">Follow-up: {s.followUpInstructions}</span>}
                {s.status === 'DISCHARGED' && s.outcome !== 'DIED' && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => open(`/patient-portal/admissions/${s.id}/discharge-summary`)}>
                    <FileText className="size-4" aria-hidden="true" /> Discharge summary
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {referrals.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <ArrowRightLeft className="size-4" aria-hidden="true" /> Referrals
          </div>
          <ul className="mt-2 space-y-1.5">
            {referrals.map((r) => (
              <li key={r.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                <span className="font-medium text-slate-800 dark:text-slate-200">To {r.toClinic.name}</span>
                <span className="ml-2 text-slate-500 dark:text-slate-400">{date(r.createdAt)} · {STATUS[r.status] ?? r.status}</span>
                <span className="block text-slate-700 dark:text-slate-300">{r.reason}</span>
                {r.responseNote && <span className="block text-slate-600 dark:text-slate-400">Reply: {r.responseNote}</span>}
                <Button size="sm" variant="outline" className="mt-2" onClick={() => open(`/patient-portal/referrals/${r.id}/letter`)}>
                  <FileText className="size-4" aria-hidden="true" /> Referral letter
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
