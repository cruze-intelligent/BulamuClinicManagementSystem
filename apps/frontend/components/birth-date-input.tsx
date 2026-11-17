'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ageProblem, ageText, dateOfBirthFromAge, type AgeUnit } from '@/lib/age';

export type BirthDateValue = { mode: 'date' | 'age'; date: string; age: string; unit: AgeUnit };

export const emptyBirthDate = (): BirthDateValue => ({ mode: 'date', date: '', age: '', unit: 'years' });

/** The form's value from a record: a known date, or an estimate shown as the date it came to. */
export const birthDateFrom = (dateOfBirth?: string | null): BirthDateValue => ({
  ...emptyBirthDate(), date: dateOfBirth ? String(dateOfBirth).slice(0, 10) : '',
});

/** What is saved: the date of birth, and whether it was worked out from an age. */
export function birthDatePayload(value: BirthDateValue): { dateOfBirth: string; dateOfBirthEstimated: boolean } {
  if (value.mode === 'age') {
    const n = Number(value.age);
    if (!value.age.trim() || ageProblem(value.age, value.unit)) return { dateOfBirth: '', dateOfBirthEstimated: false };
    return { dateOfBirth: dateOfBirthFromAge(n, value.unit), dateOfBirthEstimated: true };
  }
  return { dateOfBirth: value.date, dateOfBirthEstimated: false };
}

/**
 * Date of birth, or - for the many patients who don't know it - their age,
 * from which an estimated date of birth is worked out and marked as such.
 */
export function BirthDateInput({ id, value, onChange }: { id: string; value: BirthDateValue; onChange: (value: BirthDateValue) => void }) {
  const problem = value.mode === 'age' ? ageProblem(value.age, value.unit) : null;
  const preview = value.mode === 'age' && value.age.trim() && !problem ? ageText(dateOfBirthFromAge(Number(value.age), value.unit), true) : '';
  return (
    <fieldset>
      <legend className="text-sm font-medium leading-none">Date of birth or age</legend>
      <div className="mt-2 inline-flex rounded-md border border-slate-200 p-0.5 text-xs dark:border-slate-700" role="radiogroup" aria-label="Record by">
        {(['date', 'age'] as const).map((mode) => (
          <button
            key={mode} type="button" role="radio" aria-checked={value.mode === mode}
            className={`rounded px-2.5 py-1 font-medium ${value.mode === mode ? 'bg-emerald-700 text-white' : 'text-slate-600 dark:text-slate-300'}`}
            onClick={() => onChange({ ...value, mode })}
          >
            {mode === 'date' ? 'Date of birth' : 'Age (date not known)'}
          </button>
        ))}
      </div>
      {value.mode === 'date' ? (
        <div className="mt-2">
          <Label htmlFor={id} className="sr-only">Date of birth</Label>
          <Input id={id} type="date" max={new Date().toISOString().slice(0, 10)} value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <div className="flex-1">
            <Label htmlFor={id} className="sr-only">Age</Label>
            <Input id={id} inputMode="numeric" placeholder="e.g. 34" value={value.age} onChange={(e) => onChange({ ...value, age: e.target.value })} aria-invalid={!!problem} />
          </div>
          <div className="w-28">
            <Label htmlFor={`${id}-unit`} className="sr-only">Age in</Label>
            <Select id={`${id}-unit`} value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as AgeUnit })}>
              <option value="years">years</option>
              <option value="months">months</option>
              <option value="days">days</option>
            </Select>
          </div>
        </div>
      )}
      {problem && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">{problem}</p>}
      {preview && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Recorded as {preview}.</p>}
    </fieldset>
  );
}
