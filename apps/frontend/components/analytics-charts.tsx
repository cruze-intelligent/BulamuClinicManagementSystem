'use client';

import { useId, useState } from 'react';
import { Table2, TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Point, compactNumber, formatChange, formatNumber, niceMax, shortDay, totalOf } from '@/lib/analytics-format';

// Single-series charts in one validated colour; the title names the series, so no legend box.

const W = 320;
const H = 120;
const PAD = { l: 30, r: 8, t: 8, b: 20 };

/** A headline number with change against the previous period. */
export function StatTile({
  label, value, hint, change, goodWhenUp = true,
}: { label: string; value: string; hint?: string; change?: number | null; goodWhenUp?: boolean }) {
  const text = formatChange(change);
  const up = (change ?? 0) > 0;
  const good = change == null || change === 0 ? null : up === goodWhenUp;
  return (
    <Card className="p-4 gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-h-4">
        {text && change !== 0 && change != null && (
          <span className={`inline-flex items-center gap-0.5 font-medium ${good ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
            {up ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
            {text}
          </span>
        )}
        {text === 'no change' && <span>no change</span>}
        {hint && <span>{hint}</span>}
      </div>
    </Card>
  );
}

/** A time series as a thin line with a soft wash, hover crosshair + tooltip, and a table view. */
export function TimeSeriesChart({ title, points, unit = '', label = shortDay, period = 'in this period' }: { title: string; points: Point[]; unit?: string; label?: (key: string) => string; period?: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const n = points.length;
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = n ? `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : '';
  const ticks = [0, max / 2, max];
  const labelIdx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n ? [0, n - 1] : [];

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const hp = hover != null ? points[hover] : null;

  return (
    <Card className="p-4 gap-2 viz-root" data-testid={`chart-${title}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <div className="text-xs text-muted-foreground tabular-nums">{formatNumber(totalOf(points))}{unit} {period}</div>
        </div>
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground rounded px-1.5 py-1 border"
        >
          <Table2 className="h-3 w-3" aria-hidden /> {table ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {table ? (
        <div className="max-h-[120px] overflow-auto text-xs">
          <table className="w-full">
            <thead className="sticky top-0 bg-card text-muted-foreground"><tr><th className="text-left font-normal py-0.5">When</th><th className="text-right font-normal py-0.5">{title}</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-t"><td className="py-0.5">{label(p.date)}</td><td className="py-0.5 text-right tabular-nums">{formatNumber(p.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto block"
            role="img"
            aria-label={`${title}: ${formatNumber(totalOf(points))} in this period. Use "View as table" for each day.`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={PAD.l - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">{compactNumber(t)}</text>
              </g>
            ))}
            {labelIdx.map((i) => (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={9} fill="var(--muted-foreground)">{label(points[i].date)}</text>
            ))}
            {n > 0 && <path d={area} fill="var(--viz-series)" opacity={0.1} />}
            {n > 0 && <path d={line} fill="none" stroke="var(--viz-series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {hp && hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="2 2" />
                <circle cx={x(hover)} cy={y(hp.value)} r={4} fill="var(--viz-series)" stroke="var(--card)" strokeWidth={2} />
              </g>
            )}
          </svg>
          {hp && hover != null && (
            <div
              className="pointer-events-none absolute -top-1 rounded-md border bg-popover text-popover-foreground shadow px-2 py-1 text-xs tabular-nums whitespace-nowrap"
              style={{ left: `${Math.min(78, Math.max(0, (x(hover) / W) * 100 - 10))}%` }}
              role="status"
              id={id}
            >
              <div className="text-muted-foreground">{label(hp.date)}</div>
              <div className="font-medium">{formatNumber(hp.value)}{unit}</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Horizontal bars for one categorical dimension; one colour, values printed at the bar end. */
export function BarList({ title, rows, empty = 'Nothing to show yet.', format = formatNumber }: { title: string; rows: Array<{ label: string; value: number; note?: string }>; empty?: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card className="p-4 gap-3 viz-root" data-testid={`bars-${title}`}>
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 || rows.every((r) => r.value === 0) ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="text-xs">
              <div className="flex justify-between gap-2 mb-0.5">
                <span className="truncate">{r.label}</span>
                <span className="tabular-nums text-muted-foreground">{format(r.value)}{r.note ? ` · ${r.note}` : ''}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: 'var(--viz-series)' }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A share (x of y) as a thin progress bar with the numbers spelled out. */
export function ShareRow({ label, count, of, detail }: { label: string; count: number; of: number; detail?: string }) {
  const share = of > 0 ? count / of : 0;
  return (
    <div className="text-xs viz-root">
      <div className="flex justify-between gap-2 mb-0.5">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{formatNumber(count)} of {formatNumber(of)} · {Math.round(share * 100)}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.round(share * 100)}%`, background: 'var(--viz-series)' }} />
      </div>
      {detail && <div className="text-muted-foreground mt-0.5">{detail}</div>}
    </div>
  );
}
