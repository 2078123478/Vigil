# Personal Butler Agent-Comm — One Pager

**Agent-Comm is the trust and communication layer inside Personal Butler**.

It is a contact-first, wallet-native, chain-aware protocol for autonomous agents.

The idea is simple:

> if Personal Butler is the broader agent framework, then Agent-Comm is the part that gives agents portable identity, explicit trust, and encrypted coordination.

It is built for real operators: you can share a public contact card, require explicit approval before trust is granted, and optionally wake an orchestrator when inbound work completes.

---

## TL;DR

- **Shareable onboarding:** publish a signed **contact card** (JSON or a human-friendly HTML card with QR).
- **Explicit consent gate:** importing a card does **not** auto-trust. The receiver **requests** a connection; the owner **approves / rejects**.
- **Private coordination:** approved peers exchange encrypted payloads instead of relying on platform-locked bot accounts.
- **Operationally simple:** no servers, no brokers. Polling + receipts optimization keeps overhead low across EVM chains.

---

## Why this matters inside Personal Butler

Many AI agent projects stop at chat, prompts, or orchestration.

Personal Butler is trying to build something more practical:

- private AI agents with wallet-backed identity
- trusted agent-to-agent coordination
- reusable skill runtime
- execution-capable workflows

**Agent-Comm is the layer that makes those agents socially and cryptographically real.**

Without it, an agent is often just a process with a name.
With it, an agent can:

1. introduce itself with a portable identity
2. establish trust explicitly
3. accept business commands only from approved peers
4. coordinate across apps, operators, and chains

---

## The Core Idea

Most “agent communication” stacks assume infrastructure first:

- hosts
- ports
- brokers
- app accounts
- centralized routing assumptions

Agent-Comm flips the model:

1. **Identity** is a wallet (unforgeable anchor)
2. **Onboarding** is a signed contact card (copy / paste or QR)
3. **Trust** is explicit (approve / reject)
4. **Messages** are end-to-end encrypted payloads carried by on-chain transactions

You get **global reach**, **cryptographic identity**, and **auditability**, while preserving payload privacy.

---

## A Human-Friendly Flow (Publish → Request → Approve)

**Publish (owner):** export a shareable contact card and post it anywhere.

**Request (peer):** import the card and send a connection request.

**Approve (owner):** accept / reject the request. Only approved contacts can send business commands.

This lets you safely share a card publicly (community, socials, partner channels) without opening an inbox to spam.

---

## Shareable Contact Card (HTML + QR)

Agent-Comm uses a canonical `shareUrl`:

```text
agentcomm://card?v=1&bundle=<base64url(bundle-json)>
```

For distribution, you can export a **self-contained HTML card** with QR + copy button. It works offline and embeds the canonical share URL.

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:card:export --html --output ./my-card.html
```

Preview:

![Agent-Comm shareable contact card preview](assets/agent-comm-card-preview.png)

This is one of the most important outward-facing ideas in the repo:

**agent onboarding should feel shareable and human-friendly, not like infrastructure paperwork.**

---

## Wake on Inbound Work (Optional)

When an inbound message is successfully executed, Agent-Comm can **fire-and-forget** a webhook.

This is useful for orchestrators such as OpenClaw or similar supervisors:

- wake a supervising agent
- post a system event
- trigger a follow-up workflow

Example config:

```bash
COMM_WEBHOOK_URL=http://127.0.0.1:18789/hooks/wake
COMM_WEBHOOK_TOKEN=your-webhook-secret
```

Payload shape:

```json
{ "text": "[agent-comm] Inbound ping from ...", "mode": "now" }
```

---

## Quick Start (Operator)

1) Enable agent-comm + RPC:

```bash
COMM_ENABLED=true
COMM_RPC_URL=https://your-rpc
COMM_CHAIN_ID=196
COMM_LISTENER_MODE=poll
COMM_WALLET_ALIAS=agent-comm
```

2) Initialize the wallet:

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:wallet:init
```

3) Export and publish your card:

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:card:export --html --output ./my-card.html
```

4) Peer imports the card:

```bash
npm run dev -- agent-comm:card:import ./my-card.json
# or: npm run dev -- agent-comm:card:import 'agentcomm://card?v=1&bundle=...'
```

5) Peer requests a connection; owner approves:

```bash
# requester
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:connect:invite <contactId>

# owner
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:connect:accept <contactId>
# or reject
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:connect:reject <contactId>
```

---

## Why this can matter for BNB Chain

BNB Chain-friendly agent infrastructure needs more than chat wrappers.

It needs a credible answer to:

- how agents identify themselves
- how agents connect safely
- how trust is granted
- how coordination stays private but auditable
- how workflows stay portable across EVM environments

Agent-Comm contributes exactly to that layer.

It is not the entire Personal Butler story, but it is one of the strongest reasons the project can evolve into **real agent infrastructure instead of a one-off agent demo**.

---

## For Developers (Short)

- **Chain-agnostic:** no smart contracts required; works across EVM chains by configuration.
- **KISS performance:** polling is optimized; catch-up uses receipts when available.
- **Extensible commands:** add new business commands without changing the core transport.
- **Composable role:** works as the trust / coordination layer under a broader agent framework.

Key docs:
- Operations: `AGENT_COMM_V2_OPERATIONS.md`
- Production deployment: `AGENT_COMM_PRODUCTION_DEPLOYMENT.md`
- Card packaging: `AGENT_COMM_V2_CARD_PACKAGING.md`
- Why it matters: `AGENT_COMM_REVOLUTIONARY_DESIGN.md`
