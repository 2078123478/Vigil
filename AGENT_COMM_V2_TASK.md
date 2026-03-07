# Agent-Comm v2 Implementation Task Breakdown

Status: execution plan  
Date: 2026-03-07  
Design baseline: `docs/AGENT_COMM_PROTOCOL_V2_DRAFT.md`, `docs/AGENT_COMM_V2_DESIGN.md`  
Canonical artifact contracts: `docs/AGENT_COMM_V2_ARTIFACT_CONTRACTS.md`  
Related context: `docs/AGENT_COMM_EXPLAINED.md`, `docs/AGENT_COMM_PRIVACY_AND_TRUST_ANALYSIS.md`, `README.md`

## Purpose

This document turns the approved Agent-Comm v2 design into an implementation-ready task plan.

It is intentionally:

- implementation-oriented
- additive over the current v1 runtime
- phased with explicit dependencies
- checkable later during execution

## Current baseline

Current runtime shape in this repo:

- v1 envelope is defined in `src/skills/alphaos/runtime/agent-comm/types.ts` and `src/skills/alphaos/runtime/agent-comm/calldata-codec.ts`
- inbound trust is peer-centric in `src/skills/alphaos/runtime/agent-comm/inbox-processor.ts`
- outbound send path is peer-centric in `src/skills/alphaos/runtime/agent-comm/entrypoints.ts` and `src/skills/alphaos/runtime/agent-comm/tx-sender.ts`
- persistence is still centered on `agent_peers` and `agent_messages` in `src/skills/alphaos/runtime/state-store.ts`
- CLI is still `wallet:init`, `identity`, `peer:trust`, `send ...` in `src/index.ts`
- HTTP surface is still `/api/v1/agent-comm/peers*`, `/messages`, `/send/*` in `src/skills/alphaos/api/server.ts`

That means v2 should be delivered as a layered upgrade, not a rewrite.

## Delivery rules

- `[Core]` means required for MVP / first usable v2 rollout.
- `[Optional]` means valid follow-on work after core v2 is operating.
- Phases are ordered; do not start later phases as the mainline until upstream dependencies are in place.
- Migration must stay additive. Do not destructively replace v1 tables, routes, or runtime paths during initial rollout.

## Phase dependency map

| Phase | Depends on | Why |
|---|---|---|
| 0. Implementation freeze | none | lock remaining decisions and implementation contracts |
| 1. Identity artifacts | 0 | card/binding format and wallet-role rules must be stable first |
| 2. Persistence migration | 1 | storage has to model identity/contact artifacts before trust flows build on it |
| 3. Trust and invite control plane | 1, 2 | contact import, state machine, and invite UX need verified identity plus storage |
| 4. Envelope v2 and dual-stack runtime | 2, 3 | transport upgrade should sit on the new contact/trust model |
| 5. Migration and default-surface switch | 3, 4 | change defaults only after control plane and transport both work |
| 6. Validation, docs, examples | 1-5 | final confidence and operator guidance |

## MVP cut line

Core v2 is considered usable when all `[Core]` items in Phases 0 through 5 are complete, plus the Phase 6 `[Core]` validation/documentation work.

All `[Optional]` items are explicitly out of the MVP critical path.

## Phase 0. Implementation Freeze

Goal: turn the design into stable implementation contracts before schema and runtime work starts.

Exit criteria:

- remaining policy decisions are explicit
- object shapes and migration guardrails are written down and testable

Tasks:

- [ ] `[Core]` Confirm the two remaining policy defaults from the draft:
  - valid inbound `connection_invite` default behavior: `auto-accept` vs lightweight accept flow
  - initial `coldInboundNotifyThreshold` rule and asset normalization strategy
- [ ] `[Core]` Freeze the canonical `EIP-712` typed-data definitions for:
  - `ContactCard`
  - `TransportBinding`
  - `RevocationNotice`
- [ ] `[Core]` Define how artifact digests and short fingerprints are computed so CLI/API/UI all show the same identity proof summary.
- [ ] `[Core]` Freeze the v2 envelope/body field contract:
  - outer plaintext stays `version + kex + ciphertext`
  - `command.type` stays encrypted
  - `tx.to` remains authoritative recipient routing
  - no per-message off-chain signature is added back
