import { browser } from "wxt/browser";
import { execute, focusedTarget, targetAt } from "../lib/act";
import type { PageRequest } from "../lib/messages";
import { perceive } from "../lib/perceive";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    const g = globalThis as { __pardaReady?: boolean };
    if (g.__pardaReady) return;
    g.__pardaReady = true;
    browser.runtime.onMessage.addListener((req: PageRequest, sender, reply) => {
      if (sender.id !== browser.runtime.id) return false;
      try {
        switch (req.kind) {
          case "ping":
            reply("pong");
            break;
          case "perceive":
            reply(perceive(window));
            break;
          case "targetAt":
            reply(targetAt(req.x, req.y));
            break;
          case "focused":
            reply(focusedTarget());
            break;
          case "execute":
            reply(execute(req.action, req.resolvedText, req.expect));
            break;
          case "readPage":
            reply(perceive(window, { withText: true, allText: true }).page!);
            break;
        }
      } catch (e) {
        reply({ ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
      return false;
    });
  },
});
