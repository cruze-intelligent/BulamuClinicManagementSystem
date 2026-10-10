'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, Lock, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const API = process.env.NEXT_PUBLIC_API_URL;
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

type Status = { linked: boolean; otherFacilities: number; share: { id: string; status: 'REQUESTED' | 'APPROVED'; requestedAt: string; approvedAt: string | null } | null };

/**
 * The patient's records from OTHER Bulamu facilities - shown only after the
 * patient approves. Clinicians can ask (the patient approves later from their
 * Patient Portal) or, with the patient present, have them approve on this
 * device with their own password or a code sent to them.
 */
export function SharedHistoryPanel({ patientId }: { patientId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [mode, setMode] = useState<'none' | 'PIN' | 'OTP'>('none');
  const [secret, setSecret] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`${API}/patients/${patientId}/shared-history/status`, { headers: authHeaders() });
    const data = await res.json();
    if (data.success) setStatus(data);
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (path: string, body?: unknown) => {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`${API}/patients/${patientId}/shared-history${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Something went wrong');
      return data;
    } catch (e: any) {
      setMessage(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const showHistory = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}/patients/${patientId}/shared-history`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setHistory(data.facilities);
    } catch (e: any) {
      setMessage(e.message || 'Could not load the history');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await call('/approve', mode === 'PIN' ? { method: 'PIN', password: secret } : { method: 'OTP', otp: secret });
    if (data) {
      setSecret('');
      setMode('none');
      await load();
      await showHistory();
    }
  };

  if (!status) return null;

  return (
    <Card className="mb-6 p-6" data-testid="shared-history">
      <div className="mb-2 flex items-center gap-2">
        <History className="size-5 text-emerald-700" aria-hidden="true" />
        <h2 className="text-xl font-bold">History from other facilities</h2>
      </div>

      {!status.linked ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          This patient has no Patient Portal account linked to your facility. Their records at other facilities can be shared only once they have one and approve it themselves.
        </p>
      ) : status.otherFacilities === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">This patient has no records at other Bulamu facilities.</p>
      ) : status.share?.status === 'APPROVED' ? (
        <>
          <p className="flex items-start gap-1.5 text-sm text-slate-600 dark:text-slate-400">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" />
            The patient approved sharing on {date(status.share.approvedAt!)}. Each time you open it, it is recorded and the patient can see it. They can stop sharing at any time.
          </p>
          {!history && <Button className="mt-3" size="sm" disabled={busy} onClick={showHistory}>{busy ? 'Loading...' : `Show records from ${status.otherFacilities} other facilit${status.otherFacilities === 1 ? 'y' : 'ies'}`}</Button>}
        </>
      ) : (
        <>
          <p className="flex items-start gap-1.5 text-sm text-slate-600 dark:text-slate-400">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            This patient has records at {status.otherFacilities} other Bulamu facilit{status.otherFacilities === 1 ? 'y' : 'ies'}: allergies, diagnoses, medicines, lab results and hospital stays. You can see them only if the patient approves.
          </p>
          {status.share?.status === 'REQUESTED' && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">Asked on {date(status.share.requestedAt)} - waiting for the patient to approve in their Patient Portal.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setMode('PIN'); setSecret(''); }}>Patient is here: approve with their password</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setMode('OTP'); setSecret(''); const d = await call('/otp'); if (d) setCodeSent(true); }}>Send the patient a code</Button>
            {!status.share && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { if (await call('/request')) { await load(); setMessage('Request sent. The patient can approve it from their Patient Portal; you will be notified.'); } }}>
                Ask the patient to approve later
              </Button>
            )}
          </div>

          {mode !== 'none' && (
            <form onSubmit={approve} className="mt-3 space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <Label htmlFor="consent-secret">
                {mode === 'PIN' ? 'Hand the device to the patient to type their Patient Portal password' : codeSent ? 'Ask the patient for the 6-digit code sent to their email' : 'Sending the code...'}
              </Label>
              <Input
                id="consent-secret" autoComplete="off" type={mode === 'PIN' ? 'password' : 'text'} inputMode={mode === 'OTP' ? 'numeric' : undefined}
                value={secret} onChange={(e) => setSecret(e.target.value)} required
              />
              <p className="text-xs text-slate-500">By entering this, the patient agrees that your facility may see their records from other facilities.</p>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || !secret}>Approve</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setMode('none'); setSecret(''); }}>Cancel</Button>
              </div>
            </form>
          )}
        </>
      )}

      {message && <p role="status" className="mt-3 text-sm text-slate-700 dark:text-slate-300">{message}</p>}

      {history && (
        <div className="mt-4 space-y-4">
          {history.length === 0 && <p className="text-sm text-slate-500">No records to show.</p>}
          {history.map((f) => (
            <div key={f.facility.name} className="rounded-md border border-slate-200 p-4 dark:border-slate-800">
              <h3 className="font-semibold">{f.facility.name}{f.facility.district ? <span className="font-normal text-slate-500"> · {f.facility.district}</span> : null}</h3>
              <p className={`mt-1 text-sm ${f.allergies.startsWith('No known') ? '' : 'font-medium text-rose-700 dark:text-rose-400'}`}>Allergies: {f.allergies}</p>

              {f.stays.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase text-slate-500">Hospital stays</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {f.stays.map((s: any, i: number) => (
                      <li key={i}>
                        <span className="font-medium">{date(s.admittedAt)}{s.dischargedAt ? ` - ${date(s.dischargedAt)}` : ' (still admitted)'}</span> · {s.ward}: {s.finalDiagnosis || s.reason}
                        {s.summary && <span className="block text-slate-600 dark:text-slate-400">{s.summary}</span>}
                        {s.followUp && <span className="block text-slate-600 dark:text-slate-400">Follow-up: {s.followUp}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {f.visits.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase text-slate-500">Visits</p>
                  <ul className="mt-1 space-y-2 text-sm">
                    {f.visits.map((v: any, i: number) => (
                      <li key={i}>
                        <span className="font-medium">{date(v.date)}</span>{v.clinician ? ` · ${v.clinician}` : ''}
                        <span className="block">
                          {v.diagnoses.map((d: any) => `${d.description}${d.icd10Code ? ` (${d.icd10Code})` : ''}${d.certainty === 'PROVISIONAL' ? ' - suspected' : ''}`).join('; ') || v.complaints}
                        </span>
                        {v.medicines.length > 0 && (
                          <span className="block text-slate-600 dark:text-slate-400">Rx: {v.medicines.map((m: any) => `${m.title}${m.directions ? ` - ${m.directions}` : ''}`).join('; ')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {f.labResults.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase text-slate-500">Lab results</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {f.labResults.map((l: any, i: number) => <li key={i}><span className="font-medium">{l.test}</span>: {l.result} <span className="text-slate-500">({date(l.date)})</span></li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
