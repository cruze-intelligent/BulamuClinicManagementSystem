import { describe, expect, it } from 'vitest';
import { menuFor } from './nav-items';

describe("each person's menu", () => {
  it('gives what their roles allow, less the parts the administrator left out - never the dashboard, notifications or help', () => {
    const paths = (roles: string[], hidden: string[] = []) => menuFor(roles, hidden).map((i) => i.path);
    expect(paths(['LAB_TECH'])).toContain('/lab');
    expect(paths(['LAB_TECH'])).not.toContain('/inventory');
    // A lab technician who also nurses gets the wards too.
    expect(paths(['LAB_TECH', 'NURSE'])).toContain('/wards');
    const trimmed = paths(['NURSE'], ['/wards', '/referrals', '/dashboard', '/help']);
    expect(trimmed).not.toContain('/wards');
    expect(trimmed).not.toContain('/referrals');
    expect(trimmed).toEqual(expect.arrayContaining(['/dashboard', '/notifications', '/help', '/results']));
  });
});
