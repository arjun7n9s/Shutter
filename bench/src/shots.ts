/**
 * Working pictures: the scholarship page, the JPEG the redactor actually emits,
 * the filled form, and the side panel showing that same frame.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { TokenVault, sanitizeInstruction } from "@parda/core";
import { launch } from "./browser";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = join(root, "docs", "shots");
const TASK =
  "Fill and submit the post-matric scholarship form. Applicant Meera Iyer, date of birth 14/08/2004, Aadhaar 2096 5442 5722, mobile 6811125709, email meera.iyer@example.in, PAN ETNPF3252Z, address 18, Lake View Road, Kochi, Kerala 400734, IFSC OQRZ0W73BGM, account 384920175633.";

function waitHealth(url: string, ms = 20000): Promise<void> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => fetch(url).then((r) => (r.ok ? resolve() : retry())).catch(retry);
    const retry = () => (Date.now() - t0 > ms ? reject(new Error("server did not start")) : setTimeout(tick, 200));
    tick();
  });
}

async function redact(page: import("playwright").Page): Promise<{ jpeg: string; legend: Array<{ token: string; cls: string }>; ms: number; tokens: number; solids: number }> {
  const shot = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
  const t0 = Date.now();
  const out = (await page.evaluate(async (s) => {
    const api = (window as unknown as { __parda: { parda: (strict: boolean) => { ops: unknown; legend: Array<{ token: string; cls: string }>; items: Array<{ kind: string }> }; render: (s: string, o: unknown) => Promise<string> } }).__parda;
    const planned = api.parda(true);
    const jpeg = await api.render(s, planned.ops);
    return {
      jpeg,
      legend: planned.legend,
      tokens: planned.items.filter((i) => i.kind === "token").length,
      solids: planned.items.filter((i) => i.kind === "solid").length,
    };
  }, shot)) as { jpeg: string; legend: Array<{ token: string; cls: string }>; tokens: number; solids: number };
  return { ...out, ms: Date.now() - t0 };
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  let api: ChildProcess | null = null;
  try {
    await waitHealth("http://127.0.0.1:8000/healthz", 1500);
  } catch {
    const py = join(root, "server", ".venv", "Scripts", "python.exe");
    api = spawn(py, ["-m", "uvicorn", "parda_server.app:app", "--host", "127.0.0.1", "--port", "8000"], {
      cwd: join(root, "server"),
      env: { ...process.env, PARDA_PROVIDER: "fake" },
      stdio: "ignore",
    });
    await waitHealth("http://127.0.0.1:8000/healthz");
  }

  const portalHtml = readFileSync(join(root, "demo", "portal", "index.html"));
  const staticServer = createServer((_, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(portalHtml));
  await new Promise<void>((r) => staticServer.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(staticServer.address() as { port: number }).port}`;

  const probe = (
    await build({
      entryPoints: [join(here, "probe.ts")],
      bundle: true,
      format: "iife",
      write: false,
      platform: "browser",
      target: "chrome120",
      alias: { "@parda/core": join(root, "packages", "core", "src", "index.ts") },
    })
  ).outputFiles[0]!.text;

  const vault = new TokenVault(origin);
  const instruction = sanitizeInstruction(TASK, vault, { origin }).text;
  const legend = vault.legend();
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(origin + "/");
    await page.screenshot({ path: join(outDir, "01-portal.png") });
    await page.addScriptTag({ content: probe });
    await page.waitForFunction(() => "__parda" in window);

    const covered = await redact(page);
    writeFileSync(join(outDir, "02-covered.jpg"), Buffer.from(covered.jpeg.split(",")[1]!, "base64"));

    const observations: Array<{ screenshot: string; url: string; text_observation: string }> = [];
    const turns: string[] = [];
    for (let n = 0; n < 24; n++) {
      const shot = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
      const jpeg = (await page.evaluate(async (s) => {
        const api = (window as unknown as { __parda: { parda: (strict: boolean) => { ops: unknown }; render: (s: string, o: unknown) => Promise<string> } }).__parda;
        return api.render(s, api.parda(true).ops);
      }, shot)) as string;
      observations.push({ screenshot: jpeg.split(",")[1]!, url: origin + "/", text_observation: "" });
      const body = JSON.stringify({
        task_id: "shots",
        instruction,
        legend,
        viewport: { width: 1440, height: 900 },
        observations: observations.map((o, i) => (i < observations.length - 3 ? { ...o, screenshot: null } : o)),
        assistant_turns: turns,
      });
      const res = await fetch("http://127.0.0.1:8000/v1/step", { method: "POST", headers: { "content-type": "application/json" }, body });
      if (!res.ok) throw new Error(`step ${n}: ${res.status} ${await res.text()}`);
      const step = (await res.json()) as { action: { type: string; x?: number; y?: number; text?: string }; raw: string };
      turns.push(step.raw);
      const a = step.action;
      if (a.type === "done") break;
      if (a.type === "click" && a.x != null && a.y != null) {
        await page.mouse.click(a.x, a.y);
        await new Promise((r) => setTimeout(r, 60));
      } else if (a.type === "type") {
        const value = (a.text ?? "").replace(/\[[A-Z][A-Z_]*_\d{1,4}\]/g, (t) => vault.lookup(t)?.value ?? t);
        await page.keyboard.type(value, { delay: 4 });
      } else {
        throw new Error(`unexpected action ${JSON.stringify(a)}`);
      }
    }

    await page.screenshot({ path: join(outDir, "03-submitted.png") });
    const sent = await redact(page);
    writeFileSync(join(outDir, "04-sent.jpg"), Buffer.from(sent.jpeg.split(",")[1]!, "base64"));
    const form = await page.locator("main").boundingBox();
    if (form) {
      await page.screenshot({ path: join(outDir, "05-sent-form.jpg"), type: "jpeg", quality: 90, clip: form });
      // The clip above is the live page. Re-shoot the redacted JPEG through an image so the crop is the server's frame.
    }
    const framePage = await ctx.newPage();
    await framePage.setViewportSize({ width: 1440, height: 900 });
    await framePage.setContent(`<img id="f" src="${sent.jpeg}" style="display:block;width:1440px;height:900px">`);
    await framePage.locator("#f").waitFor();
    if (form) await framePage.screenshot({ path: join(outDir, "05-sent-form.jpg"), type: "jpeg", quality: 90, clip: form });

    const panel = await ctx.newPage();
    await panel.setViewportSize({ width: 420, height: 900 });
    await panel.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
    const panelDir = join(root, "extension", "entrypoints", "sidepanel");
    const panelServer = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const file = join(panelDir, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
      try {
        const body = readFileSync(file);
        const type = file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : "text/html";
        res.writeHead(200, { "content-type": type }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => panelServer.listen(0, "127.0.0.1", r));
    const panelOrigin = `http://127.0.0.1:${(panelServer.address() as { port: number }).port}`;
    await panel.goto(panelOrigin + "/");
    await panel.evaluate(
      ({ jpeg, rows, ms, tokens, solids, task }) => {
        const $ = (id: string) => document.getElementById(id)!;
        (document.getElementById("instruction") as HTMLTextAreaElement).value = task;
        document.body.classList.add("is-running");
        $("runstate").textContent = "Running";
        $("status").innerHTML = `<span class="chip ok">Faces</span><span class="chip ok">Codes</span><span class="chip ok">Screen</span><span class="chip ok">Server</span>`;
        ($("frame") as HTMLImageElement).src = jpeg;
        $("frame-wrap").classList.add("has-shot");
        $("bytes").textContent = `${Math.round(jpeg.length * 0.75 / 1024)} KB request`;
        const metrics = $("metrics");
        for (const [b, s] of [
          [String(tokens), "tokens drawn"],
          [String(solids), "solid masks"],
          [`${ms} ms`, "on-device redaction"],
          ["0", "values sent"],
        ] as const) {
          const d = document.createElement("div");
          const strong = document.createElement("b");
          strong.textContent = b;
          const span = document.createElement("span");
          span.textContent = s;
          d.append(strong, span);
          metrics.append(d);
        }
        const table = $("legend");
        for (const row of rows) {
          const tr = document.createElement("tr");
          const a = document.createElement("td");
          a.className = "mono";
          a.textContent = row.token;
          const b = document.createElement("td");
          b.className = "value";
          b.textContent = row.value;
          tr.append(a, b);
          table.append(tr);
        }
        const log = $("log");
        const li = document.createElement("li");
        li.innerHTML = `<div>type "[AADHAAR_1]"</div><div class="thought">The Aadhaar field is the one on this form.</div><div class="verdict-allow">typed into the matching field</div>`;
        log.append(li);
        document.querySelector("details:last-of-type")?.setAttribute("open", "");
      },
      {
        jpeg: sent.jpeg,
        rows: legend.map((l) => ({ token: l.token, value: vault.lookup(l.token)?.value ?? "" })),
        ms: sent.ms,
        tokens: sent.tokens,
        solids: sent.solids,
        task: TASK,
      },
    );
    await panel.screenshot({ path: join(outDir, "06-panel.png"), fullPage: true });
    panelServer.close();
    await ctx.close();
    console.log("wrote", outDir);
  } finally {
    await browser.close();
    staticServer.close();
    api?.kill();
  }
}

await main();
