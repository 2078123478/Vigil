# Agent-Comm v2 Card Packaging

Status: canonical share/import convention  
Updated: 2026-03-08

This file defines the packaging convention for sharing a signed Agent-Comm v2 identity artifact bundle over:
- copy/paste text
- QR codes
- short-link wrappers that preserve the full payload inline

## Canonical format

Use this exact URI shape:

```text
agentcomm://card?v=1&bundle=<base64url(bundle-json)>
```

Rules:
- scheme: `agentcomm://card`
- version param: `v=1`
- payload param: `bundle=` containing the UTF-8 JSON bundle encoded with unpadded `base64url`
- the encoded payload is the full signed identity artifact bundle JSON, not just the contact card fragment

## Current implementation in this repo

### Export
`agent-comm:card:export` returns a `shareUrl` using the canonical format above.

### Import
`agent-comm:card:import` currently accepts:
- local file path
- raw JSON bundle text
- canonical `agentcomm://card?...` share URLs
- `http(s)` URLs only when they already embed the same inline `bundle=` or `#bundle=` payload

Important: the current CLI does **not** dereference remote web pages to fetch a bundle body. Short-link support here means “an HTTPS wrapper carrying the exact inline payload”, not “follow an arbitrary URL and scrape content”.

## QR guidance

The QR payload should be the exact `shareUrl` string.

Example payload file:
- `docs/examples/agent-comm/contact-card-share-url.txt`

If a UI later renders QR images, it should encode the same string byte-for-byte.

## Short-link wrapper guidance

If a web layer wants to present a human-facing short link, preserve the canonical payload inline:

```text
https://example.com/agent-card?v=1&bundle=<base64url(bundle-json)>
```

or

```text
https://example.com/agent-card#v=1&bundle=<base64url(bundle-json)>
```

That keeps the transport deterministic and lets the current CLI parse the payload without network fetches.

## Human-friendly HTML wrapper (optional)

For distribution, it is often useful to wrap the canonical `shareUrl` in a clean, human-readable artifact (while preserving a deterministic, offline import path).

This repo supports exporting a **self-contained HTML contact card** that:
- renders a red/black OpenClaw-branded card
- embeds the canonical `shareUrl`
- renders a scannable QR code
- works offline (no external assets)

CLI:
```bash
VAULT_MASTER_PASSWORD=pass123 npm run dev -- agent-comm:card:export --html --output ./my-card.html
```

Example fixture (for docs/tests only):
- `docs/examples/agent-comm/sample-agent.card.html`

## Example fixture

Illustrative sample bundle:
- `docs/examples/agent-comm/contact-card.sample.json`

Illustrative share-url text:
- `docs/examples/agent-comm/contact-card-share-url.txt`

The sample fixture is for documentation/tests/examples only; it is not a cryptographically valid operator identity.
