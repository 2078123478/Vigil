# Arbitrage Module Contract

This document defines the **product-facing contract** for the Arbitrage Module.

It sits between:

- upstream capability sources such as Binance official open skills
- internal execution infrastructure such as the current execution backend
- downstream product surfaces such as dashboards, reports, demos, and operator approvals

The purpose of this contract is simple:

> make the arbitrage module understandable, explainable, and implementation-friendly without forcing an immediate rewrite of the current codebase.

---

## 1. Contract goal

The arbitrage module contract should answer five questions clearly:

1. what inputs the module accepts
2. what lifecycle states an opportunity can move through
3. what outputs the module produces
4. how decisions are explained
5. how upstream official skill usage is exposed

---

## 2. Design principles

### Principle 1 — Product-facing first

The contract should describe what the module means to:

- operators
- judges
- integration partners
- future module builders

It should not leak unnecessary internal naming.

### Principle 2 — Compatible with current runtime

The contract should map cleanly onto what already exists today:

- opportunity scan
- evaluate
- plan
- simulate
- execute
- record
- notify

### Principle 3 — Explicit decision trace

Every meaningful decision should be explainable.

The module should never only return “yes” or “no”.
It should return:

- status
- reason codes
- human-readable explanation
- key evidence

### Principle 4 — Skill usage should be visible

If the module claims Binance Skills compatibility, it should explicitly surface which skill-derived capabilities contributed to a decision.

---

## 3. Canonical module identity

### Module ID

```text
arbitrage
```

### Module display name

```text
Arbitrage Module
```

### Module type

```text
strategy-module
```

### Position in the system

- **Product layer name:** Arbitrage Module
- **Current implementation anchor:** `dex-arbitrage`
- **Execution backend:** current execution backend

---

## 4. Supported operating modes

| Mode | Meaning | Typical usage |
|------|---------|---------------|
| `scout` | discover and rank only | judge demos, analytics, monitoring |
| `paper` | full pipeline without live execution | default safe demo mode |
| `assisted-live` | prepare execution but require approval | operator review flow |
| `live` | execute automatically within policy bounds | mature production flow |

### Current compatibility note

Today, the runtime already supports `paper` and `live`.
`scout` and `assisted-live` are product-facing contract modes that may initially be implemented as controlled wrappers over current behavior.

---

## 5. Primary request contract

A module request represents a request to discover and/or act on arbitrage opportunities.

### Canonical request shape

```json
{
  "module": "arbitrage",
  "mode": "paper",
  "scope": {
    "pairs": ["ETH/USDC", "BTC/USDC"],
    "venues": ["dex-a", "dex-b"],
    "chainIds": [56]
  },
  "strategy": {
    "strategyId": "dex-spread-v1",
    "minExpectedNetEdgeBps": 60,
    "notionalUsd": 1000,
    "riskProfile": "balanced"
  },
  "operator": {
    "approvalRequired": false,
    "accountScope": "default"
  },
  "enrichment": {
    "useTokenInfo": true,
    "useTokenAudit": true,
    "useAddressIntel": false,
    "useTradingSignal": true
  }
}
```

### Required fields

- `module`
- `mode`
- at least one discovery scope (`pairs`, `tokenUniverse`, or equivalent)

### Optional fields

- venue scope
- chain scope
- account scope
- enrichment toggles
- approval requirement
- risk profile
- operator thresholds

---

## 6. Opportunity lifecycle contract

Every candidate should move through explicit lifecycle states.

### Canonical states

| State | Meaning |
|------|---------|
| `discovered` | raw opportunity candidate detected |
| `enriched` | candidate decorated with metadata, context, and signals |
| `validated` | candidate passed rule checks |
| `simulated` | candidate passed simulation or received simulation result |
| `approved` | candidate approved for execution |
| `executed` | execution attempted and result captured |
| `rejected` | candidate blocked by rules or operator decision |
| `expired` | candidate timed out or quote became stale |
| `failed` | processing or execution failed |

### State transition expectations

Preferred flow:

```text
discovered → enriched → validated → simulated → approved → executed
```

