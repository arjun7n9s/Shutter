// Copies WASM runtimes into public/ and downloads on-device model weights.
// Everything the extension executes ships inside the package: no CDN at runtime.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");
/** Package root without require.resolve, since these packages do not export package.json. */
function pkgDir(name) {
  for (let d = join(here, ".."); ; d = dirname(d)) {
    const p = join(d, "node_modules", name);
    if (existsSync(join(p, "package.json"))) return p;
    if (dirname(d) === d) throw new Error(`cannot find ${name}`);
  }
}

function copy(from, toDir, name) {
  mkdirSync(toDir, { recursive: true });
  copyFileSync(from, join(toDir, name));
}

const ortDist = join(pkgDir("onnxruntime-web"), "dist");
// The default onnxruntime-web entry loads only the JSEP build, which serves both WebGPU and WASM.
for (const f of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  copy(join(ortDist, f), join(pub, "ort"), f);
}
const zx = join(pkgDir("zxing-wasm"), "dist", "reader", "zxing_reader.wasm");
copy(zx, join(pub, "zxing"), "zxing_reader.wasm");

const MODELS = [
  {
    // OpenCV Zoo YuNet, MIT licence.
    name: "face_detection_yunet_2023mar.onnx",
    url: "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
  },
];

mkdirSync(join(pub, "models"), { recursive: true });
for (const m of MODELS) {
  const dest = join(pub, "models", m.name);
  if (existsSync(dest)) continue;
  try {
    const r = await fetch(m.url);
    if (!r.ok) throw new Error(`${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(dest, buf);
    console.log(`fetched ${m.name} sha256=${createHash("sha256").update(buf).digest("hex")}`);
  } catch (e) {
    console.warn(`could not fetch ${m.name} (${e}); the extension will run without it`);
  }
}

const vit = join(here, "..", "..", "models", "screen-vit", "export");
for (const f of ["screen-vit.onnx", "screen-vit.json"]) {
  if (existsSync(join(vit, f))) copy(join(vit, f), join(pub, "models"), f);
}
if (!existsSync(join(pub, "models", "screen-vit.onnx"))) console.log("screen-vit not trained yet; see models/screen-vit");
