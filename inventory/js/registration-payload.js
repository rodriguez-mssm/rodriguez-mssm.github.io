const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildSourceSamplePayload(values) {
  const sampleSourceId = String(values.sampleSourceId || "").trim();
  const sampleLocation = String(values.sampleLocation || "").trim();
  if (!UUID_PATTERN.test(sampleSourceId)) throw new Error("Select a valid Sample Source");
  if (sampleLocation.length > 200) throw new Error("Sample location must be 200 characters or fewer");
  return {
    sample_source_id: sampleSourceId,
    sample_type: values.sampleType,
    external_id: values.externalId || null,
    sample_location: sampleLocation || null,
    cell_count_million: values.cellCount,
    volume_ul: values.volume,
    concentration_ng_ul: values.concentration,
    notes: values.notes || null,
  };
}
