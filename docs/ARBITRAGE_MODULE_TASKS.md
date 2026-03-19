# Arbitrage Module Tasks

This document turns `ARBITRAGE_MODULE_SPEC.md` into an execution-oriented task list.

Goal:

> make the arbitrage module the first **Binance Skills-compatible flagship strategy module** in Vigil, while preserving the current execution backend.

This is a staged task list, not a promise to build everything at once.
The priority is to create a **credible, demoable, BN ecosystem-native module path** with minimal architectural thrash.

---

## 1. Deliverable definition

A successful first milestone should make it possible to say:

- we have a clearly defined arbitrage module
- it is described in Binance Skills-compatible language
- it maps to official skill capability sources
- it keeps the current backend intact
- it can produce a judge-friendly demo flow
- the next implementation steps are unambiguous

---

## 2. Workstreams

The work is split into five workstreams:

1. **Positioning & docs**
2. **Interface & compatibility layer**
3. **Strategy logic & risk model**
4. **Execution & observability**
5. **Demo & evaluation flow**

---

## 3. Phase plan

## Phase 0 — framing lock

Purpose: stop the project from drifting back into backend-first or naming-first thinking.

### Tasks

- [x] Write compatibility framing doc
  - Output: `BNB_SKILLS_COMPATIBILITY_PLAN.md`
- [x] Write flagship arbitrage module spec
  - Output: `ARBITRAGE_MODULE_SPEC.md`
- [ ] Normalize top-level wording in remaining high-visibility docs
  - Focus:
    - `AGENT_COMM_EXPLAINED.md`
    - `AGENT_COMM_PRODUCTION_DEPLOYMENT.md`
    - any doc still over-centering AlphaOS / legacy execution labels in external framing

### Exit condition

Anyone reading the repo should understand:

- Binance official skills are the ecosystem-facing capability layer
- Vigil is the product / orchestration / strategy layer
- The current execution backend is implementation detail, not the product headline

---

## Phase 1 — module contract definition

Purpose: define the arbitrage module in a way that can later be implemented, demoed, and explained consistently.

### Tasks

- [ ] Define the product-facing module contract
  - Inputs
  - Outputs
  - decision states
  - operator-facing summary format
- [ ] Define opportunity lifecycle states
  - proposed states:
    - `discovered`
    - `enriched`
    - `validated`
    - `simulated`
    - `approved`
    - `executed`
    - `rejected`
    - `expired`
- [ ] Define the compatibility vocabulary
  - how to describe upstream official skill usage
  - how to describe internal backend handoff
  - how to describe simulation and risk reasons
- [ ] Define decision reason taxonomy
  - examples:
    - `spread_below_threshold`
    - `liquidity_too_low`
    - `simulation_failed`
    - `audit_flagged`
    - `balance_insufficient`
    - `execution_backend_unready`

### Suggested output docs

- `ARBITRAGE_MODULE_CONTRACT.md`
- `ARBITRAGE_DECISION_REASONS.md`

### Exit condition

The module has a stable language for inputs, outputs, and decisions.

---

## Phase 2 — official skill mapping and adapter plan

Purpose: make the compatibility claim concrete.

### Tasks

- [ ] Create a mapping table from arbitrage module needs to official Binance skills
- [ ] Separate:
  - required upstream capabilities
  - optional enrichment capabilities
  - optional distribution capabilities
- [ ] Define adapter points for each capability group
  - market / execution context
  - balance / asset context
  - token metadata
  - token audit / risk context
  - signal enrichment
  - social posting
- [ ] Mark which capabilities are:
  - already covered internally
  - missing but easy to add
  - missing and architectural

### Suggested output docs

- `ARBITRAGE_SKILL_MAPPING.md`
- `ARBITRAGE_ADAPTER_PLAN.md`

### Exit condition

We can point to a clear answer for:

> Which official skills does this module build on, and where do they plug into the flow?

---

## Phase 3 — current-code alignment

Purpose: bridge current implementation to future framing without disruptive rewrites.

### Tasks

- [ ] Map current `dex-arbitrage` plugin to the new module vocabulary
- [ ] Document which parts of current code already satisfy the module responsibilities:
  - detect
  - evaluate
  - plan
  - simulate
  - execute
  - record
  - notify
- [ ] Identify naming mismatches between current code and desired external framing
- [ ] Identify whether a thin facade or adapter is enough before any deeper refactor
- [ ] Decide where the “arbitrage module” abstraction should live:
  - docs only initially
  - service layer
  - module facade
  - skill-level wrapper

### Current anchors

- `src/skills/alphaos/plugins/dex-arbitrage.ts`
- `src/skills/alphaos/engine/alpha-engine.ts`
- `src/skills/alphaos/runtime/cost-model.ts`
- `src/skills/alphaos/runtime/simulator.ts`
- `src/skills/alphaos/runtime/risk-engine.ts`
- `src/skills/alphaos/runtime/onchainos-client.ts`

