import type { Action, PiiClass } from "@parda/core";
import type { RedactedFrame } from "./render";

export interface Observation {
  frame?: RedactedFrame;
  url: string;
  text_observation?: string;
  user_response?: string;
}

export interface StepInput {
  task_id: string;
  instruction: string;
  legend: Array<{ token: string; cls: PiiClass }>;
  viewport: { width: number; height: number };
  observations: Observation[];
  assistant_turns: string[];
}

export type ServerAction = Action | { type: "unsupported"; reason: string };

export interface StepOutput {
  action: ServerAction;
  thoughts: string;
  raw: string;
  model: string;
  timings: { model_ms: number; total_ms: number };
}

/** Screenshots older than this are dropped client-side; the server keeps at most three anyway. */
export const KEEP_FRAMES = 3;

/** The exact request body. The ledger shows this same string, so what the user inspects is what is sent. */
export function serialize(input: StepInput): string {
  const n = input.observations.length;
  return JSON.stringify({
    ...input,
    observations: input.observations.map((o, i) => ({
      screenshot: i >= n - KEEP_FRAMES && o.frame ? o.frame.b64 : null,
      url: o.url,
      text_observation: o.text_observation ?? "",
      user_response: o.user_response ?? "",
    })),
  });
}

export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function postStep(server: string, apiKey: string, body: string, signal?: AbortSignal): Promise<StepOutput> {
  const r = await fetch(`${server}/v1/step`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body,
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      detail = ((await r.json()) as { detail?: string }).detail ?? detail;
    } catch {
      /* not json */
    }
    throw new ServerError(r.status, detail);
  }
  return (await r.json()) as StepOutput;
}
