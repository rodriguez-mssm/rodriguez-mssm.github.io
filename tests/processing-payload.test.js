import test from "node:test";
import assert from "node:assert/strict";
import { buildProcessingPlanPayload, serializeProcessingOutput } from "../inventory/js/processing-payload.js";
import { validateAllocation } from "../inventory/js/calculations.js";

const mixedOutputs = [
  { type: "PBMC", mode: "ALIQUOT", amountEach: 10, count: 6, sourceAllocation: 60 },
  { type: "DNA", mode: "EXTRACTION", sourceAllocation: 20, expectedVolume: 90, maxVialVolume: 50 },
  { type: "RNA", mode: "EXTRACTION", sourceAllocation: 20, expectedVolume: 90, maxVialVolume: 50 },
];

test("mixed PBMC, DNA, and RNA plan serializes to the RPC contract", () => {
  assert.deepEqual(validateAllocation(100, mixedOutputs), { available: 100, allocated: 100, remaining: 0, valid: true });
  const payload = buildProcessingPlanPayload("00000000-0000-4000-8000-000000000001", "synthetic", mixedOutputs);
  assert.deepEqual(payload.outputs, [
    { output_type: "PBMC", operation_type: "ALIQUOT", source_allocation: 60, amount_each: 10, requested_count: 6, expected_volume_ul: null, max_vial_volume_ul: null },
    { output_type: "DNA", operation_type: "EXTRACTION", source_allocation: 20, amount_each: null, requested_count: 2, expected_volume_ul: 90, max_vial_volume_ul: 50 },
    { output_type: "RNA", operation_type: "EXTRACTION", source_allocation: 20, amount_each: null, requested_count: 2, expected_volume_ul: 90, max_vial_volume_ul: 50 },
  ]);
});

test("extraction serialization drops stale aliquot-only state", () => {
  const serialized = serializeProcessingOutput({ type: "DNA", mode: "EXTRACTION", sourceAllocation: 20, expectedVolume: 92, maxVialVolume: 50, amountEach: 10, count: 6 });
  assert.equal(serialized.amount_each, null);
  assert.equal(serialized.expected_volume_ul, 92);
  assert.equal(serialized.max_vial_volume_ul, 50);
  assert.equal(serialized.requested_count, 2);
});

for (const invalid of [0, "", -1, "not-a-number", null, undefined]) {
  test(`extraction rejects invalid expected volume: ${String(invalid)}`, () => {
    assert.throws(() => serializeProcessingOutput({ type: "DNA", mode: "EXTRACTION", sourceAllocation: 20, expectedVolume: invalid, maxVialVolume: 50 }), /Expected output volume must be a positive number/);
  });

  test(`extraction rejects invalid maximum vial volume: ${String(invalid)}`, () => {
    assert.throws(() => serializeProcessingOutput({ type: "DNA", mode: "EXTRACTION", sourceAllocation: 20, expectedVolume: 90, maxVialVolume: invalid }), /Maximum vial volume must be a positive number/);
  });
}
