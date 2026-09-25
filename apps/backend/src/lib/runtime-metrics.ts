/**
 * How the API itself is doing: request volume, errors and response times.
 *
 * Kept in memory on purpose - recording a row per request would cost more than
 * it is worth on a small server. The trade-off is honest and shown to the
 * operator: the figures cover the time since the server last started (it can
 * restart or sleep on the current hosting plan), not all time.
 */

// Response-time histogram edges in milliseconds; a final bucket holds anything slower.
export const LATENCY_EDGES_MS = [50, 100, 250, 500, 1000, 2500, 5000] as const;
const BUCKET_COUNT = LATENCY_EDGES_MS.length + 1;
const WINDOW_MINUTES = 60;
const MAX_ROUTES = 300;

type Counts = { requests: number; serverErrors: number; clientErrors: number; latency: number[] };
type RouteStats = { requests: number; errors: number; totalMs: number; maxMs: number };

const emptyCounts = (): Counts => ({ requests: 0, serverErrors: 0, clientErrors: 0, latency: new Array(BUCKET_COUNT).fill(0) });

let startedAt = Date.now();
let totals = emptyCounts();
let minutes = new Map<number, Counts>();
let routes = new Map<string, RouteStats>();

const bucketFor = (ms: number) => {
  const i = LATENCY_EDGES_MS.findIndex((edge) => ms <= edge);
  return i === -1 ? BUCKET_COUNT - 1 : i;
};

function add(counts: Counts, status: number, ms: number) {
  counts.requests++;
  if (status >= 500) counts.serverErrors++;
  else if (status >= 400) counts.clientErrors++;
  counts.latency[bucketFor(ms)]++;
}

export function recordRequest(input: { method: string; route: string; status: number; ms: number; at?: number }) {
  const at = input.at ?? Date.now();
  add(totals, input.status, input.ms);

  const minute = Math.floor(at / 60_000);
  let bucket = minutes.get(minute);
  if (!bucket) {
    bucket = emptyCounts();
    minutes.set(minute, bucket);
    for (const key of minutes.keys()) if (key <= minute - WINDOW_MINUTES) minutes.delete(key);
  }
  add(bucket, input.status, input.ms);

  const key = `${input.method} ${input.route}`;
  let stats = routes.get(key);
  if (!stats && routes.size < MAX_ROUTES) {
    stats = { requests: 0, errors: 0, totalMs: 0, maxMs: 0 };
    routes.set(key, stats);
  }
  if (stats) {
    stats.requests++;
    if (input.status >= 500) stats.errors++;
    stats.totalMs += input.ms;
    stats.maxMs = Math.max(stats.maxMs, input.ms);
  }
}

/**
 * The response time that `q` (0-1) of requests were at or under, read from the
 * histogram - so it is the upper edge of the bucket it falls in, not an exact
 * figure. Null when there is nothing to measure; `overflow` when it lies beyond
 * the last edge.
 */
export function percentileMs(latency: number[], q: number): { ms: number; overflow: boolean } | null {
  const total = latency.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = Math.ceil(total * q);
  let seen = 0;
  for (let i = 0; i < latency.length; i++) {
    seen += latency[i];
    if (seen >= target) return i < LATENCY_EDGES_MS.length ? { ms: LATENCY_EDGES_MS[i], overflow: false } : { ms: LATENCY_EDGES_MS[LATENCY_EDGES_MS.length - 1], overflow: true };
  }
  return null;
}

function summarize(counts: Counts) {
  return {
    requests: counts.requests,
    serverErrors: counts.serverErrors,
    clientErrors: counts.clientErrors,
    serverErrorRate: counts.requests ? counts.serverErrors / counts.requests : 0,
    p50: percentileMs(counts.latency, 0.5),
    p95: percentileMs(counts.latency, 0.95),
  };
}

export function snapshotRuntimeMetrics(now: number = Date.now()) {
  const currentMinute = Math.floor(now / 60_000);
  const lastHour = emptyCounts();
  const perMinute: Array<{ minute: string; requests: number; serverErrors: number }> = [];
  for (let m = currentMinute - WINDOW_MINUTES + 1; m <= currentMinute; m++) {
    const b = minutes.get(m);
    if (b) {
      lastHour.requests += b.requests;
      lastHour.serverErrors += b.serverErrors;
      lastHour.clientErrors += b.clientErrors;
      b.latency.forEach((n, i) => (lastHour.latency[i] += n));
    }
    perMinute.push({ minute: new Date(m * 60_000).toISOString(), requests: b?.requests ?? 0, serverErrors: b?.serverErrors ?? 0 });
  }

  const all = [...routes.entries()].map(([route, s]) => ({ route, requests: s.requests, errors: s.errors, avgMs: s.totalMs / s.requests, maxMs: s.maxMs }));
  return {
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.floor((now - startedAt) / 1000),
    sinceStart: summarize(totals),
    lastHour: { ...summarize(lastHour), perMinute },
    busiestRoutes: [...all].sort((a, b) => b.requests - a.requests).slice(0, 8),
    // Only routes seen enough times to say anything about their speed.
    slowestRoutes: all.filter((r) => r.requests >= 5).sort((a, b) => b.avgMs - a.avgMs).slice(0, 8),
    erroringRoutes: all.filter((r) => r.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 8),
  };
}

export function resetRuntimeMetrics() {
  startedAt = Date.now();
  totals = emptyCounts();
  minutes = new Map();
  routes = new Map();
}
