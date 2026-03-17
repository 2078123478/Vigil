# Living Assistant Demo Runner

Run these commands to see Personal Butler sense, judge, and contact like a real assistant.

Default port is `3000`. If your server uses another port, replace it in the commands below.

## Prerequisites

- API server is running (`npm run dev` or your API server command).
- If API auth is enabled, set your bearer token:

```bash
export API_SECRET="your-api-secret"
```

## 1) List available signal capsules

```bash
curl -sS -H "Authorization: Bearer ${API_SECRET}" \
  localhost:3000/api/v1/living-assistant/capsules | jq .
```

What to look for:
- `items` includes replayable capsules (for stable, paper-safe demos).

## 2) Run the proactive arbitrage alert scenario

```bash
curl -sS -H "Authorization: Bearer ${API_SECRET}" \
  localhost:3000/api/v1/living-assistant/demo/proactive-arbitrage-alert | jq .
```

What to look for:
- `signal`: normalized ecosystem signal.
- `decision`: `attentionLevel`, `channels`, and `reason`.
- `brief`: `text`, `parts`, and `protocolCompliant`.
- `demoMode`: should be `true` in demo routes.

## 3) Run the quiet hours downgrade scenario

```bash
curl -sS -H "Authorization: Bearer ${API_SECRET}" \
  localhost:3000/api/v1/living-assistant/demo/quiet-hours-downgrade | jq .
```

What to look for:
- attention level is downgraded to `digest` because of quiet hours.

## 4) Run the critical risk escalation scenario

```bash
curl -sS -H "Authorization: Bearer ${API_SECRET}" \
  localhost:3000/api/v1/living-assistant/demo/critical-risk-escalation | jq .
```

What to look for:
- escalation decision reaches `strong_interrupt` or `call_escalation`.

## 5) Custom evaluation

```bash
curl -sS -X POST localhost:3000/api/v1/living-assistant/evaluate \
  -H "Authorization: Bearer ${API_SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{
    "signal": {
      "kind": "binance_announcement",
      "title": "New listing watch",
      "body": "A token in your watchlist enters listing window.",
      "type": "new_listing",
      "pair": "ETH/USDC",
      "urgency": "high",
      "relevanceHint": "likely_relevant",
      "detectedAt": "2026-03-17T10:10:00.000Z"
    },
    "userContext": {
      "localHour": 10,
      "recentContactCount": 0,
      "activeStrategies": ["dex-arbitrage"],
      "watchlist": ["ETH/USDC"],
      "riskTolerance": "moderate",
      "quietHoursStart": 23,
      "quietHoursEnd": 8
    },
    "demoMode": true
  }' | jq .
```

What to look for:
- the full loop output is returned in one response: `signal`, `decision`, `brief`, `delivered`, `demoMode`.

## 6) What you just saw

- **Radar sensed**: raw event -> normalized `signal`.
- **Policy judged**: relevance + urgency -> `attentionLevel` and channels.
- **Brief generated**: a one-breath micro-brief with protocol checks.

That is the core Living Assistant loop: `sense -> judge -> brief`.
