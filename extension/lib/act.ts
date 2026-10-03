import { classifyField, targetFingerprint, type Action, type TargetInfo } from "@parda/core";
import { describeField, frameDoc, shadowOf } from "./dom";

const ACTIONABLE =
  "a[href],button,input,select,textarea,summary,label,option,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[contenteditable=''],[contenteditable=true],[onclick],[tabindex]";

interface Hit {
  el: Element;
  /** Point in the hit element's own document viewport. */
  x: number;
  y: number;
  opaque: boolean;
}

/** elementFromPoint that descends into shadow roots and same-origin frames. */
export function deepElementFromPoint(doc: Document, x: number, y: number): Hit | null {
  let el: Element | null = doc.elementFromPoint(x, y);
  let cx = x;
  let cy = y;
  while (el) {
    const sr = shadowOf(el);
    if (sr) {
      const inner = sr.elementFromPoint(cx, cy);
      if (inner && inner !== el) {
        el = inner;
        continue;
      }
    }
    if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
      const d = frameDoc(el as HTMLIFrameElement);
      if (!d) return { el, x: cx, y: cy, opaque: true };
      const r = el.getBoundingClientRect();
      cx -= r.left + el.clientLeft;
      cy -= r.top + el.clientTop;
      const inner = d.elementFromPoint(cx, cy);
      if (!inner) return { el, x: cx, y: cy, opaque: false };
      el = inner;
      continue;
    }
    return { el, x: cx, y: cy, opaque: false };
  }
  return null;
}

export function deepActiveElement(doc: Document): Element | null {
  let el: Element | null = doc.activeElement;
  for (;;) {
    if (!el) return null;
    const sr = shadowOf(el);
    if (sr?.activeElement) {
      el = sr.activeElement;
      continue;
    }
    if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
      const d = frameDoc(el as HTMLIFrameElement);
      if (d?.activeElement && d.activeElement !== d.body) {
        el = d.activeElement;
        continue;
      }
    }
    return el;
  }
}

function isEditable(el: Element): boolean {
  if (el instanceof el.ownerDocument.defaultView!.HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof el.ownerDocument.defaultView!.HTMLInputElement) {
    const nonText = ["checkbox", "radio", "submit", "button", "reset", "image", "file", "range", "color", "hidden"];
    return !nonText.includes(el.type) && !el.readOnly && !el.disabled;
  }
  return (el as HTMLElement).isContentEditable === true;
}

function accessibleName(el: Element): string {
  const h = el as HTMLElement;
  const name =
    h.getAttribute("aria-label") ||
    (el instanceof el.ownerDocument.defaultView!.HTMLInputElement && ["submit", "button"].includes(el.type) ? el.value : "") ||
    h.innerText ||
    h.getAttribute("title") ||
    h.getAttribute("alt") ||
    "";
  return name.replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Near-invisible targets are a clickjacking signal: the user cannot see what would be clicked. */
function visuallyHidden(el: Element): boolean {
  let opacity = 1;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = e.ownerDocument.defaultView?.getComputedStyle(e);
    if (!cs) break;
    if (cs.visibility === "hidden") return true;
    opacity *= Number.parseFloat(cs.opacity || "1");
  }
  return opacity < 0.1;
}

export function describeTarget(el: Element, opaque: boolean): TargetInfo {
  const actionable = el.closest(ACTIONABLE) ?? el;
  const h = actionable as HTMLElement;
  const input = actionable instanceof actionable.ownerDocument.defaultView!.HTMLInputElement ? actionable : null;
  const formLike = ["INPUT", "TEXTAREA", "SELECT"].includes(actionable.tagName) || h.isContentEditable;
  return {
    tag: actionable.tagName.toLowerCase(),
    role: h.getAttribute("role") ?? undefined,
    inputType: input?.type,
    fieldCls: formLike ? classifyField(describeField(h)).cls : null,
    name: accessibleName(actionable),
    origin: actionable.ownerDocument.location.origin,
    href: (actionable as HTMLAnchorElement).href || undefined,
    editable: isEditable(actionable),
    occluded: visuallyHidden(actionable),
    opaque,
  };
}

export function targetAt(x: number, y: number, doc: Document = document): TargetInfo | null {
  const hit = deepElementFromPoint(doc, x, y);
  return hit ? describeTarget(hit.el, hit.opaque) : null;
}

export function focusedTarget(doc: Document = document): TargetInfo | null {
  const el = deepActiveElement(doc);
  if (!el || el === doc.body) return null;
  return describeTarget(el, false);
}

export interface Effect {
  ok: boolean;
  detail: string;
}

