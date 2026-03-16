# Personal Butler Execution Architecture

## Skill Ecosystem

Personal Butler currently ships with three cooperating skills:

| Skill | Responsibility | Code Path |
|-------|---------------|-----------|
| **alphaos** | Arbitrage engine, risk, execution, growth API | `src/skills/alphaos/engine/`, `plugins/`, `api/`, `runtime/` (excl. agent-comm, discovery) |
| **agent-comm** | P2P identity, contact cards, encrypted messaging | `src/skills/alphaos/runtime/agent-comm/` |
| **discovery** | Multi-strategy opportunity scanning | `src/skills/alphaos/runtime/discovery/` |

## Module Map

### Engine (alphaos core)
- `engine/alpha-engine.ts` — orchestrator, multi-plugin scheduler, mode gates

### Plugins
- `plugins/dex-arbitrage.ts` — DEX spread strategy

### API
- `api/server.ts` — demo page, SSE stream, control/growth/backtest/replay/agent-comm endpoints

### Runtime Services
- `runtime/state-store.ts` — SQLite persistence (trades, opportunities, strategies, profiles, contacts, messages, outbox)
- `runtime/vault.ts` — AES-256 secret storage
- `runtime/onchainos-client.ts` — current execution-backend adapter with bearer/api-key/hmac auth and token resolution cache
- `runtime/risk-engine.ts` — risk policy enforcement
- `runtime/simulator.ts` — pre-execution simulation
- `runtime/cost-model.ts` — fee/slippage/MEV/gas cost estimation
- `runtime/notifier.ts` — OpenClaw webhook integration
- `runtime/config.ts` — env-based configuration loader
- `runtime/network-profile.ts` — chain/DEX capability profiles
- `runtime/network-profile-probe.ts` — execution readiness snapshot
- `runtime/logger.ts` — structured logging (pino)
- `runtime/time.ts` — time utilities

### Agent-Comm (see agent-comm skill)
- `runtime/agent-comm/` — 21 files, see `skills/agent-comm/SKILL.md`

### Discovery (see discovery skill)
- `runtime/discovery/` — 5 files, see `skills/discovery/SKILL.md`

## Data Flow

```
                    ┌────────────────────────┐
                    │ Current Exec Backend   │
                    │     (external)         │
                    └──────────┬─────────────┘
                           │ quote/swap/simulate/broadcast
                           ▼
┌─────────┐    tick    ┌────────────┐    record    ┌────────────┐
│ Plugins │ ────────→  │   Engine   │ ──────────→  │ StateStore │
│ (scan/  │            │ (evaluate/ │              │ (SQLite)   │
│  eval/  │            │  plan/     │              └────────────┘
│  plan)  │            │  simulate/ │                    │
└─────────┘            │  execute)  │              notify│
                       └────────────┘                    ▼
                            ▲                    ┌────────────┐
                            │ approve            │  Notifier  │
                    ┌───────┴──────┐             │ (OpenClaw) │
                    │  Discovery   │             └────────────┘
                    │  Engine      │
                    └──────────────┘
                            ▲
                            │ start_discovery (remote)
                    ┌───────┴──────┐
                    │  Agent-Comm  │
                    │  (P2P msgs)  │
                    └──────────────┘
```

## Startup Sequence

1. `loadConfig()` — read env vars
2. `createAlphaOsSkill()` — init store, engine, discovery, onchain client
3. `startAgentCommRuntime()` — start tx-listener + inbox processor
4. `createServer()` — bind HTTP API
5. `engine.start()` — begin tick loop
6. `discovery.start()` — enable discovery session scheduling
