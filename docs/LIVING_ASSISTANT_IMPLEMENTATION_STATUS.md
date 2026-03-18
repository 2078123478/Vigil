# Living Assistant — Implementation Status

This document answers one practical question:

> **What is already implemented today, how does it work, how is it configured, and what is still pending?**

It is meant to save future-you from reading source code just to recover the current system shape.

---

## 1. Current status at a glance

Living Assistant is no longer just a blueprint.

It already has a working end-to-end loop across four layers:

1. **Signal Radar** — senses ecosystem events
2. **Judgment Engine** — decides whether an event matters
3. **Human Contact Orchestrator** — decides whether to stay silent, batch into digest, nudge, send voice, or escalate
4. **Action & Delivery Layer** — executes Telegram / Twilio / Aliyun delivery behaviors

### Implemented attention ladder

- `silent`
- `digest`
- `text_nudge`
- `voice_brief`
- `strong_interrupt`
- `call_escalation`

### Implemented delivery channels

- **Telegram** — text, voice message, strong reminder path
- **Twilio** — direct phone call path
- **Aliyun Voice** — additional phone/voice notification path

### Implemented live/demo paths

- fixture-driven demo scenarios
- live Binance Announcements polling
- live Binance Square polling (when endpoint is configured)
- call rehearsal mode (`--call --demo-delivery`)
- live call mode (`--call`)

---

## 2. What the system can do today

### 2.1 Live signal radar

The system can already ingest:

- **Binance Announcements**
  - new listing
  - delisting
  - airdrop
  - news
- **Binance Square narratives**
  - feed parsing
  - keyword filtering
  - dedupe
  - interval polling

These signals are normalized into a shared `NormalizedSignal` shape before policy/judgment runs.

### 2.2 Judgment and contact decision

For each signal, Living Assistant can already decide:

- whether it is relevant
- how urgent it is
- whether to contact the human
- which attention level to use
- which channel family to use

This means the assistant is already operating as:

- not just a notifier
- not just a chat bot
- but an interruption-aware assistant

### 2.3 Digest batching

`digest` is not just a label anymore.

Low-priority or degraded signals can now:

- enter a digest queue
- remain stored until flush time
- be summarized into a digest artifact
- be inspected via API/demo output

So the system can now do:

- **stay quiet now**
- **still remember**
- **summarize later**

### 2.4 Voice generation and call delivery

The system now supports three TTS families:

#### A. OpenAI-compatible TTS

Used for providers that support `/audio/speech` style APIs.

#### B. DashScope Qwen TTS

Native DashScope/Qwen integration was added because Qwen TTS does **not** fit the generic `/audio/speech` path.

It now supports:

- native DashScope generation endpoint
- `qwen3-tts-flash`
- `qwen3-tts-instruct-flash`
- optional instructions / instruction optimization
- hosted `audioUrl` return

#### C. CosyVoice TTS (WebSocket)

CosyVoice uses DashScope's WebSocket protocol for real-time speech synthesis.

It now supports:

- WebSocket duplex streaming protocol
- preset system voices (`longxiaochun_v2`, `longanyang`, etc.)
- custom cloned voices (via `CosyVoiceCloneService`)
- `mp3`, `wav`, `pcm` output formats
- configurable model (`cosyvoice-v2`, `cosyvoice-v3-flash`, `cosyvoice-v3-plus`, etc.)

This is the recommended provider for production use because:

- voice cloning enables a unique, branded assistant voice
- WebSocket streaming provides low-latency audio generation
- same API key works for both TTS and voice cloning

### 2.5 Telegram / Twilio / Aliyun delivery semantics

The intended product meaning is now:

- **Telegram** = strong reminder / voice message / escalation nudge
- **Twilio** = direct phone call
- **Aliyun** = additional call/voice notification option

Important: this is now **configurable**, not hardcoded as one global truth.

---

## 3. What changed recently

These are the key implementation upgrades that materially changed the system:

### 3.1 Phone demo closure

Implemented:

