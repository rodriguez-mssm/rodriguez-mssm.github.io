const EPSILON = 0.01;

export function plannedVialCount(expectedVolumeUl, maxVolumeUl) {
  requirePositive(expectedVolumeUl, "Expected volume");
  requirePositive(maxVolumeUl, "Maximum vial volume");
  return Math.ceil(expectedVolumeUl / maxVolumeUl);
}

export function totalMassNg(volumeUl, concentrationNgUl) {
  requireNonNegative(volumeUl, "Volume");
  requireNonNegative(concentrationNgUl, "Concentration");
  return volumeUl * concentrationNgUl;
}

export function sourceAllocation(outputs) {
  return outputs.reduce((total, output) => total + Number(output.sourceAllocation || 0), 0);
}

export function validateAllocation(available, outputs) {
  requireNonNegative(available, "Available quantity");
  const allocated = sourceAllocation(outputs);
  return { available, allocated, remaining: available - allocated, valid: allocated <= available + EPSILON };
}

export function suggestVialVolumes(actualVolumeUl, maxVolumeUl) {
  requireNonNegative(actualVolumeUl, "Actual volume");
  requirePositive(maxVolumeUl, "Maximum vial volume");
  const result = [];
  let remaining = actualVolumeUl;
  while (remaining > EPSILON) {
    const amount = Math.min(maxVolumeUl, remaining);
    result.push(Number(amount.toFixed(3)));
    remaining = Number((remaining - amount).toFixed(6));
  }
  return result;
}

export function additionalVialsRequired(actualVolumeUl, plannedVials, maxVolumeUl) {
  requireNonNegative(actualVolumeUl, "Actual volume");
  requireNonNegative(plannedVials, "Planned vial count");
  requirePositive(maxVolumeUl, "Maximum vial volume");
  return Math.max(0, Math.ceil((actualVolumeUl - plannedVials * maxVolumeUl - EPSILON) / maxVolumeUl));
}

export function validateDistribution(volumes, actualVolumeUl, maxVolumeUl, allowOverCapacity = false) {
  if (!Array.isArray(volumes) || volumes.length === 0) return { valid: false, error: "At least one vial is required." };
  if (volumes.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) return { valid: false, error: "Vial volumes must be non-negative numbers." };
  if (!allowOverCapacity && volumes.some((value) => Number(value) > maxVolumeUl + EPSILON)) return { valid: false, error: `No vial may exceed ${maxVolumeUl} µL.` };
  const total = volumes.reduce((sum, value) => sum + Number(value), 0);
  if (Math.abs(total - actualVolumeUl) > EPSILON) return { valid: false, error: `Vial volumes total ${total} µL, not ${actualVolumeUl} µL.` };
  return { valid: true, total };
}

export function aliquotSourceAllocation(amountEach, count) {
  requirePositive(amountEach, "Amount per aliquot");
  if (!Number.isInteger(Number(count)) || Number(count) <= 0) throw new Error("Aliquot count must be a positive integer");
  return amountEach * count;
}

function requirePositive(value, label) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) throw new Error(`${label} must be greater than zero`);
}

function requireNonNegative(value, label) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${label} must be zero or greater`);
}
