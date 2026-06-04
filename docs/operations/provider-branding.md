# Provider Branding

## Overview

Provider logos for the runtime catalog and iOS composer/sidebar/menus are provided via `Assets.xcassets` as `provider-*-logo.imageset` bundles. Logos drive visual distinction in the unified model picker and badges without hardcoding provider identity checks in UI visibility logic (capability flags are the source of truth per ADR-002 and AGENTS.md).

## Legal Clearance (External Dependency)

**STATUS: BLOCKED (Phase 2 pending clearance; Phase 1 prep complete in prior PR)**

- clearance received date: TBD (phase1 list prepped PR12; phase2 TBD)
- reviewers: TBD
- providers phase1 (PR12): anthropic, openai, google, xai, groq, deepseek, mistral, cohere, perplexity, together, amazon, azure, openrouter, github, bedrock
- providers phase2 (this PR): alibaba, cerebras, cloudflare, databricks, deepinfra, fireworks, gitlab, google-vertex, huggingface, lmstudio, minimax, nebius, novita, ovhcloud, scaleway

**Non-negotiable:** Do not merge any (new) assets without updating this file with actual "clearance received date: YYYY-MM-DD, reviewer: <legal>, providers: list". Track as "blocked" in the plan (see design doc) until cleared. This PR is additive prep + doc update only (no claim of clearance for phase2 assets). SF fallback path (RP-BRAND-5 / PR8) remains unblocked for visual parity in the interim. Legal blocker still applies per design doc (no upstream/merge claim until device E2E + clearance).

