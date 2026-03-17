# Arbitrage Demo Script

This document defines the preferred demo flow for the Arbitrage Module.

Goal:

> help a teammate present the module as a **BNB ecosystem-native, Binance Skills-compatible strategy product** rather than as a pile of market calls or an internal backend demo.

The demo should be explainable in a few minutes and should still work when live execution is unavailable.

---

## 1. Demo objective

After the demo, the audience should believe three things:

1. this is more than a simple API wrapper
2. this product fits naturally into the Binance / BNB ecosystem story
3. the module turns ecosystem capabilities into intelligent, risk-aware action

---

## 2. Preferred demo mode

### Default recommendation

Use **paper mode** as the default demo path.

Why:

- safest
- repeatable
- credible
- still demonstrates the full logic chain
- avoids getting derailed by external execution permissions

### Optional advanced mode

Use **assisted-live** only if:

- environment is stable
- permissions are already verified
- fallback to paper is clearly prepared

---

## 3. Demo framing in one sentence

Open with this idea:

> Personal Butler takes Binance ecosystem capabilities, enriches them with risk and strategy logic, and turns them into execution-ready arbitrage decisions instead of just raw market responses.

---

## 4. Demo flow overview

Use this sequence:

```text
Opportunity found → Context enriched → Risk validated → Simulation passed → Decision made → Result summarized
```

Keep the demo tight.
Do not try to show every subsystem.
Show the minimum needed to make the intelligence obvious.

---

## 5. Demo storyboard

## Scene 1 — Positioning (15-25 seconds)

### What to say

> We’re not building a generic bot or a raw trading API wrapper.
> We’re building a Binance Skills-compatible strategy module for the BNB ecosystem.
> The current backend is powered by our existing OnchainOS runtime, but the product layer is Personal Butler.

### What to show

- repo README or docs index
- `BNB_SKILLS_COMPATIBILITY_PLAN.md`
- `ARBITRAGE_MODULE_SPEC.md`

### What the audience should understand

- there is a clear product thesis
- this sits in a Binance ecosystem framing
- this is not just a renamed internal engine

---

## Scene 2 — Opportunity appears (30-45 seconds)

### What to say

> The first thing we do is discover a candidate opportunity.
> Right now the engine already supports scanning and spread detection.
> Over time, official skills become the ecosystem-facing capability layer feeding this module.

### What to show

Preferred options:

- discovery session output
- recent opportunity list
- a candidate object / report snapshot

### What to highlight

- pair
- buy venue / sell venue
- raw spread
- timestamp / freshness

### Judge takeaway

- this module starts from a real market opportunity, not a fabricated story

---

## Scene 3 — Enrichment with Binance ecosystem context (30-45 seconds)

### What to say

> A spread alone is not enough.
> We enrich the candidate with token context, risk context, and account-readiness context so the system can decide whether it’s actually actionable.

### What to show

At least one of:

- token metadata view
- token risk / audit view
- balance readiness indicator
- signal support flag

### Recommended language

> This is where compatibility with Binance official open skills becomes valuable: the module can consume token info, token audit, account readiness, and market context as structured upstream inputs.

### Judge takeaway

- the module is making a higher-quality decision than a naive spread detector

---

## Scene 4 — Simulation and risk gate (35-50 seconds)

### What to say

> Before any action, we simulate the trade after fees, slippage, gas, and latency adjustments.
> The point is not “can we place an order?” but “should we act after realistic costs and policy constraints?”

### What to show

- simulation result
- expected net USD
- net edge bps
- pass / fail result
- 1-3 reason codes

### Example line

> This candidate looked attractive on raw spread, but what matters is that it still remains profitable after cost-adjusted simulation.

### Judge takeaway

- the intelligence is in decision quality, not just connectivity

---

## Scene 5 — Decision output (25-40 seconds)

### What to say

> The module produces a structured decision, not just a market snapshot.
> It can reject, monitor, paper-trade, propose execution, or execute depending on mode and policy.

### What to show

- structured module response
- decision label
- summary
- reason codes
- requested mode vs effective mode

### Judge takeaway

- the system is explainable
- the system is operationally safe
- the output is product-ready

---

## Scene 6 — Result and summary (20-35 seconds)

### What to say

> Finally, the system produces a summary that works for operators, products, and ecosystem surfaces.
> So this is not just a backend action — it is a complete decision-and-reporting loop.

### What to show

- operator summary line
- trade result or paper result
- optional report / share card / dashboard output

### Optional extension

If available, mention:

- growth/share surfaces
- possible future Square distribution integration

### Judge takeaway

- this looks like a product, not just a script

---

## 6. Short talk track (2-3 minute version)

Use this compact script if time is tight.

### Opening

