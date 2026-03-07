# Agent-Comm v2 Design

Status: Design baseline  
Date: 2026-03-07  
Based on: `docs/AGENT_COMM_PROTOCOL_V2_DRAFT.md`  
Canonical artifact contracts: `docs/AGENT_COMM_V2_ARTIFACT_CONTRACTS.md`  
Related: `docs/AGENT_COMM_EXPLAINED.md`, `docs/AGENT_COMM_PRIVACY_AND_TRUST_ANALYSIS.md`, `docs/AGENT_COMM_MIN_REUSE.md`  
Scope: direct-transaction mode on EVM-compatible chains

## 1. Background / Problem Statement

Agent-Comm v1 proves that direct on-chain messaging is workable: a sender can deliver encrypted payloads to a recipient address, the receiver can decrypt them, and trusted peers can trigger business actions such as `ping` and `start_discovery`.

That foundation is useful, but v1 is not yet a product-grade communication model. The current runtime still relies on a manual trust bootstrap:

- peers are registered as `peerId + walletAddress + pubkey`
- `senderPeerId` must match what the receiver stored
- long-lived identity, active transport, and demo flows are easy to mix
- too much message metadata remains visible in plaintext
- the per-message `signature` field is not the right trust primitive

The consequence is that v1 is operable for controlled environments, but fragile for growth, cold-start onboarding, and durable identity continuity.

Agent-Comm v2 keeps the existing direct-transaction transport model and message execution model, but replaces the identity and trust bootstrap with a contact-card and invite design that is simpler for users and more coherent for implementation.

## 2. Goals / Non-Goals

### Goals

- Make first contact feel like importing or adding a contact, not manually exchanging cryptographic fields.
- Reduce plaintext metadata to the minimum required for direct delivery and decryption.
- Define one canonical off-chain signing standard for reusable protocol artifacts.
- Separate durable identity from rotatable transport wallets and from temporary demo wallets.
- Allow explicit inbound `connection_invite` flows without creating a general spam inbox.
- Preserve dual-stack interoperability with existing v1 peers during migration.
- Keep the business-command execution model and current direct-tx transport viable.

### Non-Goals

- Full anonymity or traffic-analysis resistance.
- Relayer networks, mixers, or private-routing infrastructure in core v2.
- A new mandatory smart-contract layer.
- Multiple canonical off-chain signature standards in the core protocol.
- Replacing the current business command set or task-router semantics.

## 3. Scope

### In scope

| Area | Included in v2 |
|---|---|
| Identity | Long-lived identity wallet, active comm wallet, temporary/demo wallet separation |
| Trust | Signed contact cards, transport bindings, invite/accept/reject/confirm flow, capability profiles |
| Transport | Minimal outer envelope, encrypted command body, direct-tx send/listen path |
| Compatibility | v1/v2 dual-stack parsing and negotiated send version |
| Persistence | Contact-centric storage, signed artifact storage, message model updates |
| Product surface | CLI/API/UX changes needed to make v2 usable as the default path |

### Out of scope

- hiding `tx.from`, `tx.to`, tx hash, block time, gas usage, or the transaction graph itself
- non-EVM transports
- a generalized cold-inbound business inbox
- richer privacy adapters in the first v2 core release

### What remains unchanged from v1

- The chain transaction remains the transport unit.
- `tx.to` remains the authoritative recipient address.
- Payload confidentiality still relies on ECDH-derived symmetric encryption.
- The business command router remains capability-gated after decryption.
- Existing listener/send loop concepts, vault-backed wallet storage, and message history remain relevant.
- Existing v1 CLI/API send paths remain available during migration.

## 4. Architecture Overview

v2 is an additive redesign. It does not replace the current transport runtime. It adds clear identity and trust layers above it and narrows what appears in the plaintext envelope.

