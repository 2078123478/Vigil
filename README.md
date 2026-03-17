# Personal Butler

Personal Butler is a skill-oriented autonomous agent framework for building private, wallet-native, chain-aware AI assistants.

It combines three layers in one project:

- **Agent identity & communication** — agents own wallets, exchange signed contact cards, and communicate through consent-gated encrypted messages.
- **Composable skill runtime** — capabilities are organized as skills with clear boundaries and reusable infrastructure.
- **On-chain execution workflows** — market discovery, strategy evaluation, simulation, and execution can be connected into a production-style loop.

**Positioning:** built to evolve toward **BNB Chain-friendly agent infrastructure**, while preserving the full working codebase and battle-tested flows from the original project baseline.

> Transitional note: some internal module names still reference **AlphaOS** or **OnchainOS**. This repository keeps the current implementation intact first, then refactors naming and chain defaults in later phases.

---

## Why this repo exists

This repository is the next-stage evolution of the original submitted project.

The goal is **not** to discard the existing work. The goal is to keep the full system, preserve the proven architecture, and rebuild the project narrative so people can understand the value in seconds:

- a **private AI agent** should have its own identity
- an agent should be able to **form trusted connections** with other agents
- agent communication should be **verifiable, encrypted, and chain-aware**
- useful agents need a **real execution layer**, not just chat

That is the core idea behind **Personal Butler**.

---

## Core Capabilities

### 1. Agent-Comm — wallet-native agent communication

Agent-Comm is the protocol core of this repository.

- **Wallet = identity**
- **Signed contact cards** for portable introductions
- **Consent-gated trust** before business commands are accepted
- **ECDH + AES-256-GCM** encrypted payloads
- **On-chain transport** through calldata inscriptions
- **Chain-agnostic design** for EVM environments

![Agent-Comm Contact Card](docs/assets/agent-comm-card-preview.png)

### 2. Skill-oriented architecture

Capabilities are organized as composable skills:

```text
skills/
├── agent-comm/    # identity, contacts, encrypted agent messaging
├── alphaos/       # strategy/execution engine (current implementation name)
└── discovery/     # opportunity scanning and candidate generation
```

Skills share runtime primitives such as:

- SQLite state storage
- encrypted vault storage
- config and profile management
- CLI + API entrypoints
- operator-facing documentation

### 3. Execution-ready workflow

The project already contains a full execution loop:

```text
scan → evaluate → plan → simulate → execute → record → notify
```

Current implementation highlights:

- paper/live execution modes
- pluggable discovery strategies
- execution probes and health checks
- structured trade recording
- live metrics / demo surface

---

## Why it matters for BNB Chain

The strategic direction of Personal Butler is to become a stronger fit for **BNB Chain agent infrastructure**:

- agents need portable identity, not platform-locked accounts
- multi-agent coordination needs trust and explicit consent
- useful on-chain agents need execution, observability, and operational tooling
- EVM compatibility makes the protocol and runtime portable

Today, the repository still preserves the original implementation baseline and existing execution integration. The next iterations will progressively shift:

- external branding
- documentation and examples
- default network positioning
- BNB Chain-oriented demos and narratives

---

## Quick Start

### Agent identity + communication

```bash
# Initialize agent identity
VAULT_MASTER_PASSWORD=pass123 npx tsx src/index.ts agent-comm:wallet:init

# Export a shareable HTML contact card with QR code
VAULT_MASTER_PASSWORD=pass123 npx tsx src/index.ts agent-comm:card:export --html --output ./my-card.html

# Import a peer's card (file, JSON, or agentcomm:// share URL)
npx tsx src/index.ts agent-comm:card:import ./peer-card.json

# Request connection → peer approves → mutual trust
VAULT_MASTER_PASSWORD=pass123 npx tsx src/index.ts agent-comm:connect:invite <contactId>

# Send encrypted command to a trusted peer
VAULT_MASTER_PASSWORD=pass123 npx tsx src/index.ts agent-comm:send ping contact:<contactId> --echo hello
```

