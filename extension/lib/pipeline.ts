import { browser } from "wxt/browser";
import { planRedactions, rectsStable, type RedactionItem, type TokenVault } from "@parda/core";
import { redactionItems } from "./items";
import { ask } from "./messages";
import type { Perception } from "./perceive";
import { renderRedacted, type RedactedFrame } from "./render";
import type { Detection, VisionModel } from "./vision/types";

export interface VisionStack {
  models: VisionModel[];
  /** Name of a loaded face-capable model, if any. */
  faceModel: boolean;
}

export interface CaptureOptions {
  /** Mask every image/video/canvas regardless of what the vision models find. */
  strictMedia: boolean;
}

export interface Captured {
  frame: RedactedFrame;
  perception: Perception;
  detections: Detection[];
  items: RedactionItem[];
  timings: Record<"perceive" | "capture" | "vision" | "render" | "total", number>;
}

const MIN_CAPTURE_INTERVAL_MS = 550;
let lastCapture = 0;

async function isActive(tabId: number, windowId: number): Promise<boolean> {
  const [active] = await browser.tabs.query({ active: true, windowId });
  return active?.id === tabId;
}

/**
 * captureVisibleTab captures whatever tab is in front, so the perceived tab must be in front before,
 * and no tab switch in this window may happen until after, the capture (A -> B -> A would pass both checks).
 */
async function captureTab(tabId: number, windowId: number): Promise<ImageBitmap> {
  const wait = lastCapture + MIN_CAPTURE_INTERVAL_MS - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCapture = performance.now();
  let switched = false;
  const onActivated = (info: { windowId: number }) => {
    if (info.windowId === windowId) switched = true;
  };
  browser.tabs.onActivated.addListener(onActivated);
  try {
    if (!(await isActive(tabId, windowId))) throw new Error("the agent's tab is not in front; nothing was sent");
    const url = await browser.tabs.captureVisibleTab(windowId, { format: "png" });
    if (switched || !(await isActive(tabId, windowId))) throw new Error("the tab changed during capture; nothing was sent");
    // A data URL from a full tab is too large for fetch(); decoding the image element is reliable.
    const img = new Image();
    img.src = url;
    await img.decode();
    return await createImageBitmap(img);
  } finally {
    browser.tabs.onActivated.removeListener(onActivated);
  }
}

function sameContent(a: Perception, b: Perception): boolean {
  if (a.url !== b.url || a.findings.length !== b.findings.length || a.media.length !== b.media.length || a.canvas.length !== b.canvas.length) return false;
  return a.findings.every((f, i) => f.value === b.findings[i]!.value && f.cls === b.findings[i]!.cls && rectsStable(f.rects, b.findings[i]!.rects));
}

function toImageData(bmp: ImageBitmap): ImageData {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

/**
 * Perceive -> capture -> perceive again. If anything moved in between, the rects we would mask
 * no longer match the pixels, so we retry and finally refuse rather than send a misaligned frame.
 */
export async function captureRedacted(tabId: number, windowId: number, vault: TokenVault, vision: VisionStack, opts: CaptureOptions): Promise<Captured> {
  const t0 = performance.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await ask(tabId, { kind: "perceive" });
    const t1 = performance.now();
    const bmp = await captureTab(tabId, windowId);
    const t2 = performance.now();
    const after = await ask(tabId, { kind: "perceive" });
    const stable =
      before.viewport.scrollX === after.viewport.scrollX &&
      before.viewport.scrollY === after.viewport.scrollY &&
      sameContent(before, after) &&
      rectsStable(before.probe, after.probe);
    if (!stable) {
      bmp.close();
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      continue;
    }
    const p = after;
    const scale = bmp.width / p.viewport.width;
    const image = toImageData(bmp);
    const detections = (await Promise.all(vision.models.map((m) => m.detect({ image, scale }).catch(() => [] as Detection[])))).flat();
    const t3 = performance.now();
    const items = redactionItems(p, detections, vault, { strictMedia: opts.strictMedia, faceModel: vision.faceModel });
    const ops = planRedactions(items, { scale: 1, outWidth: p.viewport.width, outHeight: p.viewport.height });
    const frame = await renderRedacted(bmp, { width: p.viewport.width, height: p.viewport.height }, ops);
    bmp.close();
    const t4 = performance.now();
    return {
      frame,
      perception: p,
      detections,
      items,
      timings: { perceive: t1 - t0, capture: t2 - t1, vision: t3 - t2, render: t4 - t3, total: t4 - t0 },
    };
  }
  throw new Error("page kept moving during capture; nothing was sent");
}
