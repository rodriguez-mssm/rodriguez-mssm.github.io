export function purityRatio(numerator, denominator) {
  if (numerator == null || denominator == null || !Number.isFinite(Number(numerator)) || !Number.isFinite(Number(denominator)) || Number(denominator) === 0) return null;
  return Number(numerator) / Number(denominator);
}

export function nanodropRatios({ a230, a260, a280 }) {
  return { a260A280: purityRatio(a260, a280), a260A230: purityRatio(a260, a230) };
}

export function validateIntegrity(sampleType, value) {
  if (value == null || value === "") return { valid: true, value: null };
  const numeric = Number(value);
  const label = sampleType === "RNA" ? "RIN" : "DIN";
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 10) return { valid: false, value: null, error: `${label} must be between 1 and 10.` };
  return { valid: true, value: numeric };
}
