// Runs the shipped screen-vit.onnx in Chromium through onnxruntime-web (WASM, the side panel's
// backend) on Chromium-captured pages, so latency is the number the extension would see.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser";

const root = normalize(join(fileURLToPath(import.meta.url), "..", "..", ".."));
const defaults = ["bench/out/real/portal.png", "bench/out/real/id_card_meera.png"].filter((p) => existsSync(join(root, p)));
const images = process.argv.slice(2).length ? process.argv.slice(2) : defaults;
const TYPES: Record<string, string> = { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".html": "text/html", ".onnx": "application/octet-stream" };
const ortDir = existsSync(join(root, "extension", "node_modules", "onnxruntime-web", "dist"))
  ? "/extension/node_modules/onnxruntime-web/dist/"
  : "/node_modules/onnxruntime-web/dist/";

const PAGE = `<!doctype html><script type="module">
import * as ort from "${ortDir}ort.wasm.min.mjs";
ort.env.wasm.wasmPaths = "${ortDir}";
ort.env.wasm.numThreads = 1;
window.run = async (names) => {
  const meta = await (await fetch("/models/screen-vit/export/screen-vit.json")).json();
  const t0 = performance.now();
  const session = await ort.InferenceSession.create("/models/screen-vit/export/screen-vit.onnx", { executionProviders: ["wasm"] });
  const loadMs = performance.now() - t0;
  const R = meta.resolution, out = [];
  for (const name of names) {
    const img = new Image();
    img.src = "/" + name.replace(/^\\/+/, "");
    await img.decode();
    const c = new OffscreenCanvas(R, R), g = c.getContext("2d");
    g.drawImage(img, 0, 0, R, R);
    const px = g.getImageData(0, 0, R, R).data, data = new Float32Array(3 * R * R);
    for (let i = 0; i < R * R; i++) for (let k = 0; k < 3; k++) data[k * R * R + i] = (px[i * 4 + k] / 255 - meta.mean[k]) / meta.std[k];
    const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", data, [1, 3, R, R]) };
    const times = [];
    let res;
    for (let r = 0; r < 4; r++) { const s = performance.now(); res = await session.run(feeds); times.push(performance.now() - s); }
    const boxes = res.dets.data, logits = res.labels.data, nq = boxes.length / 4, nc = logits.length / nq, dets = [];
    for (let q = 0; q < nq; q++) {
      let best = -Infinity, bi = -1;
      for (let k = 0; k < nc; k++) if (logits[q * nc + k] > best) { best = logits[q * nc + k]; bi = k; }
      const cls = meta.classes[bi], score = 1 / (1 + Math.exp(-best));
      if (cls && score >= (meta.thresholds[cls] ?? 0.5)) dets.push({ cls, score: +score.toFixed(3) });
    }
    dets.sort((a, b) => b.score - a.score);
    const mid = times.slice(1).sort((a, b) => a - b);
    out.push({ name, ms: mid[Math.floor(mid.length / 2)], dets: dets.length });
  }
  return { loadMs, backend: "wasm", out };
};
window.ready = true;
</script>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  if (path === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  try {
    const body = await readFile(join(root, normalize(path)));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error", e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready);
  const result = await page.evaluate((n) => (window as unknown as { run: (n: string[]) => Promise<unknown> }).run(n), images);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
