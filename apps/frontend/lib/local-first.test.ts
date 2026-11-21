import { describe, expect, it } from 'vitest';
import { notOlderThan } from './local-first';

describe("keeping this device's copies", () => {
  it('does not let an older server copy replace a newer synced one, and lets the server correct anything not sent', () => {
    const here = [
      { id: 'm1', updatedAt: '2026-11-21T08:00:00.000Z', syncStatus: 'synced' }, // price edited here a moment ago
      { id: 'm2', updatedAt: '2026-11-21T08:00:00.000Z', syncStatus: 'pending' }, // saved here, refused or not sent
      { id: 'm3', updatedAt: '2026-11-20T08:00:00.000Z', syncStatus: 'synced' },
    ];
    const fromServer = [
      { id: 'm1', updatedAt: '2026-11-21T07:59:00.000Z' }, // left the server before the edit
      { id: 'm2', updatedAt: '2026-11-20T08:00:00.000Z' },
      { id: 'm3', updatedAt: '2026-11-21T09:00:00.000Z' }, // changed on another device
      { id: 'm4', updatedAt: '2026-11-21T09:00:00.000Z' }, // new here
    ];
    expect(notOlderThan(fromServer, here).map((m) => m.id)).toEqual(['m2', 'm3', 'm4']);
  });
});
