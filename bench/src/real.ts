/**
 * Dump Chromium-rendered pages (the demo portal and canvas-only e-IDs) plus DOM redaction
 * from the production probe. Vision scoring is models/screen-vit/eval_real.py: same ONNX
 * the extension ships, on these screenshots, not on PIL training scenes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { launch } from "./browser";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const OUT = join(here, "..", "out", "real");
const W = 1440;
const H = 900;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".onnx": "application/octet-stream",
};

function idCardPage(name: string, dob: string, aadhaar: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>e-Aadhaar Preview</title>
<style>body{margin:32px;font:16px/1.4 "Segoe UI",sans-serif;background:#eef2f6;color:#1b2430}
h1{font-size:22px}canvas{border:1px solid #ccc;border-radius:10px;background:#fff}</style></head>
<body><h1>Downloaded document</h1>
<canvas id="card" width="640" height="380"></canvas>
<p>This preview is rendered on a canvas, so the DOM has no text for it.</p>
<p><button>Download</button><button>Verify QR</button></p>
<script>
window.__gt = [];
const c = document.getElementById("card"), x = c.getContext("2d");
x.fillStyle = "#fffdf5"; x.fillRect(0, 0, 640, 380);
x.fillStyle = "#b8860b"; x.fillRect(0, 0, 640, 44);
x.fillStyle = "#fff"; x.font = "bold 20px Arial"; x.fillText("Government of India", 20, 29);
x.fillStyle = "#ccd"; x.fillRect(24, 70, 120, 150);
x.fillStyle = "#222";
const r0 = c.getBoundingClientRect();
function box(cls, x0, y0, w, h) {
  window.__gt.push({ cls, rect: { x: r0.left + x0, y: r0.top + y0, w, h } });
}
function line(t, cls, y, prefix) {
  x.fillText(prefix + t, 170, y);
  const w0 = x.measureText(prefix).width, w = x.measureText(t).width;
  if (cls) box(cls, 170 + w0, y - 16, w, 21);
}
box("ID_DOCUMENT", 0, 0, 640, 380);
box("FACE", 24, 70, 120, 150);
x.font = "18px Arial";
line(${JSON.stringify(name)}, "PERSON", 96, "");
line(${JSON.stringify(dob)}, "DOB", 128, "DOB: ");
line("Female", null, 160, "");
x.font = "bold 30px Arial";
line(${JSON.stringify(aadhaar)}, "AADHAAR", 300, "");
x.font = "italic 22px Arial"; x.fillStyle = "#163";
line(${JSON.stringify(name)}, "SIGNATURE", 350, "");
</script></body></html>`;
}

const PAGES: Array<{ id: string; path: string; file?: string; html?: string }> = [
  { id: "portal", path: "/portal/", file: join(root, "demo", "portal", "index.html") },
  { id: "id_card_meera", path: "/id_card_meera.html", html: idCardPage("Meera Iyer", "14/08/2004", "2096 5442 5722") },
  { id: "id_card_rahul", path: "/id_card_rahul.html", html: idCardPage("Rahul Verma", "03/11/1991", "7641 8823 0916") },
  { id: "id_card_anita", path: "/id_card_anita.html", html: idCardPage("Anita Sharma", "22/01/1988", "4523 0198 7761") },
];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
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

  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const page = PAGES.find((p) => url === p.path || url === p.path.replace(/\/$/, ""));
    if (page?.html) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page.html);
      return;
    }
    if (page?.file) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(await readFile(page.file));
      return;
    }
    try {
      const body = await readFile(join(root, normalize(url)));
      res.writeHead(200, { "content-type": TYPES[extname(url)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const dumps = [];

  for (const spec of PAGES) {
    await page.goto(`http://127.0.0.1:${port}${spec.path}`);
    await new Promise((r) => setTimeout(r, 250));
    await page.addScriptTag({ content: probe });
    await page.waitForFunction(() => "__parda" in window);
    const gt = (await page.evaluate(() => {
      const items = (window as unknown as { __parda: { groundTruth: () => Array<{ cls: string; rects: unknown[] }> } }).__parda.groundTruth();
      const canvas = new Set(((window as unknown as { __gt?: Array<{ cls: string }> }).__gt ?? []).map((g) => g.cls + JSON.stringify(g)));
      return items.map((it) => ({
        ...it,
        source: it.rects.some((r) => canvas.has(it.cls + JSON.stringify({ cls: it.cls, rect: r }))) ? "canvas" : "dom",
      }));
    })) as Array<{ cls: string; rects: Array<{ x: number; y: number; w: number; h: number }>; source: string }>;
    const canvasGt = (await page.evaluate(() => (window as unknown as { __gt?: unknown[] }).__gt ?? [])) as Array<{
      cls: string;
      rect: { x: number; y: number; w: number; h: number };
    }>;
    const media = (await page.evaluate(() =>
      [...document.querySelectorAll("canvas,img,video,iframe")].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      }),
    )) as Array<{ x: number; y: number; w: number; h: number }>;
    const noStrict = await page.evaluate((s) => (window as unknown as { __parda: { parda: (s: boolean) => unknown } }).__parda.parda(s), false);
    const strict = await page.evaluate((s) => (window as unknown as { __parda: { parda: (s: boolean) => unknown } }).__parda.parda(s), true);
    const png = await page.screenshot({ type: "png" });
    writeFileSync(join(OUT, `${spec.id}.png`), png);
    const dump = {
      id: spec.id,
      url: spec.path,
      viewport: { width: W, height: H },
      gt,
      canvasGt,
      media,
      noStrict,
      strict,
    };
    writeFileSync(join(OUT, `${spec.id}.json`), JSON.stringify(dump));
    dumps.push({ id: spec.id, png: `${spec.id}.png`, json: `${spec.id}.json`, canvasItems: canvasGt.length, gtItems: gt.length });
    console.log(`${spec.id}: ${gt.length} gt items, ${canvasGt.length} canvas boxes, png ${(png.length / 1024).toFixed(0)} KB`);
  }

  writeFileSync(join(OUT, "index.json"), JSON.stringify({ viewport: { width: W, height: H }, pages: dumps }, null, 2));
  await browser.close();
  server.close();
}

await main();
