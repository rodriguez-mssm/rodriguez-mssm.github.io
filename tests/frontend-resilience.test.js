import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { emptyInventoryHtml, scannerUnavailableHtml } from "../inventory/js/ui-state.js";

test("approved user with zero search results sees an empty inventory state", () => {
  const html = emptyInventoryHtml();
  assert.match(html, /No samples found/i);
  assert.doesNotMatch(html, /Loading inventory/i);
});

test("scanner dependency is lazy and failure preserves manual entry", async () => {
  const app = await readFile(new URL("../inventory/js/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /^import .*scanner\.js/m);
  assert.match(app, /await import\("\.\/scanner\.js"\)/);
  assert.match(app, /id="manual-scan"/);
  const error = scannerUnavailableHtml("dependency unavailable");
  assert.match(error, /dependency unavailable/);
  assert.match(error, /Manual Sample ID entry remains available/);
  assert.doesNotMatch(error, /Loading inventory/i);
});

test("ZXing enums come from the compatible pinned library package", async () => {
  const scanner = await readFile(new URL("../inventory/js/scanner.js", import.meta.url), "utf8");
  assert.match(scanner, /BrowserMultiFormatReader.*@zxing\/browser@0\.1\.5/s);
  assert.match(scanner, /BarcodeFormat, DecodeHintType.*@zxing\/library@0\.21\.3/s);
  assert.doesNotMatch(scanner, /BrowserMultiFormatReader, BarcodeFormat, DecodeHintType/);
});
