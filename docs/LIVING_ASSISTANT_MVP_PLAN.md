# Living Assistant MVP Plan

This document turns the champion blueprint into a concrete implementation plan.

It defines the minimum viable version of three systems:

1. Signal Radar MVP
2. Contact Policy MVP
3. Voice Brief MVP

Each section specifies: what it does, where it lives in the codebase, what types it introduces, what the demo-safe behavior is, and what the acceptance criteria are.

---

## Design principles for this MVP

- thin new modules, no invasive refactors
- pure helpers and types first, wiring second
- every module must be testable in isolation
- every module must produce demo-safe output without live dependencies
- paper-first: no real notifications escape unless explicitly configured
- all new code lives under `src/skills/alphaos/living-assistant/`

---

## 1. Signal Radar MVP

### What it does

Ingests raw ecosystem events and produces normalized signal events that the judgment engine can evaluate.

The MVP does not need to poll live APIs.
It needs to:

- define the signal event contract
- accept injected events (from tests, demo capsules, or future live feeds)
- normalize them into a standard shape
- tag them with source, type, and timestamp

### Where it lives

```
src/skills/alphaos/living-assistant/
  signal-radar/
    types.ts          — signal event contracts
    normalizer.ts     — raw event → normalized signal
    capsule-loader.ts — load replayable demo event capsules from JSON
    index.ts          — re-exports
```

### Key types

```typescript
// Signal source categories
type SignalSource =
  | 'binance_announcement'
  | 'binance_square'
  | 'binance_alpha'
  | 'market_opportunity'    // from existing discovery engine
  | 'token_risk_change'
  | 'trading_signal'
  | 'meme_rush'
  | 'external_feed'
  | 'manual_inject';

// Signal urgency as estimated by the radar (before judgment)
type SignalUrgency = 'low' | 'medium' | 'high' | 'critical';

// Signal relevance hint (radar's best guess, judgment engine refines)
type SignalRelevanceHint = 'unknown' | 'likely_relevant' | 'likely_irrelevant';

interface NormalizedSignal {
  signalId: string;
  source: SignalSource;
  type: string;                    // e.g. 'new_listing', 'spread_detected', 'risk_alert'
  title: string;                   // one-line human summary
  body?: string;                   // optional detail
  urgency: SignalUrgency;
  relevanceHint: SignalRelevanceHint;
  pair?: string;                   // if market-related
  tokenAddress?: string;           // if token-specific
  chainId?: number;
  detectedAt: string;              // ISO timestamp
  expiresAt?: string;              // optional TTL
  rawPayload?: Record<string, unknown>;  // original data for debugging
  metadata?: Record<string, unknown>;
}
```

### Capsule loader

For demo and testing, the radar should load pre-built event capsules:

```
fixtures/
  signal-capsules/
    binance-announcement-sample.json
    arbitrage-opportunity-sample.json
    token-risk-alert-sample.json
```

Each capsule is a JSON file containing one or more `NormalizedSignal` objects.

### Wiring to existing system

The existing discovery engine already produces `DiscoveryCandidate` objects.
The radar should include a thin bridge:

```typescript
function discoveryToSignal(candidate: DiscoveryCandidate): NormalizedSignal
```

This means the arbitrage discovery flow automatically feeds the signal radar without refactoring.

### Acceptance criteria

- [ ] `NormalizedSignal` type compiles
- [ ] `normalizer.ts` converts at least 3 raw event shapes into `NormalizedSignal`
- [ ] `capsule-loader.ts` loads JSON fixtures and returns `NormalizedSignal[]`
- [ ] `discoveryToSignal` bridge works with existing `DiscoveryCandidate`
- [ ] unit tests pass for all normalizer paths
- [ ] `npm run build` passes
- [ ] `npm test` passes

---

## 2. Contact Policy MVP

### What it does

Takes a `NormalizedSignal` plus user context and decides:

- whether to contact the user
- at what attention level
- through what channel shape

This is the core judgment layer.

### Where it lives

```
src/skills/alphaos/living-assistant/
  contact-policy/
    types.ts       — policy types, attention levels, contact decisions
    engine.ts      — the policy evaluation function
    defaults.ts    — default policy configuration
    index.ts       — re-exports
```

### Key types

