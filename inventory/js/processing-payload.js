import { plannedVialCount } from "./calculations.js";

export function buildProcessingPlanPayload(sourceSampleId, notes, outputs) {
  if (!sourceSampleId) throw new Error("A source sample is required");
  if (!Array.isArray(outputs) || outputs.length === 0) throw new Error("At least one output is required");
  return {
    source_sample_id: sourceSampleId,
    notes: notes || null,
    outputs: outputs.map(serializeProcessingOutput),
  };
}

export function serializeProcessingOutput(output) {
  const sourceAllocation = positiveNumber(output.sourceAllocation, "Source input allocation");
  if (output.mode === "EXTRACTION") {
    const expectedVolume = positiveNumber(output.expectedVolume, "Expected output volume");
    const maxVialVolume = positiveNumber(output.maxVialVolume, "Maximum vial volume");
    return {
      output_type: output.type,
      operation_type: "EXTRACTION",
      source_allocation: sourceAllocation,
      amount_each: null,
      requested_count: plannedVialCount(expectedVolume, maxVialVolume),
      expected_volume_ul: expectedVolume,
      max_vial_volume_ul: maxVialVolume,
    };
  }

  if (output.mode !== "ALIQUOT") throw new Error(`Unsupported operation type: ${output.mode}`);
  const amountEach = positiveNumber(output.amountEach, "Amount per sample");
  const count = positiveInteger(output.count, "Sample count");
  if (sourceAllocation !== amountEach * count) throw new Error("Aliquot allocation must equal amount per sample × sample count");
  return {
    output_type: output.type,
    operation_type: "ALIQUOT",
    source_allocation: sourceAllocation,
    amount_each: amountEach,
    requested_count: count,
    expected_volume_ul: null,
    max_vial_volume_ul: null,
  };
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (value === null || value === "" || !Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}
