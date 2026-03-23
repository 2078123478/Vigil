# Agent-Comm v2 Operations

Status: current default operator/developer guide  
Updated: 2026-03-08

This guide describes the product-default Agent-Comm v2 flow in this repo:

1. initialize LIW/ACW wallets
2. export/import signed contact cards
3. establish trust with `connection_invite` / `connection_accept`
4. send business commands after trust exists

Reference contracts:
- Protocol overview: `docs/AGENT_COMM_EXPLAINED.md`
- Operations: this document

## Roles

### LIW
- long-lived identity wallet
- signs reusable contact artifacts
- should change rarely
- is the durable identity anchor for remote contacts

### ACW
- active comm wallet
- sends and receives direct-tx traffic
- can rotate on a shorter cadence than LIW
- is bound back to LIW by a signed `TransportBinding`

### Temporary demo wallet
- local-only/demo helper
- must not replace the LIW/ACW pair silently
- exists for controlled demos or throwaway testing

## Default CLI flow

### 1. Initialize the local identity

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:wallet:init
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:identity
```

Fresh installs create distinct LIW + ACW roles by default. Existing single-wallet installs are preserved as temporary dual-use state until the operator rotates.

### 2. Export a signed contact card bundle

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:card:export \
  --display-name "Agent A" \
  --capability-profile research-collab \
  --capabilities ping,start_discovery \
  --output ./agent-a.card.json
```

The response includes:
- `bundle`
- `contactCardDigest`
- `transportBindingDigest`
- `shareUrl`

`shareUrl` is the canonical text payload for QR or short-link wrapping.

### 3. Import the remote card

Any of these inputs work:

```bash
npm run dev -- agent-comm:card:import ./agent-b.card.json
npm run dev -- agent-comm:card:import '{"bundleVersion":1,...}'
npm run dev -- agent-comm:card:import 'agentcomm://card?v=1&bundle=<base64url>'
```

The import response tells you:
- whether verification succeeded
- the `contactId`
- the imported `identityWallet`
- the active transport address
- digest + fingerprint summaries

### 4. Inspect contacts

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:contacts:list
```

Look for:
- `contactId`
- `status`
- `supportedProtocols`
- `currentTransportAddress`
- `pendingInvites`
- legacy markers when a contact came from old v1 state

### 5. Establish trust

Sender:

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:connect:invite <contactId>
```

Receiver:

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:connect:accept <contactId>
```

Optional flags:
- `--attach-inline-card` to include the latest signed bundle inline
- `--requested-profile` / `--requested-capabilities` on invite
- `--capability-profile` / `--capabilities` on accept

Once accepted, the sender can use the existing business send surface with either:
- `contact:<contactId>`
- a compatible `legacyPeerId` if the contact advertises one

### 6. Send trusted business commands

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:send ping contact:<contactId> --echo hello
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:send start_discovery contact:<contactId> --strategy-id spread-threshold
```

The CLI stays backward compatible, but new contact-first onboarding no longer requires creating a manual `agent_peers` record before trusted v2 sends.

## HTTP flow

### Export/import cards

```bash
curl -X POST http://127.0.0.1:3000/api/v1/agent-comm/cards/export \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Agent A","capabilityProfile":"research-collab","capabilities":["ping","start_discovery"]}'

curl -X POST http://127.0.0.1:3000/api/v1/agent-comm/cards/import \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"bundle": {"bundleVersion":1,...}}'
```

### Invite/accept

```bash
curl -X POST http://127.0.0.1:3000/api/v1/agent-comm/connections/invite \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"contactId":"<contactId>","requestedProfile":"research-collab","requestedCapabilities":["ping","start_discovery"]}'

curl -X POST http://127.0.0.1:3000/api/v1/agent-comm/connections/<contactId>/accept \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"capabilityProfile":"research-collab","capabilities":["ping","start_discovery"]}'
```

### Trusted business send

```bash
curl -X POST http://127.0.0.1:3000/api/v1/agent-comm/send/ping \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"peerId":"contact:<contactId>","echo":"hello"}'
```

`peerId` is kept for backward compatibility, but it now accepts `contact:<contactId>` in addition to legacy peer aliases.

## Recommended capability templates

These templates are guidance, not hard-enforced registry entries.

| Profile | Intended use | Suggested capabilities |
|---|---|---|
| `research-collab` | collaborative discovery and ping-based health checks | `ping`, `start_discovery` |
| `ping-only` | smoke tests or narrow liveness checks | `ping` |

## Migration behavior

### Existing single-wallet installs
- startup preserves the historical wallet as temporary LIW + ACW dual-use state
- no trust relationships are dropped during upgrade
- rotating the ACW moves the runtime to the intended split without forcing immediate churn

### Existing `agent_peers`
- startup backfills them into v2 contact-oriented storage
- legacy/manual peer records keep working
- contact surfaces show legacy markers so operators can distinguish migrated/manual records from card-based v2 contacts

## Legacy fallback behavior

### What still works
- `agent-comm:peer:trust`
- `POST /api/v1/agent-comm/peers/trusted`
- v1 envelope receive paths
- v2 senders falling back to v1 when the trusted contact only supports `agent-comm/1`