```typescript
// The attention ladder from the champion blueprint
type AttentionLevel =
  | 'silent'          // Level 0: log only
  | 'digest'          // Level 0.5: include in next digest
  | 'text_nudge'      // Level 1: short text message
  | 'voice_brief'     // Level 2: micro voice brief
  | 'strong_interrupt' // Level 3: message + voice + explicit choices
  | 'call_escalation'; // Level 4: repeated high-priority contact

type ContactChannel = 'telegram' | 'discord' | 'webhook' | 'voice';

interface ContactDecision {
  shouldContact: boolean;
  attentionLevel: AttentionLevel;
  channels: ContactChannel[];
  reason: string;                  // one-line explanation of why this level
  suggestedActions?: string[];     // e.g. ['simulate_now', 'remind_later', 'ignore']
  cooldownUntil?: string;          // ISO timestamp: don't re-escalate before this
  degradedFrom?: AttentionLevel;   // if policy downgraded the level
  degradeReason?: string;
}

interface UserContext {
  localHour: number;               // 0-23, user's local time
  recentContactCount: number;      // contacts in last N hours
  lastContactAt?: string;          // ISO timestamp
  activeStrategies: string[];      // strategy IDs user cares about
  watchlist: string[];             // pairs or tokens user watches
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  quietHoursStart?: number;        // e.g. 23
  quietHoursEnd?: number;          // e.g. 8
  maxDailyContacts?: number;       // rate limit
}

interface ContactPolicyConfig {
  quietHoursStart: number;
  quietHoursEnd: number;
  maxContactsPerHour: number;
  maxContactsPerDay: number;
  minSignalUrgencyForVoice: SignalUrgency;       // default: 'high'
  minSignalUrgencyForCallEscalation: SignalUrgency; // default: 'critical'
  allowVoiceBrief: boolean;
  allowCallEscalation: boolean;
  digestWindowMinutes: number;     // batch low-priority signals into digest
}
```

### Policy evaluation logic (pseudocode)

```
function evaluateContactPolicy(
  signal: NormalizedSignal,
  userContext: UserContext,
  config: ContactPolicyConfig
): ContactDecision

1. If signal.urgency === 'low' and not on watchlist → silent
2. If in quiet hours and urgency < 'critical' → digest (degrade)
3. If recent contact count exceeds rate limit → digest (degrade)
4. If signal is relevant + urgency 'medium' → text_nudge
5. If signal is relevant + urgency 'high' → voice_brief (if allowed) or strong text
6. If signal is relevant + urgency 'critical' → strong_interrupt or call_escalation
7. Apply degradation rules (quiet hours, rate limits, channel availability)
8. Return ContactDecision with explanation
```

### Demo-safe behavior

In demo mode, the policy engine should:

- always evaluate and return a real `ContactDecision`
- never actually send anything
- include a `demo: true` flag in the output
- log what it would have done

This means the judgment is real, but the side effects are safe.

### Acceptance criteria

- [ ] all types compile
- [ ] `evaluateContactPolicy` handles all 6 attention levels
- [ ] quiet hours degradation works
- [ ] rate limit degradation works
- [ ] watchlist relevance boost works
- [ ] demo mode produces decisions without side effects
- [ ] unit tests cover: silent, digest, text_nudge, voice_brief, strong_interrupt, call_escalation
- [ ] unit tests cover: quiet hours downgrade, rate limit downgrade
- [ ] `npm run build` passes
- [ ] `npm test` passes

---

## 3. Voice Brief MVP

### What it does

Takes a `NormalizedSignal` + `ContactDecision` and produces a short voice-ready text following the One-Breath Voice Brief Protocol.

The MVP does not need to call TTS.
It needs to:

- generate the brief text
- validate it meets the protocol constraints
- return a structured brief object that a delivery layer can consume

### Where it lives

```
src/skills/alphaos/living-assistant/
  voice-brief/
    types.ts       — brief types
    generator.ts   — signal + decision → voice brief text
    validator.ts   — checks protocol constraints
    index.ts       — re-exports
```

### Key types

```typescript
interface VoiceBriefProtocol {
  maxDurationSeconds: number;    // default: 15
  maxSentences: number;          // default: 3
  requiredParts: ['what_happened', 'why_it_matters', 'suggested_next'];
}

interface VoiceBrief {
  briefId: string;
  signalId: string;
  attentionLevel: AttentionLevel;
  text: string;                  // the full brief text, ready for TTS
  parts: {
    whatHappened: string;
    whyItMatters: string;
    suggestedNext: string;
  };
  estimatedDurationSeconds: number;
  sentenceCount: number;
  protocolCompliant: boolean;
  violations?: string[];         // if not compliant, what failed
  language: 'zh' | 'en';
  generatedAt: string;
}
```

### Generation logic

The generator should produce briefs in two languages:

Chinese example:
> 老大，BN 刚出了和你关注的 ETH/USDC 路径相关的新信号。我已经用 paper 模式模拟过，收益为正，风险可解释。你要我现在给你 10 秒结论，还是先发卡片？

