# Vigil Judge Guide

This guide is a one-page evaluator view of what Vigil is, what to inspect first, and how to run a reliable 5-minute demo.

Evidence-focused companion docs:
- `docs/EVIDENCE.md` (claim -> evidence -> verification mapping)
- `docs/METRICS.md` (metric source and confidence classification)
- `docs/VALIDATION.md` (test map, demo boundaries, unresolved verification gaps)

## 1) What this project is

Vigil is a BNB ecosystem assistant runtime that:

- senses ecosystem signals,
- judges whether a user should be interrupted,
- and routes outcomes through paper-first, explainable execution paths.

Implementation note: parts of the runtime still use transitional internal names (`alphaos`, `onchainos`) in code and env variables; this is expected in the current repo state.

## 2) What problem it solves

In practical operations, teams face three recurring issues:

1. too many raw signals and not enough prioritization,
2. weak safety boundaries between demo behavior and real execution,
3. poor evidence quality when explaining "why this action was taken."

Vigil addresses this with a single loop: `sense -> judge -> brief/act`, plus paper-first execution and replayable outputs.

## 3) Three things to look at

1. **Judgment loop quality (Living Assistant)**
- Run `npm run demo:living-assistant`.
- Inspect fixture-driven scenarios in `fixtures/demo-scenarios/`.
- For API mode, inspect `/api/v1/living-assistant/demo/:scenarioName` and `/api/v1/living-assistant/evaluate`.

2. **Execution safety and evidence output**
- Start the API (`npm run dev`) and run `npm run demo:discovery`.
- Review generated artifacts in `demo-output/discovery-demo-*.json`.
- Check that the flow remains paper-safe by default unless explicitly switched.

3. **Trust and communication layer (Agent-Comm)**
- Review `scripts/agent-comm-demo.sh` and `docs/AGENT_COMM_ONE_PAGER.md`.
- Look for wallet-based identity, signed contact cards, and encrypted message path.

## 4) 5-minute demo path

```bash
npm install
cp .env.example .env

# Terminal A
npm run dev

# Terminal B
npm run demo:judge
```

What `demo:judge` does:

1. verifies basic prerequisites,
2. runs `demo:living-assistant` (stable local path),
3. if API health is available, attempts `demo:discovery`,
4. points you to evidence artifacts under `demo-output/`.

If you see `401 unauthorized`, export the same secret used by the API before rerunning:

```bash
export ALPHAOS_API_SECRET="<your API_SECRET value>"
```

## 5) Real vs mock boundaries (repo-validated)

Treat the following as **real/external path**:

- `npm run demo:living-assistant -- --live` (live polling path; external feeds/config dependent),
- execution backend integration when `ONCHAINOS_*` credentials are configured,
- real outbound delivery when `--send` / `--call` is used with valid provider credentials.

Treat the following as **mock/demo-safe path**:

- default `npm run demo:living-assistant` (fixture-driven local scenarios),
- `/api/v1/living-assistant/demo/:scenarioName` (demo scenario route),
- `npm run demo:discovery` default paper approval mode (`ALPHAOS_DISCOVERY_APPROVE_MODE=paper`),
- `npm run demo:living-assistant -- --call --demo-delivery` (simulated call delivery).

This boundary keeps demonstrations credible while avoiding claims that depend on unstable live conditions.
