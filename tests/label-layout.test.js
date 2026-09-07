import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LABEL_CONFIG, dxaToMm } from "../inventory/js/label-config.js";
import { assertCoordinatesWithinPage, coordinateForPosition, labelCapacity, planLabelPositions, positionToGrid } from "../inventory/js/label-layout.js";

test("reference DOCX retains the authoritative CryoLabel geometry", () => {
  const path = fileURLToPath(new URL("../inventory/label-templates/cryolabel/CryoLabel_Template.docx", import.meta.url));
  assert.equal(existsSync(path), true);
  const xml = execFileSync("unzip", ["-p", path, "word/document.xml"], { encoding: "utf8" });
  assert.match(xml, /<w:pgSz w:w="12240" w:h="15840"\/>/);
  assert.match(xml, /<w:pgMar w:top="340" w:right="1106" w:bottom="0" w:left="1106"/);
  assert.deepEqual([...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].slice(0, 9).map((match) => Number(match[1])), [1872,168,1872,168,1872,168,1872,168,1872]);
  assert.equal((xml.match(/<w:trHeight w:hRule="exact" w:val="737"\/>/g) || []).length, 17);
  assert.equal((xml.match(/<w:trHeight w:hRule="exact" w:val="170"\/>/g) || []).length, 16);
});

test("CryoLabel configuration converts exact DXA dimensions deterministically", () => {
  assert.equal(LABEL_CONFIG.name, "CryoLabel Template");
  assert.equal(LABEL_CONFIG.page.widthMm, 215.9);
  assert.equal(LABEL_CONFIG.page.heightMm, 279.4);
  assert.equal(LABEL_CONFIG.label.widthMm, dxaToMm(1872));
  assert.equal(LABEL_CONFIG.label.heightMm, dxaToMm(737));
  assert.equal(LABEL_CONFIG.margins.leftMm, dxaToMm(1091));
  assert.equal(LABEL_CONFIG.grid.capacity, 85);
  assert.equal(labelCapacity(), 85);
  assert.equal(LABEL_CONFIG.physicalCalibrationVerified, false);
});

test("positions map row-major across five columns and seventeen rows", () => {
  assert.deepEqual(positionToGrid(1), { position: 1, row: 1, column: 1 });
  assert.deepEqual(positionToGrid(5), { position: 5, row: 1, column: 5 });
  assert.deepEqual(positionToGrid(6), { position: 6, row: 2, column: 1 });
  assert.deepEqual(positionToGrid(85), { position: 85, row: 17, column: 5 });
});

test("partial sheets use requested positions and reject silent overflow", () => {
  assert.deepEqual(planLabelPositions(10, { startPosition: 13 }).map(({ position }) => position), [13,14,15,16,17,18,19,20,21,22]);
  assert.equal(planLabelPositions(6, { startPosition: 80 }).at(-1).position, 85);
  assert.throws(() => planLabelPositions(7, { startPosition: 80 }), /only 6 positions remain/);
});

test("multi-page printing occurs only when explicitly enabled", () => {
  assert.throws(() => planLabelPositions(100, { startPosition: 1 }), /only 85 positions remain/);
  const plan = planLabelPositions(100, { startPosition: 1, multiPage: true });
  assert.equal(plan.filter(({ pageIndex }) => pageIndex === 0).length, 85);
  assert.equal(plan.filter(({ pageIndex }) => pageIndex === 1).length, 15);
  assert.equal(plan.at(-1).position, 15);
});

test("all 85 label rectangles remain within the physical page", () => {
  assert.equal(assertCoordinatesWithinPage(), true);
  const last = coordinateForPosition(85);
  assert.ok(last.xMm + LABEL_CONFIG.label.widthMm <= LABEL_CONFIG.page.widthMm);
  assert.ok(last.yMm + LABEL_CONFIG.label.heightMm <= LABEL_CONFIG.page.heightMm);
});

test("routine labels remain vector-only and calibration marks every position", () => {
  const labels = readFileSync(new URL("../inventory/js/labels.js", import.meta.url), "utf8");
  assert.match(labels, /drawBarcodeVectorToPdf/);
  assert.match(labels, /generateCalibrationPdf/);
  assert.match(labels, /position <= labelCapacity\(config\)/);
  assert.doesNotMatch(labels, /addImage|toDataURL|JPEG|PNG/);
});
