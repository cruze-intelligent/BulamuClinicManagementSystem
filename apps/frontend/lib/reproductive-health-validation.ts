export type ReproductiveHealthFormInput = {
  cycleLengthDays?: string;
  flowDurationDays?: string;
  gravida?: string;
  para?: string;
};

export type ReproductiveHealthValidationResult = {
  valid: boolean;
  errors: Partial<Record<keyof ReproductiveHealthFormInput, string>>;
};

const CYCLE_LENGTH_MIN = 15;
const CYCLE_LENGTH_MAX = 45;
const FLOW_DURATION_MIN = 1;
const FLOW_DURATION_MAX = 10;

/**
 * Plausibility checks for clinician-entered cycle data - not a medical
 * diagnosis tool, just catches obvious data-entry mistakes (typos,
 * transposed digits) before they land in the patient's record.
 */
export function validateReproductiveHealthForm(input: ReproductiveHealthFormInput): ReproductiveHealthValidationResult {
  const errors: ReproductiveHealthValidationResult['errors'] = {};

  if (input.cycleLengthDays) {
    const value = Number(input.cycleLengthDays);
    if (!Number.isFinite(value) || value < CYCLE_LENGTH_MIN || value > CYCLE_LENGTH_MAX) {
      errors.cycleLengthDays = `Cycle length should be between ${CYCLE_LENGTH_MIN} and ${CYCLE_LENGTH_MAX} days`;
    }
  }

  if (input.flowDurationDays) {
    const value = Number(input.flowDurationDays);
    if (!Number.isFinite(value) || value < FLOW_DURATION_MIN || value > FLOW_DURATION_MAX) {
      errors.flowDurationDays = `Flow duration should be between ${FLOW_DURATION_MIN} and ${FLOW_DURATION_MAX} days`;
    }
  }

  const gravida = input.gravida ? Number(input.gravida) : undefined;
  const para = input.para ? Number(input.para) : undefined;

  if (gravida != null && (!Number.isInteger(gravida) || gravida < 0)) {
    errors.gravida = 'Gravida must be a non-negative whole number';
  }

  if (para != null && (!Number.isInteger(para) || para < 0)) {
    errors.para = 'Para must be a non-negative whole number';
  }

  if (gravida != null && para != null && !errors.gravida && !errors.para && para > gravida) {
    errors.para = 'Para cannot exceed gravida';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