function mouse(el: Element, type: string, x: number, y: number, detail = 1): void {
  const win = el.ownerDocument.defaultView!;
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, detail, view: win, button: 0 };
  const Ctor = type.startsWith("pointer") ? win.PointerEvent ?? win.MouseEvent : win.MouseEvent;
  el.dispatchEvent(new Ctor(type, init));
}

/** Native <select> popups are not in captured screenshots, so selects are expanded in-page while open. */
function expandSelect(sel: HTMLSelectElement): void {
  if (sel.dataset.pardaExpanded) return;
  sel.dataset.pardaExpanded = String(sel.size || 0);
  sel.size = Math.min(Math.max(sel.options.length, 2), 8);
  const restore = () => {
    sel.size = Number(sel.dataset.pardaExpanded) || 0;
    delete sel.dataset.pardaExpanded;
    sel.removeEventListener("change", restore);
    sel.removeEventListener("blur", restore);
  };
  sel.addEventListener("change", restore);
  sel.addEventListener("blur", restore);
}

function click(hit: Hit, count: number): Effect {
  const { el, x, y } = hit;
  const target = el.closest(ACTIONABLE) ?? el;
  const doc = el.ownerDocument;
  const win = doc.defaultView!;
  if (target instanceof win.HTMLOptionElement && target.parentElement) {
    const sel = target.closest("select")!;
    sel.value = target.value;
    sel.dispatchEvent(new win.Event("input", { bubbles: true }));
    sel.dispatchEvent(new win.Event("change", { bubbles: true }));
    return { ok: true, detail: `selected "${target.text.trim()}"` };
  }
  for (let i = 1; i <= count; i++) {
    mouse(el, "pointerdown", x, y, i);
    mouse(el, "mousedown", x, y, i);
    if (i === 1 && target instanceof win.HTMLElement) {
      const inner = target instanceof win.HTMLLabelElement ? target.querySelector("input, textarea, select") : null;
      (inner instanceof win.HTMLElement ? inner : target).focus({ preventScroll: true });
    }
    mouse(el, "pointerup", x, y, i);
    mouse(el, "mouseup", x, y, i);
    mouse(el, "click", x, y, i);
  }
  if (count === 2) mouse(el, "dblclick", x, y, 2);
  if (count === 3 && isEditable(target) && "select" in target) (target as HTMLInputElement).select();
  if (target instanceof win.HTMLSelectElement) expandSelect(target);
  return { ok: true, detail: `clicked <${target.tagName.toLowerCase()}>` };
}

/** Calls the prototype setter so framework-managed inputs (React, Vue) register the change. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, v: string): void {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
  if (set) set.call(el, v);
  else el.value = v;
}

function insertText(el: Element, text: string): Effect {
  const win = el.ownerDocument.defaultView!;
  if (el instanceof win.HTMLInputElement || el instanceof win.HTMLTextAreaElement) {
    let start: number | null = null;
    let end: number | null = null;
    try {
      start = el.selectionStart;
      end = el.selectionEnd;
    } catch {
      /* email/number inputs have no selection API */
    }
    const cur = el.value;
    const next = start !== null && end !== null ? cur.slice(0, start) + text + cur.slice(end) : cur + text;
    el.dispatchEvent(new win.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    setValue(el, next);
    try {
      if (start !== null) el.setSelectionRange(start + text.length, start + text.length);
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new win.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
    return { ok: el.value === next, detail: "typed into field" };
  }
  if ((el as HTMLElement).isContentEditable) {
    const ok = el.ownerDocument.execCommand("insertText", false, text);
    return { ok, detail: "typed into editable region" };
  }
  return { ok: false, detail: "focused element is not editable" };
}

function key(el: Element, k: string, type: "keydown" | "keyup", mods: { ctrl: boolean; shift: boolean; meta: boolean; alt: boolean }): boolean {
  const win = el.ownerDocument.defaultView!;
  return el.dispatchEvent(
    new win.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, composed: true, ctrlKey: mods.ctrl, shiftKey: mods.shift, metaKey: mods.meta, altKey: mods.alt }),
  );
}

function focusables(doc: Document): HTMLElement[] {
  const sel = "a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1']),[contenteditable=true]";
  return [...doc.querySelectorAll<HTMLElement>(sel)].filter((e) => e.getClientRects().length > 0);
}

