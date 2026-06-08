# launchd OpenCode Environment

The macOS bridge LaunchAgent (`com.remodex.bridge`) is installed via `phodex-bridge/src/macos-launch-agent.js` and `remodex up`.

## Environment variables

| Variable | Default | Effect |
|----------|---------|--------|
| `REMODEX_DISABLE_OPENCODE` | unset (OpenCode **on**) | Set to `1` or `true` to run Codex-only (no `opencode serve`, no OpenCode catalog row) |
| `REMODEX_OPENCODE_HANDOFF` | **on** for operator/managed/self-hosted profiles | Production Mac bridges allow `desktop/continueOpenCode` by default. Set to `0`/`false` to disable. Dev profile (`NODE_ENV=development` or `REMODEX_PROFILE=dev`) stays opt-in. |
| `REMODEX_OPENCODE_DISCOVER_SESSIONS` | **client-true** when unset | iOS sends `discoverOpenCodeSessions: true` by default. Bridge honors client params when env is unset; `=0` hard-kills; `=1` forces on without client params. **No env flip required for production.** |
| `REMODEX_OPENCODE_DISCOVER_PROJECTS` | **client-true** when unset | Same policy as sessions for `discoverOpenCodeProjects`. |
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

## Handoff opt-out (dev or rollback)

```bash
export REMODEX_OPENCODE_HANDOFF=0
remodex up
```

Operator/production launchd installs do **not** need `REMODEX_OPENCODE_HANDOFF=1` — handoff is default-on unless explicitly disabled.

## Diagnostics

- Bridge logs: `~/.remodex/logs/bridge-stdout.log`, `bridge-stderr.log`
- Status file: `~/.remodex/bridge-status.json` (includes `opencode` subsection when enabled)