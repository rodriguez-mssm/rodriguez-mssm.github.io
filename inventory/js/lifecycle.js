export const SAMPLE_TRANSITIONS = Object.freeze({
  PLANNED: new Set(["ACTIVE", "NOT_CREATED"]),
  ACTIVE: new Set(["CONSUMED", "DISCARDED"]),
  NOT_CREATED: new Set(),
  CONSUMED: new Set(),
  DISCARDED: new Set(),
});

export function canTransition(from, to) {
  return SAMPLE_TRANSITIONS[from]?.has(to) ?? false;
}
