import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeStemcellProduct, normalizeStemcellQuantity, parseStemcellCoa, shouldUseOcr } from "../inventory/js/stemcell-coa-parser.js";

const fixtureDirectory = new URL("./fixtures/stemcell_coa/", import.meta.url);
const expectedUrl = new URL("expected.json", fixtureDirectory);
const localFixturesAvailable = existsSync(fixtureDirectory) && existsSync(expectedUrl);
const expected = localFixturesAvailable ? JSON.parse(readFileSync(expectedUrl, "utf8")) : {};

function extractedText(pdfPath) {
  const embedded = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  let parsed = parseStemcellCoa(embedded);
  if (!shouldUseOcr(parsed)) return embedded;
  const directory = mkdtempSync(join(tmpdir(), "stemcell-coa-"));
  try {
    const prefix = join(directory, "page");
    execFileSync("pdftoppm", ["-png", "-r", "180", pdfPath, prefix]);
    const ocr = readdirSync(directory).filter((name) => name.endsWith(".png")).sort().map((name) => execFileSync("tesseract", [join(directory, name), "stdout"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).join("\n");
    return `${embedded}\n${ocr}`;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("all locally supplied STEMCELL COAs match reviewed JSON fixtures", { timeout: 120000, skip: localFixturesAvailable ? false : "local protected COA fixtures are not present" }, () => {
  const pdfNames = readdirSync(fixtureDirectory).filter((name) => name.endsWith(".pdf")).sort();
  assert.deepEqual(Object.keys(expected).sort(), pdfNames);
  for (const name of pdfNames) {
    const expectedFields = expected[name];
    const parsed = parseStemcellCoa(extractedText(fileURLToPath(new URL(name, fixtureDirectory))), { extractionMethod: "PDF_TEXT_PLUS_OCR" });
    const skip = new Set(expectedFields.requiresManualReview || []);
    for (const [field, expectedValue] of Object.entries(expectedFields)) {
      if (field === "requiresManualReview" || skip.has(field)) continue;
      assert.deepEqual(parsed[field], expectedValue, `${name}: ${field}`);
    }
  }
});

test("synthetic STEMCELL COA text extracts structured metadata", () => {
  const parsed = parseStemcellCoa(`Certificate of Analysis
Human Peripheral Blood Mononuclear Cells, Frozen
Catalog #: 70025
Lot #: TESTLOT001
Donor #: TST0001
Cell Processing Date: 2025-10-15
1 x 10^8 cells
Viability 99.8%
Age Sex Ethnicity Weight Height Smoker Blood Type Anticoagulant
30 Female Example Population 58 175 Yes A+ ACDA
Donor viral testing Negative Date of most recent viral testing 2025-10-10
CMV STATUS Negative DATE OF CMV TESTING 2025-10-10`);
  assert.equal(parsed.internalSampleType, "PBMC");
  assert.equal(parsed.catalogNumber, "70025");
  assert.equal(parsed.lotNumber, "TESTLOT001");
  assert.equal(parsed.donorId, "TST0001");
  assert.equal(parsed.processingDate, "2025-10-15");
  assert.equal(parsed.cellCountMillion, 100);
  assert.equal(parsed.viabilityPercent, 99.8);
  assert.deepEqual(parsed.donorMetadata, { age: 30, sex: "Female", ethnicity: "Example Population", weightKg: 58, heightCm: 175, smoker: "Yes", bloodType: "A+" });
  assert.equal(parsed.anticoagulant, "ACDA");
});

test("product mapping is explicit and ambiguous products remain unselected", () => {
  assert.equal(normalizeStemcellProduct("Human Peripheral Blood Mononuclear Cells, Frozen"), "PBMC");
  assert.equal(normalizeStemcellProduct("Human Bone Marrow Mononuclear Cells, Frozen"), "BMMNC");
  assert.equal(normalizeStemcellProduct("Human Peripheral Blood Serum, Frozen"), "SERUM");
  assert.equal(normalizeStemcellProduct("Uncharacterized Primary Cells"), null);
});

test("vendor quantities normalize while preserving the raw string", () => {
  assert.deepEqual(normalizeStemcellQuantity("1 x 10^8 cells", "PBMC"), { raw: "1 x 10^8 cells", cellCountMillion: 100, volumeUl: null });
  assert.deepEqual(normalizeStemcellQuantity("10 mL", "SERUM"), { raw: "10 mL", cellCountMillion: null, volumeUl: 10000 });
});

test("missing, malformed, and image-only text never fabricates values and requests OCR", () => {
  const parsed = parseStemcellCoa("Certificate of Analysis\nUnknown Product");
  assert.equal(parsed.internalSampleType, null);
  assert.equal(parsed.donorId, null);
  assert.ok(parsed.missingFields.includes("donorId"));
  assert.equal(shouldUseOcr(parsed), true);
  assert.equal(shouldUseOcr(parseStemcellCoa("")), true);
});
