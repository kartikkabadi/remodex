# Upstream PR stack (#29)

Stack to [Emanuele-web04/remodex](https://github.com/Emanuele-web04/remodex) after **iPad checklist** on [#16](https://github.com/kartikkabadi/remodex/issues/16) is green.

| PR | Scope | QA device |
|----|--------|-----------|
| **PR1** | Bridge registry + canonical cutover + OpenCode Core + dynamic provider/model discovery + iOS adapter | iPhone `CodexMobile` |
| **PR2** | Cursor ACP Core (permission reply, capability gates) | iPhone |
| **PR3** | RemodexPad polish (`ipad-os` allowlist only) + iPad QA notes | iPad `RemodexPad` |

Fork [kartikkabadi/remodex](https://github.com/kartikkabadi/remodex) remains integration branch until upstream merges.

**Do not:** wholesale merge `add-opencode-provider`, `add-cursor-provider`, or `ipad-os`.

**Dynamic model gate:** #38-#43 supersede the static runtime model catalog plan. PR1 should not present OpenCode as two hardcoded models; it should either ship dynamic OpenCode provider/model discovery or explicitly scope the model picker out of upstream readiness.
