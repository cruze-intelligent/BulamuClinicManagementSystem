'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SuggestionInput } from '@/components/suggestion-input';
import { saveAllergiesOffline } from '@/lib/local-first';
import {
  COMMON_ALLERGENS, MAX_ALLERGIES, SEVERITY_LABELS, allergyProblems, draftsFromRecord, draftsToPayload, emptyAllergyDraft,
  type AllergyDraft, type AllergyRecord, type AllergyStatus, type Severity,
} from '@/lib/allergy';

const STATUS_OPTIONS: Array<{ value: AllergyStatus; label: string; hint: string }> = [
  { value: 'UNKNOWN', label: 'Not recorded', hint: 'Nobody has asked yet' },
  { value: 'NONE_KNOWN', label: 'No known allergies', hint: 'The patient was asked and has none' },
  { value: 'KNOWN', label: 'Has allergies', hint: 'Name each one below' },
];

/**
 * A patient's allergies, shown where they matter (when prescribing and when
 * dispensing) and editable in place. "Not recorded" is deliberately different from
 * "No known allergies": the first is a prompt to ask, the second is an answer.
 * Saved on the device first, so it works offline, and synced like everything else.
 */
export function AllergyPanel({
  patientId, clinicId, record, canEdit, onSaved,
}: {
  patientId: string;
  clinicId: string;
  record: AllergyRecord | null | undefined;
  canEdit: boolean;
  onSaved?: (next: { allergyStatus: AllergyStatus; allergies: NonNullable<AllergyRecord['allergies']> }) => void;
}) {
  const status: AllergyStatus = record?.allergyStatus ?? 'UNKNOWN';
  const list = status === 'KNOWN' ? record?.allergies ?? [] : [];

  const [editing, setEditing] = useState(false);
  const [draftStatus, setDraftStatus] = useState<AllergyStatus>(status);
  const [drafts, setDrafts] = useState<AllergyDraft[]>(() => draftsFromRecord(record));
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');

  const open = () => {
    setDraftStatus(status);
    setDrafts(draftsFromRecord(record));
    setAttempted(false);
    setError('');
    setEditing(true);
  };

  const problems = attempted ? allergyProblems(draftStatus, drafts) : [];

  const save = async () => {
    setAttempted(true);
    if (allergyProblems(draftStatus, drafts).length > 0) return;
    setSaving(true);
    setError('');
    try {
      const payload = draftsToPayload(draftStatus, drafts);
      await saveAllergiesOffline({ patientId, clinicId, ...payload });
      onSaved?.(payload);
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || 'Could not save the allergy record');
    } finally {
      setSaving(false);
    }
  };

  const update = (key: string, patch: Partial<AllergyDraft>) => setDrafts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  if (editing) {
    return (
      <section aria-label="Record allergies" className="rounded-lg border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Allergies</h3>

        <fieldset className="mt-3">
          <legend className="sr-only">Allergy status</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {STATUS_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${
                  draftStatus === o.value ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <input type="radio" name={`allergy-status-${patientId}`} className="mt-0.5" checked={draftStatus === o.value} onChange={() => setDraftStatus(o.value)} />
                <span>
                  <span className="block font-medium text-slate-900 dark:text-slate-100">{o.label}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {draftStatus === 'KNOWN' && (
          <div className="mt-4 space-y-3">
            {drafts.map((d, i) => {
              const q = d.substance.trim().toLowerCase();
              const suggestions = q.length >= 2
                ? COMMON_ALLERGENS.filter((a) => a.toLowerCase().includes(q) && a.toLowerCase() !== q).slice(0, 6).map((a) => ({ key: a, label: a }))
                : [];
              return (
                <div key={d.key} className="grid gap-3 rounded-md bg-slate-50 p-3 dark:bg-slate-800/50 md:grid-cols-[1.4fr_1.4fr_9rem_auto]">
                  <div>
                    <Label htmlFor={`${d.key}-sub`}>Allergic to</Label>
                    <SuggestionInput
                      id={`${d.key}-sub`} className="mt-2" value={d.substance} placeholder="e.g. Penicillin, NSAIDs, latex"
                      onChange={(text) => update(d.key, { substance: text })}
                      suggestions={suggestions}
                      onPick={(picked) => update(d.key, { substance: picked })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${d.key}-reaction`}>Reaction <span className="font-normal text-slate-400">(optional)</span></Label>
                    <Input id={`${d.key}-reaction`} className="mt-2" value={d.reaction} maxLength={120} placeholder="e.g. Rash, swelling, anaphylaxis" onChange={(e) => update(d.key, { reaction: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor={`${d.key}-severity`}>Severity</Label>
                    <Select id={`${d.key}-severity`} className="mt-2" value={d.severity} onChange={(e) => update(d.key, { severity: e.target.value as '' | Severity })}>
                      <option value="">Not stated</option>
                      {(Object.keys(SEVERITY_LABELS) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
                    </Select>
                  </div>
                  <div className="flex items-end">
                    {(drafts.length > 1 || d.substance) && (
                      <Button
                        type="button" size="icon-sm" variant="ghost" aria-label="Remove this allergy" title="Remove this allergy"
                        onClick={() => setDrafts((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== d.key) : [emptyAllergyDraft()]))}
                        className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  {i === drafts.length - 1 && drafts.length < MAX_ALLERGIES && (
                    <div className="md:col-span-4">
                      <Button type="button" size="sm" variant="outline" onClick={() => setDrafts((rows) => [...rows, emptyAllergyDraft()])}>
                        <Plus className="size-4" aria-hidden="true" />
                        Add another allergy
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {problems.length > 0 && <p role="alert" className="mt-3 text-sm text-rose-600">{problems[0]}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          <Button type="button" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save allergies'}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
        </div>
      </section>
    );
  }

  // --- reading view ---
  const tone = status === 'KNOWN' && list.length > 0 ? 'known' : status === 'NONE_KNOWN' ? 'none' : 'unknown';
  const styles = {
    known: 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30',
    none: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30',
    unknown: 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
  }[tone];

  return (
    <section aria-label="Allergies" className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3 ${styles}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        {tone === 'known' && <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-700 dark:text-rose-400" aria-hidden="true" />}
        {tone === 'none' && <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />}
        {tone === 'unknown' && <HelpCircle className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />}
        <div className="min-w-0 text-sm">
          {tone === 'known' && (
            <>
              <p className="font-semibold text-rose-900 dark:text-rose-200">Allergies</p>
              <ul className="mt-1 space-y-0.5">
                {list.map((a) => (
                  <li key={a.substance} className="text-slate-900 dark:text-slate-100">
                    <span className={a.severity === 'SEVERE' ? 'font-bold' : 'font-medium'}>{a.substance}</span>
                    {(a.reaction || a.severity) && (
                      <span className="text-slate-600 dark:text-slate-300">
                        {' - '}{[a.reaction, a.severity ? `${SEVERITY_LABELS[a.severity].toLowerCase()}` : null].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {tone === 'none' && <p className="font-medium text-emerald-900 dark:text-emerald-200">No known allergies</p>}
          {tone === 'unknown' && (
            <>
              <p className="font-semibold text-amber-900 dark:text-amber-200">Allergies not recorded</p>
              <p className="text-amber-800 dark:text-amber-300">Ask the patient before prescribing.</p>
            </>
          )}
        </div>
      </div>
      {canEdit && (
        <Button type="button" size="sm" variant="outline" onClick={open}>
          <Pencil className="size-4" aria-hidden="true" />
          {tone === 'unknown' ? 'Record allergies' : 'Edit'}
        </Button>
      )}
    </section>
  );
}
