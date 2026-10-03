/**
 * Privacy-utility benchmark. For each synthetic page and each redaction mode, measures:
 *  - item recall: ground-truth PII items whose pixels are >= 90% covered by a mask or token
 *  - class accuracy: covered items whose drawn token carries the right class
 *  - pixel leakage: share of ground-truth PII pixels left visible
 *  - detection precision: share of Parda's detection items (strict-media masks excluded) that sit on ground-truth PII
 *  - redaction precision: share of all masked pixels, media included, that are ground-truth PII
 *  - context retained: share of non-PII text pixels left readable (utility proxy)
 *  - on-device latency of perception + planning
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { DrawOp, Rect } from "@parda/core";

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS_NAME = process.argv[2] ?? "generated";
const CORPUS = join(here, "..", "corpus", CORPUS_NAME);
const OUT = join(here, "..", "out", CORPUS_NAME === "generated" ? "" : CORPUS_NAME);
const W = 1440;
const H = 900;
const COVERED = 0.9;

type Mode = "raw" | "blanket" | "parda" | "parda_no_strict";
const MODES: Mode[] = ["raw", "blanket", "parda", "parda_no_strict"];

interface GtItem {
  cls: string;
  rects: Rect[];
}
interface PardaOut {
  ops: DrawOp[];
  items: Array<{ rect: Rect; cls: string | null; kind: string }>;
  perceiveMs: number;
  planMs: number;
}

class Mask {
  readonly px = new Uint8Array(W * H);
  paint(r: Rect, v = 1): void {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(W, Math.ceil(r.x + r.w));
    const y1 = Math.min(H, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) this.px.fill(v, y * W + x0, y * W + x1);
  }
  /** [covered, total] pixels of `r` that are set in this mask. */
  count(r: Rect): [number, number] {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(W, Math.ceil(r.x + r.w));
    const y1 = Math.min(H, Math.ceil(r.y + r.h));
    let c = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) c += this.px[y * W + x]!;
    return [c, Math.max(0, x1 - x0) * Math.max(0, y1 - y0)];
  }
  total(): number {
    let c = 0;
    for (let i = 0; i < this.px.length; i++) c += this.px[i]!;
    return c;
  }
}

function sumCount(m: Mask, rects: Rect[]): [number, number] {
  return rects.reduce<[number, number]>((acc, r) => {
    const [c, t] = m.count(r);
    return [acc[0] + c, acc[1] + t];
  }, [0, 0]);
}

const EQUIV: Record<string, string[]> = { AADHAAR_VID: ["AADHAAR_VID", "AADHAAR", "CARD"], OPAQUE: [] };

interface Tally {
  items: number;
  covered: number;
  classOk: number;
  gtPx: number;
  leakPx: number;
  maskPx: number;
  maskOnGtPx: number;
  ctxPx: number;
  ctxKeptPx: number;
  detItems: number;
  detOnGt: number;
  perClass: Record<string, { items: number; covered: number }>;
  perceiveMs: number[];
}

const tally = (): Tally => ({
  items: 0, covered: 0, classOk: 0, gtPx: 0, leakPx: 0, maskPx: 0, maskOnGtPx: 0, ctxPx: 0, ctxKeptPx: 0, detItems: 0, detOnGt: 0, perClass: {}, perceiveMs: [],
});

const pct = (a: number, b: number) => (b ? (100 * a) / b : 0);
const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : 0);

