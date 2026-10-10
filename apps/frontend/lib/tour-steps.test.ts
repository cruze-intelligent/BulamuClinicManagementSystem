import { describe, expect, it } from 'vitest';
import { TOUR_STEPS } from './tour-steps';
import { NAV_ITEMS } from './nav-items';

describe('the guided walkthrough', () => {
  const roles = ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF'];

  it('has a tour for every role', () => {
    for (const role of roles) expect(TOUR_STEPS[role]?.length, role).toBeGreaterThan(2);
  });

  it('only points each role at menu items that role can actually see', () => {
    for (const role of roles) {
      for (const step of TOUR_STEPS[role]) {
        if (!step.target?.startsWith('nav-')) continue;
        const path = step.target.slice('nav-'.length);
        const item = NAV_ITEMS.find((i) => i.path === path);
        expect(item, `${role}: "${step.title}" points at ${path}, which is not in the menu`).toBeDefined();
        expect(item!.roles, `${role}: "${step.title}" points at ${path}, which ${role} cannot see`).toContain(role);
      }
    }
  });

  it('ends by saying where to find the tour again', () => {
    for (const role of roles) {
      const last = TOUR_STEPS[role].at(-1)!;
      expect(last.target, role).toBe('nav-/help');
      expect(last.body).toMatch(/again/);
    }
  });

  it('keeps each step short enough to read at a glance', () => {
    for (const role of roles) {
      for (const step of TOUR_STEPS[role]) expect(step.body.length, `${role}: ${step.title}`).toBeLessThan(320);
    }
  });
});