> Personal Butler is our product layer for BNB ecosystem-native agent workflows.
> This arbitrage module is our first flagship strategy module, and it’s designed to be compatible with Binance’s open skills ecosystem.

### Opportunity

> We start by detecting a real arbitrage candidate from current market conditions.

### Enrichment

> Then we enrich it with token metadata, token-risk context, account readiness, and other ecosystem signals.

### Simulation

> Before acting, we simulate the trade after fees, slippage, gas, and latency adjustments.

### Decision

> The output is a structured decision — reject, monitor, paper-trade, propose, or execute — with explanation and reason codes.

### Close

> So instead of exposing isolated market capabilities, we turn Binance ecosystem capabilities into a risk-aware execution workflow.

---

## 7. Long talk track (4-5 minute version)

### 1. Set the frame

> The official Binance open skills give us an ecosystem-facing capability layer. We build on top of that layer to create strategy modules that are more valuable than individual calls.

### 2. Show a candidate

> Here is a candidate spread. On its own, this is just a market anomaly. The real question is whether it is executable and worth acting on.

### 3. Show enrichment

> We bring in token info, token risk, account readiness, and optional signal context. That raises the decision quality.

### 4. Show simulation

> Then we simulate after cost and execution friction. This is the point where many naive arbitrage demos fall apart.

### 5. Show decision output

> Our module produces a structured decision with reasons and mode awareness. That makes it safer and easier to integrate.

### 6. Close with product thesis

> The result is a strategy product for the BNB ecosystem, powered by our current backend, but aligned with Binance’s open skill direction.

---

## 8. Suggested screens / artifacts

Use 4-6 artifacts max.

### Recommended order

1. README / docs index / compatibility plan
2. arbitrage candidate or discovery report
3. enrichment / candidate detail view
4. simulation result
5. decision output
6. final summary / report view

### Good artifacts to reuse

- `BNB_SKILLS_COMPATIBILITY_PLAN.md`
- `ARBITRAGE_MODULE_SPEC.md`
- `ARBITRAGE_MODULE_CONTRACT.md`
- discovery report JSON or UI
- simulation output
- trade/paper report

---

## 9. Strongest talking points

Pick 3-5, not all 20.

### Recommended top 5

1. **Official-skill compatible direction**
   - We align with Binance’s open skill ecosystem instead of inventing a closed interface.
2. **Strategy layer, not just tool layer**
   - The value is in the decision-making and orchestration.
3. **Simulation before action**
   - We care about post-cost viability, not just raw spread.
4. **Safe operating modes**
   - Paper mode and downgrade paths make demos and operations credible.
5. **Product-ready outputs**
   - We produce explanations, summaries, and operator-friendly decisions.

---

## 10. Demo anti-patterns

Avoid these mistakes.

### Anti-pattern 1 — starting with internal names

Do not open with:

- AlphaOS internals
- old package naming
- backend-first explanation

Start with the product story.

### Anti-pattern 2 — showing too many API calls

Do not spend the demo reading endpoint lists.
The audience should see:

- opportunity
- decision
- result

not 20 request examples.

### Anti-pattern 3 — overpromising live execution

If live is not stable, do not force it.
Paper mode with clear logic is better than a broken live demo.

### Anti-pattern 4 — treating spread as proof

Raw spread is not enough.
Always show why the candidate survives validation and simulation.

---

## 11. Fallback path if live execution is blocked

If execution permissions are missing or unstable, use this fallback:

1. show candidate discovery
2. show enrichment
3. show simulation pass
4. show decision = `paper_trade` or `propose_execution`
5. explain that execution mode downgrades safely under policy

This is still a valid demo.
It actually strengthens the safety story.

---

## 12. Judge Q&A prep

### Q: Why is this more than a trading bot?

A:

> Because the core value is not order placement. The core value is turning ecosystem capabilities into explainable, risk-aware strategy decisions with simulation and operator control.

### Q: Why does Binance Skills compatibility matter?

A:

> It means we’re aligning with an official open ecosystem capability layer instead of building a closed one-off stack. That improves extensibility, explainability, and partner fit.

### Q: Why keep OnchainOS underneath?

A:

> Because it already gives us a working execution backend. We’re preserving proven execution infrastructure while evolving the external product and compatibility model.

### Q: What is the moat here?

A:

> The moat is in orchestration, decision quality, safety gating, simulation-backed execution, and productization — not just API access.

---

## 13. One-sentence close

End with something like:

> We’re taking Binance ecosystem capabilities and turning them into a strategy product that can discover, validate, simulate, and act — not just query and display.

---

## 14. One-sentence summary

**The best arbitrage demo is a short, high-confidence story that starts with a real candidate, proves decision quality through enrichment and simulation, and ends with a structured product-ready output rather than a raw backend trace.**
