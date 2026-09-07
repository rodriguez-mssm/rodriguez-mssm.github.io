import { jsPDF } from "https://esm.sh/jspdf@3.0.2";
import { LABEL_CONFIG } from "./label-config.js?v=202609070003";
import { coordinateForPosition, labelCapacity, planLabelPositions } from "./label-layout.js?v=202609070003";
import { drawBarcodeVectorToPdf } from "./barcode-renderer.js?v=202609070003";

function createDocument(config = LABEL_CONFIG) {
  return new jsPDF({ unit: "mm", format: [config.page.widthMm, config.page.heightMm], orientation: config.page.orientation, compress: true });
}

function fitSampleId(doc, text, maxWidthMm, config) {
  let size = config.fonts.sampleIdPt;
  doc.setFont("helvetica", "bold").setFontSize(size);
  while (size > config.fonts.sampleIdMinPt && doc.getTextWidth(text) > maxWidthMm) {
    size -= 0.25;
    doc.setFontSize(size);
  }
}

function drawSampleLabel(doc, sample, placement, config) {
  const { xMm: x, yMm: y } = placement;
  const inset = config.content.horizontalInsetMm;
  const codeSize = config.barcode.sizeMm;
  const codeX = x + inset;
  const codeY = y + (config.label.heightMm - codeSize) / 2;
  try {
    drawBarcodeVectorToPdf(doc, sample.sample_id, config.barcode.format, codeX, codeY, codeSize, config.barcode.quietZoneModules);
  } catch {
    drawBarcodeVectorToPdf(doc, sample.sample_id, config.barcode.fallbackFormat, codeX, codeY, codeSize, config.barcode.quietZoneModules);
  }

  const textX = codeX + codeSize + config.content.barcodeTextGapMm;
  const textWidth = x + config.label.widthMm - inset - textX;
  doc.setTextColor(0, 0, 0);
  fitSampleId(doc, sample.sample_id, textWidth, config);
  doc.text(sample.sample_id, textX, y + config.content.sampleIdBaselineMm, { maxWidth: textWidth });

  const amount = sample.planned_label_text || quantityLabel(sample);
  const detail = amount ? `${sample.sample_type} ${amount}` : sample.sample_type;
  doc.setFont("helvetica", "normal").setFontSize(config.fonts.detailPt);
  doc.text(detail, textX, y + config.content.detailBaselineMm, { maxWidth: textWidth });
}

export async function generateLabelPdf(samples, options = {}) {
  if (!samples.length) throw new Error("No labels selected");
  const config = options.config || LABEL_CONFIG;
  const placements = planLabelPositions(samples.length, options, config);
  const doc = createDocument(config);
  let currentPage = 0;
  samples.forEach((sample, index) => {
    const placement = placements[index];
    while (currentPage < placement.pageIndex) { doc.addPage(); currentPage += 1; }
    drawSampleLabel(doc, sample, placement, config);
  });
  doc.save(`inventory-labels-${new Date().toISOString().slice(0, 10)}.pdf`);
  return { pageCount: currentPage + 1, placements };
}

export async function generateCalibrationPdf(config = LABEL_CONFIG) {
  const doc = createDocument(config);
  const calibration = config.calibration;
  doc.setLineWidth(calibration.boundaryLineWidthMm).setDrawColor(20, 90, 80).setTextColor(20, 70, 65);
  for (let position = 1; position <= labelCapacity(config); position += 1) {
    const item = coordinateForPosition(position, config);
    doc.rect(item.xMm, item.yMm, config.label.widthMm, config.label.heightMm);
    doc.setFont("helvetica", "bold").setFontSize(config.fonts.calibrationPositionPt);
    doc.text(String(position), item.xMm + config.label.widthMm / 2, item.yMm + config.label.heightMm / 2, { align: "center", baseline: "middle" });
    doc.setFont("helvetica", "normal").setFontSize(config.fonts.calibrationMarkerPt);
    doc.text(`R${item.row} C${item.column}`, item.xMm + calibration.markerXInsetMm, item.yMm + calibration.markerBaselineMm);
  }
  const rulerStart = config.margins.leftMm;
  const rulerEnd = rulerStart + calibration.rulerLengthMm;
  doc.setLineWidth(calibration.rulerLineWidthMm).setDrawColor(0, 0, 0);
  doc.line(rulerStart, calibration.rulerYmm, rulerEnd, calibration.rulerYmm);
  doc.line(rulerStart, calibration.rulerYmm - calibration.rulerTickHalfHeightMm, rulerStart, calibration.rulerYmm + calibration.rulerTickHalfHeightMm);
  doc.line(rulerEnd, calibration.rulerYmm - calibration.rulerTickHalfHeightMm, rulerEnd, calibration.rulerYmm + calibration.rulerTickHalfHeightMm);
  doc.setFontSize(config.fonts.calibrationRulerPt).text(`${calibration.rulerLengthMm} mm calibration`, rulerStart + calibration.rulerLengthMm / 2, calibration.rulerTextYmm, { align: "center" });
  doc.save("cryolabel-calibration-sheet.pdf");
}

export async function generateBarcodeDiagnosticPdf(sampleId = "PBMC-000001") {
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait", compress: true });
  doc.setTextColor(15, 44, 38).setFont("helvetica", "bold").setFontSize(15);
  doc.text("Barcode rendering diagnostic", 20, 20);
  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text(`${sampleId} - vector PDF geometry - 28 mm square`, 20, 28);
  drawBarcodeVectorToPdf(doc, sampleId, "datamatrix", 20, 38, 28);
  drawBarcodeVectorToPdf(doc, sampleId, "qrcode", 65, 38, 28);
  doc.text("Data Matrix", 20, 70);
  doc.text("QR", 65, 70);
  doc.save(`barcode-diagnostic-${sampleId}.pdf`);
}

function quantityLabel(sample) {
  if (sample.planned_cell_count_million != null) return `${sample.planned_cell_count_million}M`;
  if (sample.planned_volume_ul != null) return `${sample.planned_volume_ul} µL`;
  if (sample.current_cell_count_million != null) return `${sample.current_cell_count_million}M`;
  if (sample.current_volume_ul != null) return `${sample.current_volume_ul} µL`;
  return "";
}
