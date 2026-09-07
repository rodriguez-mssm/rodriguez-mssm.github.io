import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { blackPixelRuns } from "../inventory/js/barcode-matrix.js";

test("black pixel matrix is converted to exact integer vector runs", () => {
  const white = [255, 255, 255, 255];
  const black = [0, 0, 0, 255];
  const pixels = new Uint8ClampedArray([
    ...white, ...black, ...black, ...white,
    ...black, ...white, ...black, ...black,
  ]);
  assert.deepEqual(blackPixelRuns(pixels, 4, 2), [
    { y: 0, startX: 1, length: 2 },
    { y: 1, startX: 0, length: 1 },
    { y: 1, startX: 2, length: 2 },
  ]);
});

test("PDF label pipeline contains no raster barcode encoding", async () => {
  const labels = await readFile(new URL("../inventory/js/labels.js", import.meta.url), "utf8");
  assert.match(labels, /drawBarcodeVectorToPdf/);
  assert.doesNotMatch(labels, /toDataURL|addImage|PNG|JPEG/i);
});

test("diagnostic page compares native browser Data Matrix and QR with vector PDF", async () => {
  const html = await readFile(new URL("../inventory/barcode-diagnostic.html", import.meta.url), "utf8");
  assert.match(html, /Browser Data Matrix/);
  assert.match(html, /Browser QR/);
  assert.match(html, /28 mm vector PDF comparison/);
  assert.match(html, /PBMC-000001/);
});
