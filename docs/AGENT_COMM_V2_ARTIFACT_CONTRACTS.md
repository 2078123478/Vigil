# Agent-Comm v2 Artifact Contracts

Status: Phase 0/1 implementation freeze  
Date: 2026-03-07  
Scope: canonical `EIP-712` typed-data contracts for reusable identity artifacts

This document freezes the exact typed-data contracts for the first three reusable v2 artifacts:

- `ContactCard`
- `TransportBinding`
- `RevocationNotice`

It also freezes the artifact digest and short-fingerprint rules so CLI/API/UI surfaces show the same proof summary.

This document does not implement or freeze:

- file/link/QR packaging
- full card export/import workflow
- persistence schema changes
- runtime envelope v2 transport migration

## 1. Canonical domain

All three artifacts use the same `EIP-712` domain template:

| Field | Value |
|---|---|
| `name` | `AgentComm` |
| `version` | `2` |
| `chainId` | advertised transport chain |
| `verifyingContract` | omitted |
| `salt` | omitted by default; optional only for deliberate environment separation on the same chain |

Implementation notes:

- `chainId` is the transport chain the artifact is intended to operate on.
- If `salt` is used, it must be a `bytes32` hex value and must travel with the signed artifact proof metadata so verifiers can reconstruct the exact domain.
- `EIP-191` is not canonical for these artifacts in v2.

## 2. Shared field conventions

These rules are part of the freeze:

- Time fields are Unix seconds, encoded as `uint64`.
- Version fields are `uint32` and start at `1`.
- Addresses are Ethereum `address` values and should be emitted in checksum form in JSON surfaces.
- Public keys are compressed secp256k1 keys encoded as `0x`-prefixed hex and signed as `bytes`.
- `protocols`, `capabilities`, and other arrays are part of the signed payload exactly as authored. Exporters should emit deterministic order; import verifiers must not reorder before signature verification.
- Optional text fields that are absent are represented as an empty string, not by omitting the field.
- `replacementDigest` uses the zero `bytes32` value when no replacement artifact exists.

## 3. `ContactCard`

Primary type: `ContactCard`

Auxiliary types:

- `ContactCardTransport`
- `ContactCardDefaults`

Typed-data definitions:

```ts
const ContactCardTransport = [
  { name: "chainId", type: "uint256" },
  { name: "receiveAddress", type: "address" },
  { name: "pubkey", type: "bytes" },
  { name: "keyId", type: "string" },
];

const ContactCardDefaults = [
  { name: "capabilityProfile", type: "string" },
  { name: "capabilities", type: "string[]" },
];

const ContactCard = [
  { name: "cardVersion", type: "uint32" },
  { name: "protocols", type: "string[]" },
  { name: "displayName", type: "string" },
  { name: "handle", type: "string" },
  { name: "identityWallet", type: "address" },
  { name: "transport", type: "ContactCardTransport" },
  { name: "defaults", type: "ContactCardDefaults" },
  { name: "issuedAt", type: "uint64" },
  { name: "expiresAt", type: "uint64" },
  { name: "legacyPeerId", type: "string" },
];
```

Field notes:

- `protocols` must include `agent-comm/2` for a native v2 card.
- `handle` is optional in product terms, but the canonical typed-data message carries it as an empty string when absent.
- `legacyPeerId` is a migration/bootstrap hint only. It is not a v2 trust anchor.
- `transport.keyId` identifies the active receive key expected by the sender for direct-tx delivery.

## 4. `TransportBinding`

Primary type: `TransportBinding`

Typed-data definition:

```ts
const TransportBinding = [
  { name: "bindingVersion", type: "uint32" },
  { name: "identityWallet", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "receiveAddress", type: "address" },
  { name: "pubkey", type: "bytes" },
  { name: "keyId", type: "string" },
  { name: "issuedAt", type: "uint64" },
  { name: "expiresAt", type: "uint64" },
];
```

Field notes:

- This is the canonical LIW -> ACW authorization artifact.
- `chainId`, `receiveAddress`, `pubkey`, and `keyId` must describe the same active transport endpoint.
- `TransportBinding` is first-class even when a `ContactCard` redundantly embeds the active transport details for convenience.

## 5. `RevocationNotice`

Primary type: `RevocationNotice`

Typed-data definition:

```ts
const RevocationNotice = [
  { name: "noticeVersion", type: "uint32" },
  { name: "identityWallet", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "artifactType", type: "string" },
  { name: "artifactDigest", type: "bytes32" },
  { name: "replacementDigest", type: "bytes32" },
  { name: "reason", type: "string" },
  { name: "revokedAt", type: "uint64" },
];
```

Field notes:

- `artifactType` is limited to `ContactCard` or `TransportBinding` in the current freeze.
- `artifactDigest` is the full typed-data digest of the revoked artifact.
- `replacementDigest` is the full typed-data digest of the replacement artifact, or `0x0000000000000000000000000000000000000000000000000000000000000000` if there is no direct replacement.
- `reason` is optional in product terms, but the canonical typed-data message carries it as an empty string when absent.

## 6. Digest and short fingerprint

These rules are frozen for Phase 0:

### 6.1 Full digest

The canonical artifact digest is the `EIP-712` typed-data digest:

```ts
hashTypedData({
  domain,
  types,
  primaryType,
  message,
})
```

That means:

- digest computation is over the structured typed-data payload, not over raw exported JSON text
- the exact domain used for signing is part of the digest
- the full 32-byte digest is the storage and API comparison value

### 6.2 Short fingerprint

The canonical short fingerprint is derived from the full digest as:

```txt
0x + first 8 hex chars + "..." + last 8 hex chars
```

Example:

```txt
0xfff1fb0c...1403b6b2
```

Rules:

- CLI/API/UI should display the short fingerprint only as a summary label
- comparisons, persistence, and revocation references must use the full digest
- do not derive the fingerprint from signer address, receive address, or raw signature bytes

## 7. What remains for later phases

Not frozen here:

- the shareable JSON wrapper or QR/link encoding for exported cards
- issuance/import UX
- sign/verify service wiring
- store schema for artifact persistence
- runtime trust-state transitions that consume these artifacts

Those belong to later Phase 1+ work after these typed-data contracts are accepted.