- `--call` mode in `scripts/living-assistant-demo.ts`
- Twilio and Aliyun call runtime parsing
- delivery executor integration with `VoiceDeliveryOrchestrator`

### 3.2 Call rehearsal / preflight

Implemented:

- `--call --demo-delivery`
- provider readiness output
- route preview output
- per-channel delivery result visibility
- operator-facing call runbook

This means phone escalation can be demonstrated even when credentials or reachability are not fully ready.

### 3.3 Binance Square polling

Implemented:

- `BinanceSquarePoller`
- `pollBinanceSquare()`
- `squarePostToSignal()`
- live radar ingestion from demo `--live`

### 3.4 Digest batching scheduler

Implemented:

- digest queue/store
- snapshot/flush
- loop integration
- API integration
- demo visibility

### 3.5 DashScope Qwen TTS

Implemented:

- native `dashscope-qwen` provider
- `audioUrl` support in TTS results
- Twilio `<Play>` when hosted audio exists
- fallback to Twilio `<Say>` when hosted audio is unavailable

### 3.6 Configurable Telegram/Twilio route policy

Implemented:

- route profiles instead of hardcoded “Twilio-first” truth
- per-attention route overrides
- policy-driven channel ordering

This is important for product narrative:

- Twilio remains valid for direct-phone deployments, especially overseas numbers
- Telegram remains valid for reminder/voice-message style deployments
- the deployment chooses the behavior
- the codebase no longer implies one universal route priority

### 3.7 CosyVoice WebSocket TTS

Implemented:

- `cosyvoice` TTS provider using DashScope WebSocket protocol
- duplex streaming synthesis (`run-task` / `continue-task` / `finish-task`)
- supports `mp3`, `wav`, `pcm` output formats
- 30s timeout with proper error handling
- preset voices (e.g. `longxiaochun_v2`) and cloned voices

### 3.8 CosyVoice Voice Cloning

Implemented:

- `CosyVoiceCloneService` — full voice cloning lifecycle via DashScope HTTP API
- `createVoice()` — clone from a 10–20s audio sample (public HTTPS URL required)
- `designVoice()` — create voice from text description (no audio needed)
- `queryVoice()` — check voice deployment status (`DEPLOYING` → `OK`)
- `listVoices()` — paginated listing of all cloned voices
- `waitForVoice()` — poll until voice is ready
- uses same DashScope API key as TTS (no separate AK/SK needed)
- endpoint: `POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization`

Current cloned voices:

| Voice ID | Description | Model |
|----------|-------------|-------|
| `cosyvoice-v2-wilsen-078bd152fc744a33871a0c71b32a6025` | 小音专属声音 ⭐ | cosyvoice-v2 |
| `cosyvoice-v2-xiaoyin-1720c44b1f9d4a07a04290e57663ae4a` | 示例音频复刻 | cosyvoice-v2 |

### 3.9 Inline Keyboard Buttons

Implemented:

- Telegram inline keyboard buttons on `strong_interrupt` / `call_escalation` messages
- callback_data format: `la:act_now`, `la:defer_5m`, `la:ignore_once`

### 3.10 Telegram Callback Handler

Implemented:

- `TelegramCallbackHandler` — server-side handler for inline button callbacks
- `handleCallback()` — answers callback query + edits original message with status label
- `startPolling()` / `stopPolling()` — long-polling `getUpdates` for `callback_query` events
- Message context caching (chatId, messageId, originalText) from polling updates
- Known actions: `act_now` → `[✅ Acknowledged]`, `defer_5m` → `[⏰ Deferred 5m]`, `ignore_once` → `[🔕 Ignored]`
- Unknown `la:*` actions gracefully answered without editing
- 7 tests covering all actions, unknown, missing params, network errors
- Uses raw `fetch` (no external dependencies), same pattern as `telegram-voice-sender.ts`

### 3.11 Hackathon E2E Demo Script

Implemented:

