import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

/** Uses Playwright's pinned browser, else CHROMIUM_PATH, else the newest locally cached Chromium. */
export async function launch() {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit) return chromium.launch({ executablePath: explicit });
  try {
    return await chromium.launch();
  } catch (e) {
    const cache = join(process.env.LOCALAPPDATA ?? join(homedir(), ".cache"), "ms-playwright");
    const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
    for (const d of dirs) {
      for (const exe of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const p = join(cache, d, exe);
        if (existsSync(p)) {
          console.warn(`pinned browser unavailable, using ${p}`);
          return chromium.launch({ executablePath: p });
        }
      }
    }
    throw e;
  }
}
