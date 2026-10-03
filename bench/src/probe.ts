// Bundled into each benchmark page. Uses the production perception and redaction code unchanged.
import { TokenVault, planRedactions, type DrawOp, type Rect } from "@parda/core";
import { contentRect, roots, toRect, intersects, type Frame } from "../../extension/lib/dom";
import { redactionItems } from "../../extension/lib/items";
import { perceive } from "../../extension/lib/perceive";
import { drawOps, verify } from "../../extension/lib/render";

interface GtItem {
  cls: string;
  rects: Rect[];
}

const vw = () => window.innerWidth;
const vh = () => window.innerHeight;

function textRects(el: Node, f: Frame): Rect[] {
  const r = f.doc.createRange();
  r.selectNodeContents(el);
  return [...r.getClientRects()].map((x) => toRect(x, f)).filter((x) => intersects(x, vw(), vh()));
}

function groundTruth(): GtItem[] {
  const out: GtItem[] = [];
  const top: Frame = { doc: document, dx: 0, dy: 0 };
  for (const { root, frame } of roots(top)) {
    for (const el of root.querySelectorAll<HTMLElement>("[data-gt]")) {
      const cls = el.dataset.gt!;
      // Input values paint inside the content box; borders and padding carry no information.
      const box =
        el.tagName === "INPUT" || el.tagName === "TEXTAREA"
          ? contentRect(el, frame)
          : el.tagName === "IMG" || el.tagName === "IFRAME"
            ? toRect(el.getBoundingClientRect(), frame)
            : null;
      const rects = box ? [box].filter((x) => intersects(x, vw(), vh())) : textRects(el, frame);
      if (rects.length) out.push({ cls, rects });
    }
  }
  for (const g of (window as unknown as { __gt?: Array<{ cls: string; rect: Rect }> }).__gt ?? []) out.push({ cls: g.cls, rects: [g.rect] });
  return out;
}

/** Visible text that is not ground-truth PII: what an agent needs to understand the page. */
function contextText(): Rect[] {
  const out: Rect[] = [];
  const top: Frame = { doc: document, dx: 0, dy: 0 };
  for (const { root, frame } of roots(top)) {
    const w = frame.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!p || !n.textContent?.trim() || p.closest("[data-gt],script,style")) continue;
      out.push(...textRects(n, frame));
    }
    for (const el of root.querySelectorAll<HTMLInputElement>("input:not([data-gt])")) {
      if (el.value) out.push(toRect(el.getBoundingClientRect(), frame));
    }
  }
  return out;
}

/** The "mask everything textual" baseline from GUIGuard-style full masking. */
function blanket(): DrawOp[] {
  const rects: Rect[] = [];
  const top: Frame = { doc: document, dx: 0, dy: 0 };
  for (const { root, frame } of roots(top)) {
    const w = frame.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent?.trim() && !n.parentElement?.closest("script,style")) rects.push(...textRects(n, frame));
    for (const el of root.querySelectorAll("input,textarea,select,img,canvas,video,iframe")) rects.push(toRect(el.getBoundingClientRect(), frame));
  }
  return planRedactions(
    rects.map((rect) => ({ rect, kind: "solid" as const, source: "dom" as const })),
    { scale: 1, outWidth: vw(), outHeight: vh() },
  );
}

function parda(strictMedia: boolean) {
  const t0 = performance.now();
  const p = perceive(window);
  const t1 = performance.now();
  const vault = new TokenVault(location.origin);
  // No vision models run in the page, so the non-strict mode measures a vision stack that flags nothing:
  // the DOM-only lower bound for that setting.
  const items = redactionItems(p, [], vault, { strictMedia, faceModel: true });
  const ops = planRedactions(items, { scale: 1, outWidth: vw(), outHeight: vh() });
  const t2 = performance.now();
  return {
    ops,
    items: items.map((i) => ({ rect: i.rect, cls: i.cls ?? null, kind: i.kind })),
    perceiveMs: t1 - t0,
    planMs: t2 - t1,
    legend: vault.legend(),
  };
}

async function render(dataUrl: string, ops: DrawOp[]): Promise<string> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const c = document.createElement("canvas");
  c.width = vw();
  c.height = vh();
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  drawOps(ctx, ops);
  if (!verify(ctx, ops)) throw new Error("redaction self-check rejected the frame");
  return c.toDataURL("image/jpeg", 0.88);
}

(window as unknown as { __parda: unknown }).__parda = { groundTruth, contextText, blanket, parda, render };
