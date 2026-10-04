#!/bin/sh
set -eu

REV_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REV_ROOT"
export UV_CACHE_DIR="$REV_ROOT/.cache/uv"

if ! command -v uv >/dev/null 2>&1; then
  printf '%s\n' 'Missing uv. Install uv, then rerun make setup.' >&2
  exit 2
fi

# Respect the checked-in lock. System packages are detected by doctor.
uv sync --locked --python 3.12
uv run --locked python scripts/verify_model_pins.py
uv run --locked rev doctor
