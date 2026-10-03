"""Score the shipped screen-vit.onnx on Chromium screenshots from bench/src/real.ts.

These pages are real browser pixels (demo portal + canvas e-IDs), not the PIL training
generator. Thresholds stay frozen from export/screen-vit.json.
"""

from __future__ import annotations

import base64
import io
import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
EXPORT = HERE / "export"
DUMP = Path(__file__).resolve().parents[2] / "bench" / "out" / "real"
COVERED = 0.9
SENSITIVE = {"ID_DOCUMENT", "SIGNATURE", "FACE", "TEXT"}
COVERS = {
    "FACE": {"FACE", "ID_DOCUMENT"},
    "PERSON": {"TEXT", "ID_DOCUMENT"},
    "DOB": {"TEXT", "ID_DOCUMENT"},
    "AADHAAR": {"TEXT", "ID_DOCUMENT"},
    "SIGNATURE": {"SIGNATURE", "TEXT", "ID_DOCUMENT"},
    "ID_DOCUMENT": {"ID_DOCUMENT"},
}


def nms(dets, thr=0.6):
    keep = []
    for d in sorted(dets, key=lambda d: -d[1]):
        if all(k[0] != d[0] or iou(k[2], d[2]) < thr for k in keep):
            keep.append(d)
    return keep


def iou(a, b) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def load_model():
    meta = json.loads((EXPORT / "screen-vit.json").read_text(encoding="utf-8"))
    sess = ort.InferenceSession(str(EXPORT / "screen-vit.onnx"), providers=["CPUExecutionProvider"])
    return sess, meta


def infer(sess, meta, img: Image.Image):
    res = int(meta["resolution"])
    mean = np.array(meta["mean"], np.float32)
    std = np.array(meta["std"], np.float32)
    w, h = img.size
    arr = (np.asarray(img.resize((res, res), Image.BILINEAR)).astype(np.float32) / 255 - mean) / std
    t0 = time.perf_counter()
    outs = dict(zip([o.name for o in sess.get_outputs()], sess.run(None, {sess.get_inputs()[0].name: arr.transpose(2, 0, 1)[None]})))
    ms = (time.perf_counter() - t0) * 1000
    boxes, logits = outs["dets"][0], outs["labels"][0]
    best = logits.argmax(-1)
    score = 1 / (1 + np.exp(-logits.max(-1)))
    classes = meta["classes"]
    thr = meta["thresholds"]
    dets = []
    for q in range(boxes.shape[0]):
        c = int(best[q])
        if c >= len(classes) or not classes[c]:
            continue
        cls = classes[c]
        s = float(score[q])
        if s < float(thr.get(cls, 0.5)):
            continue
        cx, cy, bw, bh = boxes[q]
        dets.append((cls, s, ((cx - bw / 2) * w, (cy - bh / 2) * h, bw * w, bh * h)))
    return nms(dets), ms


def mask_of(w, h, rects):
    m = np.zeros((h, w), np.uint8)
    for r in rects:
        x, y, bw, bh = (int(round(v)) for v in r)
        m[max(0, y) : max(0, y + bh), max(0, x) : max(0, x + bw)] = 1
    return m


def as_box(r):
    if isinstance(r, dict):
        return r["x"], r["y"], r["w"], r["h"]
    return tuple(r)


def coverage(m, rect) -> float:
    x, y, bw, bh = (int(round(v)) for v in as_box(rect))
    sl = m[max(0, y) : max(0, y + bh), max(0, x) : max(0, x + bw)]
    return float(sl.mean()) if sl.size else 1.0


def ops_rects(blob) -> list:
    return [(o["x"], o["y"], o["w"], o["h"]) for o in blob.get("ops", [])]


def score_items(m, items, key="rect"):
    rows = []
    for it in items:
        rects = it["rects"] if "rects" in it else [it[key]]
        cov = max((coverage(m, r) for r in rects), default=0.0)
        rows.append({"cls": it["cls"], "covered": cov >= COVERED, "coverage": round(cov, 3)})
    n = len(rows) or 1
    return rows, sum(r["covered"] for r in rows) / n, 1 - (sum(1 - r["coverage"] for r in rows) / n)