- `scripts/hackathon-e2e-demo.ts` — full 7-step end-to-end demo
- Flow: load fixture → normalize signal → contact policy → voice brief → CosyVoice TTS → Telegram voice + inline buttons → callback polling → handle user response
- Uses `critical-risk-escalation` fixture with `allowCallEscalation: false` override to route through `strong_interrupt` (Telegram inline buttons)
- Per-phase timing output with emoji-decorated step headers
- 60-second callback timeout with clean exit
- Verified end-to-end: signal → CosyVoice voice → Telegram delivery → user clicks button → callback handled → message edited with status label

---

## 4. Current delivery model

## 4.1 Attention ladder behavior

### `silent`

- no contact
- signal is observed but not surfaced

### `digest`

- do not interrupt now
- enqueue into digest batching
- allow later flush / summary

### `text_nudge`

- light Telegram text path

### `voice_brief`

- short Telegram voice message path when audio bytes are available
- text fallback if audio is absent

### `strong_interrupt`

- stronger reminder path
- default balanced route includes Telegram voice plus call channels

### `call_escalation`

- highest escalation class
- route is now policy-driven
- can include any ordered combination of:
  - `telegram_text`
  - `telegram_voice`
  - `twilio_call`
  - `aliyun_call`

---

## 5. Route policy system

Call/channel routing is now explicitly configurable.

### Default route profiles

#### `balanced`

- `strong_interrupt`: `telegram_voice -> twilio_call -> aliyun_call`
- `call_escalation`: `twilio_call -> aliyun_call -> telegram_voice`

#### `telegram-escalation`

Designed for deployments that want Telegram to lead the escalation experience.

#### `direct-call-only`

Designed for deployments that want call channels only.

### Per-level overrides

You can override any level with env vars:

- `CALL_ROUTE_TEXT_NUDGE`
- `CALL_ROUTE_VOICE_BRIEF`
- `CALL_ROUTE_STRONG_INTERRUPT`
- `CALL_ROUTE_CALL_ESCALATION`

Allowed actions:

- `telegram_text`
- `telegram_voice`
- `twilio_call`
- `aliyun_call`

### Why this matters

This avoids encoding a false product truth such as:

- “Twilio is always first”
- or “Telegram is only a fallback”

Instead, the repo now says:

- both channels are implemented
- different deployments can emphasize different behaviors

---

## 6. TTS model system

### 6.1 Supported provider types

#### `openai-compatible`

Use when your TTS provider supports an `/audio/speech` interface.

Typical env:

```bash
TTS_PROVIDER=openai-compatible
TTS_BASE_URL=https://...
TTS_API_KEY=...
TTS_MODEL=...
TTS_VOICE=...
```

#### `dashscope-qwen`

Use when you want native Alibaba Cloud Qwen TTS.

Typical env:

```bash
TTS_PROVIDER=dashscope-qwen
TTS_API_KEY=...
TTS_MODEL=qwen3-tts-instruct-flash
TTS_VOICE=Cherry
TTS_INSTRUCTIONS=Use a calm but confident assistant tone.
TTS_OPTIMIZE_INSTRUCTIONS=true
```

#### `cosyvoice`

Use when you want CosyVoice TTS with preset or cloned voices via DashScope WebSocket.

CosyVoice is the only TTS provider that supports voice cloning — you can create a custom voice from a 10–20s audio sample and use it for all subsequent synthesis.

Typical env:

```bash
TTS_PROVIDER=cosyvoice
TTS_API_KEY=sk-...          # DashScope API key (same key for TTS + cloning)
TTS_MODEL=cosyvoice-v2
TTS_VOICE=cosyvoice-v2-wilsen-078bd152fc744a33871a0c71b32a6025  # cloned voice
TTS_FORMAT=mp3
```

Key differences from other providers:

- Uses **WebSocket** protocol (`wss://dashscope.aliyuncs.com/api-ws/v1/inference/`)
- Duplex streaming: `run-task` → `task-started` → `continue-task`(text) → `finish-task` → binary audio chunks → `task-finished`
- Supports `mp3`, `wav`, `pcm` output formats
- Default model: `cosyvoice-v2`, default voice: `longxiaochun_v2`
- 30s timeout per synthesis request

