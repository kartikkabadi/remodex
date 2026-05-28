#!/usr/bin/env bash
# Fresh OpenCode simulator onboarding: stop stack, reset ~/.remodex identity, uninstall sim app,
# install loopback PrivateOverrides, optionally build/install (no DEBUG auto-pairing).
#
# Usage:
#   ./scripts/opencode-fresh-onboarding.sh              # reset + PrivateOverrides only
#   ./scripts/opencode-fresh-onboarding.sh --build-sim  # also build_run_sim (manual pairing)
#   ./scripts/opencode-fresh-onboarding.sh --start-launcher  # reset then start launcher in background
#
# After reset, start the stack and pair manually:
#   ./run-local-remodex.sh --opencode --hostname 127.0.0.1
#   # pairing code: launcher log or ~/.remodex/pairing-session.json (pairingCode field)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

STATE_DIR="${REMODEX_DEVICE_STATE_DIR:-${HOME}/.remodex}"
PRIVATE_OVERRIDES="${REPO_ROOT}/CodexMobile/BuildSupport/PrivateOverrides.xcconfig"
PRIVATE_EXAMPLE="${REPO_ROOT}/CodexMobile/BuildSupport/PrivateOverrides.xcconfig.example"
SIMULATOR_ID="${REMODOX_SIMULATOR_ID:-118307B9-FFB8-4D62-80E0-21901FE91639}"
BUNDLE_ID="com.emanueledipietro.Remodex"
RELAY_PORT="${RELAY_PORT:-9000}"
LAUNCHER_LOG="${OPENCODE_LAUNCHER_LOG:-/tmp/remodex-opencode-launcher.log}"
LAUNCHER_PID_FILE="${OPENCODE_LAUNCHER_PID_FILE:-/tmp/remodex-opencode-launcher.pid}"
RELAY_HEALTH_URL="${REMODOX_RELAY_HEALTH_URL:-http://127.0.0.1:${RELAY_PORT}/health}"
BRIDGE_BIN="${REPO_ROOT}/phodex-bridge/bin/remodex.js"

DO_BUILD_SIM=0
DO_START_LAUNCHER=0

usage() {
  cat <<'EOF'
Usage: scripts/opencode-fresh-onboarding.sh [options]

Performs a full local pairing reset for OpenCode + Simulator QA (idempotent):

  1. Stop ./run-local-remodex.sh, relay on port 9000, and macOS remodex launchd job
  2. resetBridgeDeviceState() (fresh Mac identity — not trust-only reset-pairing)
  3. Remove ~/.remodex opencode-bindings, pairing-session, bridge-status, daemon-config, push state
  4. Uninstall CodexMobile from iPhone 17 simulator (bundle com.emanueledipietro.Remodex)
  5. Write PrivateOverrides.xcconfig → ws://127.0.0.1:9000/relay (xcconfig-safe escape)

Options:
  --build-sim        build_run_sim via xcodebuildmcp (no -RemodexDebugPairingRMX1)
  --start-launcher   after reset, start ./run-local-remodex.sh --opencode in background
  -h, --help         this text

Manual pairing (recommended after --build-sim):
  ./run-local-remodex.sh --opencode --hostname 127.0.0.1
  # Short code: grep launcher log or: jq -r .pairingCode ~/.remodex/pairing-session.json
EOF
  exit "${1:-0}"
}

log() {
  echo "[opencode-fresh-onboarding] $*"
}

stop_local_stack() {
  log "stopping macOS bridge service (if any)"
  if [[ -x "${BRIDGE_BIN}" ]]; then
    (cd "${REPO_ROOT}/phodex-bridge" && node bin/remodex.js stop) 2>/dev/null || true
  fi

  if [[ -f "${LAUNCHER_PID_FILE}" ]]; then
    local pid
    pid="$(cat "${LAUNCHER_PID_FILE}")"
    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
    fi
    rm -f "${LAUNCHER_PID_FILE}"
  fi

  pkill -f "run-local-remodex.sh" 2>/dev/null || true
  pkill -f "${REPO_ROOT}/relay/server.js" 2>/dev/null || true
  sleep 0.5

  local pid
  for pid in $(lsof -ti ":${RELAY_PORT}" 2>/dev/null || true); do
    kill "${pid}" 2>/dev/null || true
  done
  sleep 0.5

  if lsof -ti ":${RELAY_PORT}" >/dev/null 2>&1; then
    echo "error: port ${RELAY_PORT} still in use" >&2
    lsof -i ":${RELAY_PORT}" >&2 || true
    exit 1
  fi
  log "port ${RELAY_PORT} clear"
}

reset_bridge_state() {
  log "resetBridgeDeviceState (full Mac identity + pairing)"
  (
    cd "${REPO_ROOT}/phodex-bridge"
    node -e "
      const { resetBridgeDeviceState } = require('./src/secure-device-state');
      console.log(JSON.stringify(resetBridgeDeviceState()));
    "
  )

  mkdir -p "${STATE_DIR}"
  local f
  for f in opencode-bindings.json pairing-session.json bridge-status.json daemon-config.json; do
    if [[ -f "${STATE_DIR}/${f}" ]]; then
      rm -f "${STATE_DIR}/${f}"
      log "removed ${STATE_DIR}/${f}"
    fi
  done

  shopt -s nullglob
  for f in "${STATE_DIR}"/relay-push*.json "${STATE_DIR}"/push*.json; do
    rm -f "${f}"
    log "removed $(basename "${f}")"
  done
  shopt -u nullglob

  if [[ -f "${STATE_DIR}/device-state.json" ]]; then
    echo "error: device-state.json still present after reset" >&2
    exit 1
  fi
  log "~/.remodex device-state cleared"
}