def paint_redacted(img: Image.Image, rects) -> bytes:
    out = img.convert("RGB")
    d = ImageDraw.Draw(out)
    for x, y, w, h in rects:
        d.rectangle((x, y, x + w, y + h), fill="#1a1a1a")
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def overlay(img: Image.Image, dets, canvas_gt, path: Path) -> None:
    colors = {"ID_DOCUMENT": "#e23", "SIGNATURE": "#14c", "FACE": "#1a3", "TEXT": "#e80", "BUTTON": "#70c", "INPUT": "#0aa"}
    vis = img.convert("RGB")
    pen = ImageDraw.Draw(vis)
    for g in canvas_gt:
        x, y, w, h = g["rect"].values() if isinstance(g["rect"], dict) else g["rect"]
        if isinstance(g["rect"], dict):
            x, y, w, h = g["rect"]["x"], g["rect"]["y"], g["rect"]["w"], g["rect"]["h"]
        pen.rectangle((x, y, x + w, y + h), outline="#888", width=1)
    for cls, score, (x, y, w, h) in dets:
        pen.rectangle((x, y, x + w, y + h), outline=colors.get(cls, "#000"), width=3)
        pen.text((x, max(0, y - 12)), f"{cls} {score:.2f}", fill=colors.get(cls, "#000"))
    vis.save(path)


def post_fake(jpeg: bytes, legend, viewport) -> dict:
    import urllib.error
    import urllib.request

    body = json.dumps({
        "task_id": "real-eval",
        "instruction": "Open the form and type [AADHAAR_1] into the Aadhaar field, then finish.",
        "legend": legend or [{"token": "[AADHAAR_1]", "cls": "AADHAAR"}],
        "viewport": viewport,
        "observations": [{
            "screenshot": base64.b64encode(jpeg).decode(),
            "url": "http://127.0.0.1/portal",
            "text_observation": "Controls visible only as pixels: BUTTON 60,270 160x38.",
            "user_response": "",
        }],
        "assistant_turns": [],
    }).encode()
    req = urllib.request.Request("http://127.0.0.1:8000/v1/step", data=body, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return {"ok": True, "status": r.status, "body": json.loads(r.read().decode())}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "detail": e.read().decode(errors="replace")[:400]}
    except OSError as e:
        return {"ok": False, "status": 0, "detail": str(e)}


