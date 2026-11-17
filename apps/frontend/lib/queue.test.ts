import { describe, expect, it } from 'vitest';
import { expectedToday, waitingQueue, waitingText } from './queue';

// Kampala times, as the queue shows them whatever the device's time zone.
const kampala = (h: number, m: number, day = 17) => new Date(`2026-11-${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
const now = kampala(10, 0);
const at = (h: number, m: number, day = 17) => kampala(h, m, day).toISOString();
const appt = (id: string, patch: object) => ({ id, patientId: `p-${id}`, status: 'SCHEDULED', date: at(8, 0), ...patch });

describe('the waiting queue', () => {
  it('lists today\'s arrivals not yet seen, first come first seen', () => {
    const list = [
      appt('late', { checkedInAt: at(9, 40) }),
      appt('early', { checkedInAt: at(8, 5) }),
      appt('seen', { checkedInAt: at(7, 50), status: 'COMPLETED' }),
      appt('yesterday', { checkedInAt: at(16, 0, 16) }),
      appt('not-arrived', {}),
      appt('middle', { checkedInAt: at(9, 0) }),
    ];
    expect(waitingQueue(list, now).map((a) => a.id)).toEqual(['early', 'middle', 'late']);
    expect(expectedToday(list, now).map((a) => a.id)).toEqual(['not-arrived']);
  });

  it('says when each patient arrived and how long they have waited', () => {
    expect(waitingText(at(9, 35), now)).toBe('Arrived 09:35 - waiting 25 min');
    expect(waitingText(at(8, 20), now)).toBe('Arrived 08:20 - waiting 1 h 40 min');
    expect(waitingText(at(9, 0), now)).toBe('Arrived 09:00 - waiting 1 h');
  });
});
