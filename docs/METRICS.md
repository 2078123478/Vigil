# Vigil Metrics and Confidence

Scope: this file classifies numbers currently mentioned in the repo as either:

- `repo-validated` (directly inspectable from code/tests/artifacts),
- `demo-backed` (reproducible via repo demos, environment-dependent),
- `narrative` (stated in docs/README, not independently reproduced in this pass).

Date context: reviewed on March 19, 2026.

## Metric table

| Metric | Current value in repo | Source paths | Status | Verification path | Confidence and limitation |
|---|---|---|---|---|---|
| Default test files in CI-style `npm test` scope | 53 files (`tests/**/*.test.ts`) | `vitest.config.ts`, `tests/` | repo-validated | `rg --files tests | wc -l` | High. This is file count only, not pass rate. |
| Total `*.test.ts` files physically present | 54 files (includes one outside default include) | `src/skills/alphaos/living-assistant/delivery/callback-handler.test.ts`, `tests/` | repo-validated | `rg --files -g '*test.ts' | wc -l` | High. One file is outside default Vitest include pattern. |
| Static test block count in default test scope | 374 `it(`/`test(` blocks under `tests/` | `tests/` | repo-validated | `rg -n "\\b(it|test)\\(" tests | wc -l` | Medium. Static grep is approximate and not a test runner result. |
| Fixture demo scenario count | 4 scenarios | `fixtures/demo-scenarios/` | repo-validated | `find fixtures/demo-scenarios -maxdepth 1 -name '*.json' | wc -l` | High. Count does not indicate scenario quality/coverage depth. |
| Signal capsule fixture count | 4 capsule files | `fixtures/signal-capsules/` | repo-validated | `find fixtures/signal-capsules -maxdepth 1 -name '*.json' | wc -l` | High. These are synthetic fixtures for replay/testing. |
| Current checked/generated demo output inventory | 10 mp3, 0 json, 0 csv (in current working tree) | `demo-output/` | repo-validated | `find demo-output -maxdepth 1 -type f` | High for current snapshot only. This is not a completeness metric. |
| Agent-Comm max encrypted message size guard | 16,384 bytes | `src/skills/alphaos/runtime/agent-comm/types.ts`, `tests/agent-comm.test.ts` | repo-validated | inspect constant + run targeted test | High for validation rule existence. Not a throughput claim. |
| README claim: "53 files, 379 cases, 100% pass" | stated in README | `README.md` | narrative | run `npm test` and capture Vitest summary | Low until fresh run output is captured in artifacts; static counts in repo do not directly confirm "379/100%". |
| README/Judge narrative: "80 -> 8/12/60, 87% noise reduction" | stated in narrative docs | `README.md`, `docs/JUDGE_ONE_PAGER.md`, `docs/CHAMPION_DEMO_STORY.md` | narrative | run controlled triage dataset + persist run logs/artifacts | Low-to-medium. No committed benchmark dataset/report currently in repo root evidence pack. |
| README claim: "6/14 official skills integrated (43%)" | stated in narrative docs | `README.md`, `docs/项目介绍*.md` | narrative | define skill inventory source of truth + auto-check script | Low. No machine-readable manifest in this pass proving numerator/denominator. |
| README/Judge narrative: "15-second one-breath brief" | prompt/protocol intent exists | `src/skills/alphaos/living-assistant/llm/natural-brief.ts`, docs mentioning brief protocol | demo-backed / narrative | collect generated audio durations from demo runs | Medium for design intent, low for measured runtime guarantee without duration report. |

## Notes on discrepancies

- The repository currently contains different "test count" signals:
  - README narrative includes `379` test cases and `100%`.
  - Static grep in default `tests/` scope currently finds `374` `it/test` blocks.
  - Counting all `*.test.ts` files also includes one file outside default Vitest include scope.
- Conclusion: treat exact case-count/pass-rate numbers as **narrative until a fresh runner output is archived**.

## What would upgrade narrative metrics to repo-validated

1. Add a reproducible benchmark script for triage noise reduction with fixed input dataset and committed result artifact.
2. Add a machine-readable skill inventory manifest and a check script for `integrated/total`.
3. Archive `npm test` summary output (or CI artifact) with timestamp in `demo-output/` or a dedicated `evidence-output/` folder.
4. Add automated audio duration reporting for generated brief files.

Related docs:
- `docs/EVIDENCE.md`
- `docs/VALIDATION.md`
- `docs/JUDGE_GUIDE.md`