- [ ] `[Core]` Freeze migration rules:
  - additive schema only
  - v1 parser remains live
  - `agent-comm:peer:trust` remains available as legacy/manual fallback
  - existing single-wallet installs may temporarily act as LIW + ACW
- [ ] `[Optional]` Define a shareable card packaging convention for URL/QR export so later UX work does not invent ad hoc encodings.

Likely touchpoints:

- new v2 protocol notes under `docs/`
- `src/skills/alphaos/runtime/agent-comm/types.ts`
- new artifact helper module(s) under `src/skills/alphaos/runtime/agent-comm/`

## Phase 1. Identity Artifacts and Wallet Roles

Goal: establish LIW/ACW concepts and verifiable v2 identity artifacts before contact flows are built.

Exit criteria:

- contact cards can be issued, exported, imported, and verified locally
- active comm wallet binding is explicit and verifiable

Tasks:

- [x] `[Core]` Introduce a local identity profile model that separates:
  - Long-lived Identity Wallet (LIW)
  - Active Comm Wallet (ACW)
  - Temporary/Demo wallet
- [ ] `[Core]` Extend vault/runtime initialization so fresh v2 installs can create distinct LIW and ACW roles without breaking current `agent-comm:wallet:init`.
- [x] `[Core]` Add the migration bridge for existing installs:
  - detect existing single comm wallet
  - represent it as temporary LIW + ACW dual-use state
  - avoid forced address churn during upgrade
- [x] `[Core]` Implement `EIP-712` sign/verify utilities for `ContactCard` and `TransportBinding`.
- [x] `[Core]` Implement artifact normalization helpers:
  - digest computation
  - expiry validation
  - signer/domain verification
  - protocol support parsing
- [x] `[Core]` Implement contact-card export service that emits:
  - supported protocols
  - display fields
  - LIW
  - active transport endpoint
  - default capability profile/capabilities
  - proof block
- [x] `[Core]` Implement contact-card import verification with clear failure reasons for:
  - bad signature
  - expired artifact
  - domain mismatch
  - malformed transport binding
- [ ] `[Optional]` Add `RevocationNotice` issuance/import support once basic card and binding flows are stable.
- [ ] `[Optional]` Add expiry warning surfaces for local LIW/ACW material before runtime send/receive starts failing.

Likely touchpoints:

- `src/skills/alphaos/runtime/agent-comm/entrypoints.ts`
- `src/skills/alphaos/runtime/agent-comm/shadow-wallet.ts`
- `src/skills/alphaos/runtime/vault.ts`
- `src/index.ts`
- new modules such as `artifact-signing.ts`, `contact-card.ts`, `transport-binding.ts`

## Phase 2. Persistence and Contact-Centric Data Model

Goal: add the storage model v2 needs without breaking the existing v1 runtime.

Exit criteria:

- new contact/artifact/binding data can be stored and queried
- current v1 peers/messages still read and behave normally

Tasks:

- [x] `[Core]` Extend `StateStore` schema creation to add additive v2 tables with the existing `agent_*` naming style.
- [x] `[Core]` Add a local identity table for LIW/ACW metadata and active binding tracking.
- [ ] `[Core]` Add a contact table keyed by internal `contactId` and canonical `identityWallet`.
- [x] `[Core]` Add a signed-artifact table that stores:
  - artifact type
  - digest
  - signer
  - validity window
  - raw JSON
  - verification result
- [ ] `[Core]` Add a transport-endpoint table that stores active and historical receive endpoints per contact.
- [ ] `[Core]` Add a connection-event table for `connection_invite`, `connection_accept`, `connection_reject`, `connection_confirm`.
- [ ] `[Core]` Add a revocation table or equivalent artifact status model so older bindings/cards can be marked superseded later.
- [ ] `[Core]` Extend `agent_messages` to carry v2-relevant fields without removing v1 fields:
  - `envelopeVersion`
  - `msgId`
  - `contactId`
  - `identityWallet`
  - `transportAddress`
  - `trustOutcome`
  - decrypted command type where available