| Layer | Owns | Must not own |
|---|---|---|
| Identity | long-lived identity wallet, contact cards, transport bindings, revocations | message polling, business routing |
| Trust | contact states, invite handling, capability profiles, blocklists | calldata encoding, low-level decryption |
| Transport | envelope encoding, tx send/listen, key selection, decrypt/replay checks | display naming, trust UX policy |
| Runtime | command validation, capability checks, execution, receipts/status | identity issuance |
| UX / Product | card sharing/import, contact list, one-tap accept flow, status presentation | cryptographic policy internals |

### End-to-end flow summary

#### Contact establishment

1. A sender exports a signed contact card.
2. A receiver imports the card or receives it inline with an inbound `connection_invite`.
3. The receiver verifies the `EIP-712` proof, expiry, and advertised transport data.
4. The receiver creates or updates a local contact record in `imported` or `pending_inbound`.
5. Accepting the invite moves the contact to `trusted` and stores the agreed capability profile.

#### Trusted business messaging

1. The sender resolves a trusted contact to its active transport endpoint.
2. The sender encrypts the command body and sends a direct chain transaction to the contact's receive address.
3. The receiver validates `tx.to`, parses the v2 envelope, decrypts the body, verifies sender continuity against stored identity/binding material, checks capabilities, and routes the command.

## 5. Identity Model

### 5.1 Wallet roles

| Wallet type | Purpose | Lifetime | Trust role |
|---|---|---|---|
| Long-lived Identity Wallet (LIW) | Signs reusable identity artifacts and anchors continuity | months to years | canonical identity |
| Active Comm Wallet (ACW) | Sends/receives direct-tx Agent-Comm messages and pays gas | weeks to months, rotatable | active transport endpoint |
| Temporary/Demo Wallet | local testing and demo flows only | minutes to days | excluded from production trust by default |

### 5.2 Required invariants

- The LIW is the canonical remote identity key for v2. Local databases may use an internal `contactId`, but remote continuity is anchored to `identityWallet`, not `peerId`.
- The ACW must be bound to the LIW through a signed transport-binding artifact before it is trusted for production messaging.
- Demo wallets must not silently mutate production identity or trust state.
- A wallet with funds or active contacts must never be silently regenerated.
- Local aliases, display names, and handles are UX fields. They are not protocol trust anchors.

### 5.3 Signed artifacts

`EIP-712` is the canonical v2 signature standard for reusable signed artifacts.

| Artifact | Signed by | Purpose |
|---|---|---|
| `ContactCard` | LIW | shareable identity object for import/bootstrap |
| `TransportBinding` | LIW | binds LIW to a specific active comm wallet and key material |
| `RevocationNotice` | LIW | revokes a previously published card or binding |

Recommended `EIP-712` domain:

| Field | Value |
|---|---|
| `name` | `AgentComm` |
| `version` | `2` |
| `chainId` | advertised transport chain |

Notes:

- `verifyingContract` is not required for core v2 artifacts.
- `salt` is optional and should be used only for deliberate environment separation on the same chain.
- `EIP-191` is accepted only for legacy import/migration from v1 material.

### 5.4 Contact card model

The contact card is the primary user-shareable object. It should contain:

- protocol support declaration, including `agent-comm/2`
- `displayName` and optional `handle`
- `identityWallet`
- active transport chain, receive address, public key, and `keyId`
- default capability profile and explicit capability list
- issue and expiry times
- `EIP-712` proof

The card is intended for file, link, or QR sharing. The receiver verifies it locally before any trust is granted.

### 5.5 Transport binding model

A `TransportBinding` is the normalized proof that a given LIW authorizes a specific ACW and receive key. It must bind:

- `identityWallet`
- `chainId`
- `receiveAddress`
- `pubkey`
- `keyId`
- `issuedAt`
- `expiresAt`

The contact card may embed the active transport details for convenience, but the implementation should materialize transport bindings as first-class verified records. That is what makes wallet rotation auditable and reversible.

## 6. Trust / Connection Model

