import { browser } from "wxt/browser";
import {
  NEVER_RELEASE,
  TOKEN_RE,
  TokenVault,
  evaluate,
  sanitizeAttr,
  sanitizeInstruction,
  targetFingerprint,
  sanitizeText,
  sanitizeUrl,
  type Action,
  type PiiClass,
  type PolicyDecision,
  type TargetInfo,
} from "@parda/core";
import { planLocal, wantsSubmit } from "./local";
import { postStep, serialize, type Observation, type StepInput, type StepOutput } from "./client";
import { ask } from "./messages";
import { captureRedacted, type CaptureOptions, type Captured, type VisionStack } from "./pipeline";
import type { Detection } from "./vision/types";

/** Controls the DOM cannot describe (canvas, images). Coordinates only: the glyphs stay in the masked pixels. */
function pixelControls(dets: Detection[]): string {
  const ui = dets.filter((d) => d.cls === "BUTTON" || d.cls === "INPUT" || d.cls === "CHECKBOX" || d.cls === "LINK");
  if (!ui.length) return "";
  const parts = ui.slice(0, 12).map((d) => `${d.cls} ${Math.round(d.rect.x)},${Math.round(d.rect.y)} ${Math.round(d.rect.w)}x${Math.round(d.rect.h)}`);
  return `Controls visible only as pixels: ${parts.join("; ")}.`;
}

/** Class and centre of each control. Values stay out of this string. */
function slotNote(slots: Array<{ role: string; cls: string; x: number; y: number; empty: boolean }>): string {
  if (!slots.length) return "";
  const parts = slots.slice(0, 24).map((s) => `${s.role} ${s.cls} ${s.empty ? "empty" : "filled"} ${Math.round(s.x)},${Math.round(s.y)}`);
  return `Slots: ${parts.join("; ")}.`;
}

export interface StepRecord {
  n: number;
  captured: Captured;
  /** Exact request body sent to the server. */
  body: string;
  response?: StepOutput;
  decision?: PolicyDecision;
  outcome: string;
  latencyMs: { client: number; server: number; roundTrip: number };
}

export interface AgentUi {
  onStep(rec: StepRecord): void;
  /** Resolves true if the user approves. `releases` maps tokens to the real values, shown locally only. */
  confirm(action: Action, decision: PolicyDecision, releases: Array<{ token: string; value: string }>): Promise<boolean>;
  askUser(question: string): Promise<string | null>;
  done(answer: string): void;
  error(message: string): void;
}

export interface AgentConfig {
  server: string;
  apiKey: string;
  maxSteps: number;
  capture: CaptureOptions;
  /** Default. Plans and types on this laptop. Nothing is posted. */
  local?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const READ_PAGE_MAX = 6000;

async function waitForLoad(tabId: number, timeoutMs = 10000): Promise<void> {
  const t0 = Date.now();
  await sleep(250);
  while (Date.now() - t0 < timeoutMs) {
    const tab = await browser.tabs.get(tabId);
    if (tab.status === "complete") return;
    await sleep(200);
  }
}

export class AgentRun {
  readonly vault: TokenVault;
  readonly steps: StepRecord[] = [];
  private readonly taskId = crypto.randomUUID();
  private readonly observations: Observation[] = [];
  private readonly turns: string[] = [];
  private instruction = "";
  private stopped = false;
  private abort = new AbortController();

  constructor(
    private readonly tabId: number,
    private readonly windowId: number,
    startOrigin: string,
    private readonly vision: VisionStack,
    private readonly cfg: AgentConfig,
    private readonly ui: AgentUi,
  ) {
    this.vault = new TokenVault(startOrigin);
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
  }

  /** Replaces tokens with real values for local display only. */
  reveal(text: string): string {
    return text.replace(TOKEN_RE, (t) => this.vault.lookup(t)?.value ?? t);
  }