### Run the current execution stack

```bash
cp .env.example .env
npm install
npm run dev
```

Demo scripts:

```bash
npm run demo:run            # full arbitrage cycle demo
npm run demo:discovery      # discovery engine demo
npm run demo:smoke:live     # current live-integration smoke test
```

---

## Current Command Surface

### Agent-Comm commands

| Command | Purpose |
|---------|---------|
| `ping` | Liveness check |
| `probe_onchainos` | Query peer execution readiness (current command name) |
| `start_discovery` | Request opportunity scanning |
| `request_mode_change` | Request paper↔live switch |

Full CLI reference:

```bash
npx tsx src/index.ts agent-comm:help
```

---

## Project Structure

```text
src/
├── index.ts                    # CLI entrypoint
├── skills/
│   ├── alphaos/                # current execution engine modules
│   └── ...
skills/
├── agent-comm/                 # protocol skill definition
├── alphaos/                    # execution/runtime skill definition
└── discovery/                  # discovery skill definition

docs/                           # protocol, operations, design, and migration docs
```

---

## Documentation

Start here:

- [Documentation Index](docs/README.md)
- [BNB Chain One Pager](docs/BNBCHAIN_ONE_PAGER.md)
- [BNB Skills Compatibility Plan](docs/BNB_SKILLS_COMPATIBILITY_PLAN.md)
- [Arbitrage Module Spec v0](docs/ARBITRAGE_MODULE_SPEC.md)
- [Arbitrage Module Tasks](docs/ARBITRAGE_MODULE_TASKS.md)
- [Arbitrage Module Contract](docs/ARBITRAGE_MODULE_CONTRACT.md)
- [Arbitrage Skill Mapping](docs/ARBITRAGE_SKILL_MAPPING.md)
- [Arbitrage Demo Script](docs/ARBITRAGE_DEMO_SCRIPT.md)
- [Personal Butler Agent-Comm One Pager](docs/AGENT_COMM_ONE_PAGER.md)
- [Agent-Comm V2 Design](docs/AGENT_COMM_V2_DESIGN.md)
- [Production Deployment Guide](docs/AGENT_COMM_PRODUCTION_DEPLOYMENT.md)
- [Personal Butler Operations Guide](docs/ALPHAOS_OPERATIONS.md)

---

## API Overview

### Agent-Comm

```text
GET  /api/v1/agent-comm/status
GET  /api/v1/agent-comm/contacts
GET  /api/v1/agent-comm/messages
POST /api/v1/agent-comm/cards/export
POST /api/v1/agent-comm/cards/import
POST /api/v1/agent-comm/connections/invite
POST /api/v1/agent-comm/connections/:contactId/accept
POST /api/v1/agent-comm/connections/:contactId/reject
POST /api/v1/agent-comm/send/ping
POST /api/v1/agent-comm/send/start-discovery
```

### Engine

```text
GET  /api/v1/metrics/today
POST /api/v1/engine/mode
GET  /api/v1/opportunities
GET  /api/v1/trades
GET  /api/v1/strategies/status
```

### Discovery

```text
POST /api/v1/discovery/sessions/start
GET  /api/v1/discovery/sessions/:id/report
POST /api/v1/discovery/sessions/:id/approve
```

### Growth & Observability

```text
GET  /api/v1/growth/share/latest
GET  /api/v1/growth/moments
GET  /api/v1/stream/metrics          (SSE)
GET  /api/v1/backtest/snapshot
POST /api/v1/replay/sandbox
GET  /demo                           (live dashboard)
```

---

## What stays the same in this phase

This phase is intentionally conservative.

We are **not** yet doing a risky full rename of:

- internal class names
- API path names
- command names
- skill folder names

That comes later. This phase focuses on:

- repository positioning
- top-level story
- first-impression clarity
- migration direction

---

## License

[Business Source License 1.1](LICENSE) — source available, commercial use requires authorization. Converts to Apache 2.0 on 2030-03-11.
