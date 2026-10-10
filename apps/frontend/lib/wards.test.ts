import { describe, expect, it } from 'vitest';
import { abnormalVitals, vitalsText, wardTypeLabel } from './wards';

describe('ward chart helpers', () => {
  it('writes vitals the way they are written on a chart', () => {
    expect(vitalsText({ temperatureC: 38.5, pulse: 110, systolic: 120, diastolic: 80, spo2: 95 })).toBe('T 38.5°C · P 110 · BP 120/80 · SpO2 95%');
    expect(vitalsText(null)).toBe('');
  });

  it('flags readings that need attention', () => {
    expect(abnormalVitals({ temperatureC: 38.5, pulse: 120, spo2: 89, systolic: 85 })).toEqual(['Fever', 'Fast pulse', 'Low BP', 'Low oxygen']);
    expect(abnormalVitals({ temperatureC: 36.8, pulse: 80, respiratoryRate: 18, systolic: 120, spo2: 98 })).toEqual([]);
  });

  it('labels ward types', () => {
    expect(wardTypeLabel('ICU')).toBe('ICU / high dependency');
    expect(wardTypeLabel('MATERNITY')).toBe('Maternity');
  });
});
