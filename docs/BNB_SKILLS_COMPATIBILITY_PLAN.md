# BNB Skills Compatibility Plan

This document captures the **current product direction**:

> Vigil should evolve into a **BNB ecosystem-native agent product** that is **compatible with Binance official open skills**, while keeping the current execution stack as the working backend.

This is **not** a full rewrite plan.
It is a framing and migration plan so future docs, modules, and demos all move in the same direction.

---

## 1. What this means

The key reference is the official open repository:

- `https://github.com/binance/binance-skills-hub`

That repository matters because it provides an **ecosystem anchor**:

- official open skills
- Binance / BNB ecosystem-aligned capability surface
- skill-oriented packaging that other agent systems can integrate with

So our goal is not just to "reference Binance" in wording.
Our goal is to make Vigil feel like:

- **built for the BNB ecosystem**
- **compatible with Binance official skill conventions**
- **stronger than a plain skill catalog because it adds strategy, orchestration, trust, and product UX**

---

## 2. The correct positioning

### Binance Skills Hub is the capability interface layer

The official skills are the open, ecosystem-facing capability layer:

- market data
- token / address / risk queries
- account / asset operations
- trade execution
- publishing / social distribution

This gives us a clean external anchor.

### Vigil is the strategy and product layer

Vigil should sit **above** the official skill layer and provide:

- user-facing product experience
- multi-step workflow orchestration
- strategy logic
- trust and coordination between agents
- memory and operator context
- explainable action proposals and execution summaries

### The current execution backend is already in place

The legacy execution-backend label may remain as an implementation fact, but it should not dominate the top-level story.

The preferred framing is:

- **BNB ecosystem-native product**
- **Binance Skills-compatible capability model**
- **powered by the current execution backend**

---

## 3. Four-layer architecture

## Layer 1 — Official Skill Compatibility Layer

Purpose: align with the Binance open skill ecosystem.

This layer should define how Vigil talks to ecosystem capabilities in a way that is easy to explain to judges, partners, and future contributors.

Typical capability groups:

- Binance Spot / Assets / Alpha / Futures / Margin
- Binance Web3 token info / token audit / address info
- Binance Web3 trading signals / market rank / meme discovery
- Binance Square publishing

Output of this layer:

- compatibility adapters
- stable skill-facing task contracts
- ecosystem-friendly module descriptions

---

## Layer 2 — Strategy Modules

Purpose: create differentiated value that the official skill catalog does not provide by itself.

This is where we should compete.

Examples:

- **Arbitrage Module**
- Smart Money Follow Module
- Alpha Capture Module
- Risk Filter Module
- Portfolio Rebalance Module
- Signal-to-Execution Module

These modules should combine multiple official skills into a higher-level outcome:

- discover
- compare
- filter
- simulate
- decide
- execute
- summarize

This is the main difference between:

- a repository of tools
- a hackathon-winning product

---

## Layer 3 — Execution Backend

Purpose: run the real workflow reliably.

This is where the current execution stack remains valuable:

- discovery runtime
- simulation
- execution pipeline
- state management
- metrics
- operator tooling
- replay / sandbox / observability

Near-term principle:

- **do not rip out the current backend just to rename it**
- keep the working stack
- add compatibility and abstraction above it

---

## Layer 4 — Product / Trust / User Experience

Purpose: make the system feel like a product, not a bag of calls.

This includes:

- Vigil user experience
- Judge as decision / evaluation / explanation layer
- Agent-Comm as trust and coordination layer
- long-term memory and operator preferences
- reports, dashboards, and review flows

This layer answers the real product question:

> Why would a user, judge, or partner choose this instead of just calling raw skills directly?

---

## 4. First flagship module: Arbitrage

If we want a concrete BNB ecosystem-native module to rally around, **arbitrage** is a strong candidate.

Not as a raw bot, but as a **Binance Skills-compatible strategy module**.

### Inputs it can consume

From the official skill ecosystem:

