export const SAMPLE_TYPES = Object.freeze({
  PBMC: { label: "PBMC", prefix: "PBMC", dimension: "CELLS", unit: "million cells" },
  BMMNC: { label: "BMMNC", prefix: "BMMNC", dimension: "CELLS", unit: "million cells" },
  SORTED_CELLS: { label: "Sorted cells", prefix: "SC", dimension: "CELLS", unit: "million cells" },
  SERUM: { label: "Serum", prefix: "SERUM", dimension: "VOLUME", unit: "µL" },
  PLASMA: { label: "Plasma", prefix: "PLASMA", dimension: "VOLUME", unit: "µL" },
  DNA: { label: "DNA", prefix: "DNA", dimension: "NUCLEIC_ACID", unit: "µL" },
  RNA: { label: "RNA", prefix: "RNA", dimension: "NUCLEIC_ACID", unit: "µL" },
});

export function typeConfig(type) {
  const config = SAMPLE_TYPES[type];
  if (!config) throw new Error(`Unsupported sample type: ${type}`);
  return config;
}

export function availableQuantity(sample) {
  const dimension = typeConfig(sample.sample_type).dimension;
  return dimension === "CELLS" ? Number(sample.current_cell_count_million ?? 0) : Number(sample.current_volume_ul ?? 0);
}

export function formatQuantity(sample) {
  const config = typeConfig(sample.sample_type);
  const value = availableQuantity(sample);
  return `${value.toLocaleString()} ${config.unit}`;
}