function chord(doc: Document, keys: string[]): Effect {
  const el = deepActiveElement(doc) ?? doc.body;
  const mods = { ctrl: keys.includes("Control"), shift: keys.includes("Shift"), meta: keys.includes("Meta"), alt: keys.includes("Alt") };
  const main = keys.filter((k) => !["Control", "Shift", "Meta", "Alt"].includes(k)).pop() ?? keys[keys.length - 1] ?? "";
  let proceed = true;
  for (const k of keys) proceed = key(el, k, "keydown", mods) && proceed;
  if (proceed) {
    const win = el.ownerDocument.defaultView!;
    const field = el instanceof win.HTMLInputElement || el instanceof win.HTMLTextAreaElement ? el : null;
    if (main === "Tab") {
      const list = focusables(el.ownerDocument);
      const i = list.indexOf(el as HTMLElement);
      list[(i + (mods.shift ? -1 : 1) + list.length) % list.length]?.focus();
    } else if (main === "Enter") {
      if (field instanceof win.HTMLInputElement && field.form) field.form.requestSubmit();
      else if (el instanceof win.HTMLElement && el !== doc.body) el.click();
    } else if (main === "a" && (mods.ctrl || mods.meta)) {
      if (field) field.select();
    } else if ((main === "Backspace" || main === "Delete") && field) {
      const s = field.selectionStart ?? field.value.length;
      const e = field.selectionEnd ?? s;
      const [a, b] = s !== e ? [s, e] : main === "Backspace" ? [Math.max(0, s - 1), s] : [s, s + 1];
      setValue(field, field.value.slice(0, a) + field.value.slice(b));
      field.dispatchEvent(new win.InputEvent("input", { bubbles: true, inputType: main === "Backspace" ? "deleteContentBackward" : "deleteContentForward" }));
    } else if (main === " " && el instanceof win.HTMLElement && !field) {
      el.click();
    } else if (!field && ["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"].includes(main)) {
      const h = win.innerHeight;
      const dy = { PageDown: h * 0.9, PageUp: -h * 0.9, ArrowDown: 40, ArrowUp: -40, Home: -1e9, End: 1e9 }[main] ?? 0;
      win.scrollBy({ top: dy, behavior: "instant" as ScrollBehavior });
    } else if (main === "Escape" && el instanceof win.HTMLElement) {
      el.blur();
    }
  }
  for (const k of [...keys].reverse()) key(el, k, "keyup", mods);
  return { ok: true, detail: `pressed ${keys.join("+")}` };
}

function scrollableAt(doc: Document, x: number, y: number): Element | null {
  for (let e = doc.elementFromPoint(x, y); e; e = e.parentElement) {
    const cs = doc.defaultView!.getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) return e;
  }
  return null;
}

/**
 * Executes an already-approved action. `resolvedText` carries token substitutions for `type`.
 * Navigation and back are handled by the caller through the tabs API.
 */
export function execute(action: Action, resolvedText?: string, expect?: string, doc: Document = document): Effect {
  const win = doc.defaultView!;
  const changed: Effect = { ok: false, detail: "the target changed after the decision; not executed" };
  switch (action.type) {
    case "click": {
      const hit = deepElementFromPoint(doc, action.x, action.y);
      if (!hit || hit.opaque) return { ok: false, detail: "no reachable element" };
      if (expect !== undefined && targetFingerprint(describeTarget(hit.el, hit.opaque)) !== expect) return changed;
      return click(hit, action.count ?? 1);
    }
    case "hover": {
      const hit = deepElementFromPoint(doc, action.x, action.y);
      if (!hit || hit.opaque) return { ok: false, detail: "no reachable element" };
      if (expect !== undefined && targetFingerprint(describeTarget(hit.el, hit.opaque)) !== expect) return changed;
      for (const t of ["pointerover", "mouseover", "pointerenter", "mouseenter", "pointermove", "mousemove"]) mouse(hit.el, t, hit.x, hit.y, 0);
      return { ok: true, detail: "hovered" };
    }
    case "type": {
      const el = deepActiveElement(doc);
      if (!el || el === doc.body) return { ok: false, detail: "nothing is focused" };
      // Released values must land in the field the user approved, not wherever focus moved meanwhile.
      if (expect !== undefined && targetFingerprint(describeTarget(el, false)) !== expect) return changed;
      const r = insertText(el, resolvedText ?? action.text);
      if (r.ok && action.pressEnter) chord(doc, ["Enter"]);
      return r;
    }
    case "key":
      return chord(doc, action.keys);
    case "scroll": {
      const target = scrollableAt(doc, win.innerWidth / 2, win.innerHeight / 2);
      if (target) target.scrollBy({ left: action.dx, top: action.dy, behavior: "instant" as ScrollBehavior });
      else win.scrollBy({ left: action.dx, top: action.dy, behavior: "instant" as ScrollBehavior });
      return { ok: true, detail: `scrolled ${action.dy > 0 ? "down" : "up"}` };
    }
    default:
      return { ok: false, detail: `${action.type} is not executed in the page` };
  }
}