# Codex Canonical Fixture Matrix

These rows define the Codex-to-Remodex bridge fixture coverage used by
`test/codex-to-canonical-adapter.test.js`.

| Source Codex method/event | Canonical wire method | Fixture test coverage |
| --- | --- | --- |
| `thread/started` | `remodex/event/thread_started` | `codex adapter maps turn lifecycle notifications to canonical events` |
| `turn/started` | `remodex/event/turn_started` | `codex adapter maps turn lifecycle notifications to canonical events` |
| `codex/event/user_message` | `remodex/event/user_message` | `codex adapter maps rollout message strings` |
| `codex/event/agent_message_content_delta` | `remodex/event/assistant_delta` | `codex adapter maps assistant deltas to canonical assistant_delta` |
| `codex/event/agent_message` and assistant `item/completed` | `remodex/event/assistant_completed` | `codex adapter maps assistant item completions to canonical assistant_completed` |
| `codex/event/exec_command_begin` | `remodex/event/tool_started` | `codex adapter maps tool activity and diffs to canonical events` |
| `codex/event/exec_command_output_delta` | `remodex/event/tool_delta` | `codex adapter maps tool activity and diffs to canonical events` |
| `codex/event/exec_command_end` | `remodex/event/tool_completed` | `codex adapter maps explicit tool completion fixtures` |
| `codex/event/image_generation_end` | `remodex/event/image_generation_end` | `codex adapter maps image generation end` |
| `turn/diff/updated` | `remodex/event/diff_updated` | `codex adapter maps tool activity and diffs to canonical events` |
| `turn/plan/updated` | `turn/plan/updated` with canonical envelope fields | `codex adapter keeps plan methods while adding canonical envelope fields` |
| `item/plan/delta` | `item/plan/delta` with canonical envelope fields | `codex adapter keeps plan methods while adding canonical envelope fields` |
| approval JSON-RPC requests | `remodex/request/permission` | `codex adapter maps approval server requests to canonical permission requests` |
| `serverRequest/resolved` | `serverRequest/resolved` with canonical envelope fields | `codex adapter maps server request resolution to canonical metadata` |
| `turn/completed` | `remodex/event/turn_completed` | `codex adapter maps turn lifecycle notifications to canonical events` |
| `turn/failed`, `error`, `codex/event/error` | `remodex/event/error` | `codex adapter maps failed turns and error envelopes to canonical error events` |

Plan and request-resolution methods intentionally keep their existing method
names because the iOS plan and approval reducers already treat those methods as
stable production ingress. Their params still carry `schemaVersion`,
`agentRuntime`, `threadId`, `turnId`, `createdAt`, and canonical `payload`.
