'use client';

import { Input } from '@/components/ui/input';
import { FLAG_WORDS, flagFor, isCellLine, referenceText, type LabValue } from '@/lib/lab-panels';

const FLAG_STYLE = 'font-semibold text-red-700 dark:text-red-400';

/**
 * Entering a result value by value: each parameter with its unit and reference
 * range (filled in from the template, and changeable for this lab's own ranges
 * or a child), flagged High, Low or Abnormal as the value is typed.
 */
export function LabValuesForm({ idPrefix, values, onChange }: { idPrefix: string; values: LabValue[]; onChange: (values: LabValue[]) => void }) {
  const set = (i: number, patch: Partial<LabValue>) => onChange(values.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  const numberOrNull = (text: string) => (text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text));
  return (
    <div className="space-y-1.5" role="group" aria-label="Result values">
      <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-medium text-slate-500 sm:grid dark:text-slate-400">
        <span className="col-span-4">Parameter</span><span className="col-span-3">Result</span><span className="col-span-1">Flag</span><span className="col-span-4">Reference range</span>
      </div>
      {values.map((v, i) => {
        const flag = flagFor(v.value, v.low, v.high, v.normal);
        const id = `${idPrefix}-${i}`;
        return (
          <div key={v.name} className="grid grid-cols-12 items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5 dark:bg-slate-800/50">
            <label htmlFor={id} className={`col-span-12 text-sm text-slate-800 sm:col-span-4 dark:text-slate-200 ${isCellLine(v.name) ? 'font-bold' : 'font-medium'}`}>
              {v.name}{v.unit && <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">{v.unit}</span>}
            </label>
            <Input id={id} className="col-span-5 h-8 sm:col-span-3" value={v.value} onChange={(e) => set(i, { value: e.target.value })} inputMode={v.normal ? 'text' : 'decimal'} autoComplete="off" />
            <span className={`col-span-2 text-xs sm:col-span-1 ${flag ? FLAG_STYLE : 'text-slate-400'}`} aria-live="polite">{flag ? FLAG_WORDS[flag] : v.value ? 'Normal' : ''}</span>
            {v.normal !== null && v.normal !== undefined && v.low == null && v.high == null ? (
              <span className="col-span-5 text-xs text-slate-500 sm:col-span-4 dark:text-slate-400">Normal: {v.normal}</span>
            ) : (
              <span className="col-span-5 flex items-center gap-1 sm:col-span-4">
                <Input aria-label={`${v.name} lowest normal`} className="h-8 px-1.5 text-xs" inputMode="decimal" value={v.low ?? ''} onChange={(e) => set(i, { low: numberOrNull(e.target.value) })} placeholder="low" />
                <span className="text-xs text-slate-400">-</span>
                <Input aria-label={`${v.name} highest normal`} className="h-8 px-1.5 text-xs" inputMode="decimal" value={v.high ?? ''} onChange={(e) => set(i, { high: numberOrNull(e.target.value) })} placeholder="high" />
              </span>
            )}
          </div>
        );
      })}
      <p className="text-xs text-slate-500 dark:text-slate-400">Reference ranges are common adult ranges. Change them where your lab&apos;s own ranges differ, or for a child. Leave a value empty if it was not measured.</p>
    </div>
  );
}

/** A result entered value by value, as it is shown and printed. */
export function LabValuesTable({ values, comment }: { values: LabValue[]; comment?: string | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
            <th className="py-1 pr-2 font-medium">Parameter</th><th className="py-1 pr-2 font-medium">Result</th><th className="py-1 pr-2 font-medium">Flag</th><th className="py-1 pr-2 font-medium">Reference</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v) => {
            const flag = v.flag ?? flagFor(v.value, v.low, v.high, v.normal);
            return (
              <tr key={v.name} className={`border-t border-slate-200 dark:border-slate-700 ${isCellLine(v.name) ? 'font-bold' : ''}`}>
                <td className="py-1 pr-2">{v.name}</td>
                <td className={`py-1 pr-2 ${flag ? FLAG_STYLE : ''}`}>{v.value}{v.unit ? <span className="ml-1 text-xs font-normal text-slate-500">{v.unit}</span> : null}</td>
                <td className={`py-1 pr-2 text-xs ${flag ? FLAG_STYLE : 'text-slate-500'}`}>{flag ? FLAG_WORDS[flag] : 'Normal'}</td>
                <td className="py-1 pr-2 text-xs text-slate-500 dark:text-slate-400">{referenceText(v)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {comment && <p className="mt-1.5 text-sm"><strong className="font-medium">Comment:</strong> {comment}</p>}
    </div>
  );
}