### 6.1 Contact states

| State | Meaning |
|---|---|
| `imported` | card verified locally, but no mutual trust yet |
| `pending_inbound` | inbound invite waiting for accept/reject |
| `pending_outbound` | outbound invite sent, awaiting response |
| `trusted` | business commands may execute within granted capabilities |
| `blocked` | future invites/messages from this sender are ignored |
| `revoked` | previously trusted material is no longer valid |

### 6.2 Trust rules

- Trust attaches to a verified LIW plus an active bound transport endpoint.
- `peerId` is not the canonical identity primitive in v2. It may remain as a local alias or legacy hint only.
- Capability grants are explicit and stored on the trust record.
- Revocation and expiry must be checked on import and on inbound processing where newer signed material is present.

### 6.3 Unknown sender policy

| Inbound type | Unknown sender behavior | Trusted sender behavior |
|---|---|---|
| `connection_invite` | allowed into a rate-limited invite path after decryption and verification | process normally |
| `connection_accept` / `connection_reject` / `connection_confirm` | allowed only if there is a matching pending connection state | process normally |
| business commands | reject by default; may optionally notify as `paid cold inbound`, but never execute before trust exists | process subject to capability checks |

This is the core product policy:

- `connection_invite` is a contact request, not an unsolicited business command.
- Unknown business messages are not a valid way to open execution access.

### 6.4 Why decrypting unknown inbound is still necessary

In v2, `command.type` is encrypted. That is intentional. It reduces metadata leakage, but it means the receiver cannot classify the message until after decrypt.

The receiving runtime therefore needs a narrow pre-trust path:

1. validate `tx.to` and parse the outer envelope
2. decrypt the body using the local receive key
3. inspect `command.type`
4. if it is `connection_invite`, verify the inline or previously imported contact material and enter the invite path
5. if it is any other business command, reject it by default and do not route it to business handlers

This path must be rate-limited and size-limited so that privacy improvements do not create an unbounded DoS surface.

### 6.5 Connection flow

Normal v2 connection flow:

1. Sender shares a contact card.
2. Receiver imports and verifies it, producing a local `imported` contact.
3. Either side sends `connection_invite`.
4. Receiver accepts or rejects the invite.
5. `connection_accept` creates or updates the trust record and final capability profile.
6. `connection_confirm` is optional and only acknowledges readiness.

Protocol capability:

- OpenClaw deployments may auto-accept valid invites by policy.

Implementation recommendation:

- The baseline product flow should implement a lightweight one-tap accept path first.
- Auto-accept should remain a policy-layer optimization, not the only supported behavior.

### 6.6 Capability profiles

v2 should store both:

- a named capability profile such as `research-collab`
- the explicit granted capability list at the moment trust is established

This keeps UX simple while preserving an auditable authorization snapshot.

## 7. Envelope v2 Design

### 7.1 Design principles

- minimize plaintext
- do not duplicate chain-visible routing data
- keep command classification encrypted
- use direct transaction signatures for per-message sender authentication
- use signed off-chain artifacts for reusable trust material

### 7.2 Outer envelope

```json
{
  "version": 2,
  "kex": {
    "suite": "secp256k1-ecdh-aes256gcm-v2",
    "recipientKeyId": "rk_2026_01",
    "ephemeralPubkey": "0x..."
  },
  "ciphertext": "0x..."
}
```

Outer plaintext fields:

| Field | Meaning | Notes |
|---|---|---|
| `version` | parser dispatch | drives v1/v2 decoding |
| `kex.suite` | key-exchange and cipher suite identifier | enables suite migration later |
| `kex.recipientKeyId` | selects recipient receive key | needed for comm-wallet/key rotation |
| `kex.ephemeralPubkey` | sender per-message public key material | replaces long-lived sender pubkey in plaintext |
| `ciphertext` | encrypted body | opaque to observers |

Not present in plaintext:

