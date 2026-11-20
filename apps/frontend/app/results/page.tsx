'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, Loader2, Printer, ScanLine, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCurrentClinicId } from '@/lib/local-first';
import { openPdfWithAuth } from '@/lib/download';
import { groupResults, imagingItem, labItem, printUrl, type ResultGroup, type ResultItem } from '@/lib/results';

const API = process.env.NEXT_PUBLIC_API_URL;
const dayText = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Results: every lab result and imaging report, by patient and day, to find
 * and print together - several short results share a page, so less paper.
 */
export default function ResultsPage() {
  const [items, setItems] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  // Results left out of a print (all are in, to begin with).
  const [leftOut, setLeftOut] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    const clinicId = getCurrentClinicId();
    try {
      const [lab, imaging] = await Promise.all([
        fetch(`${API}/lab/clinic/${clinicId}`, { headers }).then((r) => (r.ok ? r.json() : { tests: [] })),
        // Imaging reports of the last 30 days, for those who see imaging.
        fetch(`${API}/imaging?status=REPORTED`, { headers }).then((r) => (r.ok ? r.json() : { requests: [] })).catch(() => ({ requests: [] })),
      ]);
      setItems([
        ...(lab.tests ?? []).map(labItem).filter(Boolean) as ResultItem[],
        ...(imaging.requests ?? []).map(imagingItem).filter(Boolean) as ResultItem[],
      ]);
    } catch {
      setError(navigator.onLine ? 'The results could not be loaded - please try again.' : 'Results load when the connection returns.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupResults(items, search), [items, search]);

  const toggle = (item: ResultItem) => setLeftOut((current) => {
    const next = new Set(current);
    if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
    return next;
  });

  const print = async (group: ResultGroup) => {
    const chosen = group.items.filter((i) => !leftOut.has(i.id));
    if (!chosen.length) return setError('Tick at least one result to print');
    setPrinting(group.key);
    setError('');
    try {
      await openPdfWithAuth(printUrl(API ?? '', chosen), localStorage.getItem('token'), `results-${group.patientName.replace(/\s+/g, '-').toLowerCase()}-${group.day}.pdf`);
    } catch (e: any) {
      setError(e.message || 'The results could not be printed - please try again.');
    } finally {
      setPrinting(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Results</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Lab results and imaging reports, by patient and day. Tick the ones to give the patient and print them together - short results share one page.
        </p>

        <div className="relative mt-5 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input aria-label="Search by patient" className="pl-9" placeholder="Search by patient name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {error && <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}

        <div className="mt-5 space-y-3">
          {loading ? (
            <p className="text-sm text-slate-500"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />Loading results...</p>
          ) : groups.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {search ? 'No results for that name.' : 'No results yet. They appear here as the lab enters them and imaging reports are written.'}
            </Card>
          ) : (
            groups.map((group) => {
              const chosen = group.items.filter((i) => !leftOut.has(i.id)).length;
              return (
                <Card key={group.key} className="gap-0 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-800 dark:text-slate-200">{group.patientName}</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{dayText(group.day)}</p>
                    </div>
                    <Button size="sm" variant="outline" disabled={printing === group.key || chosen === 0} onClick={() => void print(group)}>
                      {printing === group.key ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Printer className="size-4" aria-hidden="true" />}
                      Print {chosen === group.items.length ? (chosen === 1 ? 'result' : `all ${chosen}`) : `${chosen} of ${group.items.length}`}
                    </Button>
                  </div>
                  <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                    {group.items.map((item) => {
                      const Icon = item.kind === 'lab' ? FlaskConical : ScanLine;
                      return (
                        <li key={item.id}>
                          <label className="flex cursor-pointer items-start gap-3 py-2">
                            <input type="checkbox" className="mt-1 size-4 accent-emerald-700" checked={!leftOut.has(item.id)} onChange={() => toggle(item)} />
                            <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{item.name}</span>
                                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${item.verified ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                                  {item.kind === 'imaging' ? 'Reported' : item.verified ? 'Verified' : 'Not yet verified'}
                                </span>
                              </span>
                              <span className={`block text-sm ${item.flagged ? 'text-red-700 dark:text-red-400' : 'text-slate-600 dark:text-slate-400'}`}>{item.summary}</span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
