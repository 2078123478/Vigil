# Living Assistant Call Demo Runbook

This runbook is for operator-facing call demos using `scripts/living-assistant-demo.ts`.

It supports two phases:

- pre-credential rehearsal (`--call --demo-delivery`)
- live call execution (`--call`)

Call routing is policy-driven and operator-configurable.
Default route profile is `balanced`:
- `strong_interrupt`: `telegram_voice -> twilio_call -> aliyun_call`
- `call_escalation`: `twilio_call -> aliyun_call -> telegram_voice`

When TTS returns a hosted audio URL, Twilio uses `<Play>`; otherwise it falls back to `<Say>`.

## 1) Rehearse call routing before credentials are ready

Run:

```bash
npm run demo:living-assistant -- --call --demo-delivery
```

What this does:

- runs the `critical-risk-escalation` fixture
- executes delivery orchestration logic
- **does not call outbound APIs**
- prints simulated per-channel results so judges can see the full escalation path

Default expected `call_escalation` route (no credentials configured):

- `twilio(simulated) -> telegram(simulated)`

## 2) Run live call mode when credentials are ready

Set at least one live call provider:

- Route policy (optional):
  - `CALL_ROUTE_PROFILE=balanced|telegram-escalation|direct-call-only`
  - optional per-level overrides:
    - `CALL_ROUTE_TEXT_NUDGE`
    - `CALL_ROUTE_VOICE_BRIEF`
    - `CALL_ROUTE_STRONG_INTERRUPT`
    - `CALL_ROUTE_CALL_ESCALATION`
  - route actions use comma-separated values from:
    - `telegram_text`, `telegram_voice`, `twilio_call`, `aliyun_call`

- Twilio required vars:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_NUMBER`
  - `TWILIO_TO_NUMBER` (or `TWILIO_DEFAULT_TO_NUMBER`)
- Aliyun required vars:
  - `ALIYUN_ACCESS_KEY_ID`
  - `ALIYUN_ACCESS_KEY_SECRET`
  - `ALIYUN_CALLED_SHOW_NUMBER`
  - `ALIYUN_CALLED_NUMBER`
  - `ALIYUN_TTS_CODE`
- Telegram channel (optional, recommended for reminder/voice nudge delivery):
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
- Optional TTS for Twilio synthesized playback (`<Play>`):
  - `TTS_PROVIDER=dashscope-qwen`
  - `TTS_API_KEY`
  - optional: `TTS_MODEL` (default `qwen3-tts-flash`, instruct model example: `qwen3-tts-instruct-flash`)
  - optional: `TTS_VOICE` (example: `Cherry`)
  - optional: `TTS_INSTRUCTIONS` and `TTS_OPTIMIZE_INSTRUCTIONS`
  - optional: `TTS_DASHSCOPE_ENDPOINT` (defaults to DashScope generation endpoint)

Then run:

```bash
npm run demo:living-assistant -- --call
```

## 3) Read preflight and delivery output

The script now prints:

- provider preflight:
  - Twilio readiness
  - Aliyun readiness
  - Telegram readiness
  - active route profile
- resolved `call_escalation` route with simulation markers when applicable
- per-channel delivery outcomes:
  - `ok/failed`
  - channel reference (`callSid`, `callId`, or `messageId`)
  - error detail when failed

## 4) Common failure messages

- `--call requires at least one ready call provider (Twilio or Aliyun).`
  - set a full Twilio or Aliyun config, or use `--call --demo-delivery` first.
- `--call Twilio config is incomplete...`
  - complete all required `TWILIO_*` vars or clear partial values.
- `--call Telegram config is incomplete...`
  - set both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, or clear both.
- `--call route policy produced no enabled channels for call_escalation.`
  - adjust `CALL_ROUTE_PROFILE` / `CALL_ROUTE_CALL_ESCALATION` to include at least one enabled channel.
