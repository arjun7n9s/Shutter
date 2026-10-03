import { browser } from "wxt/browser";
import * as ort from "onnxruntime-web";

let configured = false;

/** Optional, generated assets are not in WXT's typed PublicPath list. */
export const assetUrl = (path: string): string => (browser.runtime.getURL as (p: string) => string)(path);

/** ORT must load its WASM from the extension package: no CDN, and extension pages are not cross-origin isolated. */
export function configureOrt(): typeof ort {
  if (!configured) {
    ort.env.wasm.wasmPaths = assetUrl("/ort/");
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    configured = true;
  }
  return ort;
}

export async function assetExists(path: string): Promise<boolean> {
  try {
    const r = await fetch(assetUrl(path), { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function createSession(path: string): Promise<{ session: ort.InferenceSession; backend: string }> {
  const o = configureOrt();
  const url = assetUrl(path);
  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  if (hasGpu) {
    try {
      return { session: await o.InferenceSession.create(url, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" }), backend: "webgpu" };
    } catch {
      /* fall through to wasm */
    }
  }
  return { session: await o.InferenceSession.create(url, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }), backend: "wasm" };
}

/** Letterboxes an RGBA frame to `size`x`size` (top-left anchored) into planar float32. */
export function letterbox(
  img: ImageData,
  size: number,
  opts: { bgr?: boolean; mean?: [number, number, number]; std?: [number, number, number]; scale255?: boolean; stretch?: boolean } = {},
): { data: Float32Array; ratio: number } {
  const ratio = Math.min(size / img.width, size / img.height);
  const w = opts.stretch ? size : Math.round(img.width * ratio);
  const h = opts.stretch ? size : Math.round(img.height * ratio);
  const src = new OffscreenCanvas(img.width, img.height);
  src.getContext("2d")!.putImageData(img, 0, 0);
  const dst = new OffscreenCanvas(size, size);
  const ctx = dst.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, size, size).data;
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  const mean = opts.mean ?? [0, 0, 0];
  const std = opts.std ?? [1, 1, 1];
  const div = opts.scale255 ? 255 : 1;
  for (let i = 0; i < plane; i++) {
    const r = px[i * 4]! / div;
    const g = px[i * 4 + 1]! / div;
    const b = px[i * 4 + 2]! / div;
    const [c0, c1, c2] = opts.bgr ? [b, g, r] : [r, g, b];
    out[i] = (c0 - mean[0]) / std[0];
    out[plane + i] = (c1 - mean[1]) / std[1];
    out[2 * plane + i] = (c2 - mean[2]) / std[2];
  }
  return { data: out, ratio };
}
