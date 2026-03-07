# Agent-Comm Protocol v2 Draft

Status: Draft for architecture review  
Date: 2026-03-07  
Scope: direct-transaction mode on EVM-compatible chains

## 1. Executive decisions

| Topic | v2 decision | Why this is the recommendation |
|---|---|---|
| Signature standard | Use `EIP-712` as the only canonical off-chain signature standard in v2 for contact cards, transport-wallet bindings, and revocations. Do not define both `EIP-712` and `EIP-191` in core v2. Accept `EIP-191` only for legacy import/migration from v1 material. | It is the best practical combination of structured signing, human-reviewable payloads, and broad EVM wallet/library support. |
| Stranger invite policy | Unknown senders may send `connection_invite` into a lightweight invite path. OpenClaw may either auto-accept or place the invite into a one-tap accept flow. Unknown unsolicited business messages are rejected by default. A deployment may optionally surface them as `paid cold inbound` only if the attached transfer meets a configured threshold, but the business command still must not execute before trust exists. | This preserves growth while avoiding a general spam inbox. |
| Privacy scope | v2 focuses on direct-tx mode. The outer envelope is minimized to `version`, `kex`, and `ciphertext`. Stronger privacy variants are not part of core v2. | This keeps the design implementable and reviewable now. |
| Wallet model | Separate `Long-lived Identity Wallet`, `Active Comm Wallet`, and `Temporary/Demo Wallet`. | This prevents demo flows from mutating real identity/trust state. |
| Sender authentication | In direct-tx mode, per-message sender authentication comes from the chain transaction signature (`tx.from`). Reusable off-chain objects use `EIP-712`. Core v2 does not add a second off-chain signature to every message. | This removes redundant signature machinery from the message path. |

## 2. Why v2

Current v1 already proves the transport is viable, but it has product-level problems:

- Trust bootstrap is too manual: users exchange `peerId + walletAddress + pubkey` and must keep `senderPeerId` consistent.
- Too much metadata is visible in the envelope plaintext.
- Long-lived identity and demo wallets are easy to mix.
- The existing `signature` field is not a clean trust primitive.

v2 keeps the current direct-tx transport model, but turns it into a cleaner identity/trust protocol that is suitable for architecture review and productization.

## 3. Goals and non-goals

### Goals

- Make connection setup feel like `add contact`, not `manually register cryptographic fields`.
- Reduce plaintext metadata to the minimum required for direct delivery and decryption.
- Define one clear signature standard instead of a dual-standard matrix.
- Keep the trust gate simple: invites are allowed; untrusted business traffic is not.
- Preserve a realistic migration path from v1.

### Non-goals

- Full anonymity or traffic-analysis resistance.
- Relayer networks, mixers, or other privacy infrastructure in core v2.
- New mandatory smart contracts.
- Multiple canonical signature standards in the core spec.

## 4. Layered architecture

| Layer | Owns | Must not own |
|---|---|---|
| Identity | Long-lived identity wallet, contact cards, transport-wallet bindings, revocations | Chain listener/send loop |
| Trust | Contact states, capability profiles, invite handling, blocklists | Calldata encoding |
| Transport | Envelope encoding, tx send/listen, encryption/decryption, replay checks | Human-facing naming and approval UX |
| UX/Product | Share/import card, invite accept flow, contact list, status messaging | Cryptographic policy internals |

## 5. Wallet model

| Wallet type | Lifecycle | Primary use | Allowed in production trust? | UX label |
|---|---|---|---|---|
| Long-lived Identity Wallet | Months to years | Sign contact cards and wallet bindings; anchor reputation and continuity | Yes | `Primary Identity` |
| Active Comm Wallet | Weeks to months; rotatable | Receive/send Agent-Comm transactions and pay gas | Yes, if bound by the identity wallet | `Active Comm Wallet` |
| Temporary/Demo Wallet | Minutes to days | Demo/testing only | No, by default | `Temporary/Demo` |

Required rules:

- Demo reset must not replace the long-lived identity wallet.
- A wallet with funds or active contacts must never be silently regenerated.
- Trust bootstrap defaults to identity-signed contact cards, not raw copied pubkeys.
- Comm-wallet rotation must preserve identity continuity via a signed binding.

