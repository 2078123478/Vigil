# Arbitrage Module Spec v0

This document defines the first flagship strategy module for Vigil:

> a **Binance Skills-compatible arbitrage module** for the **BNB ecosystem**, built on top of the current execution backend.

This is a **product and architecture spec**, not a final implementation document.
The goal is to define a module that is easy to explain, easy to demo, and worth building toward in staged iterations.

---

## 1. Why this module comes first

Arbitrage is a strong first strategy module because it naturally shows the full value of the system:

- market discovery
- risk filtering
- simulation before action
- automated or semi-automated execution
- post-trade reporting

It is also a good fit for a BNB ecosystem-native story because it can combine:

- Binance market and account capabilities
- Binance Web3 token and signal capabilities
- our existing discovery / simulation / execution backend
- our trust / explanation / orchestration layers

This makes arbitrage a better flagship than a single raw API integration.

---

## 2. Product positioning

The arbitrage module should be positioned as:

> **a Binance Skills-compatible strategy module that detects, validates, simulates, and executes high-confidence arbitrage opportunities for BNB ecosystem users**.

Key framing:

- **not** just a raw arbitrage bot
- **not** just a collection of market API calls
- **not** just an internal plugin name inside the legacy execution stack

Instead, it should look like:

- a strategy module
- a reusable capability layer
- a demoable product flow
- a proof that Vigil can turn official skills into intelligent action

---

## 3. External framing vs internal reality

### External framing

- Vigil = product layer
- Arbitrage Module = flagship strategy module
- Binance official skills = ecosystem capability layer
- Agent-Comm / Judge = trust and decision support

### Internal reality today

- the current working execution backend is still based on the legacy execution stack
- the current strategy implementation is `dex-arbitrage`
- the current engine already supports:
  - scan
  - evaluate
  - plan
  - simulate
  - execute
  - record
  - notify

So this spec is not inventing a new story from nothing.
It is taking the current working pieces and giving them the right structure and future-facing interface.

---

## 4. Module goal

The arbitrage module should answer one practical question well:

> **Given current market conditions, balances, constraints, and risk rules, is there a real arbitrage opportunity worth acting on right now?**

That means the module must do more than detect a spread.
It must decide whether the spread is:

- real
- executable
- worth the cost
- worth the risk
- aligned with operator rules

---

## 5. What counts as “Binance Skills-compatible”

In this project, **compatible** does not mean we must rewrite everything to match the official repository one-to-one.
It means:

1. the module is described using Binance ecosystem skill language
2. the module can consume capabilities exposed through Binance official open skills
3. the module can be explained as an orchestration layer over those skills
4. the module can preserve our own backend and strategy logic underneath

Compatibility target:

- official skills should feel like the module's natural upstream inputs
- our strategy engine should feel like the high-value layer built on top

---

## 6. Capability map

### 6.1 Core upstream capability sources

| Capability | Official skill candidates | Why it matters |
|-----------|---------------------------|----------------|
| spot / market execution context | `binance/spot`, `binance/alpha` | price context, execution feasibility, market interaction |
| balances / asset readiness | `binance/assets` | determine whether a route is fundable |
| token metadata | `binance-web3/query-token-info` | token identity, market metadata, links, token context |
| token risk / audit | `binance-web3/query-token-audit` | reject unsafe or suspicious opportunities |
| address intelligence | `binance-web3/query-address-info` | identify risky addresses / concentration patterns if needed |
| market ranking / discovery | `binance-web3/crypto-market-rank`, `binance-web3/meme-rush` | candidate source expansion |
| smart-money signal context | `binance-web3/trading-signal` | enrich opportunity confidence |
| social distribution | `binance/square-post` | publish post-trade summaries / insights |

### 6.2 Current internal capability sources

| Current system asset | Role inside module |
|---------------------|--------------------|
| `src/skills/alphaos/plugins/dex-arbitrage.ts` | current strategy core |
| discovery engine | opportunity scanning and candidate generation |
| cost model | fees / slippage / MEV / gas estimation |
| simulator | pre-trade validation |
| risk engine | policy gating and circuit breaking |
| execution client | execution backend |
| notifier / growth surfaces | summaries, alerts, demo outputs |

---

## 7. Functional responsibilities

The arbitrage module should own the following responsibilities.

### 7.1 Opportunity detection

Detect candidate spreads or route imbalances from supported liquidity venues.

Examples:

- DEX-to-DEX spread
- Alpha token price mismatch
- venue-specific temporary pricing inefficiency
- execution-window mismatch discovered during sampling

### 7.2 Opportunity enrichment

Turn a raw spread into a strategy candidate by attaching context:

- token metadata
- liquidity
- volatility
- quote freshness
- signal support
- account readiness
- route readiness
- chain / market classification

### 7.3 Risk filtering

Reject opportunities that fail policy or safety checks.

Examples:

- insufficient liquidity
- stale quotes
- risk flags from token audit
- insufficient balance
- too much expected slippage
- too much gas or fee drag
- too many recent failures
- daily loss cap reached

### 7.4 Simulation

Before real execution, simulate whether the trade still makes sense after costs and constraints.

### 7.5 Decision output

Produce one of the following outcomes:

- ignore
- watch
- paper-trade
- propose-live-trade
- auto-execute-live

### 7.6 Execution handoff

Pass approved execution plans to the current backend in a controlled way.

### 7.7 Post-trade reporting

Produce an operator-facing summary:

- what was detected
- why it was accepted
- what route was chosen
- what risk checks passed
- what happened in simulation
- what happened in execution
- what the final outcome was

---

## 8. Recommended workflow

The module workflow should be described like this:

```text
discover → enrich → validate → simulate → decide → execute → summarize
```

