'use client';

import { useRef, useState } from 'react';
import { Paperclip, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DocumentItem } from '@/components/document-item';
import { DOCUMENT_ACCEPT, DOCUMENT_TYPES_HELP, downloadError, openDocumentPreview } from '@/lib/document-preview';
import { gather, portalDate, type PortalRecord } from '@/lib/patient-portal';
import { EmptyState, TabIntro } from './ui';

const CATEGORY_LABELS: Record<string, string> = {
  LAB_RESULT: 'Lab result',
  CONSENT_FORM: 'Consent form',
  ID_COPY: 'ID copy',
  REFERRAL_LETTER: 'Referral letter',
  PATIENT_UPLOAD: 'Added by you',
  OTHER: 'Document',
};

const MAX_BYTES = 10 * 1024 * 1024;
const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('patientToken')}` });

/** Documents the facility filed for the patient, and ones the patient added (which they can delete). */
export function PortalDocuments({ records, onChanged, onError }: { records: PortalRecord[]; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const documents = gather(records, (r) => r.documents, (d) => d.createdAt);
  const several = records.length > 1;
  const input = useRef<HTMLInputElement>(null);
  const [recordId, setRecordId] = useState(records[0]?.id ?? '');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) return onError('That file is larger than 10 MB. Please choose a smaller one.');
    const form = new FormData();
    form.append('recordId', recordId);
    form.append('file', file);
    setUploading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/documents`, { method: 'POST', headers: authHeader(), body: form });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'The upload did not work');
      await onChanged();
    } catch (err: any) {
      onError(err?.message || 'The upload did not work. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const download = async (id: string, fileName: string) => {
    setBusy(id);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/documents/${id}/download`, { headers: authHeader() });
      if (!res.ok) throw await downloadError(res);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      onError(err?.message || "The document couldn't be downloaded just now. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const view = (id: string) =>
    openDocumentPreview(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/documents/${id}/download`, localStorage.getItem('patientToken'))
      .catch((err: any) => onError(err?.message || "The document couldn't be opened just now."));

  const remove = async (id: string) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/documents/${id}`, { method: 'DELETE', headers: authHeader() });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      await onChanged();
    } catch (err: any) {
      onError(err?.message || "The document couldn't be deleted just now.");
    }
  };

  return (
    <section>
      <TabIntro
        title="Documents"
        action={records.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            {several && (
              <div>
                <Label htmlFor="upload-facility" className="text-xs">Share with</Label>
                <Select id="upload-facility" value={recordId} onChange={(e) => setRecordId(e.target.value)}>
                  {records.map((r) => <option key={r.id} value={r.id}>{r.clinic.name}</option>)}
                </Select>
              </div>
            )}
            <input ref={input} type="file" accept={DOCUMENT_ACCEPT} onChange={upload} className="hidden" />
            <Button variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
              <Upload className="size-4" aria-hidden="true" /> {uploading ? 'Uploading...' : 'Add a document'}
            </Button>
          </div>
        )}
      >
        Letters and results your facility filed for you. You can add your own too, like a result from another lab: your facility sees it. {DOCUMENT_TYPES_HELP}
      </TabIntro>

      {documents.length === 0 ? (
        <EmptyState icon={Paperclip} title="No documents yet">Documents your facility files for you appear here, and so does anything you add.</EmptyState>
      ) : (
        <div className="space-y-2">
          {documents.map((d) => (
            <DocumentItem
              key={d.id}
              fileName={d.fileName}
              fileSize={d.fileSize}
              format={d.format}
              busy={busy === d.id}
              missing={d.available === false}
              detail={`${CATEGORY_LABELS[d.category] ?? 'Document'} · ${portalDate(d.createdAt)}${several ? ` · ${d.facility}` : ''}`}
              onView={() => view(d.id)}
              onDownload={() => download(d.id, d.fileName)}
              onDelete={d.uploadedByPatientAccountId ? () => remove(d.id) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
