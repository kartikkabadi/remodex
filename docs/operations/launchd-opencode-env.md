# launchd OpenCode Environment

The macOS bridge LaunchAgent (`com.remodex.bridge`) is installed via `phodex-bridge/src/macos-launch-agent.js` and `remodex up`.

## Environment variables

| Variable | Default | Effect |
|----------|---------|--------|
| `REMODEX_DISABLE_OPENCODE` | unset (OpenCode **on**) | Set to `1` or `true` to run Codex-only (no `opencode serve`, no OpenCode catalog row) |
| `REMODEX_OPENCODE_HANDOFF` | unset | Set to `1` or `true` to allow `desktop/continueOpenCode` on the bridge |
| `REMODEX_OPENCODE_COMMAND` | `opencode` | Override the OpenCode CLI binary/path |
| `REMODEX_OPENCODE_PORT` | auto | Pin `opencode serve` to a fixed localhost port |
| `PATH` | inherited from login shell | Must include `opencode` and `node` when using nvm/Homebrew |

## Plist injection

When installing the LaunchAgent, `macos-launch-agent.js` writes `EnvironmentVariables` into `~/Library/LaunchAgents/com.remodex.bridge.plist`. Export vars in `~/.zshrc` **before** `remodex up` if you need them in the daemon, or edit the plist after install.

## Codex-only daemon

```bash
export REMODEX_DISABLE_OPENCODE=1
remodex up
```

## Handoff-enabled daemon

```bash
export REMODEX_OPENCODE_HANDOFF=1
remodex up
```

## Diagnostics

- Bridge logs: `~/.remodex/logs/bridge-stdout.log`, `bridge-stderr.log`
- Status file: `~/.remodex/bridge-status.json` (includes `opencode` subsection when enabled)