  /**
   * On-device loop. No server. Shows the redacted frame, types task values into
   * matching fields, then submits if the task asked for that.
   */
  private async runLocal(): Promise<void> {
    const submit = wantsSubmit(this.instruction);
    const releases = this.vault
      .legend()
      .filter((entry) => !NEVER_RELEASE.has(entry.cls as PiiClass))
      .map((entry) => ({ token: entry.token, value: this.vault.lookup(entry.token)?.value ?? "" }));
    if (releases.length) {
      const ok = await this.ui.confirm(
        { type: "type", text: releases.map((r) => r.token).join(" ") },
        { verdict: "confirm", reasons: ["These values will be typed into matching fields on this page. They stay on this laptop."], releases: releases.map((r) => r.token) },
        releases,
      );
      if (!ok || this.stopped) return;
    }

    const usedTokens = new Set<string>();
    const tried = new Set<string>();
    let submitted = false;
    for (let n = 1; n <= this.cfg.maxSteps && !this.stopped; n++) {
      const t0 = performance.now();
      const captured = await captureRedacted(this.tabId, this.windowId, this.vault, this.vision, this.cfg.capture);
      const plan = planLocal(captured.perception.slots, this.vault.legend(), submit, usedTokens, tried, submitted);
      const t1 = performance.now();
      const action: Action =
        plan.kind === "fill"
          ? { type: "click", x: plan.x, y: plan.y }
          : plan.kind === "submit"
            ? { type: "click", x: plan.x, y: plan.y }
            : { type: "done", answer: plan.reason };
      const rec: StepRecord = {
        n,
        captured,
        body: "Stayed on this laptop. Nothing was posted.",
        response: { action, thoughts: "On this laptop.", raw: "", model: "local", timings: { model_ms: 0, total_ms: t1 - t0 } },
        outcome: "",
        latencyMs: { client: t1 - t0, server: 0, roundTrip: 0 },
      };
      this.steps.push(rec);
      this.ui.onStep(rec);
      if (plan.kind === "done") {
        rec.outcome = "finished";
        this.ui.done(plan.reason);
        return;
      }
      if (plan.kind === "fill") {
        const clicked = await this.apply(plan.kind === "fill" ? { type: "click", x: plan.x, y: plan.y } : action, true);
        rec.outcome = clicked;
        if (!clicked.startsWith("failed") && !clicked.startsWith("blocked") && clicked !== "declined by user") {
          const typed = await this.apply({ type: "type", text: plan.token }, true);
          rec.outcome = typed;
          this.ui.onStep(rec);
        }
        usedTokens.add(plan.token);
        tried.add(plan.key);
        if (clicked === "declined by user") return;
        continue;
      }
      submitted = true;
      const outcome = await this.apply({ type: "click", x: plan.x, y: plan.y }, false);
      rec.outcome = outcome;
      this.ui.onStep(rec);
      if (outcome === "declined by user") return;
    }
    if (!this.stopped) this.ui.error(`Stopped after ${this.cfg.maxSteps} steps.`);
  }

  /** Policy, consent, then the page. `preapproved` skips the per-field prompt after the task was approved. */
  private async apply(action: Action, preapproved: boolean): Promise<string> {
    if (action.type === "done") return action.type;
    const raw = await this.targetFor(action);
    const expect = raw ? targetFingerprint(raw) : undefined;
    const target = raw && { ...raw, name: sanitizeAttr(raw.name, this.vault, raw.origin) };
    const decision = evaluate(action, target, this.vault, this.vault.taskOrigin);
    if (decision.verdict === "deny") return `blocked: ${decision.reasons.join("; ")}`;
    if (decision.verdict === "confirm" && !(preapproved && action.type === "type")) {
      const releases = (decision.releases ?? []).map((token) => ({ token, value: this.vault.lookup(token)?.value ?? "" }));
      if (!(await this.ui.confirm(action, decision, releases))) return "declined by user";
    }
    return this.perform(action, decision, expect);
  }

