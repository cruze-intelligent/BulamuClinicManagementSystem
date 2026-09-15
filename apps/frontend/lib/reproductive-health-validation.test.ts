import { describe, expect, it } from 'vitest';
import { validateReproductiveHealthForm } from './reproductive-health-validation';

describe('validateReproductiveHealthForm', () => {
  it('accepts an empty form (all fields optional)', () => {
    expect(validateReproductiveHealthForm({}).valid).toBe(true);
  });

  it('accepts plausible values', () => {
    const result = validateReproductiveHealthForm({
      cycleLengthDays: '28',
      flowDurationDays: '5',
      gravida: '3',
      para: '2',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('rejects a cycle length below the plausible minimum', () => {
    const result = validateReproductiveHealthForm({ cycleLengthDays: '3' });
    expect(result.valid).toBe(false);
    expect(result.errors.cycleLengthDays).toBeDefined();
  });

  it('rejects a cycle length above the plausible maximum', () => {
    const result = validateReproductiveHealthForm({ cycleLengthDays: '90' });
    expect(result.valid).toBe(false);
  });

  it('rejects a negative gravida', () => {
    const result = validateReproductiveHealthForm({ gravida: '-1' });
    expect(result.valid).toBe(false);
    expect(result.errors.gravida).toBeDefined();
  });

  it('rejects a non-integer para', () => {
    const result = validateReproductiveHealthForm({ para: '1.5' });
    expect(result.valid).toBe(false);
  });

  it('rejects para greater than gravida', () => {
    const result = validateReproductiveHealthForm({ gravida: '1', para: '2' });
    expect(result.valid).toBe(false);
    expect(result.errors.para).toBe('Para cannot exceed gravida');
  });

  it('allows para equal to gravida', () => {
    const result = validateReproductiveHealthForm({ gravida: '2', para: '2' });
    expect(result.valid).toBe(true);
  });
});
