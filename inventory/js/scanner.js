import { BrowserMultiFormatReader } from "https://esm.sh/@zxing/browser@0.1.5";
import { BarcodeFormat, DecodeHintType } from "https://esm.sh/@zxing/library@0.21.3";

export class SampleScanner {
  constructor(element, onScan) {
    this.element = element;
    this.onScan = onScan;
    this.controls = null;
    this.last = { value: null, at: 0 };
  }

  async start() {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
    const video = document.createElement("video");
    video.setAttribute("playsinline", "true");
    this.element.replaceChildren(video);
    this.controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: "environment" } } }, video, (result) => {
      if (!result) return;
      const value = result.getText().trim().toUpperCase();
      const now = Date.now();
      if (this.last.value === value && now - this.last.at < 2500) return;
      this.last = { value, at: now };
      navigator.vibrate?.(80);
      this.onScan(value);
    });
  }

  stop() { this.controls?.stop(); this.controls = null; this.element?.replaceChildren(); }
}
