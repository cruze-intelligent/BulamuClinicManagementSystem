'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function SubscriptionCalendar({
  coveredStart,
  coveredEnd,
  label,
}: {
  coveredStart: Date;
  coveredEnd: Date;
  label: string;
}) {
  const [cursor, setCursor] = useState(() => new Date());

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();

  const rangeStart = startOfDay(coveredStart);
  const rangeEnd = startOfDay(coveredEnd);
  const today = startOfDay(new Date());

  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          aria-label="Previous month"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          {firstOfMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        <button
          type="button"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          aria-label="Next month"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-1 font-medium text-slate-400 dark:text-slate-500">{day}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} />;
          const covered = date >= rangeStart && date <= rangeEnd;
          const isToday = dateKey(date) === dateKey(today);
          return (
            <div
              key={dateKey(date)}
              title={covered ? `Covered by ${label}` : undefined}
              className={`flex aspect-square items-center justify-center rounded-md text-sm ${
                covered
                  ? 'bg-emerald-600 font-semibold text-white'
                  : 'text-slate-600 dark:text-slate-400'
              } ${isToday && !covered ? 'ring-2 ring-emerald-500' : ''} ${isToday && covered ? 'ring-2 ring-emerald-900 dark:ring-emerald-200' : ''}`}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-block size-3 rounded bg-emerald-600" />
        Days covered by {label}
      </div>
    </div>
  );
}