- token / market discovery
- price and liquidity context
- account / asset availability
- Alpha token context
- trading signals
- risk / audit data

From our current system:

- discovery engine
- strategy evaluator
- simulator
- execution backend
- operator rules and memory

### What the module should add

The arbitrage module should not just fetch data.
It should provide:

1. opportunity detection
2. spread / path comparison
3. execution feasibility checks
4. risk filtering
5. simulation before action
6. configurable execution thresholds
7. post-trade summary and reporting

### What makes it stronger than a plain skill

A plain skill can answer:

- what is the price?
- what is the balance?
- place this order

A strategy module can answer:

- is this opportunity real?
- is it executable with current capital and constraints?
- is the expected edge worth the risk and cost?
- should we act now, paper trade it, or ignore it?

That is the level where product differentiation lives.

---

## 5. Capability mapping

The practical migration model is:

| Layer | Role | What it should look like externally |
|------|------|--------------------------------------|
| Binance official skills | ecosystem capability surface | official / open / BN-compatible building blocks |
| Vigil strategy modules | differentiated intelligence | arbitrage, risk, alpha capture, signal orchestration |
| execution backend | execution substrate | current runtime / engine / execution backend |
| Agent-Comm + Judge + UX | trust and product layer | product experience, explainability, multi-agent coordination |

Another useful way to think about it:

| Current asset | Future framing |
|--------------|----------------|
| current discovery / execution loop | backend execution engine |
| Agent-Comm | trust and coordination layer |
| Judge | decision and explanation layer |
| Vigil | BN ecosystem-native product shell |
| New arbitrage module | Binance Skills-compatible flagship strategy module |

---

## 6. Migration principles

### Principle 1 — Compatibility first, rewrite later

Do not pause progress waiting for a perfect rename or a fully rewritten architecture.

Prefer:

- wrappers
- adapters
- compatibility docs
- product-facing reframing

before deeper internal surgery.

### Principle 2 — Keep implementation facts true

Do not fake the current state.

If the backend still depends on the legacy execution stack, say so.
If a module still uses historical names internally, preserve that fact.
The improvement is in **positioning and architecture alignment**, not pretending the internals already changed.

### Principle 3 — Modules should map to ecosystem value

Each important module should eventually answer one of these questions:

- which official skills does it build on?
- what strategy value does it add?
- why does this matter specifically in the BNB / Binance ecosystem?

### Principle 4 — Demo flow beats raw capability count

For hackathon judging, a strong flow matters more than a giant list.

Preferred shape:

- discover opportunity
- validate risk
- simulate or propose execution
- execute or queue approval
- publish / report / review

---

## 7. What should change in docs next

Future doc changes should gradually reflect this structure.

### README and top-level docs should emphasize

- BNB ecosystem-native positioning
- compatibility with Binance official open skills
- Vigil as product layer
- current execution backend as implementation fact

### Strategy docs should emphasize

- flagship modules such as arbitrage
- why combining skills is more valuable than exposing single calls
- explainability and operational safety

### Protocol docs should emphasize

- Agent-Comm as trust layer inside the broader product
- why trust and consent matter for multi-agent execution

---

## 8. Implementation phases

### Phase 0 — Framing alignment

- Compatibility story definition
- Current system mapped into four-layer architecture
- Product-centered naming and positioning

### Phase 1 — Documentation and interface alignment

- README / docs index / one-pagers updated
- Modules described in Binance Skills-compatible language
- Strategy evolution path documented

### Phase 2 — Flagship strategy module

- Arbitrage module boundaries defined
- Official skills consumption mapped
- Simulation / approval / execution path specified
- Demo narrative around one strong flow

### Phase 3 — Compatibility implementation

- Adapter layer integration
- Task contract normalization
- Module structure optimized for extensibility

---

## 9. One-sentence summary

**Binance official skills should become our ecosystem-facing capability standard; Vigil should become the product and strategy layer built on top of that standard; the current execution backend should remain underneath.**