### 6.2 Important behavior difference

- OpenAI-compatible providers usually return audio bytes directly
- DashScope Qwen may return a hosted `audioUrl`

The system now handles both.

### 6.3 Current downstream behavior

- **Telegram** uses audio bytes when present
- **Twilio** prefers hosted `audioUrl` via `<Play>` when present
- if `audioUrl` is absent, Twilio falls back to `<Say>`

---

## 7. Demo / operator commands

### 7.1 Fixture demo

```bash
npm run demo:living-assistant
```

### 7.2 Live radar demo

```bash
npm run demo:living-assistant -- --live
```

### 7.3 Live radar with Square endpoint

```bash
BINANCE_SQUARE_ENDPOINT=https://... npm run demo:living-assistant -- --live
```

### 7.4 Call rehearsal

```bash
npm run demo:living-assistant -- --call --demo-delivery
```

### 7.5 Live call mode

```bash
npm run demo:living-assistant -- --call
```

### 7.6 Hackathon E2E demo (CosyVoice + inline buttons + callback)

```bash
TTS_API_KEY=sk-... \
TTS_VOICE=cosyvoice-v2-wilsen-078bd152fc744a33871a0c71b32a6025 \
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_CHAT_ID=... \
npx tsx scripts/hackathon-e2e-demo.ts
```

This runs the full loop: signal → policy → brief → CosyVoice TTS → Telegram voice + inline buttons → polls for button click → handles callback → exits.

### 7.7 DashScope Qwen TTS + call mode

```bash
TTS_PROVIDER=dashscope-qwen \
TTS_API_KEY=... \
TTS_MODEL=qwen3-tts-instruct-flash \
TTS_VOICE=Cherry \
npm run demo:living-assistant -- --call
```

---

## 8. Current important env vars

### Telegram

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### Twilio

```bash
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
TWILIO_TO_NUMBER=
```

### Aliyun voice call

```bash
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_CALLED_SHOW_NUMBER=
ALIYUN_CALLED_NUMBER=
ALIYUN_TTS_CODE=
ALIYUN_ENDPOINT=
```

### TTS

```bash
TTS_PROVIDER=                    # openai-compatible | dashscope-qwen | cosyvoice
TTS_BASE_URL=
TTS_API_KEY=
TTS_MODEL=
TTS_VOICE=
TTS_LANGUAGE=
TTS_FORMAT=
TTS_INSTRUCTIONS=
TTS_OPTIMIZE_INSTRUCTIONS=
TTS_DASHSCOPE_ENDPOINT=
TTS_DASHSCOPE_LANGUAGE_TYPE=
```

### CosyVoice-specific

```bash
TTS_PROVIDER=cosyvoice
TTS_API_KEY=sk-...               # DashScope API key
TTS_MODEL=cosyvoice-v2
TTS_VOICE=cosyvoice-v2-wilsen-078bd152fc744a33871a0c71b32a6025
TTS_FORMAT=mp3                   # mp3 | wav | pcm
```

### Route policy

```bash
CALL_ROUTE_PROFILE=
CALL_ROUTE_TEXT_NUDGE=
CALL_ROUTE_VOICE_BRIEF=
CALL_ROUTE_STRONG_INTERRUPT=
CALL_ROUTE_CALL_ESCALATION=
```

### Live Square polling

```bash
BINANCE_SQUARE_ENDPOINT=
BINANCE_SQUARE_PAGE_SIZE=
BINANCE_SQUARE_KEYWORDS=
```

---

## 9. Known caveats

### Twilio reachability is deployment-dependent

Twilio integration is implemented and works as a product channel.

But actual phone reachability depends on:

- the target country/region
- Twilio account permissions
- phone-number reachability rules

That means:

- failure to reach one China mobile number does **not** mean the Twilio channel is architecturally invalid
- Twilio remains a valid direct-call path for other deployments, especially overseas numbers

### DashScope Qwen is not generic `/audio/speech`