- `senderPeerId`
- static sender pubkey
- recipient address
- message timestamp
- command descriptor
- payment metadata
- per-message off-chain signature

The recipient address is derived from `tx.to`. It must not be duplicated in the v2 envelope.

### 7.3 Encrypted body

```json
{
  "msgId": "uuid",
  "sentAt": "2026-03-07T12:00:00.000Z",
  "sender": {
    "identityWallet": "0xIdentity...",
    "transportAddress": "0xCommWallet...",
    "cardDigest": "0x..."
  },
  "command": {
    "type": "start_discovery",
    "schemaVersion": 2,
    "payload": {
      "strategyId": "spread-threshold"
    }
  },
  "payment": {
    "asset": "0x...",
    "amount": "1000000"
  },
  "attachments": {
    "inlineCard": null
  }
}
```

Encrypted body fields:

| Field | Meaning | Notes |
|---|---|---|
| `msgId` | replay/idempotency key | replaces plaintext nonce |
| `sentAt` | sender timestamp | encrypted; used for ordering/audit |
| `sender.identityWallet` | canonical remote identity | required for v2 trust checks |
| `sender.transportAddress` | sender active comm wallet | must match `tx.from` |
| `sender.cardDigest` | binds message to known signed material | optional but recommended |
| `command` | command type, schema version, payload | fully encrypted |
| `payment` | optional payment metadata | encrypted by default |
| `attachments.inlineCard` | optional inline contact card | mainly for invite/bootstrap/rotation |

### 7.4 Sender authentication model

Direct-tx v2 uses a split authentication model:

- per-message sender authentication comes from the chain transaction signature and `tx.from`
- reusable trust objects use `EIP-712`

The receiver must verify:

1. `tx.to` matches the local receive address
2. `sender.transportAddress` in the decrypted body matches `tx.from`
3. the sender transport address is authorized by a verified binding from the stated `identityWallet`

There is no second mandatory off-chain signature on every message in core v2.

### 7.5 Replay and deduplication

- Replay checks happen after decrypt using `msgId` plus local dedupe state.
- The database should index by message direction and `msgId`.
- `txHash` remains useful for audit, but must not be the only dedupe key.
- v1-style plaintext nonce handling remains only in the legacy parser.

### 7.6 Example: `connection_invite`

Example encrypted body for an unknown-but-valid inbound invite:

```json
{
  "msgId": "b3f3f089-3d53-4cbf-b32a-8d3cecdf7b17",
  "sentAt": "2026-03-07T12:00:00.000Z",
  "sender": {
    "identityWallet": "0xIdentity...",
    "transportAddress": "0xCommWallet...",
    "cardDigest": "0xabc..."
  },
  "command": {
    "type": "connection_invite",
    "schemaVersion": 2,
    "payload": {
      "requestedProfile": "research-collab",
      "requestedCapabilities": ["ping", "start_discovery", "get_discovery_report"],
      "note": "Open a research collaboration channel"
    }
  },
  "attachments": {
    "inlineCard": {
      "cardVersion": 1,
      "protocols": ["agent-comm/2", "agent-comm/1"],
      "displayName": "Xiaoyin",
      "identityWallet": "0xIdentity..."
    }
  }
}
```

Receiver behavior:

- verify inline card or pre-imported card
- create/update a `pending_inbound` contact
- do not route the message to business handlers

## 8. Data Model / Persistence Implications

### 8.1 Storage direction

v1 storage is centered on `agent_peers` and plaintext-envelope message metadata. v2 should move to a contact-centric model anchored by `identityWallet`, while preserving additive compatibility with existing tables during migration.

The recommended migration shape is additive rather than destructive.

### 8.2 Logical entities

