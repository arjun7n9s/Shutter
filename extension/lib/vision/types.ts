import type { Rect } from "@parda/core";

export type VisionCls =
  | "FACE"
  | "QR"
  | "BARCODE"
  | "ID_DOCUMENT"
  | "SIGNATURE"
  | "TEXT"
  | "INPUT"
  | "BUTTON"
  | "CHECKBOX"
  | "IMAGE"
  | "LINK";

/** Classes whose pixels are always masked solid when detected. */
export const SENSITIVE_VISUAL: ReadonlySet<VisionCls> = new Set(["FACE", "QR", "BARCODE", "ID_DOCUMENT", "SIGNATURE"]);

export interface Detection {
  /** Viewport CSS pixels. */
  rect: Rect;
  cls: VisionCls;
  score: number;
  model: string;
}

export interface Frame {
  /** Full-resolution capture as RGBA. */
  image: ImageData;
  /** Device pixels per CSS pixel in `image`. */
  scale: number;
}

export interface VisionModel {
  readonly name: string;
  /** Loads weights; resolves false if the model file is not bundled. */
  load(): Promise<boolean>;
  detect(frame: Frame): Promise<Detection[]>;
}

export function iou(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

export function nms<T extends { rect: Rect; score: number }>(items: T[], thr = 0.45): T[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const keep: T[] = [];
  for (const it of sorted) if (keep.every((k) => iou(k.rect, it.rect) < thr)) keep.push(it);
  return keep;
}
