import bwipjs from "https://esm.sh/@bwip-js/browser@4.7.0";
import { blackPixelRuns } from "./barcode-matrix.js";

export const BARCODE_FORMATS = Object.freeze({
  datamatrix: "datamatrix",
  qrcode: "qrcode",
});

const QUIET_ZONE_MODULES = 4;

function renderCanvas(text, format, scale, quietZoneModules = QUIET_ZONE_MODULES) {
  const canvas = document.createElement("canvas");
  bwipjs.toCanvas(canvas, {
    bcid: BARCODE_FORMATS[format] || format,
    text,
    scale,
    padding: quietZoneModules,
    backgroundcolor: "FFFFFF",
    includetext: false,
  });
  canvas.setAttribute("aria-label", `${format} barcode containing ${text}`);
  return canvas;
}

export function createCrispBarcodeCanvas(text, format, targetPx = 106) {
  const logical = renderCanvas(text, format, 1);
  const scale = Math.max(1, Math.floor(targetPx / Math.max(logical.width, logical.height)));
  const canvas = renderCanvas(text, format, scale);
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  canvas.style.imageRendering = "pixelated";
  return { canvas, scale, logicalWidth: logical.width, logicalHeight: logical.height };
}

export function drawBarcodeVectorToPdf(doc, text, format, xMm, yMm, sizeMm, quietZoneModules = QUIET_ZONE_MODULES) {
  const logical = renderCanvas(text, format, 1, quietZoneModules);
  const context = logical.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, logical.width, logical.height).data;
  const moduleMm = sizeMm / Math.max(logical.width, logical.height);
  const renderedWidthMm = logical.width * moduleMm;
  const renderedHeightMm = logical.height * moduleMm;
  const offsetX = xMm + (sizeMm - renderedWidthMm) / 2;
  const offsetY = yMm + (sizeMm - renderedHeightMm) / 2;

  doc.setFillColor(255, 255, 255);
  doc.rect(xMm, yMm, sizeMm, sizeMm, "F");
  doc.setFillColor(0, 0, 0);
  for (const run of blackPixelRuns(pixels, logical.width, logical.height)) {
    doc.rect(
      offsetX + run.startX * moduleMm,
      offsetY + run.y * moduleMm,
      run.length * moduleMm,
      moduleMm,
      "F",
    );
  }
  return { logicalWidth: logical.width, logicalHeight: logical.height, moduleMm };
}