| Entity | Purpose | Key fields |
|---|---|---|
| Local identity profile | stores LIW and active comm-wallet metadata | identity wallet, active binding, wallet aliases, chain ids |
| Contact | stable remote contact record | contact id, identity wallet, handle/display alias, status, supported protocols, capability profile |
| Signed artifact | stores imported/exported card, binding, revocation objects | artifact type, digest, signer, validity window, raw JSON, verification result |
| Transport endpoint | tracks active and historical comm wallets per contact | identity wallet, chain id, receive address, pubkey, key id, binding digest, status |
| Connection event | records invite/accept/reject/confirm transitions | direction, contact id, message id, tx hash, state, timestamps |
| Message | stores v1/v2 inbound/outbound message records | version, msg id or legacy nonce, contact reference, tx hash, command type after decrypt, status |
| Revocation record | tracks superseded or revoked material | digest, revoked at, signer |

### 8.3 Implications for current v1 tables

| Current concept | v2 implication |
|---|---|
| `agent_peers` | becomes a legacy/manual-contact source; the v2 implementation should prefer a richer contact model and either backfill from or wrap this table |
| `agent_messages` | should grow to capture `envelopeVersion`, `msgId`, `identityWallet`, `transportAddress`, trust outcome, and decrypted command type where available |
| `listener_cursors` | unchanged |
| vault-backed comm wallet | remains, but v2 adds LIW and multiple bound comm-wallet records |

### 8.4 Canonical keys

- `identityWallet` is the canonical remote identity key for v2 contacts.
- `receiveAddress` is the canonical active transport locator.
- `peerId` may still be stored for legacy compatibility, but it must not remain the only lookup key.

### 8.5 Persistence rules

- Store raw signed artifacts and their verification outcome, not only extracted fields.
- Keep local display aliasing separate from signed contact-card data.
- Preserve historical transport bindings to make rotation auditable.
- Store both the requested profile and the accepted profile when invite negotiation differs.
- Record reject reasons for unknown business messages and blocked senders for audit and support.

### 8.6 Migration preference

The initial implementation should avoid destructive schema replacement. New tables or columns should be added alongside v1 tables, then the API layer can progressively resolve contacts through the new model.

## 9. API / CLI / UX Surface Implications

### 9.1 Surfaces that should remain stable

These should remain available during migration:

- `agent-comm:wallet:init`
- `agent-comm:identity`
- `agent-comm:send ...`
- `GET /api/v1/agent-comm/status`
- `GET /api/v1/agent-comm/messages`
- existing business send endpoints for trusted peers/contacts

The point is not to break the current runtime while v2 is introduced.

### 9.2 New CLI capabilities

The v2 CLI should add contact-oriented commands:

- `agent-comm:card:export`
- `agent-comm:card:import <file|url>`
- `agent-comm:contacts:list`
- `agent-comm:connect:invite <contactRef>`
- `agent-comm:connect:accept <contactRef>`
- `agent-comm:connect:reject <contactRef>`
- `agent-comm:wallet:rotate`

`agent-comm:peer:trust` should remain as a legacy/manual escape hatch, not the recommended default flow.

### 9.3 New HTTP/API capabilities

Likely v2 additions:

- `GET /api/v1/agent-comm/contacts`
- `POST /api/v1/agent-comm/cards/import`
- `POST /api/v1/agent-comm/cards/export`
- `GET /api/v1/agent-comm/invites`
- `POST /api/v1/agent-comm/connections/invite`
- `POST /api/v1/agent-comm/connections/:contactId/accept`
- `POST /api/v1/agent-comm/connections/:contactId/reject`
- `POST /api/v1/agent-comm/wallets/rotate`

These names are implementation-level proposals, not protocol primitives, but the surface should be contact-first rather than raw-wallet-first.

### 9.4 Example API shape

Importing a card:

```json
{
  "card": {
    "cardVersion": 1,
    "protocols": ["agent-comm/2", "agent-comm/1"],
    "displayName": "Xiaoyin",
    "identityWallet": "0xIdentity..."
  }
}
```

Response:

