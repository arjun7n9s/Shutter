import { NEVER_RELEASE, type PiiClass } from "@parda/core";

export interface LocalSlot {
  role: "field" | "button";
  cls: string;
  x: number;
  y: number;
  empty: boolean;
}

export interface LocalToken {
  token: string;
  cls: string;
}

export type LocalPlan =
  | { kind: "fill"; x: number; y: number; token: string; key: string }
  | { kind: "submit"; x: number; y: number }
  | { kind: "done"; reason: string };

const SUBMIT = /\b(?:submit|send|apply)\b/i;

/** True when the task asks for the form to be submitted. */
export function wantsSubmit(instruction: string): boolean {
  return SUBMIT.test(instruction);
}

/**
 * Next thing to do on this page, using only field classes and the tokens already
 * in the local vault. No network. A field is tried at most once.
 */
export function planLocal(
  slots: LocalSlot[],
  legend: LocalToken[],
  submit: boolean,
  usedTokens: ReadonlySet<string>,
  tried: ReadonlySet<string>,
  submitted: boolean,
): LocalPlan {
  const available = new Map<string, string[]>();
  for (const entry of legend) {
    if (NEVER_RELEASE.has(entry.cls as PiiClass)) continue;
    const list = available.get(entry.cls) ?? [];
    if (!usedTokens.has(entry.token)) list.push(entry.token);
    available.set(entry.cls, list);
  }

  const fields = slots
    .filter((s) => s.role === "field" && s.empty)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  for (const field of fields) {
    const key = `${field.cls}:${Math.round(field.x)}:${Math.round(field.y)}`;
    if (tried.has(key)) continue;
    const token = available.get(field.cls)?.[0];
    if (!token) continue;
    return { kind: "fill", x: field.x, y: field.y, token, key };
  }

  const stillEmpty = slots.some((s) => s.role === "field" && s.empty);
  if (submit && !submitted && !stillEmpty) {
    const button = slots.find((s) => s.role === "button" && s.cls === "SUBMIT");
    if (button) return { kind: "submit", x: button.x, y: button.y };
  }
  if (submit && stillEmpty) return { kind: "done", reason: "Fill the empty fields, or put the values in the task, then press Start." };

  if (submit && submitted) return { kind: "done", reason: "Submitted." };
  if (legend.some((e) => !NEVER_RELEASE.has(e.cls as PiiClass))) return { kind: "done", reason: "Filled the matching fields." };
  return { kind: "done", reason: "Nothing on this page needed typing." };
}
