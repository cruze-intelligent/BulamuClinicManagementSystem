import { describe, expect, it, vi } from 'vitest';
import { isStaleBuildError, newerReleaseAvailable } from './update-notice';

const site = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe('telling an open page Bulamu has been updated', () => {
  it('compares the running release with the one the site serves', async () => {
    expect(await newerReleaseAvailable('abc123', site({ release: 'def456' }))).toBe(true);
    expect(await newerReleaseAvailable('abc123', site({ release: 'abc123' }))).toBe(false);
    // Unknown, unreachable or not deployed yet: no notice.
    expect(await newerReleaseAvailable('', site({ release: 'def456' }))).toBe(false);
    expect(await newerReleaseAvailable('abc123', site({}, false))).toBe(false);
    expect(await newerReleaseAvailable('abc123', vi.fn(async () => { throw new Error('offline'); }))).toBe(false);
  });

  it('asks the site itself every time, past the CDN and browser caches', async () => {
    const fetcher = site({ release: 'abc123' });
    await newerReleaseAvailable('abc123', fetcher);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^\/version\.json\?t=\d+$/);
    expect(init.cache).toBe('no-store');
  });

  it('recognises a page that is older than the site it loads pieces from', () => {
    expect(isStaleBuildError('ChunkLoadError Loading chunk 4521 failed.')).toBe(true);
    expect(isStaleBuildError('TypeError Failed to fetch dynamically imported module: https://bulamu.site/_next/static/chunks/x.js')).toBe(true);
    expect(isStaleBuildError("TypeError Cannot read properties of undefined (reading 'filter')")).toBe(false);
  });
});