```json
{
  "contactId": "ct_01H...",
  "identityWallet": "0xIdentity...",
  "status": "imported",
  "supportedProtocols": ["agent-comm/2", "agent-comm/1"],
  "activeTransportAddress": "0xCommWallet..."
}
```

### 9.5 UX implications

The default UX should shift from "register trusted peer" to "add contact":

- share/import contact card by file, link, or QR
- show signer identity and short fingerprint before trust is granted
- show trust state, capability profile, and current transport wallet status
- provide a one-tap accept path for valid inbound invites
- hide raw `walletAddress + pubkey + peerId` entry behind advanced/manual flows

## 10. Backward Compatibility and Migration

### 10.1 Dual-stack rules

- Parse by `envelope.version`.
- Track supported protocol versions per contact.
- Send at the highest mutually supported version.
- Fall back to v1 only when the contact explicitly allows legacy.

### 10.2 Compatibility matrix

| Sender | Receiver | Behavior |
|---|---|---|
| v2 | v2 | full v2 envelope and invite flow |
| v2 | v1-only | use v1 only if the contact allows legacy fallback |
| v1 | v2 | v2 runtime accepts via legacy parser and trust path |
| v1 | v1 | unchanged |

### 10.3 Migration of current trusted peers

Existing v1 trusted peers should migrate as:

- local contact records with `status=trusted`
- `legacyPeerId` retained
- supported protocols initially set to `agent-comm/1` unless upgraded
- existing wallet address and pubkey stored as a legacy transport endpoint

This preserves current operability without pretending those peers already have full v2 identity material.

### 10.4 Migration of the current comm wallet

The current runtime has a single comm wallet. v2 introduces LIW and ACW separation.

Migration bridge:

- if a deployment already has only a v1 comm wallet, that wallet may temporarily serve as both LIW and ACW to avoid breaking live trust relationships
- fresh v2-native installs should create distinct LIW and ACW roles
- later rotation should move the deployment toward the intended split without forcing immediate churn

This is a migration concession, not the ideal steady state.

### 10.5 Legacy signatures

`EIP-191` remains acceptable only in import/migration code for legacy contact material. New v2 artifacts must not be produced in `EIP-191`.

### 10.6 What should not change during migration

- existing v1 message handling for v1 peers
- current business command semantics
- current status/messages inspection surfaces
- the direct-tx transport assumption

## 11. Security / Privacy Considerations

| Concern | Treatment in v2 |
|---|---|
| spoofed contact card | verify `EIP-712`, domain, signer, and expiry before import/trust |
| transport hijack | require a verified LIW-to-transport binding; verify `tx.from` matches the bound transport address |
| replay | dedupe on `msgId` after decrypt; keep tx hash for audit |
| unknown inbound abuse | rate-limit and size-limit the pre-trust decrypt path; only invites survive by default |
| metadata leakage | keep outer envelope minimal and encrypt command/payment metadata |
| payment-based privilege escalation | payment may affect notification policy only; it does not bypass trust or capability gates |
| stale trust material | check expiry and revocation on import and on inbound processing when newer artifacts are present |
| demo-wallet contamination | separate demo wallets from production trust and identity by default |

Privacy boundary:

- v2 improves content and command privacy compared with v1
- v2 does not hide the communication graph formed by `tx.from`, `tx.to`, timing, and gas usage

## 12. Operational Considerations

### 12.1 Key lifecycle

- support active comm-wallet rotation through signed bindings
- keep previous receive keys available for a bounded grace period during rotation
- surface expiry before it causes silent message failures

### 12.2 Runtime limits

- keep strict message-size limits on inbound envelopes
- rate-limit unknown invite traffic and decryption attempts
- bound artifact caching and message retention to avoid unbounded local growth

### 12.3 Observability

The runtime should expose enough signal to answer:

- how many contacts are v1-only vs v2-capable
- how many unknown business messages were rejected
- how many valid invites are pending
- how often decryption or binding verification fails
- how often legacy fallback is still used

