import type { PiiClass, Rect } from "./types";

export type RedactionKind = "token" | "solid";

export interface RedactionItem {
  /** CSS pixels relative to the viewport at capture time. */
  rect: Rect;
  kind: RedactionKind;
  /** Token text drawn over the box, e.g. "[EMAIL_1]". */
  label?: string;
  cls?: PiiClass | "FACE" | "QR" | "SIGNATURE" | "ID_DOCUMENT" | "FORGED_TOKEN" | "MEDIA" | "TEXT";
  source: "dom" | "ocr" | "vit" | "face" | "qr";
}

export interface DrawOp {
  /** Output-image pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  kind: RedactionKind;
  label?: string;
  fontPx?: number;
}

export interface PlanOptions {
  /** Output image pixels per CSS pixel. */
  scale: number;
  outWidth: number;
  outHeight: number;
  padPx?: number;
  minFontPx?: number;
  /** Rough glyph advance of the monospace token font relative to font size. */
  charAdvance?: number;
}

function clamp(r: Rect, W: number, H: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(W, Math.ceil(r.x + r.w));
  const y1 = Math.min(H, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Converts redaction items to draw ops. Boxes are only ever grown, never shrunk,
 * so a readable token can cover neighbouring text but never expose part of a value.
 */
export function planRedactions(items: RedactionItem[], o: PlanOptions): DrawOp[] {
  const pad = o.padPx ?? 2;
  const minFont = o.minFontPx ?? 11;
  const adv = o.charAdvance ?? 0.62;
  const ops: DrawOp[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    let r: Rect = {
      x: it.rect.x * o.scale - pad,
      y: it.rect.y * o.scale - pad,
      w: it.rect.w * o.scale + 2 * pad,
      h: it.rect.h * o.scale + 2 * pad,
    };
    let fontPx: number | undefined;
    if (it.kind === "token" && it.label) {
      const fitByH = r.h * 0.72;
      const fitByW = r.w / (it.label.length * adv);
      fontPx = Math.max(minFont, Math.min(fitByH, fitByW, 28));
      const needW = it.label.length * adv * fontPx + 4;
      const needH = fontPx / 0.72;
      if (needW > r.w) r = { ...r, x: r.x - (needW - r.w) / 2, w: needW };
      if (needH > r.h) r = { ...r, y: r.y - (needH - r.h) / 2, h: needH };
    }
    const c = clamp(r, o.outWidth, o.outHeight);
    if (!c) continue;
    const key = `${c.x},${c.y},${c.w},${c.h},${it.kind},${it.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ops.push(it.kind === "token" && it.label ? { ...c, kind: "token", label: it.label, fontPx } : { ...c, kind: "solid" });
  }
  // Solid masks last, so a token label can never be drawn on top of a face or password mask.
  return ops.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "token" ? -1 : 1));
}

/** Maps a point in the image the server saw back to viewport CSS pixels. */
export function mapToViewport(
  x: number,
  y: number,
  sent: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } | null {
  if (!(x >= 0 && y >= 0 && x < sent.width && y < sent.height)) return null;
  return { x: (x / sent.width) * viewport.width, y: (y / sent.height) * viewport.height };
}

/** True if every rect moved less than `tol` CSS px between the pre- and post-capture reads. */
export function rectsStable(before: Rect[], after: Rect[], tol = 1): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i++) {
    const a = before[i]!;
    const b = after[i]!;
    if (Math.abs(a.x - b.x) > tol || Math.abs(a.y - b.y) > tol || Math.abs(a.w - b.w) > tol || Math.abs(a.h - b.h) > tol) {
      return false;
    }
  }
  return true;
}
