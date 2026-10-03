import { detect, type DetectOptions } from "./detectors";
import type { PiiClass, Span } from "./types";
import { TOKEN_RE, type TokenSource, type TokenVault } from "./vault";

export interface SanitizedSpan extends Span {
  token: string;
}

export interface SanitizeResult {
  text: string;
  /** Offsets refer to the input text, so callers can map them onto DOM ranges or OCR boxes. */
  spans: SanitizedSpan[];
  /** Token-shaped strings already present in the input, which must also be masked in pixels. */
  forged: Array<{ start: number; end: number }>;
}

export interface SanitizeOptions extends DetectOptions {
  origin: string;
  source?: TokenSource;
}

function defang(literal: string): string {
  return literal.replace(TOKEN_RE, (_m, cls: string, n: string) => `(${cls}-${n})`);
}

export function sanitizeText(text: string, vault: TokenVault, opts: SanitizeOptions): SanitizeResult {
  const spans = detect(text, opts);
  const forged: SanitizeResult["forged"] = [];
  if (opts.source !== "user") {
    for (const m of text.matchAll(TOKEN_RE)) {
      const start = m.index ?? 0;
      forged.push({ start, end: start + m[0].length });
    }
  }
  const out: string[] = [];
  const resultSpans: SanitizedSpan[] = [];
  let last = 0;
  for (const s of spans) {
    out.push(defang(text.slice(last, s.start)));
    const token = vault.tokenFor(s.cls, text.slice(s.start, s.end), opts.origin, opts.source ?? "page");
    out.push(token);
    resultSpans.push({ ...s, token });
    last = s.end;
  }
  out.push(defang(text.slice(last)));
  return { text: out.join(""), spans: resultSpans, forged };
}

/** Sanitizes the user's own instruction; values the user typed become fillable user-sourced tokens. */
export function sanitizeInstruction(text: string, vault: TokenVault, opts: Omit<SanitizeOptions, "source">): SanitizeResult {
  return sanitizeText(text, vault, { ...opts, source: "user" });
}

/** Replaces a known-sensitive value (e.g. a classified form field) with a token without running detectors. */
export function tokenizeValue(value: string, cls: PiiClass, vault: TokenVault, origin: string): string {
  return vault.tokenFor(cls, value, origin, "page");
}

const ID_SEGMENT = /^(?:\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{20,}|[0-9a-f]{16,})$/i;

/**
 * Keeps scheme, host and path shape; strips credentials, fragment and query values,
 * and replaces identifier-like or PII path segments.
 */
export function sanitizeUrl(raw: string, vault: TokenVault): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "[URL]";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `${u.protocol}[REDACTED]`;
  const origin = u.origin;
  const segments = u.pathname.split("/").map((seg) => {
    if (!seg) return seg;
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      /* keep raw */
    }
    const pii = sanitizeText(decoded, vault, { origin });
    if (pii.spans.length) return pii.text;
    return ID_SEGMENT.test(decoded) ? "[ID]" : seg;
  });
  const keys = [...new Set([...u.searchParams.keys()])];
  const query = keys.length ? "?" + keys.map((k) => `${encodeURIComponent(k)}=*`).join("&") : "";
  return `${origin}${segments.join("/")}${query}`;
}

/** For short attribute-like strings: title, alt, aria-label, placeholder, file names. */
export function sanitizeAttr(text: string, vault: TokenVault, origin: string): string {
  return sanitizeText(text, vault, { origin }).text;
}
