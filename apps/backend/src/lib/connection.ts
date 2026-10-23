import type { FastifyRequest } from 'fastify';

/**
 * The visitor's own address. On Render every request arrives through
 * Cloudflare and then Render's proxy, so the connection itself always comes
 * from the proxy: counting tries by it would put everyone in one bucket, and a
 * few wrong passwords anywhere would lock everybody out. Cloudflare sets
 * CF-Connecting-IP to the real visitor's address and refuses requests that
 * try to supply their own (error 1000), so there it can be trusted.
 *
 * Anywhere else (the edge micro-server, a developer's machine) nothing
 * guarantees that header, so it is ignored unless TRUST_CF_CONNECTING_IP=true.
 */
function behindCloudflare(): boolean {
  return !!process.env.RENDER || process.env.TRUST_CF_CONNECTING_IP === 'true';
}

export type ClientIpSource = 'cf-connecting-ip' | 'socket';

export function clientIpSource(request: FastifyRequest): ClientIpSource {
  const header = request.headers['cf-connecting-ip'];
  return behindCloudflare() && typeof header === 'string' && header.trim() ? 'cf-connecting-ip' : 'socket';
}

export function clientIp(request: FastifyRequest): string {
  return clientIpSource(request) === 'cf-connecting-ip' ? String(request.headers['cf-connecting-ip']).trim() : request.ip;
}

/**
 * The websites allowed to call the API from a browser: the frontend's address
 * (FRONTEND_URL) and its www / bare-domain twin - people type both - plus any
 * listed in CORS_ORIGINS (comma-separated). Any other site gets no permission.
 */
export function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    try {
      const url = new URL(value.trim());
      origins.add(url.origin);
      if (url.hostname === 'localhost' || /^[\d.]+$/.test(url.hostname)) return;
      const twin = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
      origins.add(`${url.protocol}//${twin}${url.port ? `:${url.port}` : ''}`);
    } catch {
      // Not an address - ignored.
    }
  };
  add(process.env.FRONTEND_URL || 'http://localhost:3000');
  for (const extra of (process.env.CORS_ORIGINS ?? '').split(',')) add(extra);
  return origins;
}

/** The deployed commit, as Render reports it (null when not running on Render). */
export const release = () => (process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : null);
