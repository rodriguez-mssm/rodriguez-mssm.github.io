const clean = (value) => value == null ? null : String(value).replace(/\s+/g, " ").trim() || null;
const first = (text, pattern) => clean(text.match(pattern)?.[1]);
const numberOrNull = (value) => value == null || value === "" ? null : Number(value);

export function normalizeStemcellProduct(productName) {
  const normalized = clean(productName)?.toLocaleLowerCase() || "";
  if (/peripheral blood mononuclear|\bpb\s*mnc\b/.test(normalized)) return "PBMC";
  if (/bone marrow mononuclear|\bbm\s*mnc\b/.test(normalized)) return "BMMNC";
  if (/\bserum\b/.test(normalized)) return "SERUM";
  if (/\bplasma\b/.test(normalized)) return "PLASMA";
  return null;
}

export function normalizeStemcellQuantity(rawValue, sampleType) {
  const raw = clean(rawValue);
  if (!raw) return { raw: null, cellCountMillion: null, volumeUl: null };
  if (["PBMC", "BMMNC", "SORTED_CELLS"].includes(sampleType)) {
    const match = raw.match(/(\d+(?:\.\d+)?)\s*[x×]\s*10\s*(?:\^|\*|A|%|°|4)?\s*([678])(?=\s*cells|\s|$)/i);
    if (!match) return { raw, cellCountMillion: null, volumeUl: null };
    return { raw, cellCountMillion: Number(match[1]) * (10 ** (Number(match[2]) - 6)), volumeUl: null };
  }
  const volume = raw.match(/(\d+(?:\.\d+)?)\s*(mL|µL|uL)\b/i);
  if (!volume) return { raw, cellCountMillion: null, volumeUl: null };
  return { raw, cellCountMillion: null, volumeUl: Number(volume[1]) * (/ml/i.test(volume[2]) ? 1000 : 1) };
}

function findProduct(text) {
  return first(text, /(?:Certificate of Analysis\s+)?([^\n]*(?:Mononuclear Cells|Blood Serum|Blood Plasma|PB\s*MNC)[^\n]*)/i)
    || first(text, /Product Description\s*:\s*([^\n]+)/i);
}

function lastPercentOnViabilityLine(text) {
  const line = text.split(/\r?\n/).find((item) => /Viability/i.test(item));
  const values = [...(line || "").matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
  return values.length ? values.at(-1) : null;
}

function parseDemographics(text) {
  const row = text.split(/\r?\n/).find((line) => /^\s*\d{1,3}\s+(?:Male|Female)\b/i.test(line) && /\b(?:Yes|No)\b/i.test(line));
  const match = row?.match(/^\s*(\d{1,3})\s+(Male|Female)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(Yes|No)\s+([ABO]{1,2}[+-])\s+(.+?)\s*$/i);
  if (!match) return { age: null, sex: null, ethnicity: null, weightKg: null, heightCm: null, smoker: null, bloodType: null, anticoagulant: null };
  return {
    age: Number(match[1]), sex: clean(match[2]), ethnicity: clean(match[3]),
    weightKg: Number(match[4]), heightCm: Number(match[5]), smoker: clean(match[6]),
    bloodType: clean(match[7]), anticoagulant: clean(match[8])?.replace(/AC\s+DA/i, "ACDA"),
  };
}

function statusAndDate(text, heading, dateHeading) {
  const start = text.search(heading);
  if (start < 0) return { status: null, date: null };
  const section = text.slice(start, start + 600);
  const date = first(section, new RegExp(`${dateHeading}[^0-9]*(\\d{4}-\\d{2}\\s*-?\\s*\\d{2})`, "i"))?.replace(/\s/g, "") || null;
  const statuses = [...section.matchAll(/\b(Negative|Positive)\b/gi)].map((match) => match[1]);
  return { status: statuses[0] || null, date };
}

export function parseStemcellCoa(rawText, options = {}) {
  const text = String(rawText || "").replace(/\u0000/g, "").replace(/\r/g, "");
  const vendorProductName = findProduct(text)?.replace(/\s+TECHNOLOG(?:Y|IES).*$/i, "") || null;
  const internalSampleType = normalizeStemcellProduct(vendorProductName);
  const rawQuantityText = first(text, /((?:\d+(?:\.\d+)?)\s*[x×]\s*10\s*(?:\^|\*|A|%|°|4)?\s*[678]\s*cells)/i)
    || first(text, /Volume\s*:\s*([^\n]+)/i);
  const quantity = normalizeStemcellQuantity(rawQuantityText, internalSampleType);
  const demographics = parseDemographics(text);
  const viral = statusAndDate(text, /Donor viral testing/i, "Date of most recent viral testing");
  const cmv = statusAndDate(text, /CMV STATUS/i, "DATE OF CMV TESTING");
  const parsed = {
    vendorProductName,
    internalSampleType,
    catalogNumber: first(text, /Catalog\s*#?\s*:?\s*([0-9][0-9.-]*)/i),
    lotNumber: first(text, /Lot\s*#?\s*:?\s*([A-Z0-9-]+)/i),
    donorId: first(text, /Donor\s*#?\s*:?\s*([A-Z]{1,4}[0-9]{4,})/i),
    processingDate: first(text, /Cell Processing Date\s*:?\s*(\d{4}-\d{2}-\d{2})/i),
    rawQuantityText: quantity.raw,
    cellCountMillion: quantity.cellCountMillion,
    volumeUl: quantity.volumeUl,
    viabilityPercent: lastPercentOnViabilityLine(text),
    viralTestingResult: viral.status,
    viralTestingDate: viral.date,
    cmvStatus: cmv.status,
    cmvTestingDate: cmv.date,
    donorMetadata: {
      age: demographics.age, sex: demographics.sex, ethnicity: demographics.ethnicity,
      weightKg: demographics.weightKg, heightCm: demographics.heightCm,
      smoker: demographics.smoker, bloodType: demographics.bloodType,
    },
    anticoagulant: demographics.anticoagulant,
  };
  const required = ["vendorProductName", "catalogNumber", "lotNumber", "donorId", "processingDate", "internalSampleType"];
  const missingFields = [...required, "quantity"].filter((field) => field === "quantity"
    ? parsed.cellCountMillion == null && parsed.volumeUl == null
    : parsed[field] == null);
  const extractionWarnings = [];
  if (!text.match(/Certificate of Analysis/i)) extractionWarnings.push("Document title was not recognized as a Certificate of Analysis.");
  if (!internalSampleType && vendorProductName) extractionWarnings.push("Product description did not map unambiguously to an internal sample type; select it during review.");
  if (missingFields.length) extractionWarnings.push(`Missing or unreadable fields: ${missingFields.join(", ")}.`);
  if (options.extractionMethod === "PDF_TEXT_PLUS_OCR") extractionWarnings.push("OCR fallback was used; every extracted value requires visual comparison with the COA.");
  return {
    ...parsed,
    missingFields,
    extractionWarnings,
    parserConfidence: options.extractionMethod === "PDF_TEXT_PLUS_OCR" ? "REVIEW" : missingFields.length === 0 ? "HIGH" : missingFields.length <= 3 ? "REVIEW" : "LOW",
    extractionMethod: options.extractionMethod || "PDF_TEXT",
    rawExtractedText: text,
  };
}

export function shouldUseOcr(parsed) {
  return parsed.parserConfidence === "LOW" || !parsed.internalSampleType || !parsed.catalogNumber
    || !parsed.lotNumber || !parsed.donorId || !parsed.processingDate;
}
