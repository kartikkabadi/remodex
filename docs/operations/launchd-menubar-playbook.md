# launchd + Menubar Playbook — OpenCode Bridge (WP-13)

## Quick start (dev)

```bash
cd repos/remodex-opencode
./run-local-remodex.sh --hostname <LAN-IP>
```

## Production operator env

```bash
export REMODEX_OPENCODE_HANDOFF=1          # O12–O16 handoff
export REMODEX_PUSH_ENABLED=1             # relay APNs (WP-05)
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