# Arbitrage Skill Mapping

This document maps the Arbitrage Module to Binance official open skills and to the current internal implementation.

The purpose is to make one claim concrete:

> the Arbitrage Module is not a standalone black box; it is a strategy layer that can be built on top of Binance ecosystem skills while continuing to use the current OnchainOS-based backend underneath.

---

## 1. Mapping model

The mapping has three layers:

1. **official skill layer** — upstream ecosystem capabilities
2. **arbitrage module layer** — strategy, filtering, simulation, decisions
3. **backend layer** — current engine, state, and execution infrastructure

Think of it like this:

```text
Binance official skills → Arbitrage Module → OnchainOS backend → Product surfaces
```

---

## 2. Functional flow mapping

The arbitrage module flow is:

```text
discover → enrich → validate → simulate → decide → execute → summarize
```

The table below shows where capabilities should come from.

| Module stage | What happens | Binance official skill candidates | Current internal anchors |
|-------------|--------------|-----------------------------------|--------------------------|
| discover | detect raw opportunity candidates | `binance/spot`, `binance/alpha`, `binance-web3/crypto-market-rank`, `binance-web3/meme-rush`, `binance-web3/trading-signal` | discovery engine, `dex-arbitrage.ts` scan |
| enrich | attach token, market, and risk context | `binance-web3/query-token-info`, `binance-web3/query-token-audit`, `binance-web3/query-address-info`, `binance/assets` | metadata in opportunity, state store, future enrichment adapter |
| validate | check thresholds and policy | `binance/assets`, `binance/spot`, optional audit / address signals | `dex-arbitrage.ts` evaluate, risk engine, cost model |
| simulate | estimate post-cost viability | upstream market context from `binance/spot` / `binance/alpha` | simulator, cost model |
| decide | produce paper / assisted-live / live decision | optional support from skill-derived context | evaluation + module adapter |
| execute | route approved plan into backend | `binance/spot`, `binance/alpha`, `binance/assets` as capability context; backend remains current execution path | OnchainOS client, engine |
| summarize | produce operator and judge outputs | `binance/square-post` for optional distribution | notifier, growth moments, share/report surfaces |

---

## 3. Capability groups

## Group A — required capability context

These are the minimum capabilities needed for a credible arbitrage flow.

| Need | Official skill candidates | Why required |
|------|---------------------------|--------------|
| market / price context | `binance/spot`, `binance/alpha` | determine whether a spread is real and actionable |
| account / asset readiness | `binance/assets` | confirm balances, asset availability, and operational readiness |
| execution context | `binance/spot`, `binance/alpha` | frame what an execution path could look like |

### Current status

- partially covered internally by current quotes, cost model, and backend integration
- official skill compatibility should first be expressed as mapping + adapter plan

---

## Group B — enrichment capability context

These capabilities increase confidence and presentation quality.

| Need | Official skill candidates | Why useful |
|------|---------------------------|-----------|
| token metadata | `binance-web3/query-token-info` | identify token, links, chain, metadata |
| token safety / audit | `binance-web3/query-token-audit` | reject obvious risk traps |
| address intelligence | `binance-web3/query-address-info` | inspect suspicious patterns or concentration if required |
| signal context | `binance-web3/trading-signal` | increase confidence or reduce false positives |
| market ranking / discovery | `binance-web3/crypto-market-rank`, `binance-web3/meme-rush` | widen candidate sourcing |

### Current status

- mostly not formalized in current arbitrage flow
- best near-term use is enrichment adapters and documentation-level compatibility

---

## Group C — optional distribution capability context

These capabilities matter after decision and execution.

| Need | Official skill candidates | Why useful |
|------|---------------------------|-----------|
| public reporting / social distribution | `binance/square-post` | share summarized opportunities, battle reports, or outcomes |

### Current status

- current system already has growth/report surfaces
- Binance Square posting can become an ecosystem-facing extension layer

---

## 4. Skill-by-skill mapping

## 4.1 `binance/spot`

### Module role

- core market context
- price / pair-level interaction context
- potential execution context

### Best fit module stages

- discover
- validate
- simulate
- execute

### What it helps answer

- what the market currently looks like
- whether price assumptions are still valid
- whether the route still makes sense at action time

### Internal counterpart

- quotes used by `dex-arbitrage.ts`
- cost model inputs
- backend execution preparation

---

## 4.2 `binance/alpha`

### Module role

- Alpha market surface
- token-specific or venue-specific opportunity context

### Best fit module stages

- discover
- enrich
- validate
- execute

### What it helps answer

- is there an Alpha-specific pricing or market signal worth folding into the opportunity?

### Internal counterpart

- future enrichment adapter feeding candidate metadata and route hints

---

## 4.3 `binance/assets`

### Module role

- account readiness
- asset availability
- fundability checks

### Best fit module stages

- enrich
- validate
- execute

### What it helps answer

- do we have the assets needed?
- should this candidate be blocked before simulation or execution?

### Internal counterpart

- balance inputs used in evaluate / plan contexts
- future explicit readiness adapter

---

## 4.4 `binance-web3/query-token-info`

### Module role

- token metadata enrichment
- chain and market context
- social / narrative context

### Best fit module stages

- enrich
- summarize

### What it helps answer

- what token is this actually?
- what chain and identity context should be shown to operator or judge?

### Internal counterpart

- candidate metadata enrichment layer to be added

---

## 4.5 `binance-web3/query-token-audit`

### Module role

- safety and trust enrichment
- reject obvious risk traps

### Best fit module stages

- enrich
- validate

### What it helps answer

- should this candidate be blocked for safety reasons before simulation or execution?

### Internal counterpart

- future risk enrichment adapter feeding reason codes like `audit_flagged`

---

## 4.6 `binance-web3/query-address-info`