### What changed
- manual peer creation now returns an explicit warning that it is a legacy/manual v1 fallback path
- `GET /api/v1/agent-comm/status` includes `legacyUsage` counts and thresholds so operators can see whether legacy onboarding is still common
- new trusted v2 contacts can use `agent-comm:send ... contact:<contactId>` without first creating a manual peer row

### Important limitation
A true v1 receiver still depends on the old trusted-peer trust path for business commands. v2 compatibility does not remove that legacy receiver requirement.

## Wallet rotation and recovery

Rotate the active comm wallet:

```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:wallet:rotate \
  --grace-period-hours 48 \
  --display-name "Agent A" \
  --capability-profile research-collab \
  --capabilities ping,start_discovery
```

Rotation does three important things:
- archives the previous ACW in the vault
- keeps the old receive key active for a bounded grace window
- exports a fresh signed card/binding set for the new ACW

Recommended recovery posture:
- back up LIW and ACW secrets separately
- treat the archived ACW alias as temporary recovery material, not the new default wallet
- re-export the card after rotation and redistribute it to contacts
- verify that contacts import the new bundle or receive it inline during the next connection control-plane update

## Troubleshooting runbook

| Symptom | Likely cause | Action |
|---|---|---|
| `missing_inline_card` on an unknown v2 invite | sender did not attach a card and receiver had no prior contact | resend invite with `--attach-inline-card` or import the card first |
| binding verification or `tx.from` mismatch | sender rotated transport without distributing the new binding | export/import a fresh bundle or send a control-plane update with inline card |
| `Contact is not trusted` on business send | invite/accept flow is incomplete | finish `connect:invite` / `connect:accept` first |
| business send falls back to v1 unexpectedly | remote contact only advertises `agent-comm/1` or local state is legacy-only | inspect `supportedProtocols` in `agent-comm:contacts:list` |
| direct-tx send fails with insufficient balance | ACW has no gas token | fund the active comm wallet or restore a funded key |
| old receiver still rejects business commands | remote side is relying on legacy trusted-peer checks | keep the compatible manual peer record on the true v1 side until it upgrades |

## Environment Variables Reference

| Variable | Type | Default | Description |
|---|---|---|---|
| `COMM_ENABLED` | bool | `false` | Enables Agent-Comm runtime surfaces and listeners. |
| `COMM_CHAIN_ID` | int | `196` | Target EVM chain ID for message submission/listening. |
| `COMM_RPC_URL` | string | required when enabled | RPC endpoint used for chain reads/writes. |
| `COMM_LISTENER_MODE` | `poll` \| `disabled` | `disabled` | Listener mode for inbound message processing. |
| `COMM_POLL_INTERVAL_MS` | int | `5000` | Poll interval in milliseconds when listener mode is `poll`. |
| `COMM_WALLET_ALIAS` | string | `"agent-comm"` | Vault alias for the active comm wallet. |
| `COMM_SUBMIT_MODE` | `direct` \| `relay` | `direct` | Outbound submission path. |
| `COMM_RELAY_URL` | string | optional | Relay endpoint when submit mode is `relay`. |
| `COMM_RELAY_TIMEOUT_MS` | int | `10000` | Timeout for relay submission HTTP calls. |
| `COMM_PAYMASTER_URL` | string | optional | Paymaster endpoint for sponsored transactions. |
| `COMM_WEBHOOK_URL` | string | optional | HTTP endpoint to `POST` when an inbound message is processed. |
| `COMM_WEBHOOK_TOKEN` | string | optional | Bearer token used for webhook authorization. |
| `COMM_AUTO_ACCEPT_INVITES` | bool | `false` | Auto-accepts valid inbound connection invites. |
| `COMM_ARTIFACT_EXPIRY_WARNING_DAYS` | int | `7` | Warning threshold (days) before artifact expiry. |
| `AGENT_COMM_PRIVATE_KEY` | hex string | optional | Imports/restores an existing comm wallet private key. |
| `VAULT_MASTER_PASSWORD` | string | required for wallet operations | Vault unlock secret for wallet initialization, rotation, and key access. |

## Webhook Integration

Agent-Comm supports an optional fire-and-forget webhook POST for each inbound message after local processing. This enables immediate wake-up signals to external orchestrators without changing on-chain message flow.

Payload format:

```json
{"text":"[agent-comm] Inbound <type> from <address> (tx: <hash>...)","mode":"now"}
```

For integration details, see `docs/AGENT_COMM_EXPLAINED.md`.

## Performance Notes

- Batch RPC transport is enabled via viem HTTP batching (zero extra config).
- Chain ID verification is cached and checked once per runtime path instead of per poll cycle.
- Unified receipts mode uses `eth_getBlockReceipts` for all blocks, with automatic fallback to full-scan logic when unavailable.
- Polling tuning: keep `COMM_POLL_INTERVAL_MS=5000` as default for balanced latency/load; reduce to `1000-3000` for faster reaction if your RPC can sustain higher request rates.

## Related files
- Demo walkthrough: `scripts/agent-comm-demo.sh`
- Demo notes: `scripts/agent-comm-demo.md`
- Protocol overview: `docs/AGENT_COMM_EXPLAINED.md`
