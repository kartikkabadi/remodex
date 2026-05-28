# OpenCode — local development

Single launcher, loopback-first relay, explicit profiles for phone/LAN.

## Prerequisites

- Node 18+, `npm` (use `sfw npm` when Socket Firewall is enabled)
- `opencode` on PATH (or `REMODEX_OPENCODE_COMMAND`)
- Xcode for iOS sim/device builds
- Copy relay override for simulator (once per machine):

```sh
cp CodexMobile/BuildSupport/PrivateOverrides.xcconfig.example \
   CodexMobile/BuildSupport/PrivateOverrides.xcconfig
```

Edit `PrivateOverrides.xcconfig`:

```
PHODEX_DEFAULT_RELAY_URL = ws://127.0.0.1:9000/relay
```

(`PrivateOverrides.xcconfig` is gitignored.)

Fresh simulator onboarding (stop stack, full `~/.remodex` identity reset, uninstall sim app):

```sh
./scripts/opencode-fresh-onboarding.sh --build-sim --start-launcher
```

## Relay profiles

### 1. Mac-only / simulator (default)

```sh
./run-local-remodex.sh --opencode
```

- Relay binds **`127.0.0.1:9000`**
- Bridge runs with `REMODEX_PROVIDER=opencode`
- Simulator reaches Mac loopback via `PrivateOverrides.xcconfig`
- Pairing: **Paste pairing code** in sim (camera QR unreliable)

### 2. Same-LAN sim or device (opt-in)

```sh
./run-local-remodex.sh --opencode \
  --bind-host 0.0.0.0 \
  --hostname "$(ipconfig getifaddr en0)"
```

- Listens on all interfaces — **trusted LAN only**
- QR advertises `ws://<Mac-LAN-IP>:9000/relay`
- Physical iPhone: scan QR; grant Local Network if prompted

### 3. Tailscale (preferred for physical iPhone)

```sh
./run-local-remodex.sh --opencode \
  --relay-url wss://<your-tailscale-host>/relay/...
```

- Relay can stay on loopback; tunnel terminates TLS
- Prefer this over public quick tunnels for routine dev

## What not to do

- Do **not** run `cd phodex-bridge && npm start` in a second terminal while the launcher already started the bridge.
- Do **not** assume default QR works on simulator without paste-code flow.
- Do **not** use `127.0.0.1` in the advertised URL for a **physical** phone (use LAN or Tailscale).

## Verify bridge

```sh
cd phodex-bridge && npm test
./run-local-remodex.sh --help
```

## OpenCode E2E (optional)

```sh
cd phodex-bridge && OPENCODE_E2E=1 npm test -- test/opencode-e2e.test.js
```

Requires live `opencode` binary.

## XcodeBuildMCP

Repo config: `.xcodebuildmcp/config.yaml` (scheme `CodexMobile`, sim `iPhone 17`, derived data under `.build/DerivedData-Sim`).

**CLI preflight (always valid):**

```sh
sfw npx --yes xcodebuildmcp@2.5.2 simulator build-and-run
```

**Cursor MCP (optional):** pin `xcodebuildmcp@2.5.2` with workflows `simulator,ui-automation,debugging`. If MCP is not enabled in the workspace, subagents use the CLI from repo root.

## Related

- [opencode-sim-qa-runbook.md](./opencode-sim-qa-runbook.md)
- [opencode-runtime-status.md](./opencode-runtime-status.md)
- [README.md](../../README.md) — Run Locally