- [ ] `[Core]` Add indexes for:
  - `identityWallet`
  - active `receiveAddress`
  - `contactId + status`
  - `msgId`
  - `txHash`
  - pending connection states
- [ ] `[Core]` Add store APIs that can resolve contacts by:
  - `contactId`
  - `identityWallet`
  - active receive address
  - legacy `peerId`
- [ ] `[Core]` Add an idempotent backfill/adapter path from `agent_peers` into the v2 contact model:
  - preserve `legacyPeerId`
  - set supported protocols to `agent-comm/1`
  - store existing wallet address/pubkey as legacy transport material
- [ ] `[Optional]` Add retention/pruning rules for expired artifacts and stale historical bindings after baseline storage is stable.

Likely touchpoints:

- `src/skills/alphaos/runtime/state-store.ts`
- any types exported from `src/skills/alphaos/runtime/agent-comm/types.ts`
- migration/backfill tests under `tests/`

## Phase 3. Trust, Contacts, and Invite Control Plane

Goal: make contact import and trust establishment work before the transport payload format is upgraded.

Implementation note: follow the design rollout here. Build the invite/control plane on the current transport path first if needed, then move it onto envelope v2 in Phase 4.

Exit criteria:

- users can add contacts without manual triplet registration
- inbound trust state transitions work and unknown business commands are rejected by default

Tasks:

- [ ] `[Core]` Extend command schemas with:
  - `connection_invite`
  - `connection_accept`
  - `connection_reject`
  - `connection_confirm`
- [ ] `[Core]` Add capability-profile handling so trust records store both:
  - named profile
  - explicit granted capability snapshot
- [ ] `[Core]` Implement the contact-state machine:
  - `imported`
  - `pending_inbound`
  - `pending_outbound`
  - `trusted`
  - `blocked`
  - `revoked`
- [ ] `[Core]` Implement inbound invite processing rules:
  - allow `connection_invite` into a bounded pre-trust path
  - allow `connection_accept` / `reject` / `confirm` only when matching pending state exists
  - reject unknown business commands before business routing
- [ ] `[Core]` Add rate limiting and message-size guards around the unknown-inbound decrypt path.
- [ ] `[Core]` Persist trust outcomes and reject reasons for audit/support visibility.
- [ ] `[Core]` Support inline card attachment for invite/bootstrap and key-refresh scenarios.
- [ ] `[Core]` Add CLI commands:
  - `agent-comm:card:export`
  - `agent-comm:card:import <file|url>`
  - `agent-comm:contacts:list`
  - `agent-comm:connect:invite <contactRef>`
  - `agent-comm:connect:accept <contactRef>`
  - `agent-comm:connect:reject <contactRef>`
- [ ] `[Core]` Keep `agent-comm:peer:trust` available, but mark it as legacy/manual in help text and docs.
- [ ] `[Core]` Add HTTP routes:
  - `GET /api/v1/agent-comm/contacts`
  - `POST /api/v1/agent-comm/cards/import`
  - `POST /api/v1/agent-comm/cards/export`
  - `GET /api/v1/agent-comm/invites`
  - `POST /api/v1/agent-comm/connections/invite`
  - `POST /api/v1/agent-comm/connections/:contactId/accept`
  - `POST /api/v1/agent-comm/connections/:contactId/reject`
- [ ] `[Core]` Update status/list surfaces to show minimal contact-first product state:
  - contact status
  - signer fingerprint
  - capability profile
  - current transport wallet
  - pending invites
- [ ] `[Optional]` Add auto-accept as a policy toggle after the one-tap accept flow works.
- [ ] `[Optional]` Add recommended capability templates such as `research-collab`.
- [ ] `[Optional]` Add share/import via QR or short link once file/raw JSON import is stable.
- [ ] `[Optional]` Add paid cold-inbound notification behavior after the reject-by-default path is solid.

Likely touchpoints:

- `src/skills/alphaos/runtime/agent-comm/types.ts`
- `src/skills/alphaos/runtime/agent-comm/inbox-processor.ts`
- `src/skills/alphaos/runtime/agent-comm/task-router.ts`
- `src/skills/alphaos/runtime/agent-comm/entrypoints.ts`
- `src/index.ts`
- `src/skills/alphaos/api/server.ts`

