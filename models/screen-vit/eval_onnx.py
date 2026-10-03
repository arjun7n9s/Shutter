"""Evaluate export/screen-vit.onnx exactly as the extension runs it, and write the sidecar JSON.

Thresholds are chosen on datasets/screens/valid (training distribution). The test split holds
the held-out layouts and is scored once with those thresholds. Besides box P/R/F1 at IoU 0.5,
this reports pixel coverage: the share of sensitive ground-truth pixels that end up under a
sensitive mask, which is what decides whether anything leaks.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DATA = HERE / "datasets" / "screens"
EXPORT = HERE / "export"
CLASSES = ["ID_DOCUMENT", "SIGNATURE", "FACE", "TEXT", "BUTTON", "INPUT"]
SENSITIVE = {"ID_DOCUMENT", "SIGNATURE", "FACE", "TEXT"}
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def load_split(name: str):
    coco = json.loads((DATA / name / "_annotations.coco.json").read_text(encoding="utf-8"))
    by_img: dict[int, list] = {im["id"]: [] for im in coco["images"]}
    for a in coco["annotations"]:
        by_img[a["image_id"]].append((CLASSES[a["category_id"] - 1], *a["bbox"]))
    return [(DATA / name / im["file_name"], by_img[im["id"]]) for im in coco["images"]]


def iou(a, b) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def nms(dets, thr=0.6):
    keep = []
    for d in sorted(dets, key=lambda d: -d[1]):
        if all(k[0] != d[0] or iou(k[2], d[2]) < thr for k in keep):
            keep.append(d)
    return keep


def run(sess, path: Path, res: int):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    arr = (np.asarray(img.resize((res, res), Image.BILINEAR)).astype(np.float32) / 255 - MEAN) / STD
    t0 = time.perf_counter()
    outs = dict(zip([o.name for o in sess.get_outputs()], sess.run(None, {sess.get_inputs()[0].name: arr.transpose(2, 0, 1)[None]})))
    ms = (time.perf_counter() - t0) * 1000
    boxes, logits = outs["dets"][0], outs["labels"][0]
    best = logits.argmax(-1)
    score = 1 / (1 + np.exp(-logits.max(-1)))
    dets = []
    for q in range(boxes.shape[0]):
        c = int(best[q])
        if c >= len(CLASSES):
            continue
        cx, cy, bw, bh = boxes[q]
        dets.append((CLASSES[c], float(score[q]), ((cx - bw / 2) * w, (cy - bh / 2) * h, bw * w, bh * h)))
    return dets, (w, h), ms


def predict(sess, split, res):
    rows, lat = [], []
    for path, gt in split:
        dets, size, ms = run(sess, path, res)
        rows.append((dets, gt, size))
        lat.append(ms)
    return rows, lat


def score(rows, thresholds, only=None):
    tp = {c: 0 for c in CLASSES}
    fp = {c: 0 for c in CLASSES}
    n = {c: 0 for c in CLASSES}
    cov_hit = cov_all = mask_on_gt = mask_all = 0
    for dets, gt, (w, h) in rows:
        kept = nms([d for d in dets if d[1] >= thresholds.get(d[0], 1.0) and (only is None or d[0] == only)])
        taken = set()
        for cls, _, box in kept:
            bi, bv = -1, 0.5
            for gi, g in enumerate(gt):
                if gi in taken or g[0] != cls:
                    continue
                v = iou(box, g[1:])
                if v >= bv:
                    bi, bv = gi, v
            if bi >= 0:
                taken.add(bi)
                tp[cls] += 1
            else:
                fp[cls] += 1
        for g in gt:
            n[g[0]] += 1
        if only is not None:
            continue
        gt_mask = np.zeros((h, w), bool)
        pred_mask = np.zeros((h, w), bool)
        for g in gt:
            if g[0] in SENSITIVE:
                x, y, bw, bh = (int(round(v)) for v in g[1:])
                gt_mask[max(0, y): y + bh, max(0, x): x + bw] = True
        for cls, _, (x, y, bw, bh) in kept:
            if cls in SENSITIVE:
                pred_mask[max(0, int(y)): int(y + bh + 1), max(0, int(x)): int(x + bw + 1)] = True
        if only is None:
            cov_hit += int((gt_mask & pred_mask).sum())
            cov_all += int(gt_mask.sum())
            mask_on_gt += int((gt_mask & pred_mask).sum())
            mask_all += int(pred_mask.sum())
    return tp, fp, n, (cov_hit / cov_all if cov_all else 1.0), (mask_on_gt / mask_all if mask_all else 1.0)


def prf(tp, fp, n):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / n if n else 0.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def choose(rows) -> dict[str, float]:
    """On a saturated val set, sensitive classes take the lowest still-valid cut (a miss leaks)
    and controls take the highest (extra buttons only pollute the coordinate note).
    """
    out = {}
    for cls in CLASSES:
        keep_r: list[float] = []
        fallback: tuple[tuple, float] | None = None
        for t in np.round(np.arange(0.2, 0.9, 0.05), 2):
            tp, fp, n, *_ = score(rows, {cls: float(t)}, only=cls)
            p, r, f = prf(tp[cls], fp[cls], n[cls])
            rank = (f, r, p, float(t))
            if fallback is None or rank > fallback[0]:
                fallback = (rank, float(t))
            if r >= 0.95 and p >= 0.70:
                keep_r.append(float(t))
        if keep_r:
            out[cls] = min(keep_r) if cls in SENSITIVE else max(keep_r)
        else:
            out[cls] = fallback[1]
    return out


def report(title, rows, thresholds):
    tp, fp, n, cov, mprec = score(rows, thresholds)
    print(f"\n{title}")
    out = {}
    for c in CLASSES:
        p, r, f = prf(tp[c], fp[c], n[c])
        out[c] = {"precision": round(p, 3), "recall": round(r, 3), "f1": round(f, 3), "gt": n[c]}
        print(f"  {c:<12} P {p:6.1%}  R {r:6.1%}  F1 {f:6.1%}  n={n[c]}")
    print(f"  sensitive pixels masked {cov:.1%}   mask pixels on sensitive gt {mprec:.1%}")
    out["sensitive_pixel_coverage"] = round(cov, 3)
    out["mask_pixel_precision"] = round(mprec, 3)
    return out


def overlay(path: Path, rows, thresholds) -> None:
    colors = {"ID_DOCUMENT": "#e23", "SIGNATURE": "#14c", "FACE": "#1a3", "TEXT": "#e80", "BUTTON": "#70c", "INPUT": "#0aa"}
    tiles = []
    for dets, gt, _ in rows:
        img = Image.open(load_split("test")[len(tiles)][0]).convert("RGB")
        pen = ImageDraw.Draw(img)
        kept = nms([d for d in dets if d[1] >= thresholds.get(d[0], 1.0)])
        for cls, _, (x, y, w, h) in kept:
            pen.rectangle((x, y, x + w, y + h), outline=colors.get(cls, "#000"), width=3)
        tiles.append(img.resize((480, 300)))
    sheet = Image.new("RGB", (480 * 3, 300 * 2), "white")
    for i, tile in enumerate(tiles):
        sheet.paste(tile, ((i % 3) * 480, (i // 3) * 300))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    print("wrote", path)


def main() -> None:
    onnx_path = EXPORT / "screen-vit.onnx"
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    res = int(inp.shape[-1])
    names = [o.name for o in sess.get_outputs()]
    print("inputs", inp.name, inp.shape, "outputs", names, [o.shape for o in sess.get_outputs()])
    valid_rows, _ = predict(sess, load_split("valid"), res)
    thresholds = choose(valid_rows)
    print("thresholds", thresholds)
    val = report("validation (training distribution)", valid_rows, thresholds)
    test_rows, lat = predict(sess, load_split("test"), res)
    test = report("held-out layouts (never trained on, thresholds fixed from validation)", test_rows, thresholds)
    lat_sorted = sorted(lat[5:])
    p50 = lat_sorted[len(lat_sorted) // 2]
    p95 = lat_sorted[int(len(lat_sorted) * 0.95)]
    print(f"\nonnxruntime CPU latency p50 {p50:.0f} ms  p95 {p95:.0f} ms  model {onnx_path.stat().st_size / 1e6:.1f} MB")
    nc = sess.get_outputs()[names.index("labels")].shape[-1]
    meta = {
        "resolution": res,
        "classes": (CLASSES + [None] * nc)[:nc],
        "thresholds": thresholds,
        "mean": MEAN.tolist(),
        "std": STD.tolist(),
        "stretch": True,
        "arch": "RF-DETR Nano (DINOv2 ViT-S backbone), fine-tuned",
        "trained_on": "synthetic Indian-portal screenshots (make_coco.py)",
        "val": val,
        "heldout": test,
        "cpu_ms": {"p50": round(p50, 1), "p95": round(p95, 1)},
    }
    (EXPORT / "screen-vit.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("wrote", EXPORT / "screen-vit.json")
    overlay(HERE / "runs" / "heldout-pred.png", test_rows[:6], thresholds)


if __name__ == "__main__":
    main()