install_private_overrides() {
  if [[ ! -f "${PRIVATE_EXAMPLE}" ]]; then
    echo "error: missing ${PRIVATE_EXAMPLE}" >&2
    exit 1
  fi
  # xcconfig treats // as comment; use $() escape so ws://127.0.0.1:9000/relay resolves correctly.
  cat >"${PRIVATE_OVERRIDES}" <<'EOF'
// Local dev — Simulator pairing to Mac relay (gitignored)
// Copied from PrivateOverrides.xcconfig.example (loopback relay).
PHODEX_DEFAULT_RELAY_URL = ws:/$()/127.0.0.1:9000/relay
EOF
  log "wrote ${PRIVATE_OVERRIDES}"
  if ! grep -q 'PrivateOverrides.xcconfig' "${REPO_ROOT}/.gitignore" 2>/dev/null; then
    echo "warning: PrivateOverrides.xcconfig not listed in .gitignore" >&2
  else
    log "PrivateOverrides.xcconfig is gitignored"
  fi
}

reset_simulator_app() {
  log "boot simulator ${SIMULATOR_ID} if needed"
  xcrun simctl boot "${SIMULATOR_ID}" 2>/dev/null || true
  if xcrun simctl uninstall "${SIMULATOR_ID}" "${BUNDLE_ID}" 2>/dev/null; then
    log "uninstalled ${BUNDLE_ID} from simulator"
  else
    log "simulator app not installed (ok)"
  fi
}

build_and_install_sim() {
  local mcp_config="${REPO_ROOT}/.xcodebuildmcp/config.yaml"
  [[ -f "${mcp_config}" ]] || {
    echo "error: missing ${mcp_config}" >&2
    exit 1
  }
  log "build_run_sim (no DEBUG pairing launch args)"
  sfw npx --yes xcodebuildmcp@2.5.2 simulator build-and-run \
    --project-path CodexMobile/CodexMobile.xcodeproj \
    --scheme CodexMobile \
    --configuration Debug \
    --derived-data-path .build/DerivedData-Sim \
    --simulator-id "${SIMULATOR_ID}"
}

start_opencode_launcher() {
  if curl -sf "${RELAY_HEALTH_URL}" >/dev/null 2>&1; then
    log "relay already healthy at ${RELAY_HEALTH_URL}"
    return 0
  fi
  log "starting ./run-local-remodex.sh --opencode --hostname 127.0.0.1"
  : >"${LAUNCHER_LOG}"
  (
    cd "${REPO_ROOT}"
    ./run-local-remodex.sh --opencode --hostname 127.0.0.1
  ) >>"${LAUNCHER_LOG}" 2>&1 &
  echo $! >"${LAUNCHER_PID_FILE}"

  local attempt
  for attempt in {1..60}; do
    if curl -sf "${RELAY_HEALTH_URL}" >/dev/null 2>&1; then
      log "relay healthy"
      return 0
    fi
    sleep 0.5
  done
  echo "error: relay did not become healthy (see ${LAUNCHER_LOG})" >&2
  exit 1
}

print_pairing_hints() {
  local code=""
  if [[ -f "${STATE_DIR}/pairing-session.json" ]] && command -v jq >/dev/null 2>&1; then
    code="$(jq -r '.pairingCode // empty' "${STATE_DIR}/pairing-session.json" 2>/dev/null || true)"
  fi
  if [[ -z "${code}" && -f "${LAUNCHER_LOG}" ]]; then
    code="$(grep -oE 'Or enter this pairing code[^A-Z0-9]*([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8,12})' "${LAUNCHER_LOG}" 2>/dev/null | tail -1 | grep -oE '[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$' || true)"
  fi
  echo ""
  echo "=== Fresh onboarding next steps ==="
  echo "1. Relay health: curl -sf ${RELAY_HEALTH_URL}"
  echo "2. Launcher log: ${LAUNCHER_LOG}"
  echo "3. Pairing session file: ${STATE_DIR}/pairing-session.json (field pairingCode)"
  if [[ -n "${code}" ]]; then
    echo ""
    echo "Short pairing code (paste in Simulator):"
    echo "  ${code}"
  else
    echo ""
    echo "Short pairing code: start launcher, then read pairingCode from pairing-session.json or launcher log block after 'Or enter this pairing code'"
  fi
  echo "4. Do NOT pass -RemodexDebugPairingRMX1 for manual fresh pairing"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-sim) DO_BUILD_SIM=1; shift ;;
    --start-launcher) DO_START_LAUNCHER=1; shift ;;
    -h | --help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 1 ;;
  esac
done

stop_local_stack
reset_bridge_state
install_private_overrides
reset_simulator_app

if [[ "${DO_BUILD_SIM}" -eq 1 ]]; then
  build_and_install_sim
fi

if [[ "${DO_START_LAUNCHER}" -eq 1 ]]; then
  start_opencode_launcher
fi

print_pairing_hints