English example:
> Hey, Binance just posted a signal related to your ETH/USDC strategy. I ran a paper simulation — positive return, explainable risk. Want a 10-second summary now, or should I send a card?

### Duration estimation

Rough heuristic:

- Chinese: ~4 characters per second
- English: ~2.5 words per second

This is good enough for MVP validation.

### Validator

The validator checks:

- sentence count ≤ `maxSentences`
- estimated duration ≤ `maxDurationSeconds`
- all three required parts are present and non-empty
- no dense numeric dumps (flag if more than 3 numbers in the text)

### Acceptance criteria

- [ ] all types compile
- [ ] generator produces valid briefs for at least 3 signal types
- [ ] generator supports both `zh` and `en`
- [ ] validator correctly flags violations
- [ ] duration estimation is within reasonable bounds
- [ ] unit tests cover: valid brief, too long, too many sentences, missing parts, numeric dump
- [ ] `npm run build` passes
- [ ] `npm test` passes

---

## 4. Integration: the living assistant loop

After the three modules exist independently, they wire together as:

```
NormalizedSignal
  → evaluateContactPolicy(signal, userContext, config)
  → ContactDecision
  → if decision.attentionLevel >= 'voice_brief':
      generateVoiceBrief(signal, decision)
      → VoiceBrief
  → deliver(decision, brief?)
```

### Where the loop lives

```
src/skills/alphaos/living-assistant/
  loop.ts          — the orchestration function
  types.ts         — shared re-exports
  index.ts         — public API
```

### Loop function signature

```typescript
interface LivingAssistantLoopInput {
  signal: NormalizedSignal;
  userContext: UserContext;
  policyConfig: ContactPolicyConfig;
  briefProtocol?: VoiceBriefProtocol;
  demoMode?: boolean;
}

interface LivingAssistantLoopOutput {
  signal: NormalizedSignal;
  decision: ContactDecision;
  brief?: VoiceBrief;
  delivered: boolean;
  deliveryChannel?: ContactChannel;
  demoMode: boolean;
  loopCompletedAt: string;
}

function runLivingAssistantLoop(
  input: LivingAssistantLoopInput
): LivingAssistantLoopOutput
```

### Demo mode behavior

When `demoMode: true`:

- all evaluation runs normally
- brief is generated if applicable
- `delivered` is always `false`
- output includes full decision chain for inspection

This is the judge-facing demo path.

### Acceptance criteria

- [ ] loop function compiles and runs
- [ ] loop correctly chains radar → policy → brief
- [ ] demo mode produces full output without delivery
- [ ] integration test with a sample capsule event passes end-to-end
- [ ] `npm run build` passes
- [ ] `npm test` passes

---

## 5. Wiring to existing notifier

The current `OpenClawNotifier` sends webhook payloads.

The MVP should not replace it.
Instead, add a thin delivery adapter:

```
src/skills/alphaos/living-assistant/
  delivery/
    types.ts
    telegram-adapter.ts   — formats ContactDecision + VoiceBrief for Telegram
    webhook-adapter.ts    — formats for existing webhook path
    index.ts
```

The Telegram adapter should produce:

- for `text_nudge`: a short message
- for `voice_brief`: a message + a voice brief text (ready for TTS)
- for `strong_interrupt`: a message + voice brief + inline button choices
- for `call_escalation`: a high-priority message + voice brief + repeated follow-up plan

All adapters return structured payloads.
Actual sending is out of scope for this MVP (the existing notifier or OpenClaw channel handles delivery).

### Acceptance criteria

- [ ] Telegram adapter produces correct payload shapes for all 4 contactable levels
- [ ] webhook adapter produces correct payload for existing notifier format
- [ ] unit tests pass
- [ ] `npm run build` passes
- [ ] `npm test` passes

---

## 6. Fixtures and demo capsules

Create replayable event capsules for stable demos:

```
fixtures/
  signal-capsules/
    binance-announcement-eth-listing.json
    arbitrage-opportunity-eth-usdc.json
    token-risk-alert-suspicious-contract.json
    square-narrative-meme-surge.json
  demo-scenarios/
    proactive-arbitrage-alert.json     — full loop: signal → decision → brief
    quiet-hours-downgrade.json         — signal during quiet hours → digest
    critical-risk-escalation.json      — high-risk signal → strong interrupt
```

Each demo scenario file contains:

```typescript
interface DemoScenario {
  name: string;
  description: string;
  signal: NormalizedSignal;
  userContext: UserContext;
  policyConfig?: Partial<ContactPolicyConfig>;
  expectedAttentionLevel: AttentionLevel;
  expectedBrief: boolean;
}
```

