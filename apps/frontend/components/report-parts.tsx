// The pieces the Reports pages are made of: a titled panel, a figure, and a
// plain table - laid out here rather than with Card, whose built-in column
// spacing pulled titles, notes and tables apart.

export function Panel({ title, note, action, children }: { title: string; note?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
          {note && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'warn' }) {
  const colour = tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'warn' ? 'text-rose-700 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${colour}`}>{typeof value === 'number' ? value.toLocaleString('en-US') : value}</p>
    </div>
  );
}

/** A plain table: the first column is text, the rest are counts (right-aligned). */
export function CountTable({ head, rows, empty, minWidth }: { head: string[]; rows: Array<Array<string | number>>; empty?: string; minWidth?: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">{empty ?? 'Nothing to show for this period.'}</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm" style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {head.map((h, i) => <th key={h} scope="col" className={`px-1 py-1.5 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              {row.map((cell, i) => (
                <td key={i} className={`px-1 py-1.5 ${i === 0 ? 'text-slate-800 dark:text-slate-200' : 'text-right tabular-nums'} ${i > 0 && cell === 0 ? 'text-slate-400' : ''}`}>
                  {typeof cell === 'number' ? cell.toLocaleString('en-US') : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
