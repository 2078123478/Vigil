# Personal Butler Documentation Index

This index is the fastest way to understand what Personal Butler already has today, what remains transitional from the original codebase, and where to go next.

## Start Here

If you only have a few minutes, read in this order:

1. [BNB Chain One Pager](BNBCHAIN_ONE_PAGER.md) — fastest ecosystem-facing overview.
2. [Personal Butler Agent-Comm One Pager](AGENT_COMM_ONE_PAGER.md) — shortest path to the trust and communication layer.
3. [Agent-Comm V2 Design](AGENT_COMM_V2_DESIGN.md) — implementation-oriented protocol design.
4. [Personal Butler Operations Guide](ALPHAOS_OPERATIONS.md) — current operator runbook for the execution stack.
5. [Production Deployment Guide](AGENT_COMM_PRODUCTION_DEPLOYMENT.md) — battle-tested deployment flow.

---

## Reading Map by Goal

### I want to understand the product quickly

- [BNB Chain One Pager](BNBCHAIN_ONE_PAGER.md)
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
2. [Personal Butler Agent-Comm One Pager](AGENT_COMM_ONE_PAGER.md)
3. [Judge One-Pager](JUDGE_ONE_PAGER.md)
4. [Agent-Comm V2 Design](AGENT_COMM_V2_DESIGN.md)

### Path B — protocol engineer

Read:

1. [Agent-Comm V2 Design](AGENT_COMM_V2_DESIGN.md)
2. [Artifact Contracts](AGENT_COMM_V2_ARTIFACT_CONTRACTS.md)
3. [Card Packaging](AGENT_COMM_V2_CARD_PACKAGING.md)
4. [Protocol V2 Draft](AGENT_COMM_PROTOCOL_V2_DRAFT.md)

### Path C — operator / builder

Read:

1. [Personal Butler Operations Guide](ALPHAOS_OPERATIONS.md)
2. [Agent-Comm V2 Operations](AGENT_COMM_V2_OPERATIONS.md)
3. [Production Deployment Guide](AGENT_COMM_PRODUCTION_DEPLOYMENT.md)
4. [OpenClaw Discovery Playbook](OPENCLAW_DISCOVERY_PLAYBOOK.md)

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
