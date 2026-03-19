# Vigil Evidence Pack

Scope: this document only uses evidence available inside the current repository (`tests/`, `scripts/`, `fixtures/`, `docs/`, and `demo-output/`).

Date context: reviewed on March 19, 2026.

## How to read this file

Use each row as: **claim -> evidence -> how to verify**.
Claims are intentionally conservative and avoid external runtime assumptions.

## Major claims and evidence

| Claim | Evidence type | Source paths | How to verify | Confidence and limitation |
|---|---|---|---|---|
| There is a judge-oriented demo entrypoint that prefers stable local flow, then optional API-backed flow. | Script + npm command wiring | `package.json`, `scripts/judge-demo.sh`, `docs/JUDGE_GUIDE.md` | Run `npm run demo:judge` and observe sequence: prerequisites -> `demo:living-assistant` -> optional `demo:discovery` | High confidence on flow wiring. API-backed steps still depend on local server/auth readiness. |
| Living Assistant demo is fixture-replayable without live dependencies by default. | Fixture files + demo runner code | `fixtures/demo-scenarios/*.json`, `scripts/living-assistant-demo.ts` | Run `npm run demo:living-assistant` and inspect printed scenario names and decisions | High confidence for fixture path. Fixture realism is scenario-based, not independent market replay proof. |
| A demo-safe simulated call path exists (`--call --demo-delivery`) that avoids outbound provider calls. | CLI flags + unit tests | `scripts/living-assistant-demo.ts`, `tests/living-assistant-demo-cli.test.ts` | Run `npm run demo:living-assistant -- --call --demo-delivery` and check logs for demo/simulated delivery mode | High confidence on simulation behavior. Does not prove live telephony/message delivery. |
| Discovery demo is paper-first by default, with explicit control for approval mode. | Script defaults + API test coverage | `scripts/discovery-demo.sh`, `scripts/hackathon-demo.sh`, `tests/discovery-api.test.ts` | Inspect defaults (`ALPHAOS_DISCOVERY_APPROVE_MODE=paper`, `ALPHAOS_DISCOVERY_AUTO_APPROVE=false`), then run `npm run demo:discovery` with API running | High confidence on default safety posture. Live execution remains environment-dependent. |
| Judge demo route downgrades live request to paper for safety. | API behavior tests | `tests/discovery-api.test.ts`, `tests/arbitrage-module-response-adapter.test.ts` | Run targeted tests and inspect assertions on `requestedMode=live`, `effectiveMode=paper`, `degradedToPaper=true` | High confidence for tested route logic. Not a statement about live trading success. |
| Agent-Comm artifact signing/digest verification is implemented and tested. | Deterministic crypto tests | `tests/agent-comm-artifact-contracts.test.ts`, `tests/agent-comm-artifact-workflow.test.ts` | Run targeted tests for artifact contracts/workflow | High confidence for deterministic local crypto checks. Not equivalent to on-chain finality proof. |
| Agent-Comm protocol negotiation supports v2 with v1 fallback paths. | Negotiation + smoke tests | `tests/agent-comm-protocol-negotiation.test.ts`, `tests/agent-comm-smoke.test.ts` | Run targeted tests and inspect v2-v2 and v2-v1 fallback assertions | High confidence for in-repo transport simulation. External network behavior not asserted here. |
| Agent-Comm envelope payload has a hard max size guard of 16,384 bytes. | Runtime constant + codec tests | `src/skills/alphaos/runtime/agent-comm/types.ts`, `src/skills/alphaos/runtime/agent-comm/calldata-codec.ts`, `tests/agent-comm.test.ts` | Inspect constant and run codec tests that enforce max bytes | High confidence for validation guard. Does not prove throughput/latency at scale. |
| Protected APIs enforce bearer auth by default. | API tests | `tests/api.test.ts`, `tests/discovery-api.test.ts`, `tests/living-assistant-api.test.ts` | Run targeted API tests and check `401` expectations for unauthenticated calls | High confidence for tested routes. Does not replace production auth hardening review. |
| Demo audio artifacts are currently present in repo output directory. | Checked-in/generated artifact files | `demo-output/` | Run `find demo-output -maxdepth 1 -type f` | High confidence that artifacts exist. Presence alone does not prove real outbound delivery occurred. |
| Execution integration smoke report schema/output path exists. | Smoke script output contract | `scripts/execution-live-smoke.sh` | Run `npm run demo:smoke:live` with API running; inspect `integration-status-*.json`, `integration-probe-*.json`, `integration-smoke-*.json` | Medium confidence until rerun in your environment with live credentials. |

## Current artifact patterns

### Observed in `demo-output/` now

- `*.mp3` only (10 files currently).
- Example observed names:
`live-signal-binance-announcement-12-binance-ann-268134.mp3`
`proactive-arbitrage-alert-scenario-proactive-arb-1.mp3`
- No `*.json` or `*.csv` artifacts are currently present in `demo-output/`.

### Expected output patterns from scripts

- `npm run demo:living-assistant` (with TTS-enabled runtime): `<scenario>-<signalId>.<format>` in `demo-output/`
- `npm run demo:discovery`: `demo-output/discovery-demo-<YYYYMMDD-HHMMSS>.json`
- `npm run demo:run` (`scripts/hackathon-demo.sh`): `demo-output/demo-<timestamp>.json` and `demo-output/backtest-<timestamp>.csv`
- `npm run demo:smoke:live`: `demo-output/integration-status-*.json`, `integration-probe-*.json`, `integration-smoke-*.json`

## Quick verification commands

```bash
# evidence inventory
rg --files tests | wc -l
find fixtures/demo-scenarios -maxdepth 1 -name '*.json' | wc -l
find demo-output -maxdepth 1 -type f

# representative validation checks
npm run test -- tests/discovery-api.test.ts tests/living-assistant-api.test.ts
npm run test -- tests/agent-comm-artifact-contracts.test.ts tests/agent-comm-smoke.test.ts
```

Related docs:
- `README.md`
- `docs/JUDGE_GUIDE.md`
- `docs/METRICS.md`
- `docs/VALIDATION.md`