async function main(): Promise<void> {
  mkdirSync(join(OUT, "samples"), { recursive: true });
  const bundle = await build({
    entryPoints: [join(here, "probe.ts")],
    bundle: true,
    format: "iife",
    write: false,
    platform: "browser",
    target: "chrome120",
    alias: { "@parda/core": join(here, "..", "..", "packages", "core", "src", "index.ts") },
  });
  const probe = bundle.outputFiles[0]!.text;

  const server = createServer((req, res) => {
    const path = join(CORPUS, decodeURIComponent((req.url ?? "/").split("?")[0]!));
    try {
      const body = readFileSync(path);
      res.writeHead(200, { "content-type": extname(path) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf8")) as { pages: Array<{ file: string; template: string }> };
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");

  const totals = Object.fromEntries(MODES.map((m) => [m, tally()])) as Record<Mode, Tally>;
  const perTemplate: Record<string, Record<Mode, Tally>> = {};
  const sampled = new Set<string>();
  const selfCheckRejects: string[] = [];
  let heapPeak = 0;

  for (const { file, template } of manifest.pages) {
    await page.goto(`http://127.0.0.1:${port}/${file}`);
    await page.addScriptTag({ content: probe });
    await page.waitForFunction(() => "__parda" in window);
    const gt = (await page.evaluate(() => (window as any).__parda.groundTruth())) as GtItem[];
    const ctxRects = (await page.evaluate(() => (window as any).__parda.contextText())) as Rect[];
    const outs: Record<Mode, { ops: DrawOp[]; det?: PardaOut }> = {
      raw: { ops: [] },
      blanket: { ops: (await page.evaluate(() => (window as any).__parda.blanket())) as DrawOp[] },
      parda: { ops: [] },
      parda_no_strict: { ops: [] },
    };
    for (const [mode, strict] of [["parda", true], ["parda_no_strict", false]] as const) {
      const r = (await page.evaluate((s) => (window as any).__parda.parda(s), strict)) as PardaOut;
      outs[mode] = { ops: r.ops, det: r };
    }
    const m = (await cdp.send("Performance.getMetrics")) as { metrics: Array<{ name: string; value: number }> };
    heapPeak = Math.max(heapPeak, m.metrics.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0);

    const gtMask = new Mask();
    for (const g of gt) for (const r of g.rects) gtMask.paint(r);
    const ctxMask = new Mask();
    for (const r of ctxRects) ctxMask.paint(r);
    for (const g of gt) for (const r of g.rects) ctxMask.paint(r, 0);

    perTemplate[template] ??= Object.fromEntries(MODES.map((mm) => [mm, tally()])) as Record<Mode, Tally>;
    for (const mode of MODES) {
      const { ops, det } = outs[mode];
      const mask = new Mask();
      for (const o of ops) mask.paint(o);
      for (const t of [totals[mode], perTemplate[template]![mode]]) {
        for (const g of gt) {
          const [c, n] = sumCount(mask, g.rects);
          t.items++;
          t.gtPx += n;
          t.leakPx += n - c;
          const pc = (t.perClass[g.cls] ??= { items: 0, covered: 0 });
          pc.items++;
          if (n && c / n >= COVERED) {
            t.covered++;
            pc.covered++;
            if (det) {
              const want = EQUIV[g.cls] ?? [g.cls];
              const hit = det.items.find((it) => g.rects.some((r) => overlap(r, it.rect) > 0.3));
              if (hit && (want.length === 0 || (hit.cls && want.includes(hit.cls)) || ["FACE", "QR"].includes(g.cls))) t.classOk++;
            } else t.classOk++;
          }
        }
        const maskTotal = mask.total();
        let onGt = 0;
        for (let i = 0; i < mask.px.length; i++) onGt += mask.px[i]! & gtMask.px[i]!;
        t.maskPx += maskTotal;
        t.maskOnGtPx += onGt;
        let ctxN = 0;
        let ctxKept = 0;
        for (let i = 0; i < ctxMask.px.length; i++) {
          if (ctxMask.px[i]) {
            ctxN++;
            if (!mask.px[i]) ctxKept++;
          }
        }
        t.ctxPx += ctxN;
        t.ctxKeptPx += ctxKept;
        if (det) {
          for (const it of det.items) {
            // Strict-mode media masks are a policy, not a detection; their cost shows in redaction precision.
            if (it.cls === "MEDIA") continue;
            t.detItems++;
            const [c, n] = gtMask.count(it.rect);
            if (n && c / n >= 0.5) t.detOnGt++;
          }
          t.perceiveMs.push(det.perceiveMs + det.planMs);
        }
      }
    }

    // Every Parda frame goes through the extension's render self-check; a rejection means no frame would be sent.
    const shot = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
    const first = !sampled.has(template);
    sampled.add(template);
    if (first) writeFileSync(join(OUT, "samples", `${template}_raw.png`), Buffer.from(shot.split(",")[1]!, "base64"));
    for (const mode of first ? (["blanket", "parda"] as const) : (["parda"] as const)) {
      try {
        const url = (await page.evaluate(([s, o]) => (window as any).__parda.render(s, o), [shot, outs[mode].ops] as const)) as string;
        if (first) writeFileSync(join(OUT, "samples", `${template}_${mode}.jpg`), Buffer.from(url.split(",")[1]!, "base64"));
      } catch (e) {
        selfCheckRejects.push(`${file} (${mode}): ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
    }
  }
  await browser.close();
  server.close();

  const summarize = (t: Tally) => ({
    items: t.items,
    item_recall: +pct(t.covered, t.items).toFixed(1),
    class_accuracy: +pct(t.classOk, t.covered).toFixed(1),
    pixel_leakage: +pct(t.leakPx, t.gtPx).toFixed(2),
    detection_precision: t.detItems ? +pct(t.detOnGt, t.detItems).toFixed(1) : null,
    redaction_precision: +pct(t.maskOnGtPx, t.maskPx).toFixed(1),
    context_retained: +pct(t.ctxKeptPx, t.ctxPx).toFixed(1),
    on_device_ms_p50: t.perceiveMs.length ? +q(t.perceiveMs, 0.5).toFixed(1) : null,
    on_device_ms_p95: t.perceiveMs.length ? +q(t.perceiveMs, 0.95).toFixed(1) : null,
    per_class: Object.fromEntries(Object.entries(t.perClass).map(([k, v]) => [k, +pct(v.covered, v.items).toFixed(1)])),
  });
  const results = {
    pages: manifest.pages.length,
    viewport: `${W}x${H}`,
    page_js_heap_peak_mb: +(heapPeak / 1e6).toFixed(1),
    self_check_rejects: selfCheckRejects,
    modes: Object.fromEntries(MODES.map((m) => [m, summarize(totals[m])])),
    per_template: Object.fromEntries(
      Object.entries(perTemplate).map(([k, v]) => [k, Object.fromEntries(MODES.map((m) => [m, summarize(v[m])]))]),
    ),
  };
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  writeFileSync(join(OUT, "summary.md"), markdown(results));
  writeFileSync(join(OUT, "pareto.svg"), pareto(results.modes as Record<Mode, ReturnType<typeof summarize>>));
  console.log(markdown(results));
}

function overlap(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / (a.w * a.h || 1);
}

function markdown(r: { pages: number; page_js_heap_peak_mb: number; self_check_rejects: string[]; modes: Record<string, any>; per_template: Record<string, any> }): string {
  const rows = Object.entries(r.modes).map(
    ([m, s]) =>
      `| ${m} | ${s.item_recall} | ${s.class_accuracy} | ${s.pixel_leakage} | ${s.detection_precision ?? "–"} | ${s.redaction_precision} | ${s.context_retained} | ${s.on_device_ms_p50 ?? "–"} / ${s.on_device_ms_p95 ?? "–"} |`,
  );
  const classes = Object.keys(r.modes.parda.per_class).sort();
  const perClass = classes.map((c) => `| ${c} | ${r.modes.raw.per_class[c] ?? 0} | ${r.modes.blanket.per_class[c] ?? 0} | ${r.modes.parda.per_class[c] ?? 0} |`);
  const tpl = Object.entries(r.per_template).map(([t, s]) => `| ${t} | ${s.parda.item_recall} | ${s.parda.pixel_leakage} | ${s.parda.context_retained} | ${s.blanket.context_retained} |`);
  return [
    `# Parda privacy-utility benchmark`,
    ``,
    `${r.pages} synthetic pages at 1440x900, headless Chromium. Peak page JS heap: ${r.page_js_heap_peak_mb} MB. ` +
      `Render self-check rejections: ${r.self_check_rejects.length}.`,
    ``,
    `| mode | item recall % | class acc % | pixel leakage % | detection precision % | redaction precision % | context retained % | on-device ms p50 / p95 |`,
    `|---|---|---|---|---|---|---|---|`,
    ...rows,
    ``,
    `## Recall by class`,
    ``,
    `| class | raw | blanket | parda |`,
    `|---|---|---|---|`,
    ...perClass,
    ``,
    `## Parda by template`,
    ``,
    `| template | recall % | leakage % | context retained % | blanket context retained % |`,
    `|---|---|---|---|---|`,
    ...tpl,
    ``,
  ].join("\n");
}

function pareto(modes: Record<Mode, { pixel_leakage: number; context_retained: number }>): string {
  const pts = Object.entries(modes).map(([m, s]) => ({ m, x: 100 - s.pixel_leakage, y: s.context_retained }));
  const X = (v: number) => 60 + (v / 100) * 400;
  const Y = (v: number) => 320 - (v / 100) * 280;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="370" font-family="Segoe UI, Arial" font-size="12">
<rect width="520" height="370" fill="#fff"/>
<line x1="60" y1="320" x2="460" y2="320" stroke="#333"/><line x1="60" y1="40" x2="60" y2="320" stroke="#333"/>
<text x="260" y="352" text-anchor="middle">PII pixels hidden (%)</text>
<text x="18" y="180" transform="rotate(-90 18 180)" text-anchor="middle">Non-PII text still readable (%)</text>
${[0, 25, 50, 75, 100].map((v) => `<text x="${X(v)}" y="336" text-anchor="middle" fill="#666">${v}</text><text x="52" y="${Y(v) + 4}" text-anchor="end" fill="#666">${v}</text>`).join("")}
${pts.map((p) => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="6" fill="${p.m.startsWith("parda") ? "#b4441e" : "#555"}"/><text x="${X(p.x) - 10}" y="${Y(p.y) - 10}" text-anchor="end">${p.m}</text>`).join("\n")}
</svg>`;
}

await main();
