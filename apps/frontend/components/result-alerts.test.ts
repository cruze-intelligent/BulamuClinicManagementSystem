import { describe, expect, it } from 'vitest';
import { alertsToPop } from './result-alerts';

const now = Date.parse('2026-11-20T10:00:00Z');
const n = (id: string, patch: Record<string, unknown> = {}) => ({ id, type: 'LAB_RESULT_AVAILABLE', title: 'Result ready', body: '', link: '/x', readAt: null, createdAt: new Date(now - 60_000).toISOString(), ...patch });

describe('results popping up as they come back', () => {
  it('pops up a new unread result or request once - not old, read or other notices', () => {
    const list = [
      n('a'),
      n('b', { type: 'IMAGING_REPORTED' }),
      n('c', { type: 'LAB_TEST_ORDERED' }),
      n('d', { readAt: new Date(now).toISOString() }),
      n('e', { createdAt: new Date(now - 60 * 60_000).toISOString() }),
      n('f', { type: 'LOW_STOCK' }),
      n('g'),
    ];
    expect(alertsToPop(list, ['g'], now).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});
