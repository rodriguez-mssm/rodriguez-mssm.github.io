export function normalizeSampleSource(input) {
  return {
    name: String(input.name || "").trim(),
    nickname: String(input.nickname || "").trim(),
    url: String(input.url || "").trim() || null,
  };
}

export function validateSampleSource(input) {
  const source = normalizeSampleSource(input);
  if (!source.name) throw new Error("Sample Source name is required");
  if (!source.nickname) throw new Error("Sample Source nickname is required");
  if (source.url) {
    let parsed;
    try { parsed = new URL(source.url); }
    catch { throw new Error("URL must be a valid http:// or https:// URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("URL must use http:// or https://");
  }
  return source;
}

export function filterSampleSources(sources, term) {
  const query = String(term || "").trim().toLocaleLowerCase();
  if (!query) return sources;
  return sources.filter((source) => source.nickname.toLocaleLowerCase().includes(query) || source.name.toLocaleLowerCase().includes(query));
}
