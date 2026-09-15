/**
 * HMIS 105 service categories that aren't captured elsewhere in the schema
 * (HIV testing/counseling, safe male circumcision) - tagged directly on the
 * consultation rather than modeled as separate tables, since each is really
 * just a service delivered during a normal consultation.
 */
export const HMIS_SERVICE_TAGS = [
  'HIV_TESTING_COUNSELING',
  'SAFE_MALE_CIRCUMCISION',
  'ANTENATAL_CARE',
  'COMMUNITY_HOUSEHOLD_VISIT',
] as const;

export type HmisServiceTag = (typeof HMIS_SERVICE_TAGS)[number];

export function isValidServiceTag(tag: string): tag is HmisServiceTag {
  return (HMIS_SERVICE_TAGS as readonly string[]).includes(tag);
}
