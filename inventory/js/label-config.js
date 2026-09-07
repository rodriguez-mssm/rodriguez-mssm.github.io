export const DXA_PER_INCH = 1440;
export const MM_PER_INCH = 25.4;
export const dxaToMm = (dxa) => dxa * MM_PER_INCH / DXA_PER_INCH;

// Authoritative geometry: CryoLabel_Template.docx word/document.xml.
// Keeping the source DXA values here avoids drift from rounded measurements.
const TEMPLATE_DXA = Object.freeze({
  pageWidth: 12240,
  pageHeight: 15840,
  sectionMarginTop: 340,
  sectionMarginLeft: 1106,
  tableIndent: -15,
  labelWidth: 1872,
  labelHeight: 737,
  horizontalGap: 168,
  verticalGap: 170,
  cellHorizontalMargin: 15,
  paragraphHorizontalIndent: 47,
});

const leftDxa = TEMPLATE_DXA.sectionMarginLeft + TEMPLATE_DXA.tableIndent;
const gridWidthDxa = 5 * TEMPLATE_DXA.labelWidth + 4 * TEMPLATE_DXA.horizontalGap;
const gridHeightDxa = 17 * TEMPLATE_DXA.labelHeight + 16 * TEMPLATE_DXA.verticalGap;

export const LABEL_CONFIG = Object.freeze({
  name: "CryoLabel Template",
  sourceDxa: TEMPLATE_DXA,
  page: Object.freeze({ format: "letter", orientation: "portrait", widthMm: dxaToMm(TEMPLATE_DXA.pageWidth), heightMm: dxaToMm(TEMPLATE_DXA.pageHeight) }),
  label: Object.freeze({ widthMm: dxaToMm(TEMPLATE_DXA.labelWidth), heightMm: dxaToMm(TEMPLATE_DXA.labelHeight) }),
  grid: Object.freeze({ rows: 17, columns: 5, capacity: 85 }),
  margins: Object.freeze({
    topMm: dxaToMm(TEMPLATE_DXA.sectionMarginTop),
    leftMm: dxaToMm(leftDxa),
    rightMm: dxaToMm(TEMPLATE_DXA.pageWidth - leftDxa - gridWidthDxa),
    bottomMm: dxaToMm(TEMPLATE_DXA.pageHeight - TEMPLATE_DXA.sectionMarginTop - gridHeightDxa),
  }),
  gaps: Object.freeze({ horizontalMm: dxaToMm(TEMPLATE_DXA.horizontalGap), verticalMm: dxaToMm(TEMPLATE_DXA.verticalGap) }),
  content: Object.freeze({
    horizontalInsetMm: dxaToMm(TEMPLATE_DXA.cellHorizontalMargin + TEMPLATE_DXA.paragraphHorizontalIndent),
    barcodeTextGapMm: 0.9,
    sampleIdBaselineMm: 4.6,
    detailBaselineMm: 8.5,
  }),
  barcode: Object.freeze({ format: "datamatrix", fallbackFormat: "qrcode", sizeMm: 9.5, quietZoneModules: 4 }),
  fonts: Object.freeze({ sampleIdPt: 7.5, sampleIdMinPt: 6, detailPt: 6, calibrationPositionPt: 7, calibrationMarkerPt: 4.5, calibrationRulerPt: 5 }),
  calibration: Object.freeze({
    boundaryLineWidthMm: 0.15,
    markerXInsetMm: 1,
    markerBaselineMm: 2.2,
    rulerLengthMm: 20,
    rulerYmm: 3,
    rulerTickHalfHeightMm: 1,
    rulerTextYmm: 2.2,
    rulerLineWidthMm: 0.25,
  }),
  physicalCalibrationVerified: false,
});
