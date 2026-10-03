import { detect } from "./detectors";
import type { PiiClass } from "./types";
import { TOKEN_RE, type TokenVault } from "./vault";

/** Normalized action vocabulary; the server adapter maps model-native tool calls onto this. */
export type Action =
  | { type: "click"; x: number; y: number; count?: 1 | 2 | 3 }
  | { type: "hover"; x: number; y: number }
  /** Types into the focused element, as Fara's `type` carries no coordinate. */
  | { type: "type"; text: string; pressEnter?: boolean }
  | { type: "scroll"; dx: number; dy: number }
  /** A chord: pressed in order, released in reverse. */
  | { type: "key"; keys: string[] }
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "wait"; seconds: number }
  | { type: "read_page"; question: string }
  | { type: "memorize"; fact: string }
  | { type: "ask_user"; question: string }
  | { type: "done"; answer?: string };

export interface TargetInfo {
  tag: string;
  role?: string;
  inputType?: string;
  fieldCls: PiiClass | null;
  /** Accessible name after sanitization. */
  name: string;
  origin: string;
  href?: string;
  editable: boolean;
  /** The element under the point is not the one the rect lookup expected, or is covered. */
  occluded: boolean;
  /** Inside a cross-origin iframe or closed shadow root: opaque to us. */
  opaque?: boolean;
}

export type Verdict = "allow" | "confirm" | "deny";

export interface PolicyDecision {
  verdict: Verdict;
  reasons: string[];
  /** For `type`, the text to insert once approved, with tokens substituted. */
  resolvedText?: string;
  /** Tokens whose values would be released; shown on the consent card. */
  releases?: string[];
}

const IRREVERSIBLE =
  /\b(?:submit|pay|payment|place\s*order|confirm|delete|remove|send|transfer|purchase|buy|book|sign\s*(?:up|in)?|register|apply|checkout|proceed|upload|e-?sign|verify)\b|जमा|भुगतान|पुष्टि|भेजें|हटाएं/i;

const SAFE_CHORDS = new Set([
  "Tab",
  "Shift+Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Backspace",
  "Delete",
  " ",
  "Control+a",
  "Meta+a",
]);

const NO_AGENT_TYPING: ReadonlySet<PiiClass> = new Set(["PASSWORD", "OTP", "CARD_CVV"]);

/**
 * Identity of a target as seen at decision time. The page re-derives it right before executing,
 * so a page that swaps the element under the point (or moves focus) during approval is refused.
 * `name` must be the raw accessible name here, not the sanitized one.
 */
export function targetFingerprint(t: TargetInfo): string {
  return JSON.stringify([t.tag, t.role ?? "", t.inputType ?? "", t.fieldCls, t.name, t.origin, t.href ?? "", t.editable, t.occluded, !!t.opaque]);
}

function decide(verdicts: Array<[Verdict, string]>): PolicyDecision {
  const rank: Record<Verdict, number> = { allow: 0, confirm: 1, deny: 2 };
  let verdict: Verdict = "allow";
  for (const [v] of verdicts) if (rank[v] > rank[verdict]) verdict = v;
  return { verdict, reasons: verdicts.filter(([v]) => v !== "allow").map(([, r]) => r) };
}

export function evaluate(action: Action, target: TargetInfo | null, vault: TokenVault, currentOrigin: string): PolicyDecision {
  const v: Array<[Verdict, string]> = [];
  switch (action.type) {
    case "hover":
      if (!target || target.opaque) return { verdict: "deny", reasons: ["no element at that point"] };
      if (target.occluded) return { verdict: "deny", reasons: ["target is not visible"] };
      return { verdict: "allow", reasons: [] };
    case "click": {
      if (!target) return { verdict: "deny", reasons: ["no element at that point"] };
      if (target.opaque) v.push(["deny", "target is inside an opaque frame"]);
      if (target.occluded) v.push(["deny", "target is covered by another element"]);
      if (target.inputType === "file") v.push(["confirm", "opens a file upload"]);
      if (target.tag === "button" || target.role === "button" || target.inputType === "submit") {
        if (IRREVERSIBLE.test(target.name)) v.push(["confirm", `"${target.name}" may be irreversible`]);
      }
      if (target.href) {
        try {
          if (new URL(target.href, currentOrigin).origin !== currentOrigin) v.push(["confirm", "link leaves the current site"]);
        } catch {
          v.push(["deny", "unparseable link"]);
        }
      }
      return decide(v);
    }
    case "type": {
      if (!target) return { verdict: "deny", reasons: ["no field at that point"] };
      if (target.opaque) return { verdict: "deny", reasons: ["field is inside an opaque frame"] };
      if (target.occluded) return { verdict: "deny", reasons: ["field is covered by another element"] };
      if (!target.editable) return { verdict: "deny", reasons: ["target is not editable"] };
      if (target.fieldCls && NO_AGENT_TYPING.has(target.fieldCls)) {
        return { verdict: "deny", reasons: [`${target.fieldCls} must be entered by the user`] };
      }
      const releases: string[] = [];
      let resolved = "";
      for (const part of vault.parseTyped(action.text)) {
        if ("literal" in part) {
          const leaked = detect(part.literal);
          if (leaked.length) v.push(["confirm", `text contains untokenized ${leaked.map((s) => s.cls).join(", ")}`]);
          resolved += part.literal;
          continue;
        }
        const fill = vault.resolveFill(part.token, { origin: target.origin, fieldCls: target.fieldCls });
        if (!fill.ok) return { verdict: "deny", reasons: [fill.reason] };
        releases.push(part.token);
        resolved += fill.value;
      }
      if (releases.length) v.push(["confirm", `releases ${releases.join(", ")} to ${target.origin}`]);
      if (action.pressEnter) v.push(["confirm", "presses Enter, which may submit the form"]);
      return { ...decide(v), resolvedText: resolved, releases };
    }
    case "key": {
      const chord = action.keys.join("+");
      if (chord === "Enter") return { verdict: "confirm", reasons: ["Enter may submit the form"] };
      if (!SAFE_CHORDS.has(chord)) return { verdict: "deny", reasons: [`key ${chord} is not allowed`] };
      return { verdict: "allow", reasons: [] };
    }
    case "navigate": {
      if (new RegExp(TOKEN_RE.source).test(action.url)) return { verdict: "deny", reasons: ["tokens are never substituted into URLs"] };
      let u: URL;
      try {
        u = new URL(action.url);
      } catch {
        return { verdict: "deny", reasons: ["invalid URL"] };
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") return { verdict: "deny", reasons: [`scheme ${u.protocol} not allowed`] };
      // The browser, not Parda, would send this URL, so personal data in it must never be approved by habit.
      let decoded = u.href;
      try {
        decoded = decodeURIComponent(u.href.replace(/\+/g, " "));
      } catch {
        /* keep the raw form */
      }
      if (detect(decoded).length) return { verdict: "deny", reasons: ["the URL contains personal data"] };
      if (u.origin !== currentOrigin) v.push(["confirm", `navigates to ${u.origin}`]);
      return decide(v);
    }
    case "scroll":
    case "back":
    case "wait":
    case "read_page":
    case "memorize":
    case "ask_user":
    case "done":
      return { verdict: "allow", reasons: [] };
  }
}
