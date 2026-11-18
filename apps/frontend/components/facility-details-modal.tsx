'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { facilityTypeLabel } from '@/lib/facility-types';
import { downloadWithAuth, reportReadyMessage } from '@/lib/download';
import { formatDateTime } from '@/lib/time';

type FacilityDetail = {
  id: string;
  facilityCode: string;
  name: string;
  facilityType: string;
  phone: string;
  address: string;
  district: string | null;
  subCounty: string | null;
  parish: string | null;
  registrationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  isActive: boolean;
  createdAt: string;
  approvedAt: string | null;
  deletedAt: string | null;
  admin: { name: string; email: string; isActive: boolean } | null;
  subscription: { status: string; plan: string; amount: number; currency: string; trialEndsAt: string; currentPeriodEnd: string | null; planNotes: string | null } | null;
  users: number;
  patients: number;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900 dark:text-slate-100">{value || <span className="text-slate-400">Not recorded</span>}</p>
    </div>
  );
}

/**
 * Read-only card for one facility's full sign-up record - everything entered
 * at registration (location fields included), not just the summary columns a
 * facilities table shows. Same component for every role that can reach it
 * (SUPER_ADMIN for any facility, an ADMIN for their own): the backend already
 * scopes GET /clinics/:id and its export the same way.
 */
export function FacilityDetailsModal({ clinicId, onClose }: { clinicId: string; onClose: () => void }) {
  const [facility, setFacility] = useState<FacilityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('token');
    (async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/clinics/${clinicId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.success) setFacility(data.facility);
        else setError(data.error || 'Could not load facility details');
      } catch {
        if (!cancelled) setError("We couldn't reach Bulamu. Please check your internet connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clinicId]);

  const handleExport = async (format: 'pdf' | 'csv') => {
    setExporting(format);
    setNotice('');
    setError('');
    try {
      const { emailedTo } = await downloadWithAuth(
        `${process.env.NEXT_PUBLIC_API_URL}/clinics/${clinicId}/export?format=${format}`,
        localStorage.getItem('token'),
        `facility-${facility?.facilityCode || clinicId}.${format}`
      );
      setNotice(reportReadyMessage(format === 'pdf' ? 'Facility report' : 'Facility details', emailedTo));
    } catch (err: any) {
      setError(err.message || 'The report could not be prepared - please try again.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Facility details"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between border-b border-slate-200 p-6 dark:border-slate-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Facility details</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              {facility?.name || 'Loading...'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="Close"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : facility ? (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Facility ID" value={<span className="font-mono">{facility.facilityCode}</span>} />
                <Field label="Type" value={facilityTypeLabel(facility.facilityType)} />
                <Field label="Phone" value={facility.phone} />
                <Field
                  label="Status"
                  value={
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${facility.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {facility.isActive ? 'Active' : 'Suspended'}
                    </span>
                  }
                />
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Location, as entered at sign-up</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <Field label="Address" value={facility.address} />
                  <Field label="District" value={facility.district} />
                  <Field label="Sub-county" value={facility.subCounty} />
                  <Field label="Parish" value={facility.parish} />
                </div>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Registration</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <Field label="Registration status" value={facility.registrationStatus} />
                  <Field label="Registered on" value={formatDateTime(facility.createdAt)} />
                  <Field label="Approved on" value={facility.approvedAt ? formatDateTime(facility.approvedAt) : null} />
                  {facility.registrationStatus === 'REJECTED' && (
                    <Field label="Rejection reason" value={facility.rejectionReason} />
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Administrator</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <Field label="Name" value={facility.admin?.name} />
                  <Field label="Email" value={facility.admin?.email} />
                </div>
              </div>

              {facility.subscription && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Subscription</p>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    <Field label="Status" value={facility.subscription.status} />
                    <Field
                      label="Plan"
                      value={facility.subscription.plan === 'CUSTOM' ? `Custom - ${facility.subscription.amount.toLocaleString()} ${facility.subscription.currency}/mo` : `Standard - ${facility.subscription.amount.toLocaleString()} ${facility.subscription.currency}/mo`}
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Staff accounts" value={facility.users} />
                <Field label="Patients" value={facility.patients} />
              </div>
            </div>
          ) : null}
        </div>

        {notice && <p role="status" className="mx-6 mb-0 mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-6 dark:border-slate-800">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="outline" onClick={() => handleExport('csv')} disabled={!facility || !!exporting}>
            <Download className="size-4" aria-hidden="true" />
            {exporting === 'csv' ? 'Preparing...' : 'Details (CSV)'}
          </Button>
          <Button onClick={() => handleExport('pdf')} disabled={!facility || !!exporting}>
            <Download className="size-4" aria-hidden="true" />
            {exporting === 'pdf' ? 'Preparing...' : 'Facility report (PDF)'}
          </Button>
        </div>
      </section>
    </div>
  );
}
