/**
 * Maps Bulamu's computed HMIS 105 figures onto DHIS2's dataValueSets import
 * format, per the research doc's "push completed HMIS 105 and 108 datasets
 * seamlessly into the national DHIS2 data warehouse" architecture. DHIS2
 * dataElement UIDs are facility-specific (assigned by the district's DHIS2
 * instance), so they're supplied via a configurable map rather than hardcoded -
 * an unmapped figure is skipped rather than guessed.
 */

export type Dhis2DataValue = {
  dataElement: string;
  categoryOptionCombo?: string;
  value: string;
};

export type Dhis2DataValueSet = {
  dataSet: string;
  period: string;
  orgUnit: string;
  dataValues: Dhis2DataValue[];
};

export type HmisFlatFigures = Record<string, number>;

/**
 * Flattens the nested HMIS 105 report object (as returned by
 * GET /reports/hmis-105/:clinicId) into a single dot-path -> number map, so
 * it can be matched against a facility's dataElementMap.
 */
export function flattenHmisReport(report: Record<string, any>): HmisFlatFigures {
  const flat: HmisFlatFigures = {};

  function walk(node: any, prefix: string) {
    if (node == null) return;
    if (typeof node === 'number') {
      flat[prefix] = node;
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${prefix}.${index}`));
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        walk(value, prefix ? `${prefix}.${key}` : key);
      }
    }
  }

  walk(report, '');
  return flat;
}

export function buildDataValueSet(input: {
  report: Record<string, any>;
  dataElementMap: Record<string, string>;
  orgUnitId: string;
  period: string; // YYYYMM
  dataSetId?: string;
}): { dataValueSet: Dhis2DataValueSet; unmappedFigures: string[] } {
  const flat = flattenHmisReport(input.report);
  const dataValues: Dhis2DataValue[] = [];
  const unmappedFigures: string[] = [];

  for (const [path, value] of Object.entries(flat)) {
    const dataElement = input.dataElementMap[path];
    if (!dataElement) {
      unmappedFigures.push(path);
      continue;
    }
    dataValues.push({ dataElement, value: String(value) });
  }

  return {
    dataValueSet: {
      dataSet: input.dataSetId || 'HMIS_105',
      period: input.period,
      orgUnit: input.orgUnitId,
      dataValues,
    },
    unmappedFigures,
  };
}

export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export async function pushDataValueSet(
  dataValueSet: Dhis2DataValueSet,
  credentials: { baseUrl: string; username: string; password: string },
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<{ success: boolean; status: number; response: any }> {
  const url = `${credentials.baseUrl.replace(/\/$/, '')}/api/dataValueSets`;
  const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(dataValueSet),
  });

  const body = await response.json().catch(() => ({}));

  return { success: response.ok, status: response.status, response: body };
}