## Phase 4. Envelope v2, Sender Continuity, and Dual-Stack Runtime

Goal: ship the protocol-format upgrade after contact/trust primitives already exist.

Exit criteria:

- v2 send/receive works end to end
- runtime can parse both v1 and v2 safely
- send path negotiates the highest mutual version

Tasks:

- [ ] `[Core]` Add envelope v2 schemas to replace the hardcoded v1-only `AGENT_COMM_ENVELOPE_VERSION = 1` assumption.
- [ ] `[Core]` Add a versioned codec layer that can encode/decode both v1 and v2 envelopes.
- [ ] `[Core]` Implement v2 outer envelope fields:
  - `version`
  - `kex.suite`
  - `kex.recipientKeyId`
  - `kex.ephemeralPubkey`
  - `ciphertext`
- [ ] `[Core]` Implement v2 encrypted body fields:
  - `msgId`
  - `sentAt`
  - `sender.identityWallet`
  - `sender.transportAddress`
  - `sender.cardDigest`
  - encrypted `command`
  - encrypted payment metadata
  - optional `attachments.inlineCard`
- [ ] `[Core]` Update outbound send logic so v2 messages:
  - resolve the active transport endpoint from the contact model
  - generate `msgId`
  - choose `recipientKeyId`
  - persist `envelopeVersion=2`
  - stop duplicating recipient address in the envelope
- [ ] `[Core]` Update inbound processing so v2 messages:
  - verify `tx.to`
  - select the local receive key via `recipientKeyId`
  - decrypt before command classification
  - verify `sender.transportAddress == tx.from`
  - verify sender transport authorization through a stored LIW binding
  - dedupe on `msgId`
- [ ] `[Core]` Keep the v1 parser and v1 nonce-based dedupe path intact for legacy peers.
- [ ] `[Core]` Add version negotiation on send:
  - track supported protocols per contact
  - default to highest mutual version
  - fall back to v1 only when the contact explicitly allows legacy
- [ ] `[Core]` Update outbound/inbound persistence so both v1 and v2 messages are queryable from the existing messages surface.
- [ ] `[Core]` Add bounded old-key support during ACW rotation so previous receive keys remain usable for a grace window.
- [ ] `[Optional]` Add richer payment/x402 handling inside the encrypted body after the baseline v2 path is stable.
- [ ] `[Optional]` Add future suite-upgrade scaffolding beyond `secp256k1-ecdh-aes256gcm-v2` only if needed.

Likely touchpoints:

- `src/skills/alphaos/runtime/agent-comm/types.ts`
- `src/skills/alphaos/runtime/agent-comm/calldata-codec.ts`
- `src/skills/alphaos/runtime/agent-comm/entrypoints.ts`
- `src/skills/alphaos/runtime/agent-comm/tx-sender.ts`
- `src/skills/alphaos/runtime/agent-comm/inbox-processor.ts`
- `src/skills/alphaos/runtime/agent-comm/runtime.ts`
- `src/skills/alphaos/runtime/agent-comm/ecdh-crypto.ts`

## Phase 5. Backward Compatibility, Migration, and Default Surface Switch

Goal: move the product default to v2 without regressing existing v1 operators.

Exit criteria:

- existing installs can upgrade without losing trust relationships
- new contacts default to v2 flows
- legacy paths still function but are no longer the recommended path

Tasks:

- [ ] `[Core]` Implement startup/backfill logic that upgrades existing trusted peers into v2 contact records while preserving current behavior.
- [ ] `[Core]` Preserve current single-wallet installs as temporary LIW + ACW until the operator explicitly rotates.
- [ ] `[Core]` Make fresh installs create the intended LIW/ACW split by default.
- [ ] `[Core]` Keep these existing surfaces stable during migration:
  - `agent-comm:wallet:init`
  - `agent-comm:identity`
  - `agent-comm:send ...`
  - `GET /api/v1/agent-comm/status`
  - `GET /api/v1/agent-comm/messages`
  - existing business send endpoints
