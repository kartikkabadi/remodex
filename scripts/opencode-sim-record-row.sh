#!/usr/bin/env bash
# Append one PR #54 matrix row to opencode-sim-matrix.json.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MATRIX_DIR="${REPO_ROOT}/.qa-screenshots/opencode-sim"
MATRIX_FILE="${MATRIX_DIR}/opencode-sim-matrix.json"

usage() {
  cat <<'EOF'
Usage: scripts/opencode-sim-record-row.sh <row> <slug> <status> [screenshot] [notes]

status: pass | fail | blocked
screenshot: optional path (stored relative to repo root when under REPO_ROOT)
notes: optional free text (quote if it contains spaces)
EOF
  exit 1
}

[[ $# -ge 3 ]] || usage

row="$1"
slug="$2"
status="$3"
screenshot="${4:-}"
notes="${5:-}"

case "${status}" in
  pass | fail | blocked) ;;
  *)
    echo "error: status must be pass, fail, or blocked" >&2
    exit 1
    ;;
esac

if [[ -n "${screenshot}" && "${screenshot}" = "${REPO_ROOT}"* ]]; then
  screenshot="${screenshot#"${REPO_ROOT}/"}"
fi

mkdir -p "${MATRIX_DIR}"

export REPO_ROOT MATRIX_FILE ROW="${row}" SLUG="${slug}" STATUS="${status}" SCREENSHOT="${screenshot}" NOTES="${notes}"

node <<'NODE'
const fs = require("fs");
const path = require("path");

const matrixFile = process.env.MATRIX_FILE;
const entry = {
  row: Number.parseInt(process.env.ROW, 10),
  slug: process.env.SLUG,
  status: process.env.STATUS,
  screenshot: process.env.SCREENSHOT || null,
  notes: process.env.NOTES || "",
};

let rows = [];
if (fs.existsSync(matrixFile)) {
  rows = JSON.parse(fs.readFileSync(matrixFile, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error(`${matrixFile} must contain a JSON array`);
  }
}

const existingIndex = rows.findIndex((row) => row.row === entry.row);
if (existingIndex >= 0) {
  rows[existingIndex] = { ...rows[existingIndex], ...entry };
} else {
  rows.push(entry);
}

rows.sort((left, right) => left.row - right.row);
fs.writeFileSync(matrixFile, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`matrix: updated row ${entry.row} (${entry.status}) in ${path.basename(matrixFile)}`);
NODE
