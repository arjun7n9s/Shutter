import type { DrawOp } from "@parda/core";

declare const redacted: unique symbol;

/** Only `renderRedacted` can produce this type, and the network client only accepts this type. */
export interface RedactedFrame {
  readonly [redacted]: true;
  b64: string;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
  ops: DrawOp[];
  bytes: number;
}

const TOKEN_BG = "#111111";
const TOKEN_BORDER = "#F04E2E";
const TOKEN_FG = "#F3E9D8";
const SOLID = "#202020";
const SOLID_RGB = [0x20, 0x20, 0x20] as const;

export function drawOps(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, ops: DrawOp[]): void {
  for (const op of ops) {
    if (op.kind === "solid") {
      ctx.fillStyle = SOLID;
      ctx.fillRect(op.x, op.y, op.w, op.h);
      continue;
    }
    ctx.fillStyle = TOKEN_BG;
    ctx.fillRect(op.x, op.y, op.w, op.h);
    ctx.strokeStyle = TOKEN_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(op.x + 0.5, op.y + 0.5, op.w - 1, op.h - 1);
    ctx.fillStyle = TOKEN_FG;
    ctx.font = `600 ${Math.round(op.fontPx ?? 12)}px Consolas, "Cascadia Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(op.label ?? "", op.x + op.w / 2, op.y + op.h / 2 + 0.5, op.w - 4);
  }
}

const TOKEN_BG_RGB = [0x11, 0x11, 0x11] as const;

const covers = (op: DrawOp, x: number, y: number) => x >= op.x && x < op.x + op.w && y >= op.y && y < op.y + op.h;

/**
 * Every op must read back as its fill colour: solids at corners and centre, tokens just inside the
 * 1px border (op coordinates are integers, and the label is inset by the plan's padding). A point is checked against whichever op was painted last there.
 * Otherwise the frame is rejected.
 */
export function verify(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, ops: DrawOp[]): boolean {
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.w < 5 || op.h < 5) continue;
    const pts: Array<[number, number]> =
      op.kind === "solid"
        ? [[op.x + 1, op.y + 1], [op.x + op.w - 2, op.y + op.h - 2], [op.x + op.w / 2, op.y + op.h / 2]]
        : [[op.x + 1, op.y + 1], [op.x + op.w - 2, op.y + op.h - 2]];
    for (const [fx, fy] of pts) {
      const px = Math.floor(fx);
      const py = Math.floor(fy);
      if (ops.slice(i + 1).some((later) => covers(later, px, py))) continue;
      const want = op.kind === "solid" ? SOLID_RGB : TOKEN_BG_RGB;
      const d = ctx.getImageData(px, py, 1, 1).data;
      if (Math.abs(d[0]! - want[0]) > 3 || Math.abs(d[1]! - want[1]) > 3 || Math.abs(d[2]! - want[2]) > 3) return false;
    }
  }
  return true;
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Draws the capture at CSS-pixel size, paints every redaction, verifies the masks landed,
 * and encodes a fresh image. The source bitmap is never encoded or transmitted.
 */
export async function renderRedacted(
  source: ImageBitmap,
  size: { width: number; height: number },
  ops: DrawOp[],
  mime: RedactedFrame["mime"] = "image/jpeg",
): Promise<RedactedFrame> {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, size.width, size.height);
  drawOps(ctx, ops);
  if (!verify(ctx, ops)) throw new Error("redaction self-check failed; frame not sent");
  const blob = await canvas.convertToBlob({ type: mime, quality: 0.9 });
  const b64 = await toBase64(blob);
  return { b64, mime, width: size.width, height: size.height, ops, bytes: blob.size } as RedactedFrame;
}
