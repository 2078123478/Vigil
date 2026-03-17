# Personal Butler Documentation Index

This index is the fastest way to understand what Personal Butler already has today, what remains transitional from the original codebase, and where to go next.

## Start Here

If you only have a few minutes, read in this order:

1. [BNB Chain One Pager](BNBCHAIN_ONE_PAGER.md) — fastest ecosystem-facing overview.
2. [Champion Agent System](CHAMPION_AGENT_SYSTEM.md) — champion-level blueprint for turning Personal Butler into a living BNB-native assistant.
3. [Champion Demo Story](CHAMPION_DEMO_STORY.md) — judge-facing story, wow moments, and demo strategy for winning the room.
4. [Living Assistant MVP Plan](LIVING_ASSISTANT_MVP_PLAN.md) — concrete implementation plan for Signal Radar, Contact Policy, and Voice Brief.
5. [Living Assistant Demo Runner](LIVING_ASSISTANT_DEMO_RUNNER.md) — 2-minute hands-on command flow for judges.
6. [BNB Skills Compatibility Plan](BNB_SKILLS_COMPATIBILITY_PLAN.md) — the current roadmap for aligning Personal Butler with Binance official open skills.
7. [Arbitrage One Pager](ARBITRAGE_ONE_PAGER.md) — fastest way to understand the flagship strategy module.
8. [Arbitrage Module Spec v0](ARBITRAGE_MODULE_SPEC.md) — the first flagship strategy-module definition for the BN ecosystem direction.
9. [Arbitrage Module Tasks](ARBITRAGE_MODULE_TASKS.md) — staged execution plan for turning the spec into a demoable module path.
10. [Arbitrage Module Contract](ARBITRAGE_MODULE_CONTRACT.md) — product-facing request / candidate / decision / execution contract.
11. [Arbitrage Skill Mapping](ARBITRAGE_SKILL_MAPPING.md) — how the module builds on Binance official open skills and current internal anchors.
12. [Arbitrage Adapter Plan](ARBITRAGE_ADAPTER_PLAN.md) — normalized adapter-layer plan for official-skill integration.
13. [Arbitrage Output Examples](ARBITRAGE_OUTPUT_EXAMPLES.md) — product-facing example payloads for key module outcomes.
14. [Arbitrage Decision Reasons](ARBITRAGE_DECISION_REASONS.md) — normalized reason-code taxonomy for explainable decisions.
15. [Arbitrage Implementation Gap](ARBITRAGE_IMPLEMENTATION_GAP.md) — what already exists vs what still needs layering.
16. [Arbitrage Demo Script](ARBITRAGE_DEMO_SCRIPT.md) — judge-facing walkthrough for presenting the module clearly.
17. [Personal Butler Agent-Comm One Pager](AGENT_COMM_ONE_PAGER.md) — shortest path to the trust and communication layer.
18. [Agent-Comm V2 Design](AGENT_COMM_V2_DESIGN.md) — implementation-oriented protocol design.
19. [Personal Butler Operations Guide](ALPHAOS_OPERATIONS.md) — current operator runbook for the execution stack.
20. [Production Deployment Guide](AGENT_COMM_PRODUCTION_DEPLOYMENT.md) — battle-tested deployment flow.

---

## Reading Map by Goal

### I want to understand the product quickly

- [BNB Chain One Pager](BNBCHAIN_ONE_PAGER.md)
- [Champion Agent System](CHAMPION_AGENT_SYSTEM.md)
- [Champion Demo Story](CHAMPION_DEMO_STORY.md)
- [Living Assistant MVP Plan](LIVING_ASSISTANT_MVP_PLAN.md)
- [BNB Skills Compatibility Plan](BNB_SKILLS_COMPATIBILITY_PLAN.md)
- [Arbitrage One Pager](ARBITRAGE_ONE_PAGER.md)
- [Arbitrage Demo Script](ARBITRAGE_DEMO_SCRIPT.md)
- [Personal Butler Agent-Comm One Pager](AGENT_COMM_ONE_PAGER.md)
- [Judge One-Pager](JUDGE_ONE_PAGER.md)
- [Execution Algorithm](ALGORITHM.md)

### I want the protocol and architecture

- [Agent-Comm V2 Design](AGENT_COMM_V2_DESIGN.md)
- [Revolutionary Design](AGENT_COMM_REVOLUTIONARY_DESIGN.md)
- [Protocol V2 Draft](AGENT_COMM_PROTOCOL_V2_DRAFT.md)
- [Privacy and Trust Analysis](AGENT_COMM_PRIVACY_AND_TRUST_ANALYSIS.md)

