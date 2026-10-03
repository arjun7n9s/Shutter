"""Dynamic int8 quantisation of the exported ONNX for the extension (weights int8, activations float)."""

from __future__ import annotations

import shutil
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic

EXPORT = Path(__file__).resolve().parent / "export"


def main() -> None:
    fp32 = EXPORT / "screen-vit.fp32.onnx"
    target = EXPORT / "screen-vit.onnx"
    if not fp32.exists():
        shutil.move(target, fp32)
    quantize_dynamic(str(fp32), str(target), weight_type=QuantType.QUInt8, op_types_to_quantize=["MatMul", "Gemm"])
    print(f"{fp32.name} {fp32.stat().st_size / 1e6:.1f} MB -> {target.name} {target.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
