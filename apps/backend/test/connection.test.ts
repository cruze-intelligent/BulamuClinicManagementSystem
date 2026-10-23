import { afterEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers';
import { prisma } from '../src/lib/prisma';
import { allowedOrigins } from '../src/lib/connection';

// How the API meets the outside world on Render: which sites may call it,
// how visitors are told apart behind the proxy, and what its health checks say.
const ENV_KEYS = ['FRONTEND_URL', 'CORS_ORIGINS', 'RENDER', 'RENDER_GIT_COMMIT', 'TRUST_CF_CONNECTING_IP'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let app: FastifyInstance | undefined;

async function appWith(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  await app?.close();
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  if (!env.FRONTEND_URL) process.env.FRONTEND_URL = saved.FRONTEND_URL;
  app = await buildTestApp();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

const preflight = (a: FastifyInstance, origin: string) =>
  a.inject({ method: 'OPTIONS', url: '/auth/login', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' } });

describe('which websites may call the API', () => {
  it('allows bulamu.site and www.bulamu.site, and gives any other site no permission at all', async () => {
    const a = await appWith({ FRONTEND_URL: 'https://bulamu.site' });
    expect((await preflight(a, 'https://bulamu.site')).headers['access-control-allow-origin']).toBe('https://bulamu.site');
    expect((await preflight(a, 'https://www.bulamu.site')).headers['access-control-allow-origin']).toBe('https://www.bulamu.site');
    for (const other of ['https://evil.example', 'https://bulamu.site.evil.example', 'http://bulamu.site']) {
      expect((await preflight(a, other)).headers['access-control-allow-origin'], other).toBeUndefined();
    }
    // A real request from the site carries the permission too.
    const health = await a.inject({ method: 'GET', url: '/health', headers: { origin: 'https://www.bulamu.site' } });
    expect(health.headers['access-control-allow-origin']).toBe('https://www.bulamu.site');
  });

  it('works out the address twins, and takes extra sites from CORS_ORIGINS', () => {
    process.env.FRONTEND_URL = 'https://www.bulamu.site/';
    process.env.CORS_ORIGINS = 'https://staging.bulamu.site, not an address';
    expect([...allowedOrigins()].sort()).toEqual(['https://bulamu.site', 'https://staging.bulamu.site', 'https://www.bulamu.site', 'https://www.staging.bulamu.site']);
    process.env.FRONTEND_URL = 'http://localhost:3000';
    delete process.env.CORS_ORIGINS;
    expect([...allowedOrigins()]).toEqual(['http://localhost:3000']);
  });
});

describe('telling visitors apart behind Render\'s proxy', () => {
  // Patient password resets allow 5 tries per 15 minutes per visitor; a made-up identifier sends nothing.
  const forgot = (a: FastifyInstance, ip?: string) =>
    a.inject({ method: 'POST', url: '/patient-auth/forgot-password', headers: ip ? { 'cf-connecting-ip': ip } : {}, payload: { identifier: 'nobody@example.invalid' } });
  const remaining = (res: { headers: Record<string, unknown> }) => Number(res.headers['x-ratelimit-remaining']);

  it('on Render, counts each visitor by the address Cloudflare reports - one person\'s tries never use up another\'s', async () => {
    const a = await appWith({ RENDER: 'true' });
    expect(remaining(await forgot(a, '196.43.1.10'))).toBe(4);
    expect(remaining(await forgot(a, '196.43.1.10'))).toBe(3);
    expect(remaining(await forgot(a, '102.85.7.20'))).toBe(4); // someone else, a fresh count
    for (let i = 0; i < 3; i++) await forgot(a, '196.43.1.10');
    expect((await forgot(a, '196.43.1.10')).statusCode).toBe(429);
    expect((await forgot(a, '102.85.7.20')).statusCode).toBe(200); // not locked out by the first
  });

  it('elsewhere, ignores that header - anyone could type it', async () => {
    const a = await appWith({});
    expect(remaining(await forgot(a, '196.43.1.10'))).toBe(4);
    expect(remaining(await forgot(a, '102.85.7.20'))).toBe(3); // same connection, same count
  });
});

describe('health checks', () => {
  it('/health answers at once with the commit Render is running, without touching the database', async () => {
    const a = await appWith({ RENDER: 'true', RENDER_GIT_COMMIT: '64bf5e4d1a2b3c4d5e6f' });
    const spy = vi.spyOn(prisma, '$queryRaw');
    const res = await a.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'Bulamu API', release: '64bf5e4' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('/health/connection reports the database link and how the visitor was identified, and nothing else', async () => {
    const a = await appWith({ RENDER: 'true' });
    const res = await a.inject({ method: 'GET', url: '/health/connection', headers: { 'cf-connecting-ip': '196.43.1.10' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['clientIpSource', 'database', 'databaseMs', 'release', 'status', 'uptimeSeconds']);
    expect(body).toMatchObject({ status: 'ok', database: 'ok', clientIpSource: 'cf-connecting-ip' });
    expect(body.databaseMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(body)).not.toContain('196.43.1.10'); // the address itself is never echoed

    const local = await appWith({});
    expect((await local.inject({ method: 'GET', url: '/health/connection', headers: { 'cf-connecting-ip': '196.43.1.10' } })).json().clientIpSource).toBe('socket');
  });

  it('says plainly when the database cannot be reached (503), so monitoring can tell', async () => {
    const a = await appWith({});
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused') as never);
    const res = await a.inject({ method: 'GET', url: '/health/connection' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', database: 'unreachable' });
    expect(res.body).not.toContain('connection refused');
  });
});
