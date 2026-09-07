import test from "node:test";
import assert from "node:assert/strict";
import { aliquotSourceAllocation, validateAllocation, plannedVialCount, totalMassNg, suggestVialVolumes, additionalVialsRequired, validateDistribution } from "../inventory/js/calculations.js";

test("100M PBMC accepts 6x10M plus 20M DNA and 20M RNA", () => {
  const outputs = [{ sourceAllocation: aliquotSourceAllocation(10, 6) }, { sourceAllocation: 20 }, { sourceAllocation: 20 }];
  assert.deepEqual(validateAllocation(100, outputs), { available: 100, allocated: 100, remaining: 0, valid: true });
});

test("100M PBMC blocks an additional 10M", () => {
  assert.equal(validateAllocation(100, [{ sourceAllocation: 60 }, { sourceAllocation: 20 }, { sourceAllocation: 20 }, { sourceAllocation: 10 }]).valid, false);
});

test("10 mL serum accepts 20x500uL and blocks 21", () => {
  assert.equal(validateAllocation(10_000, [{ sourceAllocation: aliquotSourceAllocation(500, 20) }]).valid, true);
  assert.equal(validateAllocation(10_000, [{ sourceAllocation: aliquotSourceAllocation(500, 21) }]).valid, false);
});

test("DNA vial planning rounds up", () => {
  assert.equal(plannedVialCount(90, 50), 2);
  assert.equal(plannedVialCount(101, 50), 3);
});

test("DNA actual mass and distribution", () => {
  assert.equal(totalMassNg(92, 70), 6440);
  assert.deepEqual(suggestVialVolumes(92, 50), [50, 42]);
  assert.deepEqual(validateDistribution([46, 46], 92, 50), { valid: true, total: 92 });
});

test("high actual yield requires one additional vial", () => {
  assert.equal(additionalVialsRequired(130, 2, 50), 1);
});

test("distribution validation prevents loss and overcapacity", () => {
  assert.equal(validateDistribution([50, 40], 92, 50).valid, false);
  assert.equal(validateDistribution([52, 40], 92, 50).valid, false);
  assert.equal(validateDistribution([52, 40], 92, 50, true).valid, true);
});
