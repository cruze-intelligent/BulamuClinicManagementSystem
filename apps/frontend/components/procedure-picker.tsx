'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SuggestionInput } from '@/components/suggestion-input';
import { procedureChoices, type ServicePrice } from '@/lib/price-list';
import type { LocalProcedure } from '@/lib/local-first';

const MAX_PROCEDURES = 15;

/**
 * Procedures in the visit's treatment plan - incision and drainage, ear
 * syringing, circumcision, a wound dressing. They are done, not dispensed, so
 * they sit apart from the prescription; picked from the facility's price list
 * where they are on it, the bill finds their price.
 */
export function ProcedurePicker({ value, onChange, prices }: { value: LocalProcedure[]; onChange: (next: LocalProcedure[]) => void; prices: ServicePrice[] }) {
  const [typed, setTyped] = useState('');
  const choices = procedureChoices(prices, typed);

  const add = (name: string) => {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!clean || value.length >= MAX_PROCEDURES) return;
    if (!value.some((p) => p.name.toLowerCase() === clean.toLowerCase() && !p.notes)) onChange([...value, { name: clean, notes: '' }]);
    setTyped('');
  };

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ol className="space-y-2" aria-label="Procedures in the plan">
          {value.map((p, i) => (
            <li key={`${p.name}-${i}`} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900 dark:text-slate-100">{i + 1}. {p.name}</span>
                <Button
                  type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${p.name}`} title="Remove"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50"
                  onClick={() => onChange(value.filter((_, n) => n !== i))}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <Input
                aria-label={`Note on ${p.name}`}
                className="mt-2"
                value={p.notes ?? ''}
                maxLength={300}
                placeholder="Optional: site, side, findings - e.g. right pre-auricular abscess, pus drained"
                onChange={(e) => onChange(value.map((q, n) => (n === i ? { ...q, notes: e.target.value } : q)))}
              />
            </li>
          ))}
        </ol>
      )}
      {value.length < MAX_PROCEDURES && (
        // Add stays beside the search on a phone too: below it, the open list would cover it.
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <SuggestionInput
              id="procedure-search"
              value={typed}
              onChange={setTyped}
              placeholder="Search or type: incision and drainage, ear syringing, circumcision..."
              suggestions={choices.map((c) => ({ key: c.name, label: c.name, detail: c.price !== null ? `UGX ${c.price.toLocaleString('en-US')}` : undefined }))}
              onPick={add}
              footer={typed.trim().length >= 2 ? <>Not on the list? Press Add to use your own wording.</> : undefined}
            />
          </div>
          <Button type="button" variant="outline" onClick={() => add(typed)} disabled={!typed.trim()}>
            <Plus className="size-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
