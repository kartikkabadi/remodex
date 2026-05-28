#!/usr/bin/env bash
# Append one tab-separated row to .audit/opencode-p0-ship.tsv
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIT_FILE="${REPO_ROOT}/.audit/opencode-p0-ship.tsv"

usage() {
  cat <<'EOF'
Usage: scripts/audit-log.sh <phase> <actor> <action> <status> [detail]

Columns: timestamp_utc  phase  actor  action  status  detail

Example:
  scripts/audit-log.sh phase0 parent-bootstrap architect-contracts done "WT-1/2/4 contracts written"
EOF
  exit 1
}

[[ $# -ge 4 ]] || usage

phase="$1"
actor="$2"
action="$3"
status="$4"
detail="${5:-}"

mkdir -p "${REPO_ROOT}/.audit"

if [[ ! -f "${AUDIT_FILE}" ]]; then
  printf '%s\n' 'timestamp_utc	phase	actor	action	status	detail' >"${AUDIT_FILE}"
fi

# Escape tabs/newlines in detail
detail="${detail//$'\t'/ }"
detail="${detail//$'\n'/ }"

printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  "${phase}" \
  "${actor}" \
  "${action}" \
  "${status}" \
  "${detail}" >>"${AUDIT_FILE}"

echo "audit: appended to ${AUDIT_FILE}"