This is intentionally close to the current engine reality while using more product-friendly wording.

### Step 1 — Discover

Collect candidate opportunities from:

- internal discovery engine
- Binance market context
- Binance Web3 skill-driven opportunity surfaces

### Step 2 — Enrich

Attach:

- token info
- audit context
- account readiness
- liquidity / spread / volatility data
- signal context

### Step 3 — Validate

Apply:

- risk policy
- spread threshold
- fee / slippage / gas checks
- quote freshness checks
- balance and permissions checks

### Step 4 — Simulate

Estimate expected outcome after costs and execution friction.

### Step 5 — Decide

Choose:

- no action
- watchlist
- paper trade
- live execution candidate
- fully automated execution

### Step 6 — Execute

Send approved plans to the current execution backend.

### Step 7 — Summarize

Generate:

- operator report
- dashboard update
- optional public / social summary

---

## 9. Operating modes

The module should support distinct operating modes.

| Mode | Purpose | Typical user |
|------|---------|--------------|
| `scout` | detect and rank opportunities only | judges, analysts, cautious operators |
| `paper` | full pipeline without live execution | demos, testing, evaluation |
| `assisted-live` | propose execution and require approval | human-in-the-loop operators |
| `live` | automatic execution under policy bounds | mature operator setup |

Note: the current system already supports `paper` and `live`. `scout` and `assisted-live` are useful product-facing refinements for later phases.

---

## 10. Decision model

The module should not decide on spread alone.

A simplified decision model:

```text
raw edge
- fees
- slippage
- gas
- mev penalty
- latency risk
- liquidity penalty
= expected net edge
```

Then apply gates:

- minimum net edge threshold
- risk policy threshold
- available balance threshold
- execution readiness threshold
- route safety threshold

Then produce a decision class:

- reject
- monitor
- simulate only
- propose execution
- execute

---

## 11. Input / output contract (product level)

### Inputs

The module should accept inputs such as:

- target pair or token universe
- supported venue set
- budget / notional constraints
- risk profile
- execution mode
- chain / market scope
- optional signal sources
- optional account scope

### Outputs

The module should produce structured outputs such as:

```json
{
  "module": "arbitrage",
  "status": "candidate_accepted",
  "mode": "paper",
  "pair": "TOKEN/USDT",
  "opportunityType": "dex_spread",
  "expectedNetEdgeBps": 72.4,
  "notionalUsd": 1000,
  "decision": "paper_trade",
  "reasons": [
    "spread passed net threshold",
    "risk checks passed",
    "simulation remained profitable"
  ],
  "upstreamSkills": [
    "binance/spot",
    "binance/assets",
    "binance-web3/query-token-info",
    "binance-web3/query-token-audit"
  ]
}
```

This contract is illustrative.
The important point is that the module should expose:

- what it saw
- what it used
- what it decided
- why it decided that way

---

## 12. What makes this module differentiated

A raw skills catalog can:

- fetch token info
- fetch balances
- fetch signals
- place a trade

A good strategy module can:

- combine those capabilities
- filter noise from signal
- reason about execution readiness
- avoid false-positive spreads
- decide whether live action is justified
- produce an explanation after the action

That difference is the main reason this module matters.

---

## 13. Judge-facing demo flow

The demo should feel like a complete workflow, not a collection of calls.

### Preferred demo story

1. **Find an opportunity**
   - show a candidate surfaced from discovery
2. **Explain why it matters**
   - show spread, expected edge, market context
3. **Validate safety**
   - show token/risk checks and balance readiness
4. **Simulate**
   - show expected outcome after costs
5. **Execute or approve**
   - paper or assisted-live depending environment
6. **Summarize**
   - show outcome report and optional distribution surface

### The key judge takeaway

> This is not an agent that merely calls market APIs.
> This is a strategy product that turns BN ecosystem capabilities into actionable, risk-aware execution flows.

---

## 14. Non-goals for v0

This spec does **not** require us to solve everything at once.

Not required in v0:

- every arbitrage class
- fully generalized cross-chain routing
- perfect internal renaming
- replacing the current execution backend
- full one-to-one parity with every Binance skill

v0 should focus on:

- one convincing flagship path
- one clear compatibility story
- one strong demoable flow
- one realistic migration path from the current codebase

---

## 15. Build phases

### Phase A — Spec and framing

- define the module boundary
- define official skill mapping
- define demo narrative
- define product-facing output format

### Phase B — Interface alignment

- identify adapter points for official skills
- normalize opportunity enrichment inputs
- make upstream skill usage explicit in outputs and docs

### Phase C — MVP module

- implement the first Binance Skills-compatible arbitrage flow
- keep current backend
- expose structured decisions and summaries

### Phase D — Expanded strategy surface

- add more opportunity sources
- add more risk filters
- add assisted-live flows
- add better review and reporting surfaces

---

## 16. Code anchors in the current repository

Current implementation anchors:

- strategy plugin: `src/skills/alphaos/plugins/dex-arbitrage.ts`
- engine orchestration: `src/skills/alphaos/engine/alpha-engine.ts`
- risk engine: `src/skills/alphaos/runtime/risk-engine.ts`
- simulator: `src/skills/alphaos/runtime/simulator.ts`
- cost model: `src/skills/alphaos/runtime/cost-model.ts`
- backend adapter: `src/skills/alphaos/runtime/onchainos-client.ts`
- discovery and candidate flow: `src/skills/alphaos/runtime/discovery/`

These should remain the implementation anchors while the external module framing evolves.

---

## 17. One-sentence summary

**The Arbitrage Module should become the first Binance Skills-compatible flagship strategy module in Vigil: a BNB ecosystem-native layer that transforms official skill capabilities into risk-aware, simulation-backed, execution-ready action.**
