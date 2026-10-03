import { browser } from "wxt/browser";
import type { Action, Span, TargetInfo } from "@parda/core";
import type { Effect } from "./act";
import type { Perception } from "./perceive";

export type PageRequest =
  | { kind: "perceive" }
  | { kind: "targetAt"; x: number; y: number }
  | { kind: "focused" }
  /** `expect` is the target fingerprint the decision was made on; execution is refused if it changed. */
  | { kind: "execute"; action: Action; resolvedText?: string; expect?: string }
  | { kind: "readPage" }
  | { kind: "ping" };

export interface PageResponses {
  perceive: Perception;
  targetAt: TargetInfo | null;
  focused: TargetInfo | null;
  execute: Effect;
  readPage: { text: string; spans: Span[] };
  ping: "pong";
}

export async function ask<K extends PageRequest["kind"]>(
  tabId: number,
  req: Extract<PageRequest, { kind: K }>,
): Promise<PageResponses[K]> {
  try {
    return (await browser.tabs.sendMessage(tabId, req, { frameId: 0 })) as PageResponses[K];
  } catch (e) {
    // Tabs opened before the extension was installed have no content script yet.
    if (!String(e).includes("Receiving end does not exist")) throw e;
    await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/content.js"] });
    return (await browser.tabs.sendMessage(tabId, req, { frameId: 0 })) as PageResponses[K];
  }
}
