import type { Rect, RedactionItem, TokenVault } from "@parda/core";
import type { Perception } from "./perceive";
import { SENSITIVE_VISUAL, type Detection, type VisionCls } from "./vision/types";

/** Rendered personal text is masked too. Buttons and inputs stay visible: the agent needs them. */
const PIXEL_MASK: ReadonlySet<VisionCls> = new Set([...SENSITIVE_VISUAL, "TEXT"]);
/** These fire on ordinary form chrome; keep them only where the DOM has no glyphs (canvas / image). */
const MEDIA_LOCKED: ReadonlySet<VisionCls> = new Set(["TEXT", "ID_DOCUMENT"]);

export interface ItemOptions {
  /** Mask every image/video/canvas. Off, only regions the vision models flag are masked. */
  strictMedia: boolean;
  faceModel: boolean;
}

function overlapFrac(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / (a.w * a.h || 1);
}

function onMedia(rect: Rect, media: Rect[]): boolean {
  return media.some((m) => overlapFrac(rect, m) >= 0.45);
}

export function redactionItems(p: Perception, detections: Detection[], vault: TokenVault, opts: ItemOptions): RedactionItem[] {
  const items: RedactionItem[] = [];
  for (const f of p.findings) {
    if (f.kind === "solid") {
      for (const rect of f.rects) items.push({ rect, kind: "solid", cls: f.cls, source: "dom" });
      continue;
    }
    const token = vault.tokenFor(f.cls, f.value, p.origin);
    f.rects.forEach((rect, i) =>
      items.push({ rect, kind: i === 0 ? "token" : "solid", label: i === 0 ? token : undefined, cls: f.cls, source: "dom" }),
    );
  }
  for (const rect of p.canvas) items.push({ rect, kind: "solid", cls: "MEDIA", source: "dom" });
  for (const rect of p.opaque) items.push({ rect, kind: "solid", source: "dom" });
  for (const rect of p.forged) items.push({ rect, kind: "solid", cls: "FORGED_TOKEN", source: "dom" });
  for (const d of detections) {
    if (!PIXEL_MASK.has(d.cls)) continue;
    if (MEDIA_LOCKED.has(d.cls) && !onMedia(d.rect, p.media)) continue;
    const cls = d.cls === "BARCODE" ? "QR" : d.cls === "TEXT" ? "TEXT" : (d.cls as "FACE" | "QR" | "ID_DOCUMENT" | "SIGNATURE");
    items.push({ rect: d.rect, kind: "solid", cls, source: d.cls === "FACE" ? "face" : d.cls === "QR" || d.cls === "BARCODE" ? "qr" : "vit" });
  }
  // Without a face model, "not strict" would silently mean "no media masking at all".
  if (opts.strictMedia || !opts.faceModel) for (const rect of p.media) items.push({ rect, kind: "solid", cls: "MEDIA", source: "dom" });
  return items;
}
