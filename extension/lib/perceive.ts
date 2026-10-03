import { TOKEN_RE, classifyField, detect, type PiiClass, type Rect, type Span } from "@parda/core";
import { contentRect, describeField, displayLabel, frameDoc, intersects, roots, toRect, type Frame } from "./dom";

export interface Finding {
  /** Viewport CSS pixels; a value wrapping across lines has several. */
  rects: Rect[];
  cls: PiiClass;
  value: string;
  kind: "token" | "solid";
  source: "text" | "field" | "placeholder";
  rule: string;
}

export interface Perception {
  url: string;
  origin: string;
  viewport: { width: number; height: number; dpr: number; scrollX: number; scrollY: number };
  findings: Finding[];
  /** Regions we cannot inspect (cross-origin frames, plugins): always masked. */
  opaque: Rect[];
  /** Token-shaped text planted by the page: always masked so it cannot impersonate our tokens. */
  forged: Rect[];
  /** Images, video and canvases: masked wholesale in strict mode when no face model is loaded. */
  media: Rect[];
  /** Canvas pixels the DOM cannot read. Always masked, even when strict media is off. */
  canvas: Rect[];
  /** Empty or filled controls, class and centre only. No values. */
  slots: Array<{ role: "field" | "button"; cls: string; x: number; y: number; empty: boolean }>;
  /** Geometry probe used to detect layout shifts between perception and capture. */
  probe: Rect[];
  /** Visible text and its resolved spans, for `read_page`. Only with `withText`. */
  page?: { text: string; spans: Span[] };
}

