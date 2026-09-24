'use client';

import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type Suggestion = {
  key: string;
  /** Main text of the option. */
  label: string;
  /** Smaller text after the label (a code, a stock level). */
  detail?: string;
  /** Small tag on the right (e.g. "In stock"). */
  tag?: string;
};

/**
 * A text box that suggests matches as you type - pick one with the mouse or the
 * arrow keys and Enter, or just keep typing to use your own wording. The
 * suggestions are supplied by the caller; this only handles showing, choosing
 * and the keyboard/screen-reader behaviour (the standard combobox pattern).
 */
export function SuggestionInput({
  id, value, onChange, suggestions, onPick, placeholder, invalid, footer, className,
}: {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  suggestions: Suggestion[];
  onPick: (key: string) => void;
  placeholder?: string;
  invalid?: boolean;
  /** Shown under the suggestions (for example "Use as typed"). */
  footer?: React.ReactNode;
  className?: string;
}) {
  const generated = useId();
  const listId = `${id ?? generated}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const visible = open && (suggestions.length > 0 || !!footer);

  const pick = (key: string) => {
    onPick(key);
    setOpen(false);
  };

  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && suggestions[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && suggestions.length > 0) {
            e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault(); setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && visible && suggestions[active]) {
            e.preventDefault(); pick(suggestions[active].key);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {visible && (
        // onMouseDown (not onClick) so choosing an option happens before the input's blur closes the list.
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-[22rem] max-w-[32rem] overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s.key); }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2',
                i === active ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''
              )}
            >
              <span className="min-w-0">
                <span className="text-slate-900 dark:text-slate-100">{s.label}</span>
                {s.detail && <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">{s.detail}</span>}
              </span>
              {s.tag && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">{s.tag}</span>}
            </li>
          ))}
          {footer && <li role="presentation" className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">{footer}</li>}
        </ul>
      )}
    </div>
  );
}
