# Provider Branding

## Overview

Provider logos for the runtime catalog and iOS composer/sidebar/menus are provided via `Assets.xcassets` as `provider-*-logo.imageset` bundles. Logos drive visual distinction in the unified model picker and badges without hardcoding provider identity checks in UI visibility logic (capability flags are the source of truth per ADR-002 and AGENTS.md).

## Legal Clearance (External Dependency)

**STATUS: BLOCKED**

- clearance received date: TBD
- reviewers: TBD
- providers: anthropic, openai, google, xai, groq, deepseek, mistral, cohere, perplexity, together, amazon, azure, openrouter, github, bedrock (15 in Phase 1)

**Non-negotiable:** Do not merge any assets without updating this file with actual "clearance received date: YYYY-MM-DD, reviewer: <legal>, providers: list". Track as "blocked" in the plan (see design doc) until cleared. SF fallback path (RP-BRAND-5 / PR8) remains unblocked for visual parity in the interim.

Sources for Phase 1 SVGs:
- Primarily @lobehub/icons-static-svg (stylized LLM brand icons, public CDN usage; https://github.com/lobehub/lobe-icons ; chosen as many core AI providers like OpenAI/Anthropic are absent from Simple Icons due to trademark policies in their library).
- Fallback Simple Icons (MIT) via CDN where direct match (e.g. for some).
- Note in each: MIT or fair-use stylized for dev tooling; full legal sign-off required before any App Store impact or merge of binary assets. No raw official trademarks copied without explicit clearance.

Phase 2 (PR14 / RP-BRAND-4) will add ~15 more once clearance and catalog are ready.

## Phase 1 Branded Assets (RP-BRAND-3)

Added in this change (15 new `provider-*-logo.imageset` directories containing `Contents.json` + `.svg`):

- provider-anthropic-logo (SVG + template + preserves-vector)
- provider-openai-logo (SVG + template + preserves-vector)
- provider-google-logo (SVG + template + preserves-vector)
- provider-xai-logo (SVG + template + preserves-vector)
- provider-groq-logo (SVG + template + preserves-vector)
- provider-deepseek-logo (SVG + template + preserves-vector)
- provider-mistral-logo (SVG + template + preserves-vector)
- provider-cohere-logo (SVG + template + preserves-vector)
- provider-perplexity-logo (SVG + template + preserves-vector)
- provider-together-logo (SVG + template + preserves-vector)
- provider-amazon-logo (SVG + template + preserves-vector; sourced via aws stylized)
- provider-azure-logo (SVG + template + preserves-vector)
- provider-openrouter-logo (SVG + template + preserves-vector)
- provider-github-logo (SVG + template + preserves-vector)
- provider-bedrock-logo (SVG + template + preserves-vector)

All use:
- Single SVG (vector, suitable for Liquid Glass / tinting)
- `template-rendering-intent: "template"` (for accent tint / foreground in SwiftUI dark/light)
- `preserves-vector-representation: true` (crisp at all sizes)
- `currentColor` friendly where sourced (adapts to tint)

Existing 4 (`provider-codex-logo`, `provider-opencode-logo`, `provider-opencode-go-logo`, `provider-opencode-zen-logo`) left unchanged in this PR (they lack the properties currently; future maintenance PR can align).

Asset naming convention: `provider-{logoProviderId}-logo` where `logoProviderId` comes from bridge `resolveLogoProviderId` / catalog (e.g. "anthropic", "mistral", "amazon").

## Review Checklist (for PR + visual)

- [ ] All 15 assets present under CodexMobile/CodexMobile/Assets.xcassets/ with correct Contents.json (properties for template/preserve) + .svg
- [ ] SVGs are from Simple Icons MIT / lobe-icons public or equivalent (documented source + no raw TM w/o clearance)
- [ ] Visual review: composer bar, sidebar badges, UIKit menus, settings providers list, light + dark + high contrast, tinting works (no color bleed)
- [ ] iOS build succeeds (`xcodebuild ... build` reports SUCCEEDED); no behavior change to Codex path
- [ ] No fake-enabled UI; catalog (parallel PR) will drive; SF Symbols fallback handles uncleared
- [ ] docs/operations/provider-branding.md has the BLOCKED clearance block + this checklist + rollback note
- [ ] PR description includes this checklist + "legal blocker per design doc; assets prepared, doc updated with block"
- [ ] Commit is conventional `feat(assets): ... (legal block + additive)`
- [ ] Rollback: `rm -rf` the 15 dirs + revert the md file
- [ ] Phase 2 follow-up tracked (PR14)

## Rollback

To revert this PR's asset changes:
```
rm -rf \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-anthropic-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-openai-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-google-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-xai-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-groq-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-deepseek-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-mistral-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-cohere-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-perplexity-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-together-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-amazon-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-azure-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-openrouter-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-github-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-bedrock-logo.imageset
git checkout -- docs/operations/provider-branding.md
```

## Maintenance

See RP-BRAND-6 (runbook + full table + quarterly audit of licenses/clearances). Update this file on any new clearance or Phase 2 additions. Coverage metric in obs: catalog providers vs present assets.

## References

- Design doc (private/tmp/grok-design-doc-bbe8e09d.md): RP-BRAND-3, legal hard blocker, Phase 1 15, PR12 details.
- AGENTS.md: capability-driven, no assets w/o clearance.
- docs/design/master-opencode-integration.md (branding sections).
- iOS: RuntimeProviderLogo.swift (current 4; will become catalog driven in RP-BRAND-2).
- Bridge: opencode-provider-inventory.js (resolveLogoProviderId), runtime catalog (PR7 parallel).
