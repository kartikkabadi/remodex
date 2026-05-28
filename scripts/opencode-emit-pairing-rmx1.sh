#!/usr/bin/env bash
# Emit an RMX1 paste token for DEBUG simulator pairing (Wave 2A).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${REMODEX_DEVICE_STATE_DIR:-${HOME}/.remodex}"
PAIRING_SESSION_FILE="${STATE_DIR}/pairing-session.json"
RELAY_URL="${REMODOX_RELAY:-ws://127.0.0.1:9000/relay}"
RELAY_HEALTH_URL="${REMODOX_RELAY_HEALTH_URL:-http://127.0.0.1:9000/health}"
LAUNCHER_LOG="${OPENCODE_LAUNCHER_LOG:-/tmp/remodex-opencode-launcher.log}"
PAIRING_WAIT_SECONDS="${OPENCODE_PAIRING_WAIT_SECONDS:-90}"

usage() {
  cat <<'EOF'
Usage: scripts/opencode-emit-pairing-rmx1.sh

Prints a single RMX1:<base64url> token for:
  - REMODOX_DEBUG_PAIRING_RMX1, or
  - -RemodexDebugPairingRMX1 <token> on the Simulator launch args

Sources (first match wins):
  1. ~/.remodex/pairing-session.json (pairingPayload)
  2. Short pairing code from OPENCODE_LAUNCHER_LOG + relay /v1/pairing/code/resolve

Requires a healthy local relay (see scripts/opencode-sim-preflight.sh).
EOF
  exit 1
}

[[ "${1:-}" != "-h" && "${1:-}" != "--help" ]] || usage

curl -sf "${RELAY_HEALTH_URL}" >/dev/null || {
  echo "error: relay health check failed at ${RELAY_HEALTH_URL}" >&2
  echo "hint: run ./scripts/opencode-sim-preflight.sh or ./run-local-remodex.sh --opencode" >&2
  exit 1
}

export REPO_ROOT PAIRING_SESSION_FILE RELAY_URL LAUNCHER_LOG PAIRING_WAIT_SECONDS

node <<'NODE'
const fs = require("fs");
const path = require("path");

const pairingSessionFile = process.env.PAIRING_SESSION_FILE;
const relayUrl = (process.env.RELAY_URL || "ws://127.0.0.1:9000/relay").replace(/\/+$/, "");
const launcherLog = process.env.LAUNCHER_LOG;
const waitSeconds = Number.parseInt(process.env.PAIRING_WAIT_SECONDS || "90", 10);
const healthUrl = process.env.REMODEX_RELAY_HEALTH_URL || "http://127.0.0.1:9000/health";

function encodeRMX1(payload) {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `RMX1:${encoded}`;
}

function readPairingPayloadFromSessionFile() {
  if (!fs.existsSync(pairingSessionFile)) {
    return null;
  }
  const session = JSON.parse(fs.readFileSync(pairingSessionFile, "utf8"));
  return session?.pairingPayload || session?.pairingSession?.pairingPayload || null;
}

function extractShortPairingCodeFromLog(contents) {
  const lines = contents.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    const match = line.match(/\b([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8,12})\b/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

async function resolveShortPairingCode(code) {
  const relayHttpOrigin = healthUrl.replace(/\/health\/?$/, "");
  const response = await fetch(`${relayHttpOrigin}/v1/pairing/code/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || `resolve failed (${response.status})`);
  }
  return {
    v: body.v,
    relay: relayUrl,
    sessionId: body.sessionId,
    macDeviceId: body.macDeviceId,
    macIdentityPublicKey: body.macIdentityPublicKey,
    expiresAt: body.expiresAt,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPairingPayload() {
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    const fromSession = readPairingPayloadFromSessionFile();
    if (fromSession?.sessionId && fromSession?.relay) {
      return fromSession;
    }

    if (launcherLog && fs.existsSync(launcherLog)) {
      const code = extractShortPairingCodeFromLog(fs.readFileSync(launcherLog, "utf8"));
      if (code) {
        try {
          return await resolveShortPairingCode(code);
        } catch {
          // Bridge may still be registering the code; keep polling.
        }
      }
    }

    await sleep(500);
  }

  return null;
}

(async () => {
  const payload = await waitForPairingPayload();
  if (!payload?.sessionId || !payload?.relay) {
    console.error(
      "error: could not resolve pairing payload. Ensure the bridge is running and pairing is visible in the launcher log or pairing-session.json.",
    );
    process.exit(1);
  }
  process.stdout.write(`${encodeRMX1(payload)}\n`);
})().catch((error) => {
  console.error(`error: ${error.message || error}`);
  process.exit(1);
});
NODE