### Acceptance criteria

- [ ] at least 4 signal capsules exist
- [ ] at least 3 demo scenarios exist
- [ ] all scenarios produce expected results when run through the loop
- [ ] `npm test` passes

---

## 7. API surface

Add one new route group to the existing API server:

```
POST /api/v1/living-assistant/evaluate
  body: { signal, userContext?, policyConfig?, demoMode? }
  returns: LivingAssistantLoopOutput

GET /api/v1/living-assistant/demo/:scenarioName
  returns: LivingAssistantLoopOutput for a named demo scenario

GET /api/v1/living-assistant/capsules
  returns: list of available signal capsules
```

These routes are judge-facing and demo-safe by default.

### Acceptance criteria

- [ ] `/evaluate` accepts a signal and returns a full loop output
- [ ] `/demo/:scenarioName` loads a fixture and returns the result
- [ ] `/capsules` lists available capsules
- [ ] all routes work in demo mode
- [ ] integration tests pass
- [ ] `npm run build` passes
- [ ] `npm test` passes

---

## 8. File structure summary

```
src/skills/alphaos/living-assistant/
  signal-radar/
    types.ts
    normalizer.ts
    capsule-loader.ts
    index.ts
  contact-policy/
    types.ts
    engine.ts
    defaults.ts
    index.ts
  voice-brief/
    types.ts
    generator.ts
    validator.ts
    index.ts
  delivery/
    types.ts
    telegram-adapter.ts
    webhook-adapter.ts
    index.ts
  loop.ts
  types.ts
  index.ts

fixtures/
  signal-capsules/
    binance-announcement-eth-listing.json
    arbitrage-opportunity-eth-usdc.json
    token-risk-alert-suspicious-contract.json
    square-narrative-meme-surge.json
  demo-scenarios/
    proactive-arbitrage-alert.json
    quiet-hours-downgrade.json
    critical-risk-escalation.json

tests/
  living-assistant-signal-radar.test.ts
  living-assistant-contact-policy.test.ts
  living-assistant-voice-brief.test.ts
  living-assistant-loop.test.ts
  living-assistant-delivery.test.ts
  living-assistant-api.test.ts
```

---

## 9. Implementation order

### Phase 1 — Types and signal radar

1. Create `living-assistant/signal-radar/types.ts`
2. Create `living-assistant/signal-radar/normalizer.ts`
3. Create `living-assistant/signal-radar/capsule-loader.ts`
4. Create signal capsule fixtures
5. Write tests
6. Validate: `npm run build && npm test`

### Phase 2 — Contact policy

1. Create `living-assistant/contact-policy/types.ts`
2. Create `living-assistant/contact-policy/defaults.ts`
3. Create `living-assistant/contact-policy/engine.ts`
4. Write tests for all attention levels and degradation paths
5. Validate: `npm run build && npm test`

### Phase 3 — Voice brief

1. Create `living-assistant/voice-brief/types.ts`
2. Create `living-assistant/voice-brief/generator.ts`
3. Create `living-assistant/voice-brief/validator.ts`
4. Write tests
5. Validate: `npm run build && npm test`

### Phase 4 — Loop and delivery

1. Create `living-assistant/loop.ts`
2. Create `living-assistant/delivery/` adapters
3. Create demo scenario fixtures
4. Write integration tests
5. Validate: `npm run build && npm test`

### Phase 5 — API routes

1. Add routes to existing API server
2. Write API integration tests
3. Validate: `npm run build && npm test`

### Phase 6 — Demo polish

1. Verify all demo scenarios produce expected output
2. Verify the judge-facing API path works end-to-end
3. Commit and tag

---

## 10. What this MVP does NOT include

- live API polling (Binance announcements, Square, etc.)
- real TTS audio generation
- real Telegram message sending
- telephony / SIP bridge
- persistent user preference storage
- digest batching scheduler
- multi-user support

These are all valid next steps, but the MVP proves the judgment and contact architecture first.

---

## 11. What this MVP DOES prove

- the signal radar can normalize ecosystem events
- the contact policy engine can make human-quality interruption decisions
- the voice brief generator can produce protocol-compliant assistant briefs
- the full loop chains correctly from signal to decision to brief
- the system is demo-safe and judge-inspectable
- the architecture is modular and testable
- replayable event capsules enable stable, repeatable demos

That is enough to demonstrate the champion-level living assistant concept.

---

## 12. One-sentence summary

**This MVP builds the minimum viable signal radar, contact policy engine, and voice brief generator to prove that Personal Butler can sense, judge, and contact a human like a real assistant — safely, explainably, and demo-ready.**
