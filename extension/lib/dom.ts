import type { FieldDescriptor, Rect } from "@parda/core";

/** A document plus the offset of its viewport inside the top-level viewport. */
export interface Frame {
  doc: Document;
  dx: number;
  dy: number;
}

type ShadowOpener = (el: Element) => ShadowRoot | null;

/** Extensions may enter closed shadow roots; web pages (and tests) only see open ones. */
export function shadowOf(el: Element): ShadowRoot | null {
  const api = (globalThis as { chrome?: { dom?: { openOrClosedShadowRoot?: ShadowOpener } } }).chrome?.dom;
  if (api?.openOrClosedShadowRoot) {
    try {
      return api.openOrClosedShadowRoot(el as HTMLElement);
    } catch {
      return el.shadowRoot;
    }
  }
  return el.shadowRoot;
}

/** Same-origin iframe document, or null when the frame is opaque to us. */
export function frameDoc(el: HTMLIFrameElement | HTMLFrameElement): Document | null {
  try {
    return el.contentDocument;
  } catch {
    return null;
  }
}

export function toRect(r: DOMRect | DOMRectReadOnly, f: Frame): Rect {
  return { x: r.left + f.dx, y: r.top + f.dy, w: r.width, h: r.height };
}

export function intersects(r: Rect, vw: number, vh: number): boolean {
  return r.w > 0 && r.h > 0 && r.x < vw && r.y < vh && r.x + r.w > 0 && r.y + r.h > 0;
}

/** Visits every root (document, shadow roots, same-origin frames) reachable from `root`. */
export function* roots(frame: Frame): Generator<{ root: Document | ShadowRoot; frame: Frame }> {
  const stack: Array<{ root: Document | ShadowRoot; frame: Frame }> = [{ root: frame.doc, frame }];
  while (stack.length) {
    const cur = stack.pop()!;
    yield cur;
    const walker = cur.frame.doc.createTreeWalker(cur.root, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode() as Element | null; n; n = walker.nextNode() as Element | null) {
      const sr = shadowOf(n);
      if (sr) stack.push({ root: sr, frame: cur.frame });
      if (n.tagName === "IFRAME" || n.tagName === "FRAME") {
        const d = frameDoc(n as HTMLIFrameElement);
        if (d?.documentElement) {
          const r = n.getBoundingClientRect();
          const inner: Frame = { doc: d, dx: cur.frame.dx + r.left + n.clientLeft, dy: cur.frame.dy + r.top + n.clientTop };
          stack.push({ root: d, frame: inner });
        }
      }
    }
  }
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function labelText(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => textOf(doc.getElementById(id)))
      .join(" ")
      .trim();
    if (t) return t;
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) return textOf(labels[0]);
  // Unassociated labels: the nearest preceding text inside the field's own container, e.g.
  // <div><label>X</label><input></div>, <p>X: <input></p> or <td>X</td><td><input></td>.
  // Climbing stops at a container holding several fields, whose preceding text belongs to another one.
  let node: Element = el;
  for (let depth = 0; depth < 3 && node.parentElement; depth++) {
    for (let s = node.previousSibling; s; s = s.previousSibling) {
      const t = s.nodeType === Node.TEXT_NODE ? (s.textContent ?? "").replace(/\s+/g, " ").trim() : textOf(s as Element);
      if (t) return t.length <= 80 ? t : "";
    }
    const parent: Element = node.parentElement;
    if (parent.querySelectorAll("input, select, textarea").length > 1) break;
    node = parent;
  }
  return "";
}

const LABEL_MAX = 40;

function labelLike(t: string): boolean {
  return t.length > 0 && t.length <= LABEL_MAX && t.split(/\s+/).length <= 5;
}

/**
 * Label text that describes a display element, for static label/value layouts:
 * <dt>/<dd>, adjacent label cells, table column headers, and sibling label divs.
 */
export function displayLabel(el: Element): string {
  const tag = el.tagName;
  if (tag === "DD") {
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === "DT") return textOf(s);
    return "";
  }
  if (tag === "TD") {
    const row = el.parentElement as HTMLTableRowElement | null;
    const head = el.closest("table")?.querySelector("tr") as HTMLTableRowElement | null;
    if (head && row && head !== row) {
      const th = head.cells[(el as HTMLTableCellElement).cellIndex];
      if (th?.tagName === "TH") return textOf(th);
    }
    const prev = el.previousElementSibling;
    const pt = prev ? textOf(prev) : "";
    return prev && labelLike(pt) ? pt : "";
  }
  const prev = el.previousElementSibling;
  if (!prev || prev.querySelector("input, select, textarea, button")) return "";
  const t = textOf(prev);
  return labelLike(t) ? t : "";
}

export function describeField(el: HTMLElement): FieldDescriptor {
  return {
    tag: el.tagName.toLowerCase(),
    type: (el as HTMLInputElement).type,
    autocomplete: el.getAttribute("autocomplete") ?? undefined,
    name: el.getAttribute("name") ?? undefined,
    id: el.id || undefined,
    label: labelText(el),
    placeholder: el.getAttribute("placeholder") ?? undefined,
    ariaLabel: el.getAttribute("aria-label") ?? undefined,
  };
}

/** Content box of a form control, where its value is painted. */
export function contentRect(el: HTMLElement, f: Frame): Rect {
  const r = el.getBoundingClientRect();
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  const px = (v: string | undefined) => Number.parseFloat(v ?? "0") || 0;
  const l = px(cs?.borderLeftWidth) + px(cs?.paddingLeft);
  const t = px(cs?.borderTopWidth) + px(cs?.paddingTop);
  const rr = px(cs?.borderRightWidth) + px(cs?.paddingRight);
  const b = px(cs?.borderBottomWidth) + px(cs?.paddingBottom);
  const w = Math.max(r.width - l - rr, Math.min(r.width, 8));
  const h = Math.max(r.height - t - b, Math.min(r.height, 8));
  return { x: r.left + f.dx + (w === r.width ? 0 : l), y: r.top + f.dy + (h === r.height ? 0 : t), w, h };
}