Common alternative flows:

```text
discovered → rejected
discovered → enriched → rejected
discovered → enriched → validated → simulated → rejected
discovered → enriched → validated → expired
approved → failed
```

### State timestamps

A candidate record should capture timestamps when available:

- `discoveredAt`
- `enrichedAt`
- `validatedAt`
- `simulatedAt`
- `approvedAt`
- `executedAt`
- `closedAt`

---

## 7. Candidate contract

A candidate is the module’s central working object.

### Canonical candidate shape

```json
{
  "candidateId": "arb_cand_001",
  "module": "arbitrage",
  "status": "validated",
  "opportunityType": "dex_spread",
  "pair": "ETH/USDC",
  "buyVenue": "dex-a",
  "sellVenue": "dex-b",
  "detectedAt": "2026-03-17T01:00:00.000Z",
  "metrics": {
    "grossEdgeBps": 104.2,
    "expectedNetEdgeBps": 71.8,
    "expectedNetUsd": 7.18,
    "notionalUsd": 1000,
    "liquidityUsd": 240000,
    "volatility": 0.021,
    "avgLatencyMs": 280
  },
  "context": {
    "chainId": 56,
    "tokenRisk": "normal",
    "balanceReady": true,
    "signalSupport": true,
    "quoteFreshnessMs": 420
  },
  "reasons": [
    "spread_above_threshold",
    "balance_ready",
    "audit_clear"
  ],
  "skillSources": [
    "binance/spot",
    "binance/assets",
    "binance-web3/query-token-info",
    "binance-web3/query-token-audit",
    "binance-web3/trading-signal"
  ]
}
```

### Required candidate fields

- `candidateId`
- `module`
- `status`
- `opportunityType`
- `pair` or equivalent asset scope
- `detectedAt`

### Strongly recommended fields

- expected net edge
- notional
- liquidity
- quote freshness
- reason codes
- skill sources

---

## 8. Decision contract

A decision is the module’s formal answer to whether the candidate should move forward.

### Canonical decision values

| Decision | Meaning |
|---------|---------|
| `reject` | do not continue |
| `monitor` | continue observing, do not simulate or execute yet |
| `simulate_only` | simulate but do not seek execution |
| `paper_trade` | run through paper path |
| `propose_execution` | execution-worthy, but needs approval |
| `execute` | proceed with execution |

### Canonical decision shape

```json
{
  "decision": "paper_trade",
  "status": "accepted",
  "summary": "Candidate passed threshold and remained profitable after simulation.",
  "reasonCodes": [
    "spread_above_threshold",
    "simulation_profitable",
    "balance_ready"
  ],
  "blockingReasonCodes": [],
  "confidence": 0.82
}
```

### Decision requirements

Each decision should include:

- a decision label
- at least one human-readable summary line
- reason codes
- optional confidence
- optional blocking reason codes

---

## 9. Reason taxonomy

The module should standardize the reason layer so outputs are consistent.

### Positive reason code examples

- `spread_above_threshold`
- `net_edge_above_threshold`
- `simulation_profitable`
- `balance_ready`
- `audit_clear`
- `signal_supported`
- `liquidity_sufficient`
- `execution_backend_ready`

### Negative / blocking reason code examples

- `spread_below_threshold`
- `net_edge_below_threshold`
- `liquidity_too_low`
- `quote_stale`
- `simulation_failed`
- `audit_flagged`
- `balance_insufficient`
- `execution_backend_unready`
- `daily_loss_cap_reached`
- `too_many_recent_failures`
- `approval_required`
- `candidate_expired`

---

## 10. Simulation contract

Simulation is a first-class stage, not an implementation detail.

### Canonical simulation shape

```json
{
  "status": "pass",
  "summary": "Expected net remained positive after fees, slippage, gas, and latency adjustments.",
  "metrics": {
    "grossUsd": 10.42,
    "feeUsd": 1.63,
    "netUsd": 8.79,
    "netEdgeBps": 87.9,
    "latencyAdjustedNetUsd": 7.18,
    "expectedShortfall": 1.1,
    "pFail": 0.08
  },
  "reasonCodes": [
    "simulation_profitable",
    "latency_risk_within_bounds"
  ]
}
```