## 6. Canonical signed objects

### 6.1 Signature standard recommendation

`EIP-712` is the canonical v2 signature format for reusable signed artifacts:

- `ContactCard`
- `TransportBinding`
- `RevocationNotice`

Recommended domain fields:

| Field | Value |
|---|---|
| `name` | `AgentComm` |
| `version` | `2` |
| `chainId` | advertised transport chain |

Notes:

- Add `salt` only if multiple environments intentionally share the same chain and need domain separation.
- Do not require `verifyingContract`; these are off-chain signed objects.
- `EIP-191` stays out of the core v2 protocol. It may be accepted only as a legacy import path.

### 6.2 Contact card

```json
{
  "cardVersion": 1,
  "protocols": ["agent-comm/2", "agent-comm/1"],
  "displayName": "Xiaoyin",
  "handle": "@xiaoyin",
  "identityWallet": "0xIdentity...",
  "transport": {
    "chainId": 196,
    "receiveAddress": "0xCommWallet...",
    "pubkey": "0xCommPubkey...",
    "keyId": "rk_2026_01"
  },
  "defaults": {
    "capabilityProfile": "research-collab",
    "capabilities": ["ping", "start_discovery", "get_discovery_report"]
  },
  "issuedAt": "2026-03-07T12:00:00.000Z",
  "expiresAt": "2026-09-07T12:00:00.000Z",
  "proof": {
    "type": "eip712",
    "signer": "0xIdentity...",
    "signature": "0x..."
  }
}
```

Card requirements:

- Import must verify the `EIP-712` signature and expiry.
- UI must show signer identity and a short fingerprint before trust is granted.
- The local store keeps display aliasing separate from protocol identifiers.
- A legacy `peerId` hint may be included only for v1 fallback/bootstrap.

### 6.3 Transport binding

A `TransportBinding` is an `EIP-712` object signed by the identity wallet that binds:

- `identityWallet`
- `chainId`
- `receiveAddress`
- `pubkey`
- `keyId`
- `issuedAt`
- `expiresAt`

This is the trust anchor for comm-wallet rotation. It is not repeated as a new signature inside every message.

## 7. Envelope v2

### 7.1 Outer plaintext

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

Plaintext rules:

- `version` is for parser dispatch.
- `recipientKeyId` helps the receiver select the right decryption key during rotation.
- `ephemeralPubkey` is the only sender-side public key material that stays outside the ciphertext.
- The recipient address comes from `tx.to`, not from a duplicate envelope field.

### 7.2 Encrypted body

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

Rules:

- `command.type` is encrypted.
- Optional payment/proof metadata is encrypted.
- `inlineCard` is typically used only on `connection_invite` or on key refresh.
- Replay protection happens after decrypt using `msgId` and local dedupe state.

### 7.3 v1 plaintext to v2 treatment

| v1 field | v2 treatment |
|---|---|
| `senderPeerId` | Remove from outer envelope. If needed, keep only as an internal contact identifier after decrypt or as a legacy hint. |
| `senderPubkey` | Remove the static sender pubkey from the outer envelope. Use per-message `ephemeralPubkey` outside, and keep long-lived receive pubkeys in signed contact material. |
| `recipient` | Remove from envelope; use `tx.to`. |
| `nonce` / `timestamp` | Move inside ciphertext as `msgId` / `sentAt`. |
| `command.type` / `schemaVersion` | Move inside ciphertext. |
| `x402` / payment metadata | Encrypt by default. |
| `signature` | No per-message off-chain signature in direct-tx v2. Use `tx.from` for message auth and `EIP-712` signed objects for reusable trust artifacts. |

Unavoidable chain-visible data in direct-tx mode:

- `tx.from`
- `tx.to`
- tx hash
- block time
- gas usage

## 8. Trust model and stranger policy

### 8.1 Contact states

| State | Meaning |
|---|---|
| `imported` | Card verified locally, but no mutual trust yet |
| `pending_inbound` | An inbound `connection_invite` is awaiting action |
| `pending_outbound` | A sent invite is awaiting response |
| `trusted` | Business commands may be processed within granted capabilities |
| `blocked` | Ignore future invites/messages from this sender |
| `revoked` | Previously trusted material is no longer valid |