  async run(rawInstruction: string): Promise<void> {
    this.instruction = sanitizeInstruction(rawInstruction, this.vault, { origin: this.vault.taskOrigin }).text;
    if (this.cfg.local !== false) {
      await this.runLocal();
      return;
    }
    let pendingText = "";
    let pendingReply = "";
    try {
      for (let n = 1; n <= this.cfg.maxSteps && !this.stopped; n++) {
        const t0 = performance.now();
        const captured = await captureRedacted(this.tabId, this.windowId, this.vault, this.vision, this.cfg.capture);
        const p = captured.perception;
        const note = [pendingText, pixelControls(captured.detections), slotNote(p.slots)].filter(Boolean).join("\n");
        this.observations.push({ frame: captured.frame, url: sanitizeUrl(p.url, this.vault), text_observation: note, user_response: pendingReply });
        pendingText = "";
        pendingReply = "";
        for (const o of this.observations.slice(0, -3)) delete o.frame;

        const input: StepInput = {
          task_id: this.taskId,
          instruction: this.instruction,
          legend: this.vault.legend(),
          viewport: { width: p.viewport.width, height: p.viewport.height },
          observations: this.observations,
          assistant_turns: this.turns,
        };
        const body = serialize(input);
        const t1 = performance.now();
        const response = await postStep(this.cfg.server, this.cfg.apiKey, body, this.abort.signal);
        const t2 = performance.now();
        this.turns.push(response.raw);
        const rec: StepRecord = {
          n,
          captured,
          body,
          response,
          outcome: "",
          latencyMs: { client: t1 - t0, server: response.timings.total_ms, roundTrip: t2 - t1 },
        };
        this.steps.push(rec);

        const a = response.action;
        if (a.type === "unsupported") {
          rec.outcome = `not executed: ${a.reason}`;
          pendingText = `That action could not be performed (${a.reason}). Choose a different action.`;
          this.ui.onStep(rec);
          continue;
        }
        if (a.type === "done") {
          rec.outcome = "finished";
          this.ui.onStep(rec);
          this.ui.done(this.reveal(a.answer ?? ""));
          return;
        }
        if (a.type === "ask_user") {
          rec.outcome = "asked the user";
          this.ui.onStep(rec);
          const reply = await this.ui.askUser(this.reveal(a.question));
          if (reply === null) return;
          pendingReply = sanitizeInstruction(reply, this.vault, { origin: p.origin }).text;
          continue;
        }

        const raw = await this.targetFor(a);
        const expect = raw ? targetFingerprint(raw) : undefined;
        // The accessible name is page text and can surface in reasons that are sent back to the model.
        const target = raw && { ...raw, name: sanitizeAttr(raw.name, this.vault, raw.origin) };
        const decision = evaluate(a, target, this.vault, p.origin);
        rec.decision = decision;
        if (decision.verdict === "deny") {
          rec.outcome = `blocked: ${decision.reasons.join("; ")}`;
          pendingText = `The browser blocked that action: ${decision.reasons.join("; ")}. Choose a different action.`;
          this.ui.onStep(rec);
          continue;
        }
        if (decision.verdict === "confirm") {
          const releases = (decision.releases ?? []).map((token) => ({ token, value: this.vault.lookup(token)?.value ?? "" }));
          this.ui.onStep({ ...rec, outcome: "waiting for approval" });
          if (!(await this.ui.confirm(a, decision, releases))) {
            rec.outcome = "declined by user";
            pendingText = "The user declined that action. Ask the user how to proceed or choose a different action.";
            this.ui.onStep(rec);
            continue;
          }
        }
        rec.outcome = await this.perform(a, decision, expect);
        if (rec.outcome.startsWith("failed: the target changed")) {
          pendingText = "The page changed before the action ran, so it was not performed. Look at the new screenshot.";
        }
        if (a.type === "read_page") {
          // Same text and spans as the screenshot redaction, so label/value layouts are covered here too.
          const page = await ask(this.tabId, { kind: "readPage" });
          // Cut at a line end, and clip spans that cross the cut so a truncated value is still replaced.
          const nl = page.text.lastIndexOf("\n", READ_PAGE_MAX);
          const cut = page.text.length <= READ_PAGE_MAX ? page.text.length : nl > 0 ? nl : READ_PAGE_MAX;
          const clean = sanitizeText(page.text.slice(0, cut), this.vault, {
            origin: p.origin,
            extra: page.spans.filter((s) => s.start < cut).map((s) => ({ ...s, end: Math.min(s.end, cut) })),
          }).text;
          pendingText = `I read the page to answer: ${a.question}\nPage text:\n${clean}`;
        }
        this.ui.onStep(rec);
      }
      if (!this.stopped) this.ui.error(`stopped after ${this.cfg.maxSteps} steps`);
    } catch (e) {
      if (!this.stopped) this.ui.error(e instanceof Error ? e.message : String(e));
    }
  }

  private async targetFor(a: Action): Promise<TargetInfo | null> {
    if (a.type === "click" || a.type === "hover") return ask(this.tabId, { kind: "targetAt", x: a.x, y: a.y });
    if (a.type === "type") return ask(this.tabId, { kind: "focused" });
    return null;
  }

  private async perform(a: Action, d: PolicyDecision, expect?: string): Promise<string> {
    switch (a.type) {
      case "navigate":
        await browser.tabs.update(this.tabId, { url: a.url });
        await waitForLoad(this.tabId);
        return `navigated to ${new URL(a.url).origin}`;
      case "back":
        await browser.tabs.goBack(this.tabId);
        await waitForLoad(this.tabId);
        return "went back";
      case "wait":
        await sleep(Math.min(a.seconds, 30) * 1000);
        return `waited ${a.seconds}s`;
      case "memorize":
      case "read_page":
        return a.type === "memorize" ? "noted" : "read the page";
      default: {
        const effect = await ask(this.tabId, { kind: "execute", action: a, resolvedText: d.resolvedText, expect });
        await waitForLoad(this.tabId, 5000);
        return effect.ok ? effect.detail : `failed: ${effect.detail}`;
      }
    }
  }
}