- [ ] `[Core]` Update response payloads carefully so old callers do not break when new v2 fields appear.
- [ ] `[Core]` Add explicit legacy markers in CLI/API output for:
  - v1-only contacts
  - legacy fallback sends
  - manual `peer:trust` records
- [ ] `[Core]` Add `agent-comm:wallet:rotate` and `POST /api/v1/agent-comm/wallets/rotate` once the binding and old-key grace path work.
- [ ] `[Core]` Change product guidance and default docs from "register trusted peer" to "add contact".
- [ ] `[Optional]` Add soft-deprecation warnings when operators create new v1-only peers manually.
- [ ] `[Optional]` Add legacy-usage telemetry thresholds to decide when v1 onboarding can be discouraged more aggressively.

Likely touchpoints:

- `src/index.ts`
- `src/skills/alphaos/api/server.ts`
- `src/skills/alphaos/runtime/state-store.ts`
- `src/skills/alphaos/runtime/agent-comm/entrypoints.ts`
- any config/defaults under `src/skills/alphaos/runtime/config.ts`

## Phase 6. Testing, Validation, Docs, and Examples

Goal: prove v2 works in dual-stack mode and make it operable by the next engineer/operator.

Exit criteria:

- automated coverage exists for core v2 paths and migration
- docs/examples show the new contact-first flow

Tasks:

- [ ] `[Core]` Add unit tests for:
  - `EIP-712` sign/verify for card and binding artifacts
  - artifact digest/fingerprint logic
  - contact-card import validation
  - state-machine transitions
  - version negotiation
  - v2 codec encode/decode
  - v2 replay/dedupe behavior
- [ ] `[Core]` Add store migration tests for:
  - fresh database bootstrap
  - existing v1 database upgrade
  - repeated startup/backfill idempotency
- [ ] `[Core]` Extend runtime tests to cover:
  - unknown inbound invite acceptance path
  - unknown inbound business rejection path
  - `tx.from` vs bound transport verification
  - LIW/ACW rotation grace period
  - mixed v1/v2 inbox handling
- [ ] `[Core]` Extend API tests to cover new contact/card/connection routes and backward compatibility on existing routes.
- [ ] `[Core]` Extend CLI/entrypoint tests to cover card export/import, invite commands, and wallet rotation.
- [ ] `[Core]` Add end-to-end smoke coverage using two runtimes and both version combinations:
  - v2 -> v2
  - v2 -> v1 fallback
  - v1 -> v2 legacy receive
- [ ] `[Core]` Update or replace the demo scripts so the default walkthrough demonstrates:
  - card export/import
  - invite/accept
  - trusted business send after trust exists
- [ ] `[Core]` Write operator/developer docs for:
  - LIW vs ACW roles
  - migration behavior
  - legacy fallback behavior
  - wallet rotation and recovery
  - contact-first CLI/API examples
- [ ] `[Core]` Update `README.md` once implementation lands so it points to the final v2 execution and usage docs.
- [ ] `[Optional]` Add sample card JSON fixtures, QR examples, and a troubleshooting runbook for failed binding verification.

Likely touchpoints:

- `tests/agent-comm-entrypoints.test.ts`
- `tests/agent-comm-runtime.test.ts`
- `tests/agent-comm-send-api.test.ts`
- additional v2-specific test files under `tests/`
- `scripts/agent-comm-demo.sh`
- `README.md`
- `docs/`

## Recommended implementation order inside the MVP

1. Finish Phase 0 first so the team is not coding against moving protocol details.
2. Do Phase 1 and Phase 2 next as the shared foundation for every later surface.
3. Deliver Phase 3 before Phase 4 so contact onboarding works even before envelope v2 becomes default.
4. Deliver Phase 4 once the contact model and trust state machine are stable.
5. Use Phase 5 to switch defaults only after dual-stack runtime behavior is proven.
6. Treat Phase 6 as continuous work, but do not declare v2 ready without its core validation/docs tasks.

## Top dependency chain

`design freeze -> LIW/ACW + signed artifacts -> contact-centric storage -> invite/control plane -> envelope v2 dual-stack -> migration/default switch -> full validation/docs`
