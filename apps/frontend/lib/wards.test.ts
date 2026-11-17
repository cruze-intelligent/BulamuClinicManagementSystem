import { describe, expect, it } from 'vitest';
import { KIND_LABEL, NOTE_KINDS, abnormalVitals, structuredFields, structuredProblem, structuredTitle, vitalsText, wardTypeLabel } from './wards';

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

describe('procedures and operation notes on the chart', () => {
  it('asks for what a standard note needs before saving', () => {
    expect(structuredProblem('PROCEDURE', { procedure: 'Wound dressing' })).toBe('What was done and found is needed');
    expect(structuredProblem('OPERATION_NOTE', { operation: 'Caesarean section', surgeon: 'Dr Ogwang', procedure: 'LSCS' })).toBe('Anaesthesia is needed');
    expect(structuredProblem('OPERATION_NOTE', { operation: 'Caesarean section', surgeon: 'Dr Ogwang', anaesthesia: 'Spinal', procedure: 'LSCS' })).toBeNull();
    expect(structuredFields('NURSING_NOTE')).toBeNull();
  });

  it('heads each one in a line, and only clinicians write operation notes', () => {
    expect(structuredTitle('OPERATION_NOTE', { operation: 'Emergency caesarean section', surgeon: 'Dr Ogwang', anaesthesia: 'Spinal' })).toBe('Emergency caesarean section - Dr Ogwang, spinal');
    expect(structuredTitle('PROCEDURE', { procedure: 'Urethral catheterisation' })).toBe('Urethral catheterisation');
    expect(NOTE_KINDS.find((k) => k.value === 'OPERATION_NOTE')).toMatchObject({ roles: ['DOCTOR', 'ADMIN'] });
    expect(KIND_LABEL.NURSING_NOTE).toBe('Nursing note / intervention');
  });
});
