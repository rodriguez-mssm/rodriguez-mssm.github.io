import { jsPDF } from "https://esm.sh/jspdf@3.0.2";
import bwipjs from "https://esm.sh/@bwip-js/browser@4.7.0";
import { LABEL_CONFIG } from "./label-config.js";

function barcodeDataUrl(text, format) {
  const canvas = document.createElement("canvas");
  bwipjs.toCanvas(canvas, { bcid: format, text, scale: 3, padding: 0, includetext: false });
  return canvas.toDataURL("image/png");
}

export async function generateLabelPdf(samples, options = {}) {
  if (!samples.length) throw new Error("No labels selected");
  const config = { ...LABEL_CONFIG, ...options };
  const doc = new jsPDF({ unit: "mm", format: config.page.format, orientation: "portrait", compress: true });
  const perPage = config.grid.rows * config.grid.columns;
  samples.forEach((sample, index) => {
    if (index && index % perPage === 0) doc.addPage();
    const pageIndex = index % perPage;
    const row = Math.floor(pageIndex / config.grid.columns);
    const column = pageIndex % config.grid.columns;
    const x = config.margins.leftMm + column * (config.label.widthMm + config.gaps.horizontalMm);
    const y = config.margins.topMm + row * (config.label.heightMm + config.gaps.verticalMm);
    doc.setDrawColor(205, 215, 212).rect(x, y, config.label.widthMm, config.label.heightMm);
    const codeSize = Math.min(config.barcode.sizeMm, config.label.heightMm - 4);
    let barcode;
    try { barcode = barcodeDataUrl(sample.sample_id, config.barcode.format); }
    catch { barcode = barcodeDataUrl(sample.sample_id, config.barcode.fallbackFormat); }
    doc.addImage(barcode, "PNG", x + 2, y + 2, codeSize, codeSize);
    doc.setTextColor(15, 44, 38).setFont("helvetica", "bold").setFontSize(8.5);
    doc.text(sample.sample_id, x + codeSize + 4, y + 7, { maxWidth: config.label.widthMm - codeSize - 6 });
    doc.setFont("helvetica", "normal").setFontSize(7);
    doc.text(sample.sample_type, x + codeSize + 4, y + 12);
    const amount = sample.planned_label_text || quantityLabel(sample);
    if (amount) doc.text(amount, x + codeSize + 4, y + 17, { maxWidth: config.label.widthMm - codeSize - 6 });
  });
  doc.save(`inventory-labels-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function quantityLabel(sample) {
  if (sample.planned_cell_count_million != null) return `${sample.planned_cell_count_million}M cells`;
  if (sample.planned_volume_ul != null) return `${sample.planned_volume_ul} µL planned`;
  if (sample.current_cell_count_million != null) return `${sample.current_cell_count_million}M cells`;
  if (sample.current_volume_ul != null) return `${sample.current_volume_ul} µL`;
  return "";
}
