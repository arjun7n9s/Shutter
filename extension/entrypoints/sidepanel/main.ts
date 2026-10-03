import { browser } from "wxt/browser";
import type { Action, PolicyDecision } from "@parda/core";
import { AgentRun, type StepRecord } from "../../lib/agent";
import { ask } from "../../lib/messages";
import type { VisionStack } from "../../lib/pipeline";
import { CodeDetector } from "../../lib/vision/codes";
import { ScreenVit } from "../../lib/vision/screenvit";
import type { VisionModel } from "../../lib/vision/types";
import { YuNet } from "../../lib/vision/yunet";

const SERVER = __PARDA_SERVER__;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function chip(label: string, state: "ok" | "off" | "bad", title = ""): HTMLElement {
  return el("span", { className: `chip ${state}`, title, textContent: label });
}

const vision: VisionStack = { models: [], faceModel: false };
const chips = new Map<string, HTMLElement>();
function setChip(key: string, c: HTMLElement): void {
  chips.get(key)?.remove();
  chips.set(key, c);
  $("status").append(c);
}

const CHIP_NAME: Record<string, string> = { faces: "Faces", codes: "Codes", "screen-vit": "Screen", server: "Server" };

async function loadModels(): Promise<void> {
  const candidates: Array<[string, VisionModel & { backend?: string }]> = [
    ["faces", new YuNet()],
    ["codes", new CodeDetector()],
    ["screen-vit", new ScreenVit()],
  ];
  await Promise.all(
    candidates.map(async ([key, m]) => {
      const name = CHIP_NAME[key] ?? key;
      setChip(key, chip(name, "off", "Loading"));
      try {
        const ok = await m.load();
        if (ok) {
          vision.models.push(m);
          if (m instanceof YuNet) vision.faceModel = true;
        }
        setChip(key, chip(name, ok ? "ok" : "off", ok ? `${m.name}${m.backend ? ` · ${m.backend}` : ""}` : `${m.name} missing`));
      } catch (e) {
        setChip(key, chip(name, "bad", String(e)));
      }
    }),
  );
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function describe(a: Action): string {
  switch (a.type) {
    case "click":
      return `click at (${Math.round(a.x)}, ${Math.round(a.y)})${a.count && a.count > 1 ? ` ×${a.count}` : ""}`;
    case "hover":
      return `hover at (${Math.round(a.x)}, ${Math.round(a.y)})`;
    case "type":
      return `type "${a.text}"${a.pressEnter ? " + Enter" : ""}`;
    case "key":
      return `press ${a.keys.join("+")}`;
    case "scroll":
      return `scroll ${a.dy >= 0 ? "down" : "up"} ${Math.abs(Math.round(a.dy || a.dx))}px`;
    case "navigate":
      return `open ${a.url}`;
    default:
      return a.type.replace("_", " ");
  }
}

let run: AgentRun | null = null;

function renderStep(rec: StepRecord): void {
  const c = rec.captured;
  $<HTMLImageElement>("frame").src = `data:${c.frame.mime};base64,${c.frame.b64}`;
  $("frame-wrap").classList.add("has-shot");
  $("bytes").textContent = `${(rec.body.length / 1024).toFixed(0)} KB request · image ${(c.frame.bytes / 1024).toFixed(0)} KB`;
  const tokens = c.items.filter((i) => i.kind === "token").length;
  const solids = c.items.filter((i) => i.kind === "solid").length;
  const m = $("metrics");
  m.replaceChildren(
    ...[
      [String(tokens), "tokens drawn"],
      [String(solids), "solid masks"],
      [String(c.detections.length), "vision detections"],
      [`${Math.round(c.timings.total)} ms`, "on-device redaction"],
      [`${Math.round(c.timings.vision)} ms`, "vision models"],
      [`${Math.round(rec.latencyMs.roundTrip)} ms`, "server round trip"],
    ].map(([b, s]) => el("div", {}, el("b", { textContent: b }), el("span", { textContent: s }))),
  );
  const shown = rec.body.replace(/"screenshot":"[^"]{64,}"/g, (s) => `"screenshot":"<${s.length - 15} base64 chars, shown above>"`);
  $("body").textContent = shown;
  void sha256(rec.body).then((h) => ($("hash").textContent = `sha256 ${h.slice(0, 16)}…`));
  $("copy").onclick = () => void navigator.clipboard.writeText(rec.body);

  if (run) {
    $("legend").replaceChildren(
      ...run.vault.legend().map(({ token }) =>
        el("tr", {}, el("td", { className: "mono", textContent: token }), el("td", { className: "value", textContent: run!.vault.lookup(token)?.value ?? "" })),
      ),
    );
  }

  const r = rec.response;
  const li = document.getElementById(`step-${rec.n}`) ?? el("li", { id: `step-${rec.n}` });
  const verdict = rec.decision?.verdict;
  li.replaceChildren(
    el("div", { textContent: r ? describe(r.action as Action) : "…" }),
    el("div", { className: "thought", textContent: r?.thoughts ?? "" }),
    el("div", { className: verdict ? `verdict-${verdict}` : "", textContent: rec.outcome }),
  );
  if (!li.isConnected) $("log").prepend(li);
}

function showPrompt(build: (card: HTMLElement, close: () => void) => void): void {
  const card = $("prompt");
  card.classList.remove("hidden");
  card.replaceChildren();
  build(card, () => {
    card.classList.add("hidden");
    card.replaceChildren();
  });
}

function confirmCard(a: Action, d: PolicyDecision, releases: Array<{ token: string; value: string }>): Promise<boolean> {
  return new Promise((resolve) =>
    showPrompt((card, close) => {
      const yes = el("button", { className: "primary", textContent: "Approve" });
      const no = el("button", { className: "danger", textContent: "Decline" });
      yes.onclick = () => (close(), resolve(true));
      no.onclick = () => (close(), resolve(false));
      card.append(
        el("h3", { textContent: `Approve: ${describe(a)}?` }),
        el("ul", {}, ...d.reasons.map((r) => el("li", { textContent: r }))),
      );
      if (releases.length) {
        card.append(
          el("div", { className: "muted", textContent: "These values will be typed into the page. They are never sent to the server." }),
          el("table", {}, ...releases.map((r) => el("tr", {}, el("td", { className: "mono", textContent: r.token }), el("td", { textContent: r.value })))),
        );
      }
      card.append(el("div", { className: "row" }, yes, no));
    }),
  );
}

function askCard(question: string): Promise<string | null> {
  return new Promise((resolve) =>
    showPrompt((card, close) => {
      const input = el("textarea", { rows: 2 });
      const send = el("button", { className: "primary", textContent: "Reply" });
      const cancel = el("button", { textContent: "End task" });
      send.onclick = () => (close(), resolve(input.value));
      cancel.onclick = () => (close(), resolve(null));
      card.append(el("h3", { textContent: "The agent asks" }), el("p", { textContent: question }), input, el("div", { className: "row" }, send, cancel));
      input.focus();
    }),
  );
}

function setRunning(on: boolean): void {
  $<HTMLButtonElement>("start").disabled = on;
  $<HTMLButtonElement>("stop").disabled = !on;
  document.body.classList.toggle("is-running", on);
  $("runstate").textContent = on ? "Running" : "Idle";
}

$("start").onclick = async () => {
  const instruction = $<HTMLTextAreaElement>("instruction").value.trim();
  if (!instruction) {
    showPrompt((card, close) =>
      card.append(
        el("h3", { textContent: "Write the task first" }),
        el("p", { textContent: "Say what the agent should do on this page. Values in that sentence are replaced before they are sent." }),
        el("button", { className: "primary", textContent: "OK", onclick: close }),
      ),
    );
    return;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    showPrompt((card, close) => card.append(el("p", { textContent: "Open a web page first." }), el("button", { textContent: "OK", onclick: close })));
    return;
  }
  await ask(tab.id, { kind: "ping" });
  const { apiKey = "" } = (await browser.storage.local.get("apiKey")) as { apiKey?: string };
  $("log").replaceChildren();
  setRunning(true);
  run = new AgentRun(tab.id, tab.windowId, new URL(tab.url).origin, vision, {
    server: SERVER,
    apiKey,
    maxSteps: 40,
    local: true,
    capture: { strictMedia: $<HTMLInputElement>("strict").checked },
  }, {
    onStep: renderStep,
    confirm: async (a, d, releases) => {
      if ($<HTMLInputElement>("trust").checked) return true;
      return confirmCard(a, d, releases);
    },
    askUser: askCard,
    done: (answer) => showPrompt((card, close) => card.append(el("h3", { textContent: "Done" }), el("p", { textContent: answer || "Task finished." }), el("button", { textContent: "OK", onclick: close }))),
    error: (msg) => showPrompt((card, close) => card.append(el("h3", { textContent: "Stopped" }), el("p", { textContent: msg }), el("button", { textContent: "OK", onclick: close }))),
  });
  await run.run(instruction);
  setRunning(false);
};

$("stop").onclick = () => {
  run?.stop();
  setRunning(false);
};

void loadModels();
