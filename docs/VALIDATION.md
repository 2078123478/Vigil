# Vigil Validation Guide

Purpose: give reviewers a practical map of what is validated in-repo today, what is demo-backed, and what still needs independent verification.

Date context: reviewed on March 19, 2026.

## 1) Automated test coverage by area

Counts below are based on the default test scope (`tests/**/*.test.ts`).

| Area | Evidence sources | What is validated | Boundary notes |
|---|---|---|---|
| Living Assistant (18 test files by prefix) | `tests/living-assistant-*.test.ts` | contact policy decisions, digest batching, loop behavior, API routes, signal pollers, TTS adapters, delivery orchestration, CLI flag behavior | Most delivery/provider tests use mocked `fetch`; they validate request/response contracts, not external provider uptime. |
| Agent-Comm (12 test files by prefix) | `tests/agent-comm-*.test.ts` | artifact contracts, protocol negotiation, inbox processing, CLI/API paths, runtime routing, send/tx sender behavior, v2/v1 fallback smoke flows | Tests are mostly local/in-memory with mocked transport/chain clients; they are not blockchain finality proofs. |
| Discovery and arbitrage module | `tests/discovery-*.test.ts`, `tests/arbitrage-*.test.ts`, `tests/dex-arbitrage.test.ts` | session lifecycle, candidate/report/approve paths, module response adaptation, reason normalization, strategy logic | Strong for API/logic shape and paper-mode decisions; external market quality and live slippage remain out of scope. |
| Risk and execution safeguards | `tests/risk.test.ts`, `tests/engine-degrade.test.ts`, `tests/engine-dedup.test.ts`, `tests/cost-model.test.ts`, `tests/simulator.test.ts` | live gate constraints, circuit breaker triggers, degrade-to-paper behavior, cost/simulation calculations | Validates control logic but not real-world execution latency/failure distribution. |
| API/auth/state/config | `tests/api.test.ts`, `tests/config.test.ts`, `tests/state-store.test.ts`, `tests/vault.test.ts` | auth boundaries, route outputs, config defaults, persistence and vault safety behaviors | Good local correctness coverage; production deployment posture still depends on environment hardening. |
| External execution integration client | `tests/onchain-client.test.ts`, `tests/network-profile-probe.test.ts`, `tests/network-profile.test.ts` | request signing, fallback behavior, probe/readiness classification, network profile selection | Predominantly mocked external calls; validates client behavior under simulated responses. |

## 2) Demo-backed flows and expected evidence output

| Flow | Command | Default safety posture | Evidence output | External dependencies |
|---|---|---|---|---|
| Judge wrapper | `npm run demo:judge` | conservative: local demo first, API demo optional | console walkthrough; references `demo-output/` | API server and auth required for discovery step |
| Living Assistant fixture replay | `npm run demo:living-assistant` | fixture/demo-safe by default | console decisions; optional audio files when TTS runtime is active | none for fixture path |
| Living Assistant live polling | `npm run demo:living-assistant -- --live` | external/live path | optional `demo-output/*.mp3` plus console triage summary | Binance endpoints, optional LLM/TTS provider credentials |
| Discovery session demo | `npm run demo:discovery` | paper-first defaults in script | `demo-output/discovery-demo-*.json` | running API + valid auth token |
| Full hackathon capture | `npm run demo:run` | forces paper mode before capture | `demo-output/demo-*.json`, `demo-output/backtest-*.csv` | running API |
| Integration smoke check | `npm run demo:smoke:live` | probe/report style, no forced trade broadcast in script | `integration-status-*.json`, `integration-probe-*.json`, `integration-smoke-*.json` | running API, integration credentials for meaningful result |

## 3) Real vs mock boundary summary

Treat as primarily **mock/demo-safe**:

- `npm run demo:living-assistant` (fixture scenarios in `fixtures/demo-scenarios/`)
- `npm run demo:living-assistant -- --call --demo-delivery` (simulated call delivery path)
- API demo routes such as `/api/v1/living-assistant/demo/:scenarioName`
- Discovery demo defaults with paper approval mode

Treat as **real/external-dependent**:

- `npm run demo:living-assistant -- --live`
- `npm run demo:living-assistant -- --send` or `--call` with real provider credentials
- execution integration flows requiring `ONCHAINOS_*` environment and reachable backend

## 4) Not independently verified yet (important for judges)

1. No committed external transaction hashes or chain explorer evidence in this repo snapshot.
2. No committed discovery JSON/CSV artifacts currently present in `demo-output/` (only mp3 files are present now).
3. "87% noise reduction" and "80 -> 8/12/60" are narrative/demo claims, not backed by a committed reproducible benchmark artifact in this pass.
4. "6/14 skills integrated (43%)" is narrative in docs/README; no machine-readable inventory check is included in current evidence pack.
5. "15-second brief" exists as protocol intent and prompt constraints, but no committed duration measurement report is present.
6. This documentation pass did not rerun the full test suite; test evidence here is based on existing tests and scripts in the repo.

## 5) Reviewer quick-start checklist

```bash
# 1) inspect evidence inventory
find demo-output -maxdepth 1 -type f
find fixtures/demo-scenarios -maxdepth 1 -name '*.json'

# 2) run judge path
npm run demo:judge

# 3) run representative test slices
npm run test -- tests/living-assistant-api.test.ts tests/discovery-api.test.ts
npm run test -- tests/agent-comm-artifact-contracts.test.ts tests/agent-comm-smoke.test.ts
```

Related docs:
- `README.md`
- `docs/JUDGE_GUIDE.md`
- `docs/EVIDENCE.md`
- `docs/METRICS.md`