### Module role

- optional address-level intelligence
- suspicious concentration or provenance context

### Best fit module stages

- enrich
- validate

### What it helps answer

- do address-level patterns reduce confidence in the candidate?

### Internal counterpart

- optional enrichment path; not required for MVP

---

## 4.7 `binance-web3/trading-signal`

### Module role

- signal support for opportunity confidence
- smart-money context

### Best fit module stages

- discover
- enrich
- decide

### What it helps answer

- does an external signal reinforce or weaken our confidence in the candidate?

### Internal counterpart

- future scoring boost / confidence adjustment layer

---

## 4.8 `binance-web3/crypto-market-rank`

### Module role

- candidate universe discovery
- asset ranking input

### Best fit module stages

- discover

### What it helps answer

- which symbols or segments deserve scanning attention first?

### Internal counterpart

- discovery session input generation

---

## 4.9 `binance-web3/meme-rush`

### Module role

- opportunistic candidate sourcing
- event-driven or narrative-driven discovery expansion

### Best fit module stages

- discover
- enrich

### What it helps answer

- are there fast-moving assets worth temporary inclusion in discovery?

### Internal counterpart

- optional upstream candidate source; not required for MVP

---

## 4.10 `binance/square-post`

### Module role

- public reporting
- battle report publishing
- ecosystem-native distribution

### Best fit module stages

- summarize

### What it helps answer

- how does the module publish its outcome in an ecosystem-facing way?

### Internal counterpart

- growth moments / share card layer

---

## 5. Required vs optional for MVP

## Required for MVP compatibility story

These should be emphasized first:

1. `binance/spot`
2. `binance/assets`
3. `binance-web3/query-token-info`
4. `binance-web3/query-token-audit`

Why these four first:

- they cover discover / validate / safety / readiness / explanation
- they are enough to tell a credible compatibility story
- they match the arbitrage module’s judge-facing workflow well

## Strong optional enrichments for MVP+

1. `binance-web3/trading-signal`
2. `binance/alpha`
3. `binance/square-post`

## Later or scenario-driven enrichments

1. `binance-web3/query-address-info`
2. `binance-web3/crypto-market-rank`
3. `binance-web3/meme-rush`

---

## 6. Adapter plan by capability family

## Family A — market and execution context adapter

### Scope

- `binance/spot`
- `binance/alpha`

### Adapter responsibilities

- normalize market observations into module-friendly quote context
- attach venue metadata
- attach route or execution hints where available
- expose freshness and confidence information

### Recommended output fields

- `pair`
- `venue`
- `bid`
- `ask`
- `gasUsd`
- `quoteTs`
- `sourceSkill`

---

## Family B — readiness and risk enrichment adapter

### Scope

- `binance/assets`
- `binance-web3/query-token-audit`
- `binance-web3/query-address-info`

### Adapter responsibilities

- normalize account readiness
- normalize risk flags
- turn external signals into standardized reason codes

### Recommended output fields

- `balanceReady`
- `accountScope`
- `tokenRisk`
- `riskFlags`
- `addressRiskLevel`
- `sourceSkill`

---

## Family C — token and narrative enrichment adapter

### Scope

- `binance-web3/query-token-info`
- `binance-web3/trading-signal`
- `binance-web3/crypto-market-rank`
- `binance-web3/meme-rush`

### Adapter responsibilities

- enrich candidate identity and context
- enrich confidence score
- support more compelling operator and judge summaries

### Recommended output fields

- `tokenName`
- `symbol`
- `chainId`
- `signalSupport`
- `marketRankContext`
- `sourceSkill`

---

## Family D — distribution adapter

### Scope

- `binance/square-post`

### Adapter responsibilities

- turn outcome reports into shareable content
- keep public-facing content optional and policy-controlled

### Recommended output fields

- `shareableText`
- `distributionStatus`
- `sourceSkill`

---

## 7. Mapping to current code anchors

| Module need | Current code anchor | Gap |
|------------|---------------------|-----|
| raw opportunity scan | `src/skills/alphaos/plugins/dex-arbitrage.ts` | already present |
| structured evaluation | `dex-arbitrage.ts` evaluate | already present but needs normalized reason codes |
| planning | `dex-arbitrage.ts` plan | already present |
| simulation | `runtime/simulator.ts` | already present |
| cost breakdown | `runtime/cost-model.ts` | already present |
| execution handoff | `runtime/onchainos-client.ts` | already present |
| risk policy gates | `runtime/risk-engine.ts` | already present |
| discovery loop | `runtime/discovery/` | already present |
| official skill adapter layer | not formalized | missing |
| product-facing module output layer | not formalized | missing |
| public distribution via Square | not formalized | optional future gap |

---

## 8. Recommended first compatibility slice

If we want one realistic first slice, it should be:

### Inputs

- internal arbitrage candidate detection
- token metadata from `query-token-info`
- token safety from `query-token-audit`
- balance readiness from `assets`
- market context narrative from `spot`

### Output

- one structured candidate card
- one structured decision output
- one operator summary
- one judge-friendly explanation line

This is small enough to deliver but strong enough to demonstrate the architecture.

---

## 9. Recommended wording for external explanation

A short external explanation should sound like this:

> The Arbitrage Module builds on Binance ecosystem skills for market context, account readiness, token metadata, and token-risk enrichment, then combines those inputs with our own discovery, simulation, and execution backend to produce risk-aware arbitrage decisions.

That line is concise, truthful, and strong enough for demos and partner conversations.

---

## 10. One-sentence summary

**The Arbitrage Skill Mapping shows how official Binance skills should feed discovery, enrichment, validation, execution context, and reporting, while the current internal runtime continues to provide the strategy engine, simulation, risk controls, and execution backend.**