Qwen TTS required a native provider because the generic OpenAI-compatible endpoint path was not correct for DashScope Qwen speech synthesis.

### CosyVoice voice cloning requires a China-accessible HTTPS URL

The `createVoice()` API requires a public HTTPS URL that DashScope (hosted in China mainland) can download.

This means:

- Telegram file URLs do not work (blocked in China)
- HTTP-only URLs from overseas servers do not work (DashScope cannot reach them)
- China-based CDN links (e.g. Lanzou Cloud direct links, Aliyun OSS) work reliably
- The audio sample should be 10–20 seconds, clear speech, single speaker

### CosyVoice uses WebSocket, not HTTP REST

CosyVoice TTS synthesis only works via WebSocket (`wss://dashscope.aliyuncs.com/api-ws/v1/inference/`).

Previous attempts to use HTTP REST endpoints (`multimodal-generation`, `speech-synthesizer`, `text2audio`, `compatible-mode/v1/audio/speech`) all returned `InvalidParameter: url error`.

Voice cloning management (create/query/list) uses a separate HTTP REST endpoint and works fine.

### Telegram bot voice messages are not the same as Telegram real-time calls

Current implementation supports:

- Telegram text
- Telegram voice messages

It does **not** claim that Telegram bot API provides a robust proactive real-time call system.

---

## 10. Files that matter most

If someone still wants to inspect the system shape, these are the highest-value files:

### Demo / operator entry

- `scripts/living-assistant-demo.ts`
- `scripts/hackathon-e2e-demo.ts`

### Core loop

- `src/skills/alphaos/living-assistant/loop.ts`

### Delivery routing

- `src/skills/alphaos/living-assistant/delivery/voice-orchestrator.ts`
- `src/skills/alphaos/living-assistant/delivery/delivery-executor.ts`
- `src/skills/alphaos/living-assistant/delivery/callback-handler.ts`

### TTS

- `src/skills/alphaos/living-assistant/tts/types.ts`
- `src/skills/alphaos/living-assistant/tts/provider-factory.ts`
- `src/skills/alphaos/living-assistant/tts/openai-compatible-provider.ts`
- `src/skills/alphaos/living-assistant/tts/dashscope-qwen-provider.ts`
- `src/skills/alphaos/living-assistant/tts/cosyvoice-provider.ts`
- `src/skills/alphaos/living-assistant/tts/voice-clone.ts`

### Signal radar

- `src/skills/alphaos/living-assistant/signal-radar/`

### Digest batching

- `src/skills/alphaos/living-assistant/digest-batching/`

### Call-focused operator guide

- `docs/LIVING_ASSISTANT_CALL_DEMO_RUNBOOK.md`

---

## 11. What is still pending

The system is already substantial, but a few meaningful next steps remain.

Most relevant pending/extendable areas:

- **Second-batch adapters** — `query-address-info`, `trading-signal`, and other signal sources
- **More production-style scheduling** around digest windows
- **More advanced phone/voice interaction patterns**
- **Broader live radar sources** beyond announcements + Square
- **Voice cloning workflow polish** — audio upload helper, voice preview before committing

---

## 12. Recommended mental model

The best way to think about Living Assistant today is:

- **already implemented as a real system**
- **still growing in polish and deployment breadth**
- **strong enough for demo, architecture discussion, and staged operator testing**

Do **not** think of it as:

- only a plan
- only a static demo
- only a Telegram bot
- only a phone bot

It is now a configurable interruption-and-delivery system for a proactive assistant.

---

## 13. Related docs

Read these next depending on what you want:

- [Living Assistant MVP Plan](LIVING_ASSISTANT_MVP_PLAN.md)
- [Champion Agent System](CHAMPION_AGENT_SYSTEM.md)
- [Champion Demo Story](CHAMPION_DEMO_STORY.md)
- [Living Assistant Demo Runner](LIVING_ASSISTANT_DEMO_RUNNER.md)
- [Living Assistant Call Demo Runbook](LIVING_ASSISTANT_CALL_DEMO_RUNBOOK.md)