### 12.4 Recovery and backup

- LIW and ACW backup procedures must be explicit and separate
- restoring a demo wallet must not restore production trust state by default
- restoring a production runtime must preserve contact state, binding history, and message audit history

### 12.5 Polling and transport operation

- direct-tx mode remains the operational baseline
- poll-based listeners remain acceptable for the initial v2 rollout
- websocket or relayer enhancements are optional future adapters, not core design dependencies

## 13. Rollout Plan

| Phase | Outcome | Exit criteria |
|---|---|---|
| 0. Design freeze | approve this design as the implementation baseline | architecture sign-off |
| 1. Identity artifacts | generate/import/export contact cards and bindings; verify `EIP-712` | signed artifacts round-trip correctly |
| 2. Storage migration | add v2 contact/artifact persistence without breaking v1 | existing installs migrate cleanly |
| 3. Invite control plane | add `connection_*` commands and invite state machine | manual triplet registration is no longer the primary onboarding path |
| 4. Envelope v2 | send/receive minimal-plaintext v2 messages | v2 messaging is stable in dual-stack mode |
| 5. Product default | create new contacts through card/import + invite by default | most new contacts are v2 contacts |
| 6. v1 soft deprecation | keep compatibility but discourage new v1-only setup | legacy-only onboarding becomes exceptional |

### Likely follow-on implementation phases

These should likely become separate task groups after this design:

- `EIP-712` typed-data and verification spec with test vectors
- database migration spec
- API/CLI contract document
- invite UX and QR/link sharing spec
- rotation/revocation handling spec
- integration and interoperability test plan

## 14. Risks / Alternatives Considered

### 14.1 Rejected alternatives

| Alternative | Why it was rejected |
|---|---|
| make both `EIP-712` and `EIP-191` canonical in v2 | creates unnecessary matrix complexity and weaker interoperability guarantees |
| keep v1-style plaintext command descriptors | leaks too much business metadata |
| allow unknown business messages into a normal inbox | creates a spam/execution problem and weakens the trust model |
| add a second off-chain signature to every direct-tx message | duplicates `tx.from` authentication without enough benefit |
| keep `peerId` as the canonical remote identity | preserves the manual, error-prone v1 trust model |
| make relayer/private routing part of core v2 | expands scope and delays a reviewable implementation |

### 14.2 Main risks in the chosen design

- Decrypting unknown inbound to identify invites introduces a bounded DoS surface.
- Wallet-role separation increases product complexity if the UI is careless.
- Dual-stack support can linger too long without explicit deprecation pressure.

Mitigations are rate limits, strong defaults, additive migration, and telemetry on legacy usage.

## 15. Irreversible vs Reversible Decisions

| Decision | Durability | Reason |
|---|---|---|
| `EIP-712` as canonical off-chain artifact signature | hard to reverse | affects every shared artifact and interoperability |
| `identityWallet` as the v2 trust anchor | hard to reverse | shapes persistence, migration, and UX |
| explicit `connection_invite` path with reject-by-default unknown business messages | medium-high | defines core trust semantics |
| minimal outer envelope with encrypted `command.type` | medium-high | changes parser and observability expectations |
| direct-tx privacy scope as the core v2 baseline | medium | adapters can be added later without replacing the core |
| API/CLI naming for contact flows | reversible | surface-level ergonomics, not protocol identity |

## 16. Summary

Agent-Comm v2 should be implemented as a contact-first, identity-grounded upgrade to the current direct-tx runtime.

The key design outcomes are:

- `EIP-712` is the only canonical v2 signature format for reusable off-chain artifacts.
- Contact bootstrap moves from manual trusted-peer triples to verified cards plus explicit invites.
- Unknown business messages are rejected by default, while `connection_invite` gets a narrow explicit path.
- The outer envelope is reduced to the minimum needed for direct delivery and decryption.
- v1 remains supported during migration, but it is no longer the intended default path for new contacts.
