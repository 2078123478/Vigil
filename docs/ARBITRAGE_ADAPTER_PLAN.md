# Arbitrage Adapter Plan

This document defines the adapter layer plan for the Arbitrage Module.

Goal:

> connect Binance official open skills to the Arbitrage Module in a way that is truthful, incremental, and compatible with the current execution backend.

The adapter layer is the shortest path to making the module feel **Binance Skills-compatible** without forcing an immediate rewrite of the current engine.

---

## 1. Why an adapter layer

Right now, the repository already has:

- discovery
- arbitrage strategy logic
- simulation
- risk policy
- paper/live execution
- reporting surfaces

What it does **not** yet have is a clean layer that says:

- where official Binance skill outputs enter the module
- how those outputs become normalized module inputs
- how they influence candidate enrichment, validation, and summaries

That is what the adapter layer is for.

---

## 2. Adapter design principles

### Principle 1 — Normalize, do not leak raw upstream shapes

Official skill outputs may vary.
The Arbitrage Module should consume a stable internal shape.

### Principle 2 — Add compatibility without replacing the current engine

Adapters should feed the module and current backend.
They should not force `dex-arbitrage`, `simulator`, or `onchainos-client` to be redesigned first.

### Principle 3 — Separate required inputs from optional enrichment

Not every upstream skill must be required for MVP.
Some adapters can be optional enrichments.

### Principle 4 — Preserve attribution

Every adapter should make it possible to expose:

- which skill family contributed
- whether it was required or optional
- what effect it had on the final decision

---

## 3. Adapter families

The Arbitrage Module should use four adapter families.

## Family A — Market Context Adapter

### Upstream skills

- `binance/spot`
- `binance/alpha`

### Purpose

Convert market and execution context into a normalized module-facing market snapshot.

### Responsibilities

- normalize pair / venue / price observations
- normalize quote freshness
- normalize gas / fee hints if available
- preserve upstream source attribution
- optionally attach route hints or Alpha-specific context

### Recommended output shape

```json
{
  "pair": "ETH/USDC",
  "venue": "binance-spot",
  "bid": 2048.1,
  "ask": 2048.6,
  "gasUsd": 1.2,
  "quoteTs": "2026-03-17T01:00:00.000Z",
  "marketContext": {
    "chainId": 56,
    "marketType": "spot",
    "alphaContext": false
  },
  "sourceSkill": "binance/spot"
}
```

### Near-term MVP behavior

- keep using current internal quote flow where needed
- allow this adapter to feed enrichment and reporting first
- later allow it to influence candidate sourcing more directly

---

## Family B — Readiness Adapter

### Upstream skills

- `binance/assets`

### Purpose

Normalize asset and account readiness into a stable module context.

### Responsibilities

- determine whether assets are available
- determine whether the requested notional is fundable
- attach account scope / readiness summary
- expose whether readiness is blocking or supportive

### Recommended output shape

```json
{
  "accountScope": "default",
  "balanceReady": true,
  "availableNotionalUsd": 2500,
  "assetReadiness": {
    "baseAssetReady": true,
    "quoteAssetReady": true
  },
  "sourceSkill": "binance/assets"
}
```

### Near-term MVP behavior

- map current balance-aware planning into a richer readiness object
- use this adapter mostly for validation and explanation first

---

## Family C — Risk & Metadata Enrichment Adapter

### Upstream skills

- `binance-web3/query-token-info`
- `binance-web3/query-token-audit`
- `binance-web3/query-address-info`
- `binance-web3/trading-signal`
- `binance-web3/crypto-market-rank`
- `binance-web3/meme-rush`

### Purpose

Turn raw candidate opportunities into context-rich module candidates.

### Responsibilities

- attach token identity and metadata
- attach token-risk / audit outcomes
- attach address-level context when needed
- attach signal or ranking support
- convert enrichment into standardized module fields and reason codes

### Recommended output shape

```json
{
  "token": {
    "name": "Wrapped Ether",
    "symbol": "ETH",
    "chainId": 56,
    "contractAddress": "0x..."
  },
  "risk": {
    "tokenRisk": "normal",
    "auditFlags": [],
    "addressRiskLevel": "unknown"
  },
  "signal": {
    "signalSupport": true,
    "signalType": "smart_money",
    "confidenceBoost": 0.08
  },
  "marketNarrative": {
    "rankSource": "crypto-market-rank",
    "eventDriven": false
  },
  "sourceSkills": [
    "binance-web3/query-token-info",
    "binance-web3/query-token-audit",
    "binance-web3/trading-signal"
  ]
}
```

