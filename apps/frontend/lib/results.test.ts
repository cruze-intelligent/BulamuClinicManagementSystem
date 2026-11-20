import { describe, expect, it } from 'vitest';
import { groupResults, imagingItem, labItem, printUrl } from './results';

const lab = (id: string, patch: Record<string, unknown> = {}) => ({ id, patientId: 'p1', testName: 'Malaria blood smear (B/S)', results: 'No parasites seen', status: 'COMPLETED', createdAt: '2026-11-19T07:00:00Z', resultedAt: '2026-11-19T08:00:00Z', verifiedAt: null, patient: { name: 'Achieng Mary' }, ...patch });

describe('the Results section', () => {
  it("gathers a patient's lab results and imaging reports of a day, newest day first, ready to print together", () => {
    const items = [
      labItem(lab('l1'))!,
      labItem(lab('l2', { testName: 'Random blood sugar (RBS)', values: [{ name: 'Random blood glucose', value: '11.2', flag: 'H' }], resultedAt: '2026-11-19T09:00:00Z' }))!,
      labItem(lab('l3', { patientId: 'p2', patient: { name: 'Okot John' }, resultedAt: '2026-11-20T06:00:00Z' }))!,
      imagingItem({ id: 'r1', examination: 'Resting 12-lead ECG', status: 'REPORTED', impression: 'Normal ECG', reportedAt: '2026-11-19T10:00:00Z', requestedAt: '2026-11-19T07:00:00Z', patient: { id: 'p1', name: 'Achieng Mary' } })!,
    ];
    expect(labItem(lab('pending', { status: 'PENDING', results: '' }))).toBeNull();
    const groups = groupResults(items);
    expect(groups.map((g) => [g.patientName, g.day, g.items.map((i) => i.id)])).toEqual([
      ['Okot John', '2026-11-20', ['l3']],
      ['Achieng Mary', '2026-11-19', ['l1', 'l2', 'r1']],
    ]);
    expect(groups[1].items[1]).toMatchObject({ summary: '11.2', flagged: 1 });
    expect(groupResults(items, 'okot')).toHaveLength(1);
    expect(printUrl('https://api', groups[1].items)).toBe('https://api/results/pdf?lab=l1%2Cl2&imaging=r1');
  });
});