Sources for SVGs (Phase 1 + Phase 2):
- Primarily @lobehub/icons-static-svg (stylized LLM brand icons, public CDN usage; https://github.com/lobehub/lobe-icons ; chosen as many core AI providers like OpenAI/Anthropic are absent from Simple Icons due to trademark policies in their library).
- Fallback Simple Icons (MIT) via CDN where direct match (e.g. for some, databricks/gitlab etc).
- Note in each: MIT or fair-use stylized for dev tooling; full legal sign-off required before any App Store impact or merge of binary assets. No raw official trademarks copied without explicit clearance.
- Phase 2 SVGs fetched same way (lobe cdn + simple-icons raw); identical format (SVG + Contents template/preserve).

See full table below for per-provider license/clearance/ownership + dates/reviewers. Phase 2 marked "phase2 pending clearance".

## License / Clearance / Ownership Table + Quarterly Audit (RP-BRAND-6)

This table is the source of truth for the 30 external providers (phase1+phase2). Core 4 (codex, opencode*, internal) have no external clearance needed.

| Provider       | Asset Name                        | Phase | Source                          | License          | Clearance Status          | Clearance Date | Reviewer | Ownership / Notes                          | Last Reviewed |
|----------------|-----------------------------------|-------|---------------------------------|------------------|---------------------------|----------------|----------|--------------------------------------------|---------------|
| anthropic     | provider-anthropic-logo          | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| openai        | provider-openai-logo             | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| google        | provider-google-logo             | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| xai           | provider-xai-logo                | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| groq          | provider-groq-logo               | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| deepseek      | provider-deepseek-logo           | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| mistral       | provider-mistral-logo            | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| cohere        | provider-cohere-logo             | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| perplexity    | provider-perplexity-logo         | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| together      | provider-together-logo           | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| amazon        | provider-amazon-logo             | 1     | aws stylized / simple fallback | fair-use / MIT   | BLOCKED / pending full | TBD           | TBD     | phase1 note: sourced via aws stylized      | 2026-06-04   |
| azure         | provider-azure-logo              | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| openrouter    | provider-openrouter-logo         | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| github        | provider-github-logo             | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| bedrock       | provider-bedrock-logo            | 1     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | BLOCKED / pending full | TBD           | TBD     | lobe-icons; amazon-bedrock alias           | 2026-06-04   |
| alibaba       | provider-alibaba-logo            | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| cerebras      | provider-cerebras-logo           | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| cloudflare    | provider-cloudflare-logo         | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| databricks    | provider-databricks-logo         | 2     | Simple Icons MIT               | MIT              | phase2 pending clearance | TBD           | TBD     | simple-icons; MIT license                  | 2026-06-04   |
| deepinfra     | provider-deepinfra-logo          | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| fireworks     | provider-fireworks-logo          | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| gitlab        | provider-gitlab-logo             | 2     | Simple Icons MIT               | MIT              | phase2 pending clearance | TBD           | TBD     | simple-icons; MIT license                  | 2026-06-04   |
| google-vertex | provider-google-vertex-logo      | 2     | @lobehub/icons-static-svg (google) | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | uses google brand svg; vertex alias        | 2026-06-04   |
| huggingface   | provider-huggingface-logo        | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| lmstudio      | provider-lmstudio-logo           | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| minimax       | provider-minimax-logo            | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| nebius        | provider-nebius-logo             | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| novita        | provider-novita-logo             | 2     | @lobehub/icons-static-svg      | fair-use stylized (lobe public) | phase2 pending clearance | TBD           | TBD     | lobe-icons; no raw TM copy                 | 2026-06-04   |
| ovhcloud      | provider-ovhcloud-logo           | 2     | Simple Icons MIT (ovh)         | MIT              | phase2 pending clearance | TBD           | TBD     | simple-icons ovh; MIT license              | 2026-06-04   |
| scaleway      | provider-scaleway-logo           | 2     | Simple Icons MIT               | MIT              | phase2 pending clearance | TBD           | TBD     | simple-icons; MIT license                  | 2026-06-04   |

**Quarterly Audit Process (per BRAND-6):** 
- Schedule: Run at start of each quarter (or triggered by new provider addition / source update). Owner: legal + eng.
- Steps: 1. Re-verify all 30 SVGs still available at documented CDN (lobe/simple) and match committed (no drift). 2. Check license pages / repo for any change in terms (MIT still ok? lobe fair-use note). 3. Confirm no App Store complaints / TM claims. 4. Update table rows: set Last Reviewed date, Reviewer, any new Clearance Date if received. 5. Cross-check against runtime catalog providers[] count (from BRAND-1) + obs branding coverage metric (>=80% target). 6. Re-run iOS xcodebuild asset catalog verification + bridge npm test (DISABLE=1 regression). 7. Update this doc + any runbook refs if needed. 8. If clearance received for more, promote from "pending" and note in PR desc.
- Evidence: Append to this file (or linked /tmp audit md) + git commit "chore(assets,docs): quarterly branding audit YYYY-QX".
- Rollback of audit: revert the date/row changes only.
- Also cross-ref device-e2e-opencode.md and opencode-ipad-repro-runbook.md for any logo-related visual checks during E2E.

## Phase 1 Branded Assets (RP-BRAND-3 / PR12)

Added previously (15 new `provider-*-logo.imageset` directories containing `Contents.json` + `.svg`):

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

Existing 4 (`provider-codex-logo`, `provider-opencode-logo`, `provider-opencode-go-logo`, `provider-opencode-zen-logo`) left unchanged (they lack the properties currently; future maintenance PR can align). Re-verified in this PR base.

Asset naming convention: `provider-{logoProviderId}-logo` where `logoProviderId` comes from bridge `resolveLogoProviderId` / catalog (e.g. "anthropic", "mistral", "amazon", "cerebras").

## Phase 2 Branded Assets (RP-BRAND-4 / this PR + RP-BRAND-6)

Added in this change (15 more `provider-*-logo.imageset`; different from phase1; total 30 external + 4 core = 34 imagesets):

- provider-alibaba-logo (SVG + template + preserves-vector; lobe)
- provider-cerebras-logo (SVG + template + preserves-vector; lobe)
- provider-cloudflare-logo (SVG + template + preserves-vector; lobe)
- provider-databricks-logo (SVG + template + preserves-vector; simple-icons MIT)
- provider-deepinfra-logo (SVG + template + preserves-vector; lobe)
- provider-fireworks-logo (SVG + template + preserves-vector; lobe)
- provider-gitlab-logo (SVG + template + preserves-vector; simple-icons MIT)
- provider-google-vertex-logo (SVG + template + preserves-vector; lobe google base)
- provider-huggingface-logo (SVG + template + preserves-vector; lobe)
- provider-lmstudio-logo (SVG + template + preserves-vector; lobe)
- provider-minimax-logo (SVG + template + preserves-vector; lobe)
- provider-nebius-logo (SVG + template + preserves-vector; lobe)
- provider-novita-logo (SVG + template + preserves-vector; lobe)
- provider-ovhcloud-logo (SVG + template + preserves-vector; simple-icons MIT ovh)
- provider-scaleway-logo (SVG + template + preserves-vector; simple-icons MIT)

Same properties/format as phase1. Legal: all phase2 marked "phase2 pending clearance" in table above; this PR does prep + full doc (table + audit process + runbook refs). No merge claim for phase2.

Re-verified pr-12 (phase1) assets + current doc + 4 originals present and unchanged (ls + cat Contents + 19->34 count).

## Full 30 List (Phase1 + Phase2) + Core

External (30): anthropic, openai, google, xai, groq, deepseek, mistral, cohere, perplexity, together, amazon, azure, openrouter, github, bedrock, alibaba, cerebras, cloudflare, databricks, deepinfra, fireworks, gitlab, google-vertex, huggingface, lmstudio, minimax, nebius, novita, ovhcloud, scaleway.

Core (always, no external TM): codex, opencode, opencode-go, opencode-zen.

## Review Checklist (for PR + visual)

- [ ] All 15 phase2 assets present under CodexMobile/CodexMobile/Assets.xcassets/ with correct Contents.json (properties for template/preserve) + .svg ; total imagesets now 34
- [ ] SVGs are from Simple Icons MIT / lobe-icons public or equivalent (documented source + no raw TM w/o clearance)
- [ ] Visual review: composer bar, sidebar badges, UIKit menus, settings providers list, light + dark + high contrast, tinting works (no color bleed) -- (assets only; full render in BRAND-2)
- [ ] iOS build succeeds (`xcodebuild ... build` reports SUCCEEDED); asset catalog clean for new 15; no behavior change to Codex path
- [ ] No fake-enabled UI; catalog (parallel/prior PR) will drive; SF Symbols fallback handles uncleared
- [ ] docs/operations/provider-branding.md has the BLOCKED clearance block + full table + quarterly audit + runbook refs + this checklist + rollback note + full 30 list
- [ ] PR description includes this checklist + "legal blocker per design doc; phase2 pending clearance; assets prepped, doc updated with table+audit+runbook"
- [ ] Commit is conventional `feat(assets,docs): RP-BRAND-4 Phase 2 + RP-BRAND-6 (15 more + runbook + audit)`
- [ ] Rollback: `rm -rf` the 15 phase2 dirs + revert the md file
- [ ] Phase 1 re-verified present from PR12 base; quarterly audit process documented
- [ ] Bridge tests + DISABLE=1 regression noted (even for assets/doc PR)

## Rollback

To revert this PR's asset changes (phase2 only; phase1 from prior):
```
rm -rf \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-alibaba-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-cerebras-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-cloudflare-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-databricks-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-deepinfra-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-fireworks-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-gitlab-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-google-vertex-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-huggingface-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-lmstudio-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-minimax-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-nebius-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-novita-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-ovhcloud-logo.imageset \
  repos/remodex-opencode/CodexMobile/CodexMobile/Assets.xcassets/provider-scaleway-logo.imageset
git checkout -- docs/operations/provider-branding.md
```
(Full revert also undoes any doc-only changes to table/audit text.)

## Maintenance

See RP-BRAND-6 (this doc now contains the runbook + full table + quarterly audit of licenses/clearances). Update this file on any new clearance or Phase 2 additions. Coverage metric in obs: catalog providers vs present assets.

Ops runbook refs: cross-reference docs/operations/opencode-ipad-repro-runbook.md (for E2E visual/logo checks), device-e2e-*.md (O* checklists may include provider badges), observability.md (branding coverage alert), release-compatibility.md (asset parity).

## References

- Design doc (private/tmp/grok-design-doc-bbe8e09d.md): RP-BRAND-4, RP-BRAND-6, BRAND plan, legal + Key Decisions, PR15, re-verify pr-12 + 4 originals.
- AGENTS.md: capability-driven, no assets w/o clearance.
- docs/design/master-opencode-integration.md (branding sections).
- iOS: RuntimeProviderLogo.swift (current 4; catalog driven in RP-BRAND-2).
- Bridge: opencode-provider-inventory.js (resolveLogoProviderId), runtime catalog (BRAND-1).
- This PR: 15 phase2 assets + full doc update (table + audit + refs).


