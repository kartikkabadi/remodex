#!/usr/bin/env bash
# Fail-closed QA screenshot gate (Wave 2A/2B).
set -euo pipefail

MIN_BYTES="${OPENCODE_QA_SCREENSHOT_MIN_BYTES:-8192}"

usage() {
  cat <<'EOF'
Usage: scripts/validate-qa-screenshot.sh <image-path>

Exits 0 when the file exists, exceeds a minimum byte size, and is not a uniform/blank capture.
EOF
  exit 1
}

[[ $# -eq 1 ]] || usage
[[ -f "$1" ]] || {
  echo "error: missing file: $1" >&2
  exit 1
}

path="$1"
size="$(wc -c <"${path}" | tr -d ' ')"
if [[ "${size}" -lt "${MIN_BYTES}" ]]; then
  echo "error: screenshot too small (${size} bytes < ${MIN_BYTES})" >&2
  exit 1
fi

python3 - "${path}" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = path.read_bytes()

# Crude blank/uniform rejection without extra dependencies.
sample = data[64:min(len(data), 65536)]
if len(sample) < 256:
    print("error: screenshot payload too small to analyze", file=sys.stderr)
    raise SystemExit(1)

unique_bytes = len(set(sample))
if unique_bytes < 12:
    print("error: screenshot appears uniform or blank", file=sys.stderr)
    raise SystemExit(1)

# Optional stricter check when Pillow is available.
try:
    from PIL import Image  # type: ignore

    with Image.open(path) as image:
        grayscale = image.convert("L")
        extrema = grayscale.getextrema()
        if extrema[0] == extrema[1]:
            print("error: screenshot is a flat color", file=sys.stderr)
            raise SystemExit(1)
except ImportError:
    pass

print(f"ok: {path} ({len(data)} bytes, sample-unique={unique_bytes})")
PY
