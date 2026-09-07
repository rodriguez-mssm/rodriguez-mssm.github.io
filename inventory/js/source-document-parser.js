import { parseStemcellCoa, shouldUseOcr } from "./stemcell-coa-parser.js";

const PDFJS_VERSION = "4.10.38";
const TESSERACT_VERSION = "6.0.1";

async function loadPdf(file) {
  const pdfjs = await import(`https://esm.sh/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
  return pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
}

function layoutText(items) {
  const lines = [];
  for (const item of items.filter(({ str }) => str?.trim())) {
    const x = item.transform[4]; const y = item.transform[5];
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < 2);
    if (!line) { line = { y, items: [] }; lines.push(line); }
    line.items.push({ x, text: item.str });
  }
  return lines.sort((a, b) => b.y - a.y).map((line) => line.items.sort((a, b) => a.x - b.x).map(({ text }) => text).join("  ")).join("\n");
}

async function extractEmbeddedText(pdf) {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push(layoutText((await page.getTextContent()).items));
  }
  return pages.join("\n\n");
}

async function extractOcrText(pdf, onProgress) {
  const { createWorker } = await import(`https://esm.sh/tesseract.js@${TESSERACT_VERSION}`);
  const worker = await createWorker("eng", 1, { logger: (message) => onProgress?.(message) });
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      pages.push((await worker.recognize(canvas)).data.text);
    }
  } finally { await worker.terminate(); }
  return pages.join("\n\n");
}

export async function parseSourceDocument(profile, file, onProgress) {
  if (profile !== "STEMCELL_COA") throw new Error(`No document parser is configured for ${profile}`);
  if (file.type !== "application/pdf") throw new Error("The STEMCELL COA must be a PDF");
  const pdf = await loadPdf(file);
  const embeddedText = await extractEmbeddedText(pdf);
  let parsed = parseStemcellCoa(embeddedText, { extractionMethod: "PDF_TEXT" });
  if (shouldUseOcr(parsed)) {
    onProgress?.({ status: "OCR_FALLBACK", progress: 0 });
    const ocrText = await extractOcrText(pdf, onProgress);
    parsed = parseStemcellCoa(`${embeddedText}\n${ocrText}`, { extractionMethod: "PDF_TEXT_PLUS_OCR" });
  }
  return parsed;
}
