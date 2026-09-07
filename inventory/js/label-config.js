export const LABEL_CONFIG = Object.freeze({
  page: { format: "letter", widthMm: 215.9, heightMm: 279.4 },
  label: { widthMm: 50, heightMm: 25 },
  grid: { rows: 10, columns: 4 },
  margins: { topMm: 10, leftMm: 5 },
  gaps: { horizontalMm: 2, verticalMm: 1 },
  barcode: { format: "datamatrix", sizeMm: 17, fallbackFormat: "qrcode" },
});