### Suggested output docs

- `ARBITRAGE_IMPLEMENTATION_GAP.md`

### Exit condition

We know exactly how much of the current system is reusable and where the new abstraction boundary belongs.

---

## Phase 4 — MVP compatibility implementation

Purpose: create the first working version that can honestly claim Binance Skills-compatible direction.

### Tasks

- [ ] Expose arbitrage flow in product-facing terms
- [ ] Add explicit opportunity enrichment stage
- [ ] Add structured decision outputs with reason codes
- [ ] Add explicit upstream-skill usage metadata in outputs or reports
- [ ] Add a thin compatibility adapter layer where needed
- [ ] Keep existing backend execution path intact
- [ ] Ensure paper mode remains the default safe path for demos

### MVP constraints

The MVP does **not** need:

- every official skill integration fully live
- every arbitrage style
- full cross-chain generality
- a new execution engine

It **does** need:

- one coherent flow
- one coherent vocabulary
- one believable BN ecosystem angle
- one strong demo path

### Exit condition

The module can run a convincing “discover → validate → simulate → decide” flow and show where official skill compatibility fits.

---

## Phase 5 — demo packaging

Purpose: make the module win attention.

### Tasks

- [ ] Write a judge-facing demo storyboard
- [ ] Define a preferred demo mode
  - scout
  - paper
  - assisted-live
- [ ] Create a short script for live walkthrough
- [ ] Define the exact screens / outputs to show
- [ ] Define the 3-5 strongest talking points
- [ ] Define fallback demo path if external execution permissions are unavailable

### Suggested output docs

- `ARBITRAGE_DEMO_SCRIPT.md`
- `ARBITRAGE_JUDGE_STORY.md`

### Exit condition

A teammate can run the demo and tell the same product story consistently.

---

## Phase 6 — ecosystem-facing packaging

Purpose: make the module legible to Binance / BNB ecosystem partners.

### Tasks

- [ ] Write a short ecosystem-facing one-pager for the arbitrage module
- [ ] Make skill compatibility explicit in top-level repo language
- [ ] Show how the module extends, not replaces, official skills
- [ ] Explain why this matters specifically for BN ecosystem operator workflows
- [ ] Prepare concise comparison language:
  - official skills = capability surface
  - our module = strategy + orchestration + safety + execution reporting

### Suggested output docs

- `ARBITRAGE_ONE_PAGER.md`

### Exit condition

The arbitrage module can be described in partner language in under one minute.

---

## 4. Priority order

If we want speed without losing quality, the recommended order is:

1. **contract definition**
2. **official skill mapping**
3. **implementation gap analysis**
4. **demo script**
5. **MVP compatibility layer**

This order avoids writing code before the compatibility story and demo story are stable.

---

## 5. Minimum believable milestone

The smallest milestone that still feels real should include:

- `ARBITRAGE_MODULE_SPEC.md`
- `ARBITRAGE_MODULE_TASKS.md`
- module contract draft
- official skill mapping draft
- judge demo script draft
- one example of structured arbitrage decision output

If we reach that point, we already have a coherent story plus a build path.

---

## 6. Suggested task owners by role

### Product / strategy owner

Own:

- module goal
- target user
- demo flow
- judge story
- compatibility positioning

### Architecture / backend owner

Own:

- adapter boundaries
- module abstraction boundary
- reuse vs refactor decisions
- execution handoff design

### Runtime / strategy owner

Own:

- opportunity enrichment
- decision reasons
- risk gating
- simulation integration
- structured outputs

### Demo / growth owner

Own:

- battle report format
- demo script
- visual surfaces
- optional Square distribution flow

---

## 7. Open questions

These should be answered before implementation gets too deep.

### Product questions

- Who is the primary first user?
  - judge
  - power user
  - operator
  - ecosystem partner
- Is the first demo primarily:
  - DEX arbitrage
  - Binance Alpha + Web3 signal-enhanced arbitrage
  - assisted execution and explanation

### Architecture questions

- Should official-skill compatibility start as:
  - documentation-level mapping only
  - wrapper functions
  - a formal adapter interface
- Should the arbitrage module be exposed as:
  - a doc concept only first
  - an API surface
  - a skill wrapper
  - a product module in UI/demo

### Risk questions

- What is the minimum trustworthy simulation requirement before any assisted-live flow?
- Which risk signals are mandatory before a candidate may be promoted from paper to proposal?

---

## 8. Immediate next-doc recommendations

The next documents worth writing are:

1. `ARBITRAGE_MODULE_CONTRACT.md`
2. `ARBITRAGE_SKILL_MAPPING.md`
3. `ARBITRAGE_DEMO_SCRIPT.md`

That sequence keeps both engineering and narrative aligned.

---

## 9. One-sentence summary

**The arbitrage module should be developed through staged contract, compatibility, implementation-gap, and demo work so it becomes a credible Binance Skills-compatible flagship strategy module without destabilizing the current backend.**
