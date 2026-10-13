'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, ImagePlus, Trash2, Upload } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/useAuth';

const MAX_BYTES = 500 * 1024;
const API = process.env.NEXT_PUBLIC_API_URL;

/** The facility's own details and its logo, which is printed on its documents. */
export default function FacilityPage() {
  const { user, hasRole } = useAuth();
  const clinicId = user?.clinicId;
  const clinic = (user as any)?.clinic as { name?: string; facilityCode?: string; phone?: string; address?: string } | undefined;
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isAdmin = hasRole('ADMIN');

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  const upload = async (file: File) => {
    setMessage(null);
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setMessage({ ok: false, text: 'Choose a PNG or JPEG image (other formats can not be printed on documents).' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage({ ok: false, text: `That image is ${Math.round(file.size / 1024)} KB - the logo must be under 500 KB.` });
      return;
    }
    setBusy(true);
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('The file could not be read'));
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${API}/clinics/${clinicId}/logo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ image }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The logo could not be saved');
      await loadLogo();
      setMessage({ ok: true, text: 'Logo saved. It now appears on your invoices, prescriptions, referral letters and discharge summaries.' });
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
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your facility&apos;s details and logo, as they appear on the documents you print.</p>

        <Card className="mt-6 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white">
              <Building2 className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 text-sm">
              <p className="text-lg font-semibold text-slate-950 dark:text-slate-50">{clinic?.name ?? 'Your facility'}</p>
              {clinic?.facilityCode && <p className="text-slate-600 dark:text-slate-400">Facility ID {clinic.facilityCode}</p>}
              {clinic?.phone && <p className="text-slate-600 dark:text-slate-400">{clinic.phone}</p>}
              {clinic?.address && <p className="text-slate-600 dark:text-slate-400">{clinic.address}</p>}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">To change these details, contact Bulamu support.</p>
            </div>
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <h2 className="text-lg font-semibold">Logo on your documents</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Printed at the top of your invoices, prescriptions, referral letters and discharge summaries, beside your facility name.
            Use a PNG or JPEG under 500 KB; a wide logo on a white or transparent background looks best.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            {/* How it sits on the document header. */}
            <div className="flex h-20 w-64 items-center justify-end gap-3 rounded-md bg-teal-700 px-3" aria-label="Preview of the document header">
              <span className="truncate text-right text-xs font-semibold text-white">{clinic?.name ?? 'Your facility'}</span>
              <div className="flex h-14 w-28 shrink-0 items-center justify-center rounded-md bg-white p-1.5">
                {loading ? (
                  <span className="text-xs text-slate-400">Loading...</span>
                ) : logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Your facility logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <ImagePlus className="size-6 text-slate-300" aria-label="No logo yet" />
                )}
              </div>
            </div>

            {isAdmin ? (
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg"
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
              <p className="text-sm text-slate-500 dark:text-slate-400">Your facility administrator can change the logo.</p>
            )}
          </div>

          {message && (
            <p role={message.ok ? 'status' : 'alert'} className={`mt-4 text-sm ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
              {message.text}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
