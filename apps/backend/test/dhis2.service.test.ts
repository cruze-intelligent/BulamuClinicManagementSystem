import { describe, expect, it, vi } from 'vitest';
import { buildDataValueSet, flattenHmisReport, pushDataValueSet } from '../src/services/dhis2.service';

describe('flattenHmisReport', () => {
  it('flattens nested numeric figures into dot paths', () => {
    const report = {
      section1_attendance: { totalOutpatients: 42, newAttenders: 40 },
      section2_epidemicSurveillance: [{ condition: 'Malaria', cases: 5 }],
    };

    const flat = flattenHmisReport(report);
    expect(flat['section1_attendance.totalOutpatients']).toBe(42);
    expect(flat['section1_attendance.newAttenders']).toBe(40);
    expect(flat['section2_epidemicSurveillance.0.cases']).toBe(5);
  });

  it('ignores non-numeric leaves (strings, etc.)', () => {
    const flat = flattenHmisReport({ facilityName: 'Kawempe HC III', section1_attendance: { totalOutpatients: 1 } });
    expect(flat.facilityName).toBeUndefined();
    expect(flat['section1_attendance.totalOutpatients']).toBe(1);
  });
});

describe('buildDataValueSet', () => {
  it('maps figures to configured dataElement UIDs and reports unmapped ones', () => {
    const report = { section1_attendance: { totalOutpatients: 42 }, section3_essentialMedicines: { totalTracked: 10 } };

    const { dataValueSet, unmappedFigures } = buildDataValueSet({
      report,
      dataElementMap: { 'section1_attendance.totalOutpatients': 'DE_ATTENDANCE_UID' },
      orgUnitId: 'ORG_UNIT_1',
      period: '202601',
    });

    expect(dataValueSet.orgUnit).toBe('ORG_UNIT_1');
    expect(dataValueSet.period).toBe('202601');
    expect(dataValueSet.dataValues).toEqual([{ dataElement: 'DE_ATTENDANCE_UID', value: '42' }]);
    expect(unmappedFigures).toContain('section3_essentialMedicines.totalTracked');
  });
});

describe('pushDataValueSet', () => {
  it('posts to the DHIS2 dataValueSets endpoint with basic auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'SUCCESS' }),
    });

    const result = await pushDataValueSet(
      { dataSet: 'HMIS_105', period: '202601', orgUnit: 'ORG_UNIT_1', dataValues: [] },
      { baseUrl: 'https://dhis2.example.ug', username: 'bulamu', password: 'secret' },
      fetchMock
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://dhis2.example.ug/api/dataValueSets',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: expect.stringContaining('Basic ') }),
      })
    );
  });

  it('surfaces a failed push without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    });

    const result = await pushDataValueSet(
      { dataSet: 'HMIS_105', period: '202601', orgUnit: 'ORG_UNIT_1', dataValues: [] },
      { baseUrl: 'https://dhis2.example.ug', username: 'bulamu', password: 'wrong' },
      fetchMock
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });
});
