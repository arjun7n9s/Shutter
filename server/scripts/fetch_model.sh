#!/usr/bin/env bash
# Run once on a connected machine; copy ./models to the offline host afterwards.
set -euo pipefail
MODEL="${1:-microsoft/Fara1.5-4B}"
DEST="${MODELS_PATH:-./models}/$(basename "$MODEL")"
pip install -q "huggingface_hub>=0.25"
huggingface-cli download "$MODEL" --local-dir "$DEST"
echo "weights in $DEST"