export interface PerceiveOptions {
  /** Extra detector (e.g. a local name model) run over the collected page text. */
  extraSpans?: (text: string) => Span[];
  withText?: boolean;
  /** Collect text outside the viewport too (for `read_page`). */
  allText?: boolean;
}

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "DESC", "TEXTAREA", "OPTION", "SELECT"]);
const BLOCK = "p,div,li,td,th,tr,h1,h2,h3,h4,h5,h6,section,article,header,footer,form,fieldset,dd,dt,label,button,table,ul,ol,main,nav,aside";
const NON_TEXT_INPUTS = new Set(["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "range", "color"]);
const SOLID_FIELDS: ReadonlySet<PiiClass> = new Set(["PASSWORD", "OTP", "CARD_CVV"]);
const SELECT_PII: ReadonlySet<PiiClass> = new Set(["DOB", "ADDRESS", "PINCODE"]);
const TOKEN_SHAPE = new RegExp(TOKEN_RE.source);
/** Values already masked by the site, e.g. "XXXX XXXX 1234". */
const ALREADY_MASKED = /[X*•]{4}/i;
const NO_PROPAGATE: ReadonlySet<PiiClass> = new Set(["PASSWORD"]);
const LABELLED_MAX = 160;

interface Segment {
  node: Text;
  start: number;
  frame: Frame;
}

function clip(rects: Rect[], vw: number, vh: number): Rect[] {
  return rects.filter((r) => intersects(r, vw, vh));
}

/** Resolved text of a ::before/::after `content` value, or "" for none/normal/counters. */
function pseudoText(el: Element, cs: CSSStyleDeclaration): string {
  const c = cs.content;
  if (!c || c === "none" || c === "normal") return "";
  let out = "";
  for (const m of c.matchAll(/"((?:[^"\\]|\\.)*)"|attr\(\s*([\w-]+)\s*\)/g)) out += m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (el.getAttribute(m[2]!) ?? "");
  return out;
}

function rangeRects(doc: Document, node: Text, a: number, b: number, f: Frame): Rect[] {
  const range = doc.createRange();
  range.setStart(node, a);
  range.setEnd(node, b);
  return [...range.getClientRects()].map((r) => toRect(r, f));
}

export function perceive(win: Window = window, opts: PerceiveOptions = {}): Perception {
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const top: Frame = { doc: win.document, dx: 0, dy: 0 };
  const findings: Finding[] = [];
  const opaque: Rect[] = [];
  const forged: Rect[] = [];
  const media: Rect[] = [];
  const canvas: Rect[] = [];
  const slots: Perception["slots"] = [];

  const segs: Segment[] = [];
  let text = "";
  let lastBlock: Element | null = null;
  let lineBreak = false;
  let space = false;
  let prevLast: DOMRect | null = null;
  let prevFrame: Frame | null = null;
  const parentRectCache = new Map<Element, Rect>();
  const labelled = new Map<Element, { cls: PiiClass; start: number; end: number } | null>();

  const labelledAncestor = (p: Element): { cls: PiiClass; start: number; end: number } | null => {
    let e: Element | null = p;
    for (let d = 0; e && d < 3; d++, e = e.parentElement) {
      if (labelled.has(e)) {
        const hit = labelled.get(e);
        if (hit) return hit;
        continue;
      }
      let rec: { cls: PiiClass; start: number; end: number } | null = null;
      const own = (e.textContent ?? "").replace(/\s+/g, " ").trim();
      if (own && own.length <= LABELLED_MAX && e.childElementCount <= 4 && !ALREADY_MASKED.test(own)) {
        const lab = displayLabel(e);
        const cls = lab ? classifyField({ tag: "text", label: lab }).cls : null;
        const ownIsLabel = !/[\d@]/.test(own) && classifyField({ tag: "text", label: own }).cls !== null;
        if (cls && !NO_PROPAGATE.has(cls) && !ownIsLabel) rec = { cls, start: -1, end: -1 };
      }
      labelled.set(e, rec);
      if (rec) return rec;
    }
    return null;
  };

  for (const { root, frame } of roots(top)) {
    const doc = frame.doc;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.nodeType === Node.ELEMENT_NODE && SKIP.has((n as Element).tagName.toUpperCase())
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        if (el.tagName === "BR") {
          lineBreak = true;
          continue;
        }
        if (el.tagName === "IMG" || el.tagName === "VIDEO" || el.tagName === "CANVAS" || el.tagName.toUpperCase() === "IMAGE") {
          const r = toRect(el.getBoundingClientRect(), frame);
          if (r.w >= 24 && r.h >= 24 && intersects(r, vw, vh)) {
            media.push(r);
            if (el.tagName === "CANVAS") canvas.push(r);
          }
          continue;
        }
        if (el.tagName === "IFRAME" || el.tagName === "FRAME" || el.tagName === "EMBED" || el.tagName === "OBJECT") {
          const isFrame = el.tagName === "IFRAME" || el.tagName === "FRAME";
          if (!isFrame || !frameDoc(el as HTMLIFrameElement)?.documentElement) {
            const r = toRect(el.getBoundingClientRect(), frame);
            if (intersects(r, vw, vh)) opaque.push(r);
          }
          continue;
        }
        // Painted surfaces that are not text nodes: CSS generated content and background images.
        if (el === doc.documentElement || el === doc.body) continue;
        const view = doc.defaultView;
        if (!view) continue;
        const cs = view.getComputedStyle(el);
        const before = view.getComputedStyle(el, "::before");
        const after = view.getComputedStyle(el, "::after");
        const bg = cs.backgroundImage.includes("url(") || before.content.includes("url(") || after.content.includes("url(");
        const pseudo = pseudoText(el, before) + " " + pseudoText(el, after);
        if (!bg && !pseudo.trim()) continue;
        const r = toRect(el.getBoundingClientRect(), frame);
        if (!intersects(r, vw, vh)) continue;
        if (bg && r.w >= 24 && r.h >= 24) media.push(r);
        if (pseudo.trim()) {
          if (TOKEN_SHAPE.test(pseudo)) forged.push(r);
          const hit = detect(pseudo)[0];
          if (hit) findings.push({ rects: [r], cls: hit.cls, value: pseudo.trim(), kind: "solid", source: "text", rule: `pseudo.${hit.rule}` });
        }
        continue;
      }
      const t = n as Text;
      const value = t.data;
      if (!value.trim()) {
        space = true;
        continue;
      }
      const parent = t.parentElement;
      if (!parent) continue;
      let pr = parentRectCache.get(parent);
      if (!pr) {
        pr = toRect(parent.getBoundingClientRect(), frame);
        parentRectCache.set(parent, pr);
      }
      // Zero-size parents (display: contents, inline wrappers) are decided later by the text's own rects.
      if (!opts.allText && !intersects(pr, vw, vh) && (pr.w > 0 || pr.h > 0)) continue;
      // Join the way the page renders, since CSS decides what is a line: a node that starts below the
      // previous one, a <br>, or a new block is a new line (except after "Label:"); on the same line a
      // visible gap or whitespace node is a space, and touching inline nodes are joined directly.
      const block = parent.closest(BLOCK);
      const range = doc.createRange();
      range.selectNodeContents(t);
      const own = range.getClientRects();
      const first = own[0];
      // Rects are frame-local; geometry across a frame boundary says nothing about lines.
      if (frame !== prevFrame) prevLast = null;
      prevFrame = frame;
      if (text) {
        const nextLine = !!first && !!prevLast && first.top >= prevLast.bottom - 2;
        const gap = !!first && !!prevLast && !nextLine && first.left - prevLast.right > 1;
        if ((lineBreak || nextLine || block !== lastBlock) && !/[:：]\s*$/.test(text)) text += "\n";
        else if (lineBreak || nextLine || block !== lastBlock || space || gap) text += " ";
      }
      if (own.length) prevLast = own[own.length - 1]!;
      lineBreak = false;
      space = false;
      lastBlock = block;
      segs.push({ node: t, start: text.length, frame });
      const rec = labelledAncestor(parent);
      if (rec) {
        if (rec.start < 0) rec.start = text.length;
        rec.end = text.length + value.length;
      }
      text += value;
    }
  }

  const labelSpans: Span[] = [];
  for (const rec of new Set(labelled.values())) {
    if (!rec || rec.start < 0) continue;
    const raw = text.slice(rec.start, rec.end);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) labelSpans.push({ start: rec.start + lead, end: rec.start + lead + trimmed.length, cls: rec.cls, score: 0.75, rule: `label.${rec.cls}` });
  }
  const spans = detect(text, { extra: [...labelSpans, ...(opts.extraSpans?.(text) ?? [])] });
  const locate = (s: number, e: number): Rect[] => {
    const out: Rect[] = [];
    for (const seg of segs) {
      const segEnd = seg.start + seg.node.data.length;
      if (segEnd <= s || seg.start >= e) continue;
      const a = Math.max(s, seg.start) - seg.start;
      const b = Math.min(e, segEnd) - seg.start;
      out.push(...rangeRects(seg.frame.doc, seg.node, a, b, seg.frame));
    }
    return clip(out, vw, vh);
  };
  for (const s of spans) {
    const rects = locate(s.start, s.end);
    if (rects.length) findings.push({ rects, cls: s.cls, value: text.slice(s.start, s.end), kind: "token", source: "text", rule: s.rule });
  }
  for (const m of text.matchAll(TOKEN_RE)) {
    forged.push(...locate(m.index ?? 0, (m.index ?? 0) + m[0].length));
  }

  for (const { root, frame } of roots(top)) {
    const fields = root.querySelectorAll<HTMLElement>("input, textarea, select");
    for (const el of fields) {
      const type = ((el as HTMLInputElement).type ?? "").toLowerCase();
      if (el.tagName === "INPUT" && NON_TEXT_INPUTS.has(type)) continue;
      const rect = contentRect(el, frame);
      if (!intersects(rect, vw, vh)) continue;
      const rects = clip([rect], vw, vh);
      const fc = classifyField(describeField(el)).cls;
      if (type === "file") {
        const files = (el as HTMLInputElement).files;
        if (files && files.length) findings.push({ rects, cls: "SECRET", value: "", kind: "solid", source: "field", rule: "field.file" });
        continue;
      }
      const sel = el.tagName === "SELECT" ? (el as HTMLSelectElement) : null;
      if (sel && (sel.size > 1 || sel.multiple)) {
        // A listbox (including one Parda expanded) paints every option, not just the selected one.
        for (const opt of sel.options) {
          const or = clip([toRect(opt.getBoundingClientRect(), frame)], vw, vh);
          const hit = or.length && opt.text.trim() ? detect(opt.text)[0] : undefined;
          if (hit) findings.push({ rects: or, cls: hit.cls, value: opt.text, kind: "token", source: "field", rule: `option.${hit.rule}` });
          if (or.length && TOKEN_SHAPE.test(opt.text)) forged.push(...or);
        }
        continue;
      }
      const value =
        el.tagName === "SELECT"
          ? ((el as HTMLSelectElement).selectedOptions[0]?.text ?? "")
          : (el as HTMLInputElement | HTMLTextAreaElement).value;
      if (fc) slots.push({ role: "field", cls: fc, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, empty: !value.trim() });
      if (value) {
        if (type === "password" || (fc && SOLID_FIELDS.has(fc))) {
          findings.push({ rects, cls: fc ?? "PASSWORD", value, kind: "solid", source: "field", rule: "field.secret" });
        } else if (fc && (el.tagName !== "SELECT" || SELECT_PII.has(fc))) {
          findings.push({ rects, cls: fc, value, kind: "token", source: "field", rule: "field.semantic" });
        } else {
          const hit = detect(value)[0];
          if (hit) findings.push({ rects, cls: hit.cls, value, kind: "token", source: "field", rule: `field.${hit.rule}` });
        }
        if (TOKEN_SHAPE.test(value)) forged.push(...rects);
        continue;
      }
      const ph = el.getAttribute("placeholder");
      const hit = ph ? detect(ph)[0] : undefined;
      if (ph && hit) findings.push({ rects, cls: hit.cls, value: ph, kind: "token", source: "placeholder", rule: `placeholder.${hit.rule}` });
    }
  }

  for (const { root, frame } of roots(top)) {
    for (const el of root.querySelectorAll<HTMLElement>("button, input[type=submit], [role=button]")) {
      const name = (el.innerText || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
      if (!/\b(?:submit|send|apply|save)\b/i.test(name)) continue;
      const r = toRect(el.getBoundingClientRect(), frame);
      if (!intersects(r, vw, vh)) continue;
      slots.push({ role: "button", cls: "SUBMIT", x: r.x + r.w / 2, y: r.y + r.h / 2, empty: true });
    }
  }

  const probe = findings.flatMap((f) => f.rects).concat(opaque, forged, media);
  return {
    url: win.location.href,
    origin: win.location.origin,
    viewport: { width: vw, height: vh, dpr: win.devicePixelRatio || 1, scrollX: win.scrollX, scrollY: win.scrollY },
    findings,
    opaque,
    forged,
    media,
    canvas,
    slots,
    probe,
    page: opts.withText ? { text, spans } : undefined,
  };
}