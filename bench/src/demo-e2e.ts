/**
 * Runs the scholarship portal against the real Parda server until the form is submitted.
 * Proves the leftover: empty page → redacted frames → actions → filled fields → submit.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { TokenVault, sanitizeInstruction } from "@parda/core";
import { launch } from "./browser";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const TASK =
  "Fill and submit the post-matric scholarship form. Applicant Meera Iyer, date of birth 14/08/2004, Aadhaar 2096 5442 5722, mobile 6811125709, email meera.iyer@example.in, PAN ETNPF3252Z, address 18, Lake View Road, Kochi, Kerala 400734, IFSC OQRZ0W73BGM, account 384920175633.";
const WANT: Record<string, string> = {
  name: "Meera Iyer",
  bday: "14/08/2004",
  aadhaar: "2096 5442 5722",
  mobile: "6811125709",
  email: "meera.iyer@example.in",
  pan: "ETNPF3252Z",
  address: "18, Lake View Road, Kochi, Kerala 400734",
  ifsc: "OQRZ0W73BGM",
  account: "384920175633",
};
const SIZES: Array<[number, number]> = [
  [1440, 900],
  [1920, 1080],
];

function waitHealth(url: string, ms = 20000): Promise<void> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () =>
      fetch(url)
        .then((r) => (r.ok ? resolve() : retry()))
        .catch(retry);
    const retry = () => (Date.now() - t0 > ms ? reject(new Error("server did not start")) : setTimeout(tick, 200));
    tick();
  });
}

async function main(): Promise<void> {
  const py = join(root, "server", ".venv", "Scripts", "python.exe");
  const api: ChildProcess = spawn(py, ["-m", "uvicorn", "parda_server.app:app", "--host", "127.0.0.1", "--port", "8000"], {
    cwd: join(root, "server"),
    env: { ...process.env, PARDA_PROVIDER: "fake" },
    stdio: "ignore",
  });
  const portalHtml = readFileSync(join(root, "demo", "portal", "index.html"));
  const staticServer = createServer((_, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(portalHtml));
  await new Promise<void>((r) => staticServer.listen(0, "127.0.0.1", r));
  const portalPort = (staticServer.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${portalPort}`;

  const probeBundle = await build({
    entryPoints: [join(here, "probe.ts")],
    bundle: true,
    format: "iife",
    write: false,
    platform: "browser",
    target: "chrome120",
    alias: { "@parda/core": join(root, "packages", "core", "src", "index.ts") },
  });
  const probe = probeBundle.outputFiles[0]!.text;

  try {
    await waitHealth("http://127.0.0.1:8000/healthz");
    const vault = new TokenVault(origin);
    const instruction = sanitizeInstruction(TASK, vault, { origin }).text;
    const legend = vault.legend();
    if (!legend.some((l) => l.cls === "AADHAAR")) throw new Error("instruction was not tokenized");

    const browser = await launch();
    for (const [W, H] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(origin + "/");
      await page.addScriptTag({ content: probe });
      await page.waitForFunction(() => "__parda" in window);

      const observations: Array<{ screenshot: string; url: string; text_observation: string }> = [];
      const turns: string[] = [];

      for (let n = 0; n < 24; n++) {
        const shot = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
        const jpeg = (await page.evaluate(async ([s]) => {
          const ops = (window as unknown as { __parda: { parda: (strict: boolean) => { ops: unknown } } }).__parda.parda(true).ops;
          return (window as unknown as { __parda: { render: (s: string, o: unknown) => Promise<string> } }).__parda.render(s, ops);
        }, [shot] as const)) as string;
        observations.push({ screenshot: jpeg.split(",")[1]!, url: origin + "/", text_observation: "" });
        const body = JSON.stringify({
          task_id: "demo",
          instruction,
          legend,
          viewport: { width: W, height: H },
          observations: observations.map((o, i) => (i < observations.length - 3 ? { ...o, screenshot: null } : o)),
          assistant_turns: turns,
        });
        const res = await fetch("http://127.0.0.1:8000/v1/step", { method: "POST", headers: { "content-type": "application/json" }, body });
        if (!res.ok) throw new Error(`step ${n}: ${res.status} ${await res.text()}`);
        const out = (await res.json()) as { action: { type: string; x?: number; y?: number; text?: string; answer?: string }; raw: string };
        turns.push(out.raw);
        const a = out.action;
        if (a.type === "done") {
          console.log(`${W}x${H} agent:`, a.answer);
          break;
        }
        if (a.type === "click" && a.x != null && a.y != null) {
          await page.mouse.click(a.x, a.y);
          await new Promise((r) => setTimeout(r, 80));
        } else if (a.type === "type") {
          const rawText = a.text ?? "";
          const value = rawText.replace(/\[[A-Z][A-Z_]*_\d{1,4}\]/g, (t) => vault.lookup(t)?.value ?? t);
          await page.keyboard.type(value, { delay: 8 });
        } else {
          throw new Error(`unexpected action ${JSON.stringify(a)}`);
        }
      }

      const got: Record<string, string> = {};
      for (const name of Object.keys(WANT)) got[name] = await page.locator(`input[name="${name}"]`).inputValue();
      const status = await page.locator("#done").getAttribute("data-status");
      console.log(JSON.stringify({ size: `${W}x${H}`, ...got, submitted: status === "ok", instructionHasPii: /\d{4}\s\d{4}\s\d{4}/.test(instruction) }));
      const misses = Object.entries(WANT).filter(([k, v]) => got[k] !== v).map(([k]) => `${k}=${got[k]!}`);
      if (misses.length || status !== "ok") {
        throw new Error(`demo did not finish the form at ${W}x${H}: ${misses.join("; ") || "fields ok"} status=${status}`);
      }
      await ctx.close();
    }
    await browser.close();
  } finally {
    staticServer.close();
    api.kill();
  }
}

await main();