def main() -> None:
    index = json.loads((DUMP / "index.json").read_text(encoding="utf-8"))
    sess, meta = load_model()
    pages = []
    lat = []
    fake = None
    for spec in index["pages"]:
        dump = json.loads((DUMP / spec["json"]).read_text(encoding="utf-8"))
        img = Image.open(DUMP / spec["png"]).convert("RGB")
        dets, ms = infer(sess, meta, img)
        lat.append(ms)
        media = [(m["x"], m["y"], m["w"], m["h"]) for m in dump.get("media") or []]

        def on_media(box) -> bool:
            return any(iou(box, m) >= 0.0 and overlap_frac(box, m) >= 0.45 for m in media)

        def overlap_frac(a, b) -> float:
            ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
            iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
            return (ix * iy) / (a[2] * a[3] or 1)

        vit_rects = [
            d[2]
            for d in dets
            if d[0] in SENSITIVE and (d[0] not in {"TEXT", "ID_DOCUMENT"} or on_media(d[2]))
        ]
        vit_by_cls = {}
        for cls, _, box in dets:
            vit_by_cls.setdefault(cls, []).append(box)
        w, h = img.size
        vit_m = mask_of(w, h, vit_rects)
        dom_m = mask_of(w, h, ops_rects(dump["noStrict"]))
        strict_m = mask_of(w, h, ops_rects(dump["strict"]))
        combo_m = np.maximum(vit_m, dom_m)
        canvas = [{"cls": g["cls"], "rect": g["rect"]} for g in dump["canvasGt"]]
        glyph = [g for g in canvas if g["cls"] != "ID_DOCUMENT"]

        def canvas_hit(m):
            rows, rec, _ = score_items(m, glyph)
            return rows, rec

        def class_aware(dets_list, items):
            rows = []
            for it in items:
                allow = COVERS.get(it["cls"], SENSITIVE)
                rect = as_box(it["rect"])
                pix = coverage(mask_of(w, h, [b for c, _, b in dets_list if c in allow]), rect)
                rows.append({"cls": it["cls"], "covered": pix >= COVERED, "coverage": round(pix, 3)})
            rec = sum(r["covered"] for r in rows) / (len(rows) or 1)
            return rows, rec

        vit_rows, vit_rec = class_aware(dets, glyph)
        _, dom_rec = canvas_hit(dom_m)
        _, combo_rec = canvas_hit(combo_m)
        _, strict_rec = canvas_hit(strict_m)
        leak_vit = 1 - float((mask_of(w, h, [(g["rect"]["x"], g["rect"]["y"], g["rect"]["w"], g["rect"]["h"]) for g in glyph]) & vit_m).sum() / max(1, mask_of(w, h, [(g["rect"]["x"], g["rect"]["y"], g["rect"]["w"], g["rect"]["h"]) for g in glyph]).sum()))
        overlay(img, dets, canvas, DUMP / f"{dump['id']}_vit.png")
        redacted = paint_redacted(img, ops_rects(dump["noStrict"]) + vit_rects)
        (DUMP / f"{dump['id']}_redacted.jpg").write_bytes(redacted)
        legend = []
        for it in dump["noStrict"].get("legend") or []:
            legend.append({"token": it["token"], "cls": it["cls"]})
        page = {
            "id": dump["id"],
            "cpu_ms": round(ms, 1),
            "vit_dets": [{"cls": c, "score": round(float(s), 3), "box": [round(float(v), 1) for v in b]} for c, s, b in dets],
            "canvas_glyphs": glyph,
            "canvas_item_recall": {
                "dom_only": round(dom_rec, 3),
                "vit_only": round(vit_rec, 3),
                "dom_plus_vit": round(combo_rec, 3),
                "strict_media": round(strict_rec, 3),
            },
            "canvas_glyph_pixel_leakage_vit": round(float(leak_vit), 3),
            "per_glyph": vit_rows,
        }
        pages.append(page)
        print(f"\n{dump['id']}  {ms:.0f} ms CPU")
        print(f"  canvas glyphs  DOM-only R {dom_rec:.0%}  ViT R {vit_rec:.0%}  DOM+ViT R {combo_rec:.0%}  strict R {strict_rec:.0%}")
        for r in vit_rows:
            print(f"    {r['cls']:<12} {'hit' if r['covered'] else 'MISS':<4}  {r['coverage']:.0%}")
        if fake is None:
            fake = post_fake(redacted, legend, dump["viewport"])
            print("  fake /v1/step", fake.get("status"), (fake.get("body") or {}).get("action") or fake.get("detail", "")[:120])

    lat_sorted = sorted(lat)
    out = {
        "pages": pages,
        "cpu_ms": {"p50": round(lat_sorted[len(lat_sorted) // 2], 1), "p95": round(lat_sorted[int(0.95 * (len(lat_sorted) - 1))], 1)},
        "canvas_item_recall_mean": {
            k: round(sum(p["canvas_item_recall"][k] for p in pages) / len(pages), 3) for k in pages[0]["canvas_item_recall"]
        },
        "fake_server": {k: v for k, v in fake.items() if k != "body"} | {"action": (fake.get("body") or {}).get("action")},
    }
    (DUMP / "results.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("\nmean canvas glyph recall", out["canvas_item_recall_mean"])
    print("cpu ms", out["cpu_ms"])
    print("wrote", DUMP / "results.json")


if __name__ == "__main__":
    main()
