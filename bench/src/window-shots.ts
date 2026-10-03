/**
 * Headed Chrome, extension loaded, side panel docked. The PNG is the window, not the page.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type BrowserContext, type Page } from "playwright";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = join(root, "docs", "shots");
const ext = join(root, "extension", ".output", "chrome-mv3");
const TASK =
  "Fill and submit the post-matric scholarship form. Applicant Meera Iyer, date of birth 14/08/2004, Aadhaar 2096 5442 5722, mobile 6811125709, email meera.iyer@example.in, PAN ETNPF3252Z, address 18, Lake View Road, Kochi, Kerala 400734, IFSC OQRZ0W73BGM, account 384920175633.";

function waitHealth(url: string, ms = 20000): Promise<void> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => fetch(url).then((r) => (r.ok ? resolve() : retry())).catch(retry);
    const retry = () => (Date.now() - t0 > ms ? reject(new Error("server did not start")) : setTimeout(tick, 250));
    tick();
  });
}

async function grab(needle: string, file: string): Promise<void> {
  const { stdout } = await exec("python", [join(here, "grab_window.py"), needle, join(outDir, file)], { timeout: 15000 });
  console.log(stdout.trim());
}

async function sidePanel(context: BrowserContext): Promise<Page | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const hit = context.pages().find((p) => p.url().includes("sidepanel"));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function main(): Promise<void> {
  let api: ChildProcess | null = null;
  try {
    await waitHealth("http://127.0.0.1:8000/healthz", 1200);
    console.log("server already up");
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
  const origin = `http://127.0.0.1:${(staticServer.address() as { port: number }).port}/`;

  const chrome = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1223", "chrome-win64", "chrome.exe");
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "shutter-")), {
    executablePath: chrome,
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      "--window-position=40,40",
      "--window-size=1680,980",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(origin);
    await page.bringToFront();
    const fields: Record<string, string> = {
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
    for (const [name, value] of Object.entries(fields)) await page.locator(`input[name="${name}"]`).fill(value);
    await page.locator("#submit").click();
    await page.locator("#done[data-status=ok]").waitFor();
    await page.bringToFront();
    await exec("python", [join(here, "click_ext.py")]);
    await page.waitForTimeout(700);
    const taskFile = join(outDir, "task.txt");
    writeFileSync(taskFile, TASK, "utf8");
    await exec("python", [join(here, "type_task.py"), taskFile]);
    await page.waitForTimeout(8000);
    await grab("Scholarship", "chrome-redacted.png");
  } finally {
    await context.close();
    staticServer.close();
    api?.kill();
  }
}

await main();
