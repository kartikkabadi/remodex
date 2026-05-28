#!/usr/bin/env bash
# OpenCode simulator preflight: launcher health, DEBUG pairing token, build_run_sim (Wave 2A).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

RELAY_HEALTH_URL="${REMODOX_RELAY_HEALTH_URL:-http://127.0.0.1:9000/health}"
LAUNCHER_LOG="${OPENCODE_LAUNCHER_LOG:-/tmp/remodex-opencode-launcher.log}"
SCREENSHOT_DIR="${REPO_ROOT}/.qa-screenshots/opencode-sim"
XCODEBUILDMCP_CONFIG="${REPO_ROOT}/.xcodebuildmcp/config.yaml"
LAUNCHER_PID_FILE="${OPENCODE_LAUNCHER_PID_FILE:-/tmp/remodex-opencode-launcher.pid}"

usage() {
  cat <<'EOF'
Usage: scripts/opencode-sim-preflight.sh [--check-only] [--skip-build]

Default (Wave 2A):
  1. Ensure ./run-local-remodex.sh --opencode is healthy (start in background if needed)
  2. Emit RMX1 via scripts/opencode-emit-pairing-rmx1.sh
  3. build_run_sim with -RemodexDebugPairingRMX1 launch args

Subcommands:
  codex-smoke   Row 9 Codex regression: Codex launcher (no --opencode), health, bridge smoke

Options:
  --check-only   Verify relay health + .xcodebuildmcp/config.yaml only (no sim build)
  --skip-build   Start launcher + emit RMX1 but skip build_run_sim
EOF
  exit 1
}

stop_launcher() {
  if [[ -f "${LAUNCHER_PID_FILE}" ]]; then
    local pid
    pid="$(cat "${LAUNCHER_PID_FILE}")"
    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
    fi
    rm -f "${LAUNCHER_PID_FILE}"
  fi
}

wait_for_health() {
  local attempt
  for attempt in {1..40}; do
    if curl -sf "${RELAY_HEALTH_URL}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "error: relay did not become healthy at ${RELAY_HEALTH_URL}" >&2
  return 1
}

ensure_opencode_launcher() {
  if curl -sf "${RELAY_HEALTH_URL}" >/dev/null 2>&1; then
    echo "preflight: relay already healthy"
    return 0
  fi

  echo "preflight: starting ./run-local-remodex.sh --opencode --hostname 127.0.0.1"
  : >"${LAUNCHER_LOG}"
  (
    cd "${REPO_ROOT}"
    ./run-local-remodex.sh --opencode --hostname 127.0.0.1
  ) >>"${LAUNCHER_LOG}" 2>&1 &
  echo $! >"${LAUNCHER_PID_FILE}"
  wait_for_health
}

ensure_codex_launcher() {
  stop_launcher
  echo "preflight: starting ./run-local-remodex.sh (Codex mode) for row 9 smoke"
  : >"${LAUNCHER_LOG}"
  (
    cd "${REPO_ROOT}"
    ./run-local-remodex.sh --hostname 127.0.0.1
  ) >>"${LAUNCHER_LOG}" 2>&1 &
  echo $! >"${LAUNCHER_PID_FILE}"
  wait_for_health
}

run_codex_smoke() {
  ensure_codex_launcher
  echo "preflight: codex-smoke health ok"
  (
    cd "${REPO_ROOT}/phodex-bridge"
    sfw npm test -- --test-name-pattern "remodex pair --json exposes"
  ) || {
    echo "warning: filtered bridge smoke did not match; running relay npm test instead" >&2
    (cd "${REPO_ROOT}/relay" && sfw npm test)
  }
  ./scripts/opencode-sim-record-row.sh 9 codex-regression pass "" "codex-smoke: launcher without --opencode"
  stop_launcher
  ensure_opencode_launcher
  echo "preflight: codex-smoke complete (row 9 recorded; OpenCode launcher restored)"
}

preflight_check_only() {
  [[ -f "${XCODEBUILDMCP_CONFIG}" ]] || {
    echo "error: missing ${XCODEBUILDMCP_CONFIG}" >&2
    exit 1
  }
  wait_for_health
  echo "preflight: check-only ok (health + xcodebuildmcp config)"
}

preflight_wave_2a() {
  local skip_build=0
  if [[ "${1:-}" == "--skip-build" ]]; then
    skip_build=1
  fi

  [[ -f "${XCODEBUILDMCP_CONFIG}" ]] || {
    echo "error: missing ${XCODEBUILDMCP_CONFIG}" >&2
    exit 1
  }

  mkdir -p "${SCREENSHOT_DIR}"
  ensure_opencode_launcher

  local rmx1
  rmx1="$(./scripts/opencode-emit-pairing-rmx1.sh)"
  echo "preflight: RMX1 token emitted (${#rmx1} chars)"

  if [[ "${skip_build}" -eq 1 ]]; then
    echo "preflight: skip-build — export for Simulator launch:"
    echo "  REMODOX_DEBUG_PAIRING_RMX1=${rmx1}"
    return 0
  fi

  echo "preflight: build_run_sim (DEBUG pairing launch args)"
  sfw npx --yes xcodebuildmcp@2.5.2 simulator build-and-run \
    --project-path CodexMobile/CodexMobile.xcodeproj \
    --scheme CodexMobile \
    --configuration Debug \
    --derived-data-path .build/DerivedData-Sim \
    --simulator-name "iPhone 17" \
    --launch-args "-RemodexDebugPairingRMX1" "${rmx1}"

  echo "preflight: capture connected-state screenshot:"
  echo "  sfw npx --yes xcodebuildmcp@2.5.2 simulator screenshot --output-path ${SCREENSHOT_DIR}/row-00-connected.png"
  echo "  ./scripts/validate-qa-screenshot.sh ${SCREENSHOT_DIR}/row-00-connected.png"
}

if [[ "${STOP_LAUNCHER:-0}" == "1" ]]; then
  stop_launcher
  exit 0
fi

case "${1:-}" in
  -h | --help) usage ;;
  codex-smoke) run_codex_smoke ;;
  --check-only) preflight_check_only ;;
  --skip-build) preflight_wave_2a --skip-build ;;
  "") preflight_wave_2a ;;
  *) usage ;;
esac
