import { describe, expect, it } from 'vitest';
import { defaultDepartmentId, sortDepartments, type Department } from './departments';

const unit = (id: string, code: string | null, name: string, isActive = true): Department => ({ id, code, name, isActive });

describe('units', () => {
  it('lists the standard units in the standard order, then the facility\'s own by name', () => {
    const sorted = sortDepartments([unit('s', null, 'Sickle Cell Clinic'), unit('d', 'DENTAL', 'Dentistry'), unit('a', null, 'Antiretroviral Outreach'), unit('o', 'OPD', 'General OPD')]);
    expect(sorted.map((u) => u.name)).toEqual(['General OPD', 'Dentistry', 'Antiretroviral Outreach', 'Sickle Cell Clinic']);
  });

  it('books a new visit into the person\'s own unit, else General OPD, else the only unit there is', () => {
    const units = [unit('o', 'OPD', 'General OPD'), unit('d', 'DENTAL', 'Dentistry'), unit('e', 'EYE', 'Eye Clinic', false)];
    expect(defaultDepartmentId(units, ['d'])).toBe('d');
    expect(defaultDepartmentId(units, ['e'])).toBe('o'); // their unit is closed
    expect(defaultDepartmentId(units, [])).toBe('o');
    expect(defaultDepartmentId([unit('d', 'DENTAL', 'Dentistry')], [])).toBe('d');
    expect(defaultDepartmentId([unit('d', 'DENTAL', 'Dentistry'), unit('t', 'ORTHOPAEDICS', 'Orthopaedics')], [])).toBe('');
  });
});
