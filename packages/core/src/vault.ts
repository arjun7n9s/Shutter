import { fillCompatible } from "./fields";
import { NEVER_RELEASE, type PiiClass } from "./types";

export type TokenSource = "page" | "user";

export interface VaultEntry {
  token: string;
  cls: PiiClass;
  value: string;
  source: TokenSource;
  /** Origin the value was observed on. User-provided values carry the task's start origin. */
  origin: string;
}

export interface FillTarget {
  origin: string;
  fieldCls: PiiClass | null;
}

export type FillDecision =
  | { ok: true; value: string; entry: VaultEntry }
  | { ok: false; reason: string };

/** Matches any token shape the server could echo back, including ones the vault never issued. */
export const TOKEN_RE = /\[([A-Z][A-Z_]*?)_(\d{1,4})\]/g;

function canonical(cls: PiiClass, value: string): string {
  const v = value.trim();
  switch (cls) {
    case "EMAIL":
    case "UPI":
      return v.toLowerCase();
    case "PHONE":
      return v.replace(/\D/g, "").slice(-10);
    case "AADHAAR":
    case "AADHAAR_VID":
    case "CARD":
    case "BANK_ACCOUNT":
      return v.replace(/\D/g, "");
    case "PAN":
    case "GSTIN":
    case "IFSC":
    case "PASSPORT":
    case "VOTER_ID":
    case "DRIVING_LICENCE":
      return v.replace(/[\s-]/g, "").toUpperCase();
    default:
      return v.replace(/\s+/g, " ").toLowerCase();
  }
}

/**
 * Per-task mapping between real values and the typed tokens the server sees.
 * Values never leave the client; the server only ever receives token strings.
 */
export class TokenVault {
  private byKey = new Map<string, VaultEntry>();
  private byToken = new Map<string, VaultEntry>();
  private counters = new Map<PiiClass, number>();

  constructor(readonly taskOrigin: string) {}

  tokenFor(cls: PiiClass, value: string, origin: string, source: TokenSource = "page"): string {
    const key = `${cls}\u0000${canonical(cls, value)}`;
    const hit = this.byKey.get(key);
    if (hit) {
      if (source === "user" && hit.source === "page") hit.source = "user";
      return hit.token;
    }
    const n = (this.counters.get(cls) ?? 0) + 1;
    this.counters.set(cls, n);
    const entry: VaultEntry = { token: `[${cls}_${n}]`, cls, value, source, origin };
    this.byKey.set(key, entry);
    this.byToken.set(entry.token, entry);
    return entry.token;
  }

  lookup(token: string): VaultEntry | undefined {
    return this.byToken.get(token);
  }

  /** Token legend shown to the server: token -> class, never values. */
  legend(): Array<{ token: string; cls: PiiClass }> {
    return [...this.byToken.values()].map((e) => ({ token: e.token, cls: e.cls }));
  }

  get size(): number {
    return this.byToken.size;
  }

  /**
   * Decides whether a token may be substituted into a target field.
   * The caller must still obtain user approval for every `ok: true` result.
   */
  resolveFill(token: string, target: FillTarget): FillDecision {
    const e = this.byToken.get(token);
    if (!e) return { ok: false, reason: `unknown token ${token}` };
    if (NEVER_RELEASE.has(e.cls)) return { ok: false, reason: `${e.cls} is never released` };
    if (!fillCompatible(e.cls, target.fieldCls)) {
      return { ok: false, reason: `${e.cls} cannot be typed into a ${target.fieldCls ?? "unclassified"} field` };
    }
    if (e.source === "page" && e.origin !== target.origin) {
      return { ok: false, reason: `value seen on ${e.origin} cannot be sent to ${target.origin}` };
    }
    return { ok: true, value: e.value, entry: e };
  }

  /**
   * Splits server-provided text into literal parts and token references.
   * Literal parts are returned as-is; the policy layer decides whether they are safe to type.
   */
  parseTyped(text: string): Array<{ literal: string } | { token: string; entry?: VaultEntry }> {
    const parts: Array<{ literal: string } | { token: string; entry?: VaultEntry }> = [];
    let last = 0;
    for (const m of text.matchAll(TOKEN_RE)) {
      const i = m.index ?? 0;
      if (i > last) parts.push({ literal: text.slice(last, i) });
      const entry = this.byToken.get(m[0]);
      parts.push(entry ? { token: m[0], entry } : { token: m[0] });
      last = i + m[0].length;
    }
    if (last < text.length) parts.push({ literal: text.slice(last) });
    return parts;
  }
}
