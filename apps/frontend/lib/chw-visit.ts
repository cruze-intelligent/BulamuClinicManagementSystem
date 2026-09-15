export type ChwVisitSummary = {
  diagnosis: string;
  symptomsText: string;
  hasDangerSign: boolean;
};

/**
 * Builds the consultation record for a community household visit from the
 * checked symptom/danger-sign lists - a danger sign always drives the
 * diagnosis toward "needs referral" regardless of which one was checked.
 */
export function buildChwVisitSummary(symptoms: string[], dangerSigns: string[]): ChwVisitSummary {
  const hasDangerSign = dangerSigns.length > 0;
  const findings = [...symptoms, ...dangerSigns.map((s) => `DANGER SIGN: ${s}`)];

  return {
    diagnosis: hasDangerSign ? 'Community visit - referral needed' : 'Community household visit',
    symptomsText: findings.length > 0 ? findings.join(', ') : 'None reported',
    hasDangerSign,
  };
}