### Near-term MVP behavior

- first support token info + token audit
- then add trading signal
- leave address-info / meme-rush / ranking as optional enrichments

---

## Family D — Distribution Adapter

### Upstream skills

- `binance/square-post`

### Purpose

Turn module results into ecosystem-facing distribution artifacts when desired.

### Responsibilities

- prepare shareable content from structured module outputs
- keep distribution policy-controlled and optional
- preserve post status and attribution

### Recommended output shape

```json
{
  "distributionTarget": "binance-square",
  "shareableText": "Detected and paper-validated a BNB Chain arbitrage candidate...",
  "ready": true,
  "sourceSkill": "binance/square-post"
}
```

---

## 4. Module integration points

Adapters should plug into the module at five points.

| Integration point | What should happen |
|------------------|--------------------|
| before discovery | expand or prioritize candidate universe |
| after discovery | enrich raw candidate with metadata and risk context |
| before validation | attach readiness and blocking signals |
| before summary generation | expose skill attribution and context |
| after result generation | produce distribution-ready output |

---

## 5. Recommended normalized objects

To keep implementation stable, use a small set of module-facing normalized objects.

### `NormalizedMarketContext`

Used by:

- discovery
- validation
- summary generation

Fields:

- `pair`
- `venue`
- `bid`
- `ask`
- `quoteTs`
- `gasUsd`
- `sourceSkill`

### `NormalizedReadinessContext`

Used by:

- validation
- planning
- decision explanation

Fields:

- `balanceReady`
- `availableNotionalUsd`
- `accountScope`
- `sourceSkill`

### `NormalizedEnrichmentContext`

Used by:

- enrichment
- validation
- explanation

Fields:

- `token`
- `risk`
- `signal`
- `marketNarrative`
- `sourceSkills`

### `NormalizedDistributionContext`

Used by:

- summary generation
- ecosystem publishing

Fields:

- `distributionTarget`
- `shareableText`
- `ready`
- `sourceSkill`

---

## 6. MVP adapter scope

To avoid overbuilding, the first adapter slice should only cover:

### Required in MVP slice

1. Market Context Adapter
   - `binance/spot`
2. Readiness Adapter
   - `binance/assets`
3. Risk & Metadata Enrichment Adapter
   - `binance-web3/query-token-info`
   - `binance-web3/query-token-audit`

### Strong optional MVP+

4. Signal enrichment
   - `binance-web3/trading-signal`
5. Distribution adapter
   - `binance/square-post`

### Later-phase optional

6. `binance/alpha`
7. `binance-web3/query-address-info`
8. `binance-web3/crypto-market-rank`
9. `binance-web3/meme-rush`

---

## 7. Suggested implementation sequence

### Step 1 — Define interfaces only

Create adapter interfaces and normalized object types without changing the engine.

### Step 2 — Add response-layer attribution

Even before real upstream calls are wired, add fields in module outputs for:

- `skillSources`
- `requiredSkillsUsed`
- `enrichmentSkillsUsed`
- `distributionSkillsUsed`

### Step 3 — Add token info + token audit enrichment

This gives the fastest visible improvement in:

- candidate cards
- decision quality narrative
- judge demos

### Step 4 — Add balance readiness adapter

Make account readiness explicit in validation and outputs.

### Step 5 — Add signal enrichment and distribution hooks

Only after the core module response shape is stable.

---

## 8. Suggested ownership by layer

### Adapter interface owner

Own:

- normalized type definitions
- interface boundaries
- source attribution conventions

### Module owner

Own:

- where adapters plug into candidate lifecycle
- how enrichment affects decisions
- how reasons are surfaced

### Demo/product owner

Own:

- which adapter outputs matter in judge flow
- how to expose compatibility without overloading the screen

---

## 9. Do-not-do list

Avoid these mistakes:

### Do not

- rewrite the whole engine first
- block progress waiting for all official skill integrations
- pass raw upstream payloads directly into UI/demo surfaces
- hide attribution once adapters exist

### Do instead

- normalize
- attribute
- enrich incrementally
- keep backend stable

---

## 10. Minimum believable adapter milestone

The smallest milestone that already feels real:

- normalized adapter interfaces exist
- module outputs show `skillSources`
- token info and token audit enrich a candidate
- readiness is visible in validation output
- one demo uses this enriched output shape

That is enough to make the compatibility story much more concrete.

---

## 11. One-sentence summary

**The adapter layer should normalize Binance official skill outputs into stable market, readiness, enrichment, and distribution contexts so the Arbitrage Module can become visibly Binance Skills-compatible without disrupting the current execution engine.**