### 8.2 Unknown-sender policy

| Inbound type | Unknown sender behavior | Trusted sender behavior |
|---|---|---|
| `connection_invite` | Accept into a rate-limited invite path. OpenClaw may auto-accept directly or place it into a lightweight one-tap accept flow. | Process normally. |
| `connection_accept` / `connection_reject` / `connection_confirm` | Accept only if there is a matching pending invite state; otherwise reject. | Process normally. |
| Business commands such as `ping`, `start_discovery`, `approve_candidate`, `request_mode_change`, `probe_onchainos` | Reject by default. A deployment may optionally persist and notify as `paid cold inbound` only if the attached transfer meets `coldInboundNotifyThreshold`, but it still must not execute the business command before trust exists. | Process subject to capability checks. |

Explicit product rule:

- A `connection_invite` is a contact request, not an unsolicited business message.

### 8.3 Connection flow

1. User shares a signed contact card by file, link, or QR.
2. Receiver imports the card and verifies the `EIP-712` signature.
3. Receiver or sender sends `connection_invite`.
4. OpenClaw either auto-accepts per policy or surfaces a one-tap accept flow.
5. `connection_accept` establishes the trust record and negotiated capability profile.
6. `connection_confirm` is optional and only acknowledges readiness.

No manual copy/paste of `peerId + walletAddress + pubkey` in the normal path.

## 9. Payments and privacy scope

- v2 assumes direct-tx mode as the primary transport.
- Optional payment details stay inside ciphertext.
- A transfer attached to an unknown business message may change notification behavior, but it does not bypass the trust gate.
- Stronger privacy variants such as relayer forwarding are out of core scope. If ever added, they should be optional adapters above the same trust model, not a replacement for direct-tx v2.

## 10. Backward compatibility

### 10.1 Dual-stack rules

- Decode by `envelope.version`.
- Store peer/contact support by protocol version.
- Send at the highest mutually supported version.
- Keep existing v1 CLI/API surfaces during migration.

### 10.2 Compatibility matrix

| Sender | Receiver | Behavior |
|---|---|---|
| v2 | v2 | Full v2 envelope and v2 invite flow |
| v2 | v1-only | Fall back to v1 only if the contact explicitly allows legacy |
| v1 | v2 | v2 runtime accepts via legacy parser/trust path |
| v1 | v1 | Unchanged |

### 10.3 Legacy coexistence

- Keep current trusted-peer storage for v1 peers.
- Card import may auto-create legacy trust entries when only v1 is available.
- `EIP-191` is tolerated only where needed to import legacy contact material.

## 11. Rollout

| Phase | Goal | Exit criteria |
|---|---|---|
| 0. Spec freeze | Approve the decisions in this document | Architecture review sign-off |
| 1. Identity/card | Card export/import, `EIP-712` verification, wallet-binding model | Cards import correctly and bindings verify |
| 2. Invite UX | Lightweight invite accept flow on current transport | Manual peer registration is no longer the primary path |
| 3. Envelope v2 | Send/receive minimal-plaintext v2 envelopes | v2 reliability is stable with no v1 regression |
| 4. v2 default | New contacts default to v2 | Most new contacts are created as v2 contacts |
| 5. v1 soft deprecation | Keep compatibility, discourage new legacy-only peers | Negligible new v1-only contacts |

## 12. Architecture review checklist

- [ ] Approve `EIP-712` as the sole canonical off-chain signature standard for v2.
- [ ] Approve the direct-tx privacy scope and minimal outer envelope.
- [ ] Approve the `connection_invite` exception and reject-by-default treatment for unknown business messages.
- [ ] Approve the LIW / Active Comm Wallet / Demo Wallet split.
- [ ] Approve dual-stack migration and v1 soft-deprecation plan.

## 13. Remaining human decisions

- Choose the default OpenClaw behavior for valid inbound `connection_invite`: `auto-accept` or `lightweight accept flow`.
- Set the initial `coldInboundNotifyThreshold` value and the asset/normalization rule used to evaluate it.
