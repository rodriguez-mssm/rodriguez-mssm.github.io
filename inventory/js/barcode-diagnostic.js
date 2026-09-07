import { createCrispBarcodeCanvas } from "./barcode-renderer.js";

const SAMPLE_ID = "PBMC-000001";

try {
  for (const [format, containerId, detailsId] of [
    ["datamatrix", "browser-datamatrix", "datamatrix-details"],
    ["qrcode", "browser-qr", "qr-details"],
  ]) {
    const result = createCrispBarcodeCanvas(SAMPLE_ID, format, 110);
    document.querySelector(`#${containerId}`).append(result.canvas);
    document.querySelector(`#${detailsId}`).textContent = `${result.canvas.width} × ${result.canvas.height} native pixels; integer scale ${result.scale}; logical grid including quiet zone ${result.logicalWidth} × ${result.logicalHeight}. No CSS resampling.`;
  }
} catch (error) {
  document.querySelector("#diagnostic-status").innerHTML = `<span class="error">Browser barcode generation failed: ${String(error.message || error)}</span>`;
}

document.querySelector("#generate-pdf").addEventListener("click", async () => {
  const status = document.querySelector("#diagnostic-status");
  try {
    const { generateBarcodeDiagnosticPdf } = await import("./labels.js");
    await generateBarcodeDiagnosticPdf(SAMPLE_ID);
    status.innerHTML = '<span class="success">Generated a PDF with native vector rectangles; no PNG or JPEG is embedded.</span>';
  } catch (error) {
    status.innerHTML = `<span class="error">PDF generation failed: ${String(error.message || error)}</span>`;
  }
});