### I want implementation-level reference

- [Artifact Contracts](AGENT_COMM_V2_ARTIFACT_CONTRACTS.md)
- [Card Packaging](AGENT_COMM_V2_CARD_PACKAGING.md)
- [Extensions Design](AGENT_COMM_EXTENSIONS_DESIGN.md)
- [Examples](examples/agent-comm/)

### I want to run the current system

- [Personal Butler Operations Guide](ALPHAOS_OPERATIONS.md)
- [Agent-Comm V2 Operations](AGENT_COMM_V2_OPERATIONS.md)
- [Production Deployment Guide](AGENT_COMM_PRODUCTION_DEPLOYMENT.md)
- [OpenClaw Discovery Playbook](OPENCLAW_DISCOVERY_PLAYBOOK.md)

---

## Current Repository Reality

Personal Butler is currently in a **transition phase**.

That means:

- the **repository identity** is now Personal Butler
- the **core protocol** is still Agent-Comm
- parts of the execution/runtime layer still use historical names such as **AlphaOS** and **OnchainOS**

This is intentional for now. The project is preserving a working baseline first, then refactoring naming, defaults, and outward presentation in controlled steps.

---

## Recommended Reading Paths

### Path A — evaluator / judge / investor

Read:

1. [BNB Chain One Pager](BNBCHAIN_ONE_PAGER.md)
2. [Champion Agent System](CHAMPION_AGENT_SYSTEM.md)
3. [Champion Demo Story](CHAMPION_DEMO_STORY.md)
4. [Living Assistant MVP Plan](LIVING_ASSISTANT_MVP_PLAN.md)
5. [Living Assistant Demo Runner](LIVING_ASSISTANT_DEMO_RUNNER.md)
6. [BNB Skills Compatibility Plan](BNB_SKILLS_COMPATIBILITY_PLAN.md)
7. [Arbitrage One Pager](ARBITRAGE_ONE_PAGER.md)
8. [Arbitrage Demo Script](ARBITRAGE_DEMO_SCRIPT.md)
9. [Judge One-Pager](JUDGE_ONE_PAGER.md)

### Path B — protocol engineer

Read:

1. [Agent-Comm V2 Design](AGENT_COMM_V2_DESIGN.md)
2. [Artifact Contracts](AGENT_COMM_V2_ARTIFACT_CONTRACTS.md)
3. [Card Packaging](AGENT_COMM_V2_CARD_PACKAGING.md)
4. [Protocol V2 Draft](AGENT_COMM_PROTOCOL_V2_DRAFT.md)

### Path C — operator / builder

Read:

1. [Arbitrage One Pager](ARBITRAGE_ONE_PAGER.md)
2. [Living Assistant Demo Runner](LIVING_ASSISTANT_DEMO_RUNNER.md)
3. [Arbitrage Module Contract](ARBITRAGE_MODULE_CONTRACT.md)
4. [Arbitrage Skill Mapping](ARBITRAGE_SKILL_MAPPING.md)
5. [Arbitrage Adapter Plan](ARBITRAGE_ADAPTER_PLAN.md)
6. [Arbitrage Output Examples](ARBITRAGE_OUTPUT_EXAMPLES.md)
7. [Arbitrage Decision Reasons](ARBITRAGE_DECISION_REASONS.md)
8. [Arbitrage Implementation Gap](ARBITRAGE_IMPLEMENTATION_GAP.md)
9. [Arbitrage Module Tasks](ARBITRAGE_MODULE_TASKS.md)
10. [Personal Butler Operations Guide](ALPHAOS_OPERATIONS.md)
11. [Agent-Comm V2 Operations](AGENT_COMM_V2_OPERATIONS.md)
12. [Production Deployment Guide](AGENT_COMM_PRODUCTION_DEPLOYMENT.md)
13. [OpenClaw Discovery Playbook](OPENCLAW_DISCOVERY_PLAYBOOK.md)

---

## Legacy / Transitional Material

These documents are still useful, but they reflect earlier naming or historical framing:

- [MIN_REUSE (v1 compat)](AGENT_COMM_MIN_REUSE.md)
- [EXPLAINED (early runtime)](AGENT_COMM_EXPLAINED.md)
- [Judge One-Pager](JUDGE_ONE_PAGER.md)

---

## Documentation Intent Going Forward

The next documentation passes will gradually do three things:

1. reduce dependence on old competition framing
2. make the repo easier to understand from the first screen
3. shift examples and narrative toward BNB Chain-friendly positioning

Until then, this index is the canonical guide for navigating the current repository.
