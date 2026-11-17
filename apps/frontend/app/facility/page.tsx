'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/useAuth';
import { FacilityDetailsEditor } from '@/components/facility-details-editor';
import { UnitsSettings } from '@/components/units-settings';
import { optimiseLogo, rememberFacilityLogo } from '@/lib/facility-logo';

const MAX_MOTTO = 80;
const API = process.env.NEXT_PUBLIC_API_URL;

/** The facility's own details, and the logo and motto printed at the top of its documents. */
export default function FacilityPage() {
  const { user, hasRole } = useAuth();
  const clinicId = user?.clinicId;
  const signedInClinic = (user as any)?.clinic as { name?: string } | undefined;
  // The name shown on the logo preview follows any change made below.
  const [clinicName, setClinicName] = useState<string | null>(null);
  const clinic = { name: clinicName ?? signedInClinic?.name };
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isAdmin = hasRole('ADMIN');
  // What the letterhead shows beside the logo: the motto, and the Facility ID and phone.
  const [heading, setHeading] = useState<{ facilityCode?: string; phone?: string; motto: string } | null>(null);
  const [motto, setMotto] = useState('');
  const [mottoBusy, setMottoBusy] = useState(false);
  const [mottoMessage, setMottoMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadHeading = async () => {
    if (!clinicId) return;
    try {
      const res = await fetch(`${API}/clinics/${clinicId}/details`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      if (data.success) {
        setHeading({ facilityCode: data.facility.facilityCode, phone: data.facility.phone, motto: data.facility.motto ?? '' });
        setMotto(data.facility.motto ?? '');
      }
    } catch {
      // Offline: the preview shows the name only.
    }
  };

  const saveMotto = async (event: React.FormEvent) => {
    event.preventDefault();
    setMottoBusy(true);
    setMottoMessage(null);
    try {
      const res = await fetch(`${API}/clinics/${clinicId}/motto`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ motto }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The motto could not be saved');
      setHeading((h) => ({ ...(h ?? {}), motto: data.motto ?? '' }));
      setMotto(data.motto ?? '');
      setMottoMessage({ ok: true, text: data.motto ? 'Motto saved. It is printed under your name on your documents.' : 'Motto removed.' });
    } catch (error: any) {
      setMottoMessage({ ok: false, text: navigator.onLine ? error.message : 'You are offline - the motto can be saved when the connection returns.' });
    } finally {
      setMottoBusy(false);
    }
  };

  const loadLogo = async () => {
    if (!clinicId) return;
    try {
      const res = await fetch(`${API}/clinics/${clinicId}/logo`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      setLogoUrl(res.ok ? URL.createObjectURL(await res.blob()) : null);
    } catch {
      setLogoUrl(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogo();
    loadHeading();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  const upload = async (file: File) => {
    setMessage(null);
    if (!navigator.onLine) {
      setMessage({ ok: false, text: 'You are offline - the logo can be uploaded when the connection returns.' });
      return;
    }
    setBusy(true);
    try {
      // Any photo or image works: it is resized and compressed here first, so it
      // uploads quickly and fits on every document.
      const optimised = await optimiseLogo(file);
      const image = optimised.dataUrl;
      const res = await fetch(`${API}/clinics/${clinicId}/logo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ image }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The logo could not be saved');
      await loadLogo();
      if (clinicId) rememberFacilityLogo(clinicId, image);
      const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
      const smaller = file.size > optimised.bytes * 1.2 ? ` (made smaller for upload: ${kb(file.size)} to ${kb(optimised.bytes)})` : '';
      setMessage({ ok: true, text: `Logo saved${smaller}. It now shows in the menu and on your invoices, receipts, prescriptions, lab results, referral letters, discharge summaries and financial reports.` });
    } catch (error: any) {
      setMessage({ ok: false, text: error.message });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const remove = async () => {
    if (!confirm('Remove the logo? Documents will show just your facility name.')) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/clinics/${clinicId}/logo`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      if (!res.ok) throw new Error('The logo could not be removed');
      setLogoUrl(null);
      if (clinicId) rememberFacilityLogo(clinicId, null);
      setMessage({ ok: true, text: 'Logo removed.' });
    } catch (error: any) {
      setMessage({ ok: false, text: error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold">Facility</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your facility&apos;s details and logo, as they appear on the documents you print and to facilities you refer patients to.</p>

        {clinicId && <FacilityDetailsEditor clinicId={clinicId} isAdmin={isAdmin} onChanged={(details) => setClinicName(details.name)} />}

        <Card className="mt-4 p-5">
          <h2 className="text-lg font-semibold">Logo and motto on your documents</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Your invoices, receipts, prescriptions, lab results, referral letters, discharge summaries and financial reports are headed with your logo, your name, your motto and your Facility ID.
            Bulamu is named only in the small print at the foot of each page. Any image or photo of your logo works - it is resized and compressed for you. One on a white or see-through background looks best.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            {/* How it sits on the document header. */}
            <div className="flex h-24 w-full max-w-md items-center gap-3 rounded-md bg-teal-700 px-3" aria-label="Preview of the document header">
              <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md bg-white p-1.5">
                {loading ? (
                  <span className="text-xs text-slate-400">Loading...</span>
                ) : logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Your facility logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <ImagePlus className="size-6 text-slate-300" aria-label="No logo yet" />
                )}
              </div>
              <div className="min-w-0 text-white">
                <p className="truncate text-sm font-semibold">{clinic?.name ?? 'Your facility'}</p>
                {heading?.motto && <p className="truncate text-xs italic text-emerald-100">{heading.motto}</p>}
                <p className="truncate text-[11px] text-emerald-100">{[heading?.facilityCode ? `Facility ID ${heading.facilityCode}` : null, heading?.phone].filter(Boolean).join('  |  ')}</p>
              </div>
            </div>

            {isAdmin ? (
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Choose a logo image"
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                />
                <Button type="button" onClick={() => fileInput.current?.click()} disabled={busy || !clinicId}>
                  <Upload className="size-4" aria-hidden="true" /> {busy ? 'Saving...' : logoUrl ? 'Replace logo' : 'Upload logo'}
                </Button>
                {logoUrl && (
                  <Button type="button" variant="outline" onClick={remove} disabled={busy}>
                    <Trash2 className="size-4" aria-hidden="true" /> Remove
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">Your facility administrator can change the logo and motto.</p>
            )}
          </div>

          {isAdmin && (
            <form onSubmit={saveMotto} className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
              <Label htmlFor="facility-motto">Motto <span className="font-normal text-slate-500">(optional)</span></Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Input id="facility-motto" className="min-w-0 flex-1" value={motto} maxLength={MAX_MOTTO} onChange={(e) => setMotto(e.target.value)} placeholder="For example: Caring for our community" />
                <Button type="submit" variant="outline" disabled={mottoBusy || motto.trim() === (heading?.motto ?? '')}>{mottoBusy ? 'Saving...' : 'Save motto'}</Button>
              </div>
              {mottoMessage && (
                <p role={mottoMessage.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${mottoMessage.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{mottoMessage.text}</p>
              )}
            </form>
          )}

          {message && (
            <p role={message.ok ? 'status' : 'alert'} className={`mt-4 text-sm ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
              {message.text}
            </p>
          )}
        </Card>

        {clinicId && <UnitsSettings clinicId={clinicId} isAdmin={isAdmin} />}
      </div>
    </div>
  );
}
