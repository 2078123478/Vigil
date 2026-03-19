---
name: agent-comm
description: P2P encrypted messaging protocol for autonomous agents over EVM chains. Use when implementing wallet identity, contact card exchange, connection handshake (invite/accept/reject), on-chain message send/receive, peer trust management, or extending the agent-comm protocol with new command types.
---

# Agent-Comm Skill

Contact-first, blockchain-native messaging between autonomous agents. Identity is a wallet, onboarding is a signed contact card, trust is explicit, messages are E2E encrypted on-chain transactions.

## Code Location

All runtime code lives in `src/skills/alphaos/runtime/agent-comm/`. Key files:

- `entrypoints.ts` — all CLI-callable operations (wallet, card, connect, send)
- `runtime.ts` — background listener + inbox processor
- `tx-sender.ts` / `tx-listener.ts` — on-chain send/receive
- `ecdh-crypto.ts` — secp256k1 ECDH + AES-256-GCM encryption
- `card-packaging.ts` — `agentcomm://card?v=1&bundle=<base64url>` share URL codec
- `card-html.ts` — self-contained HTML contact card with QR
- `peer-registry.ts` — trust state machine (imported → pending → trusted → blocked/revoked)
- `artifact-workflow.ts` — EIP-712 typed-data signing for ContactCard/TransportBinding/RevocationNotice
- `local-identity.ts` — multi-profile identity management (liw/acw/temporary_demo)
- `contact-surfaces.ts` — contact list aggregation
- `connection-helpers.ts` — invite/accept/reject flow helpers
- `inbox-processor.ts` — inbound message dispatch + receipt generation
- `task-router.ts` — business command routing (ping, probe, discovery, mode_change)
- `x402-adapter.ts` — paid message gating
- `shadow-wallet.ts` — ephemeral wallet for demo/test
- `types.ts` — all Zod schemas, enums, constants

## CLI Operations

All commands run via `npx tsx src/index.ts <command>`.

### Identity & Wallet

```bash
# Initialize wallet (generates secp256k1 keypair, stores in vault)
agent-comm:wallet:init [--private-key <hex>] [--sender-peer-id <id>]

# Initialize temporary demo wallet (no vault password needed)
agent-comm:wallet:init-demo [--wallet-alias <alias>]

# Rotate wallet (re-signs identity artifacts with new key)
agent-comm:wallet:rotate [--display-name <name>] [--capabilities ping,start_discovery]

# Show current identity
agent-comm:identity [--sender-peer-id <id>]
```

### Contact Cards

```bash
# Export card as JSON (stdout) or HTML file
agent-comm:card:export [--display-name <name>] [--output <file>] [--html]

# Import card from file, raw JSON, or agentcomm:// share URL
agent-comm:card:import <file|raw-json|share-url>
```

Share URL format: `agentcomm://card?v=1&bundle=<base64url(bundle-json)>`

HTML card is self-contained (offline-capable, embedded QR, copy button).

### Connection Handshake

```bash
# Send connection request to a contact
agent-comm:connect:invite <contactRef> [--attach-inline-card] [--note <text>]

# Accept inbound connection request
agent-comm:connect:accept <contactRef> [--attach-inline-card] [--capabilities ping,start_discovery]

# Reject inbound connection request
agent-comm:connect:reject <contactRef> [--reason <text>]
```

Flow: import card → invite → peer accepts → mutual trust established.

### Business Commands

```bash
# Send a command to a trusted peer
agent-comm:send <command> <peerId|contact:contactId> [flags]

# Supported commands:
#   ping                    — liveness check
#   probe_execution         — query peer's execution-backend readiness
#   probe_onchainos         — legacy alias for probe_execution
#   start_discovery         — request peer to run discovery session
#   request_mode_change     — ask peer to switch paper/live mode
```

Command-specific flags:

```bash
# ping
--echo <text> --note <text>

# start_discovery
--strategy-id <spread-threshold|mean-reversion|volatility-breakout>
--pairs ETH/USDC,WBTC/USDC --duration-minutes 30 --top-n 5

# probe_execution (legacy alias: probe_onchainos)
--pair ETH/USDC --notional-usd 100

# request_mode_change
--requested-mode paper|live --reason <text>
```

### Revocation

```bash
# Revoke a signed artifact
agent-comm:artifact:revoke <artifactDigest> --artifact-type ContactCard|TransportBinding

# Import a revocation notice from peer
agent-comm:artifact:import-revocation <file|raw-json>
```

### Contacts List

```bash
agent-comm:contacts:list
```

## Runtime (Background)

`startAgentCommRuntime()` in `runtime.ts` starts:

1. **tx-listener** — polls chain for inbound encrypted transactions (dual-mode: 1 block/3s realtime, `getBlockReceipts` pre-filter for catch-up)
2. **inbox-processor** — decrypts, verifies, routes to task-router
3. **task-router** — dispatches business commands to handlers (discovery engine, alpha engine, etc.)
4. **Optional webhook** — fires on every processed inbound message

## Protocol Details

- Envelope version: v2 (`agent-comm/2`)
- Key exchange: `secp256k1-ecdh-aes256gcm-v2`
- Max message: 16384 bytes
- Artifact signing: EIP-712 typed-data (see `docs/AGENT_COMM_V2_ARTIFACT_CONTRACTS.md`)
- Trust states: `imported → pending_inbound/pending_outbound → trusted → blocked/revoked`

For full protocol spec, see `references/protocol.md`.

## Extension Points

- Add new command types: define in `types.ts` → add handler in `task-router.ts` → add CLI in `index.ts`
- Add transport backends: implement alongside `tx-sender.ts` / `tx-listener.ts`
- Custom trust policies: modify `peer-registry.ts` state machine
- x402 paid messaging: configure in `x402-adapter.ts`
