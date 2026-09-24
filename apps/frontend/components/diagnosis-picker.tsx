'use client';

import { ArrowUpToLine, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SuggestionInput } from '@/components/suggestion-input';
import { CERTAINTY_LABELS, MAX_DIAGNOSES, emptyDiagnosis, type Certainty, type DiagnosisDraft } from '@/lib/diagnosis';
import { ICD10_PATTERN, findIcd10, searchIcd10 } from '@/lib/icd10';

/**
 * The diagnoses for a consultation. The first is the primary diagnosis (the main
 * reason for the visit); add more for co-existing conditions. Search by name,
 * ICD-10 code or a common term ("URTI", "high blood pressure"), pick a match to
 * fill in the name and code together - or type your own wording and, if you
 * like, any ICD-10 code. Mark a diagnosis Suspected when it is a working
 * diagnosis still to be confirmed: reports count suspected and confirmed
 * cases separately.
 */
export function DiagnosisPicker({
  value, onChange, problems,
}: {
  value: DiagnosisDraft[];
  onChange: (next: DiagnosisDraft[]) => void;
  problems?: string[];
}) {
  const update = (key: string, patch: Partial<DiagnosisDraft>) =>
    onChange(value.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const makePrimary = (key: string) => {
    const chosen = value.find((d) => d.key === key);
    if (chosen) onChange([chosen, ...value.filter((d) => d.key !== key)]);
  };

  const remove = (key: string) => {
    const rest = value.filter((d) => d.key !== key);
    onChange(rest.length > 0 ? rest : [emptyDiagnosis()]);
  };

  return (
    <div className="space-y-3">
      {value.map((d, index) => {
        const code = d.icd10Code.trim().toUpperCase();
        const codeInvalid = code !== '' && !ICD10_PATTERN.test(code);
        const inList = code !== '' && !!findIcd10(code);
        const suggestions = d.description.trim().length >= 2
          ? searchIcd10(d.description).map((e) => ({ key: e.code, label: e.name, detail: e.code }))
          : [];

        return (
          <div key={d.key} className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  index === 0
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                }`}
              >
                {index === 0 ? 'Primary diagnosis' : `Secondary diagnosis ${index}`}
              </span>
              <div className="flex gap-1">
                {index > 0 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => makePrimary(d.key)}>
                    <ArrowUpToLine className="size-4" aria-hidden="true" />
                    Make primary
                  </Button>
                )}
                {(value.length > 1 || d.description || d.icd10Code) && (
                  <Button
                    type="button" size="icon-sm" variant="ghost" onClick={() => remove(d.key)}
                    title="Remove this diagnosis" aria-label="Remove this diagnosis"
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_9rem_13rem]">
              <div>
                <Label htmlFor={`${d.key}-name`}>Diagnosis</Label>
                <SuggestionInput
                  id={`${d.key}-name`}
                  className="mt-2"
                  value={d.description}
                  placeholder="Search or type: malaria, pneumonia, B54, high blood pressure..."
                  onChange={(text) => {
                    // A code picked from the list belongs to that wording - if the wording is
                    // changed, the code no longer describes it, so it is cleared.
                    const picked = findIcd10(d.icd10Code);
                    update(d.key, { description: text, ...(picked && picked.name === d.description ? { icd10Code: '' } : {}) });
                  }}
                  suggestions={suggestions}
                  onPick={(pickedCode) => {
                    const entry = findIcd10(pickedCode);
                    if (entry) update(d.key, { icd10Code: entry.code, description: entry.name });
                  }}
                  footer={d.description.trim().length >= 2 ? <>Keep typing to use your own wording. You can add any ICD-10 code yourself.</> : undefined}
                />
              </div>
              <div>
                <Label htmlFor={`${d.key}-code`}>ICD-10 code</Label>
                <Input
                  id={`${d.key}-code`}
                  className="mt-2 font-mono uppercase placeholder:normal-case"
                  value={d.icd10Code}
                  placeholder="e.g. B54"
                  maxLength={10}
                  aria-invalid={codeInvalid || undefined}
                  onChange={(e) => update(d.key, { icd10Code: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${d.key}-certainty`}>Status</Label>
                <Select
                  id={`${d.key}-certainty`}
                  className="mt-2"
                  value={d.certainty}
                  onChange={(e) => update(d.key, { certainty: e.target.value as Certainty })}
                >
                  <option value="CONFIRMED">{CERTAINTY_LABELS.CONFIRMED}</option>
                  <option value="PROVISIONAL">{CERTAINTY_LABELS.PROVISIONAL}</option>
                </Select>
              </div>
            </div>

            {codeInvalid && (
              <p role="alert" className="mt-2 text-xs text-rose-600">
                &quot;{d.icd10Code.trim()}&quot; is not a valid ICD-10 code. Codes look like B54 or J18.9.
              </p>
            )}
            {code !== '' && !codeInvalid && !inList && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">This code is not in the quick list - it will be saved as typed.</p>
            )}

            <div className="mt-3">
              <Label htmlFor={`${d.key}-notes`}>Note on this diagnosis <span className="font-normal text-slate-400">(optional)</span></Label>
              <Input
                id={`${d.key}-notes`}
                className="mt-2"
                value={d.notes}
                maxLength={500}
                placeholder="e.g. RDT positive; Hb result pending"
                onChange={(e) => update(d.key, { notes: e.target.value })}
              />
            </div>
          </div>
        );
      })}

      {problems && problems.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-rose-600">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      {value.length < MAX_DIAGNOSES && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, emptyDiagnosis()])}>
          <Plus className="size-4" aria-hidden="true" />
          Add another diagnosis
        </Button>
      )}
    </div>
  );
}
