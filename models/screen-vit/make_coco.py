"""Write the synthetic screens as a Roboflow-style COCO dataset for RF-DETR fine-tuning.

train and valid come from synth.py. test comes from heldout_scenes.py, whose layouts the
model never sees during training or threshold selection.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

import synth
from heldout_scenes import sample as heldout_sample

HERE = Path(__file__).resolve().parent
CLASSES = ["ID_DOCUMENT", "SIGNATURE", "FACE", "TEXT", "BUTTON", "INPUT"]


def write_split(out: Path, n: int, seed: int, factory) -> None:
    out.mkdir(parents=True, exist_ok=True)
    images, annotations = [], []
    categories = [{"id": 0, "name": "screen", "supercategory": "none"}]
    categories += [{"id": i + 1, "name": c, "supercategory": "screen"} for i, c in enumerate(CLASSES)]
    for i in range(n):
        scene = factory(np.random.default_rng(seed + i))
        name = f"{seed}_{i:05d}.jpg"
        scene.image.save(out / name, quality=92)
        images.append({"id": i, "file_name": name, "width": scene.image.width, "height": scene.image.height})
        for cls, x, y, w, h in scene.boxes:
            annotations.append({
                "id": len(annotations),
                "image_id": i,
                "category_id": CLASSES.index(cls) + 1,
                "bbox": [round(x, 1), round(y, 1), round(w, 1), round(h, 1)],
                "area": round(w * h, 1),
                "iscrowd": 0,
            })
    coco = {"images": images, "annotations": annotations, "categories": categories}
    (out / "_annotations.coco.json").write_text(json.dumps(coco), encoding="utf-8")
    print(f"{out.name}: {n} images, {len(annotations)} boxes")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", type=int, default=6000)
    ap.add_argument("--valid", type=int, default=300)
    ap.add_argument("--test", type=int, default=180)
    ap.add_argument("--out", default=str(HERE / "datasets" / "screens"))
    args = ap.parse_args()
    root = Path(args.out)
    write_split(root / "train", args.train, 26171, synth.sample)
    write_split(root / "valid", args.valid, 10007, synth.sample)
    write_split(root / "test", args.test, 4242, heldout_sample)


if __name__ == "__main__":
    main()
