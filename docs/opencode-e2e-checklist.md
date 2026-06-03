# OpenCode E2E Checklist (post execute-plan f700f9bf)

## Providers (Settings)

- [ ] `runtime/catalog` includes `opencode.providerInventory` with `connectedOnServe` and `authenticated`
- [ ] Settings → **OpenCode providers on Mac** lists authenticated-but-disconnected rows with **Not connected on serve**
- [ ] Model menu still offers **connected** models only (no fake-enabled disconnected rows)

## Logos

- [ ] `opencode-go` shows **provider-opencode-go-logo** (not cube) in Settings and composer menu
- [ ] `opencode-zen` shows **provider-opencode-zen-logo** (not generic OpenCode logo)

## Agents

- [ ] Agent submenu matches Mac `app.agents()` when serve responds within catalog budget
- [ ] On slow serve, catalog returns **stale cached agents** (not empty); log contains `runtime_catalog_agents_stale`

## Turns

- [ ] Send with `opencode-go/deepseek-v4-flash` — turn completes; no `setConfig` in bridge logs
- [ ] Log `opencode_turn_prompt` includes `providerID` / `modelID`

## Regression

- [ ] `cd repos/remodex-opencode/phodex-bridge && npm test` — all green