# launchd + Menubar Playbook — OpenCode Bridge (WP-13)

## Quick start (dev)

```bash
cd repos/remodex-opencode
./run-local-remodex.sh --hostname <LAN-IP>
```

## Production operator env

Operator Mac bridges default **handoff on** and honor **client-true discovery** (iOS sends `discoverOpenCodeSessions: true`; bridge env unset follows the client). Explicit opt-outs only:

```bash
# Handoff + discovery are production-default-on — set only to disable:
# export REMODEX_OPENCODE_HANDOFF=0
# export REMODEX_OPENCODE_DISCOVER_SESSIONS=0

# Relay/VPS push (WP-05) — use the env name the relay actually reads:
export REMODEX_ENABLE_PUSH_SERVICE=true    # opt-in for dev; auto-on when APNs creds present
export REMODEX_APNS_TEAM_ID=...
export REMODEX_APNS_KEY_ID=...
export REMODEX_APNS_BUNDLE_ID=...
export REMODEX_APNS_PRIVATE_KEY_FILE=...
export REMODEX_PUSH_SERVICE_URL=https://relay.example   # bridge push registration base URL

# Rollback flags (smoke before revert):
# REMODEX_OPENCODE_PERMISSIONS_UI=0
# REMODEX_OPENCODE_SSE_RECONNECT=0
# REMODEX_OPENCODE_ATTACHMENTS=0
# REMODEX_DISABLE_OPENCODE=1
```

## launchd plist notes

- Bridge label: `com.remodex.bridge` (see `phodex-bridge/src/macos-launch-agent.js`)
- Persist `REMODEX_OPENCODE_COMMAND`, `REMODEX_OPENCODE_HANDOFF`, `REMODEX_OPENCODE_PORT` in plist `EnvironmentVariables`
- After WP-11: check `bridge-status.json` for `opencode.sseReconnectCount`, `permissionPendingCount`

## Menubar / daemon health

1. `curl -s localhost:<bridge-port>/bridge-status.json | jq .opencode,.push`
2. Single listener: `lsof -nP -iTCP:9000 -sTCP:LISTEN`
3. Push degraded: `push.enabled: false` → iOS shows relay banner

## Observability

See [`observability.md`](observability.md) for APNs 4xx/5xx runbook.