"""Fine-tune RF-DETR Nano (Apache-2.0, DINOv2 ViT backbone, COCO-pretrained) on the synthetic screens.

Run make_coco.py first. The checkpoint lands in runs/rfdetr and the ONNX in export/.
"""

from __future__ import annotations

import argparse
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--export-only", action="store_true")
    args = ap.parse_args()

    from rfdetr import RFDETRNano

    out = HERE / "runs" / "rfdetr"
    if args.export_only:
        model = RFDETRNano(pretrain_weights=str(out / "checkpoint_best_ema.pth"))
    else:
        model = RFDETRNano()
        model.train(
            dataset_dir=str(HERE / "datasets" / "screens"),
            epochs=args.epochs,
            batch_size=args.batch,
            grad_accum_steps=2,
            lr=2e-4,
            num_workers=4,
            output_dir=str(out),
            checkpoint_interval=4,
        )
    model.export(output_dir=str(HERE / "export"), output_name="screen-vit")


if __name__ == "__main__":
    main()
