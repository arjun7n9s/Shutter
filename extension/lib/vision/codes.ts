import { assetUrl } from "./ort";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import type { Detection, Frame, VisionModel } from "./types";

/**
 * QR / PDF417 / Data Matrix / Aztec via zxing-cpp compiled to WASM. Chrome's BarcodeDetector
 * is unavailable on Windows and Linux desktop, and Aadhaar Secure QR is the main target here.
 */
export class CodeDetector implements VisionModel {
  readonly name = "zxing-wasm";
  private ready = false;

  async load(): Promise<boolean> {
    if (!this.ready) {
      await prepareZXingModule({
        overrides: { locateFile: (path: string) => assetUrl(`/zxing/${path}`) },
        fireImmediately: true,
      });
      this.ready = true;
    }
    return true;
  }

  async detect(frame: Frame): Promise<Detection[]> {
    const results = await readBarcodes(frame.image, {
      formats: ["QRCode", "MicroQRCode", "PDF417", "DataMatrix", "Aztec"],
      tryHarder: true,
      maxNumberOfSymbols: 16,
    });
    return results
      .filter((r) => r.isValid)
      .map((r) => {
        const p = r.position;
        const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
        const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
        const x0 = Math.min(...xs) / frame.scale;
        const y0 = Math.min(...ys) / frame.scale;
        const w = Math.max(...xs) / frame.scale - x0;
        const h = Math.max(...ys) / frame.scale - y0;
        // Include the quiet zone so no finder pattern survives.
        const m = Math.max(w, h) * 0.12;
        return {
          rect: { x: x0 - m, y: y0 - m, w: w + 2 * m, h: h + 2 * m },
          cls: r.format.startsWith("QR") || r.format.includes("QR") ? ("QR" as const) : ("BARCODE" as const),
          score: 1,
          model: this.name,
        };
      });
  }
}
