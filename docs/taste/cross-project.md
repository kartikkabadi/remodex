# Cross-Project Conventions

Rules that apply across both `phodex-bridge/` and `CodexMobile/`.

## Design Principle: Model Selection IS Runtime Selection

The user picks a model, and the runtime is implicit. The iOS composer shows a single model picker grouped by provider. There is no separate "Runtime" row. A small provider badge next to the model name provides visual context.

**Why:** This keeps the UI simple and prevents two separate pickers that would be confusing. The bridge enforces thread affinity — once a model is picked, the runtime is locked. Adding a runtime picker would imply the user can change runtimes mid-thread, which they cannot.

## Capability-Driven UI

Never check provider identity in iOS code:
```swift
// BAD — hardcodes provider knowledge
if thread.modelProvider == "opencode" {
    showAgentPicker = true
}

// GOOD — reads capability flag
if model.capabilities.supportsAgentSelection == true {
    showAgentPicker = true
}
```

**Why:** Adding a new runtime (e.g., "cursor", "claude-code") requires zero iOS changes if the bridge's `runtime/catalog` advertises capabilities correctly. The iOS app is a capability renderer, not a feature gate.

## Open Source Quality

- No junk code, placeholder hacks, or noisy one-off workarounds
- No "TODO" or "FIXME" in committed code without an issue link
- Deletions are clean — no `// removed this` comments, no dead code paths
- If something is unused, delete it completely

**Why:** The repo is open source. Visitors and future contributors form judgments from what they see. Placeholder hacks and commented-out code erode trust.

## Documentation

- Don't create one-off report markdown files in repo roots
- Keep ad-hoc analysis in chat, not in the filesystem
- Documentation lives in `docs/` with a clear purpose
- READMEs are for quick starts, not architecture

**Why:** Repo roots accumulate orphaned markdown files that nobody maintains. If a doc is worth keeping, it goes in `docs/` with a clear role.

## Security

- Never log live relay `sessionId` values or bearer-like pairing identifiers
- Redact or hash sensitive identifiers in logs
- Bridge file permissions: `0600` for device state, ownership store, session mappings
- Do not put live API keys into bridge config or launchd plists

**Why:** The relay is untrusted by design. Logging session identifiers to relay-side logs would leak pairing information. Defense in depth: if one layer fails, the next layer catches it.

## "Do Not Build What Wasn't Asked For"

When implementing a feature, only build what's required:
- Don't add error handling for scenarios that can't happen
- Don't create helpers, utilities, or abstractions for one-time operations
- Three similar lines of code is better than a premature abstraction
- Don't add backwards-compatibility hacks

**Why:** Premature abstraction is worse than duplication. A helper used once makes the code harder to follow, not easier. Wait for three uses before extracting.

## Build Guardrails

- Do NOT run Xcode tests unless explicitly asked
- For small iOS fixes, prefer inspection and targeted edits over simulator runs
- Bridge tests: `cd repos/remodex-opencode/phodex-bridge && npm test`
- Markdown files inside Xcode-synced groups produce harmless warnings — ignore them

## Commit Conventions

| Type | Use |
|------|-----|
| `feat:` | New capability |
| `fix:` | Bug fix |
| `docs:` | Documentation changes |
| `refactor:` | Code restructuring without behavior change |
| `test:` | Test additions or changes |
| `chore:` | Maintenance (deps, cleanup, config) |

Examples: `feat(bridge): add OpenCode SDK transport`, `docs: add bridge RPC contract`, `chore: remove stale ACP transport files`