### Minimum simulation contract

At minimum, surface:

- pass / fail
- summary
- net edge after cost adjustments
- at least one reason code

---

## 11. Execution contract

Execution output should be explicit even when live execution is not used.

### Canonical execution result shape

```json
{
  "execution": {
    "requestedMode": "assisted-live",
    "effectiveMode": "paper",
    "degradedToPaper": true,
    "status": "completed",
    "tradeStatus": "submitted",
    "txHash": "0xabc...",
    "tradeId": "trade_123",
    "summary": "Execution downgraded to paper due to backend readiness policy.",
    "reasonCodes": [
      "approval_required",
      "execution_backend_unready"
    ]
  }
}
```

### Execution notes

- `requestedMode` and `effectiveMode` should always be visible when relevant
- downgrade paths should be explicit
- paper execution is still a valid execution result in contract terms

---

## 12. Module response contract

The module response should present a complete picture.

### Canonical top-level response

```json
{
  "module": "arbitrage",
  "requestId": "req_001",
  "mode": "paper",
  "status": "candidate_accepted",
  "decision": "paper_trade",
  "candidate": {},
  "simulation": {},
  "execution": {},
  "summary": {
    "headline": "Arbitrage candidate accepted for paper trade.",
    "explanation": "Detected a DEX spread on BNB Chain, passed enrichment and validation, and remained profitable after simulation."
  },
  "skillUsage": {
    "required": [
      "binance/spot",
      "binance/assets"
    ],
    "enrichment": [
      "binance-web3/query-token-info",
      "binance-web3/query-token-audit",
      "binance-web3/trading-signal"
    ],
    "distribution": []
  }
}
```

### Top-level requirements

A response should make these visible:

- final status
- final decision
- candidate details
- simulation outcome if applicable
- execution outcome if applicable
- skill usage view
- short explanation in plain language

---

## 13. Operator summary contract

The module should produce a short summary usable in dashboards, logs, or chat replies.

### Preferred operator summary format

```text
[arbitrage][paper] accepted ETH/USDC dex-a→dex-b expectedNet=7.18USD netEdge=71.8bps reasons=spread_above_threshold,simulation_profitable
```

### Preferred operator card fields

- pair
- route
- mode
- decision
- expected net
- net edge
- 2-4 reasons
- optional tx hash / trade id

---

## 14. Judge / demo summary contract

For demos, the module should also support a more human-friendly summary.

### Preferred judge summary format

```text
We detected a BNB Chain arbitrage candidate, enriched it with token and risk context, validated liquidity and balances, simulated post-cost profitability, and accepted it for paper execution.
```

This summary style is intentionally less technical and more presentation-friendly.

---

## 15. Mapping to current implementation

This contract maps cleanly onto current runtime pieces:

| Contract stage | Current implementation anchor |
|---------------|-------------------------------|
| `discovered` | `scan()` in `dex-arbitrage.ts` |
| `validated` | `evaluate()` in `dex-arbitrage.ts` |
| `approved` / plan-ready | `plan()` in `dex-arbitrage.ts` |
| `simulated` | `runtime/simulator.ts` |
| `executed` | `runtime/onchainos-client.ts` or paper mode |
| summary / notify | notifier / growth surfaces |

Missing or future-facing pieces can be added as thin wrappers without discarding the current engine.

---

## 16. Near-term implementation guidance

The shortest path to honoring this contract is:

1. keep current `Opportunity`, `EvalResult`, `ExecutionPlan`, and simulation structures internally
2. add a product-facing adapter that emits the richer module contract
3. add reason-code normalization
4. add skill-usage metadata fields
5. add operator / judge summary generators

This keeps momentum high while making the module legible externally.

---

## 17. One-sentence summary

**The Arbitrage Module Contract defines a product-facing language for requests, candidate states, decisions, simulation, execution, and skill usage so the current runtime can evolve into a Binance Skills-compatible flagship strategy module without a disruptive rewrite.**
