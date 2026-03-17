import { describe, expect, it } from "vitest";
import {
  normalizeEvalReasonBundle,
  normalizeExecutionReasonBundle,
  normalizeReasonMessage,
  normalizeRiskReasonBundle,
  normalizeSimulationReasonBundle,
} from "../src/skills/alphaos/module/reason-normalizer";

describe("arbitrage module reason normalizer", () => {
  it("maps evaluate threshold failures to normalized blocking reasons", () => {
    const result = normalizeEvalReasonBundle({
      accepted: false,
      reason: "net edge 18.6 bps below threshold",
      opportunity: {
        id: "opp-1",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "dex-a",
        sellDex: "dex-b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: "2026-03-17T01:00:00.000Z",
      },
    });

    expect(result.reasonCodes).toContain("net_edge_below_threshold");
    expect(result.blockingReasonCodes).toContain("net_edge_below_threshold");
  });

  it("maps simulation pass text into profitable simulation reasons", () => {
    const result = normalizeSimulationReasonBundle({
      grossUsd: 10,
      feeUsd: 2,
      netUsd: 8,
      netEdgeBps: 80,
      pFail: 0.08,
      expectedShortfall: 1,
      latencyAdjustedNetUsd: 7,
      pass: true,
      reason: "risk-adjusted net edge 71.00bps passed",
    });

    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        "simulation_completed",
        "simulation_profitable",
        "latency_risk_within_bounds",
      ]),
    );
    expect(result.blockingReasonCodes).toHaveLength(0);
  });

  it("maps live-gate failures and risk strings into blocking reason codes", () => {
    const result = normalizeRiskReasonBundle({
      passed: false,
      reasons: [
        "LIVE_ENABLED is false",
        "consecutive failures exceeded threshold",
      ],
    });

    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        "live_gate_failed",
        "mode_not_allowed",
        "too_many_recent_failures",
        "execution_backend_unready",
      ]),
    );
    expect(result.blockingReasonCodes).toEqual(
      expect.arrayContaining([
        "live_gate_failed",
        "execution_backend_unready",
      ]),
    );
  });

  it("prefers existing errorType for execution failure mapping", () => {
    const result = normalizeExecutionReasonBundle(
      {
        success: false,
        txHash: "",
        status: "failed",
        grossUsd: 0,
        feeUsd: 0,
        netUsd: 0,
        error: "permission denied by backend policy",
        errorType: "permission_denied",
      },
      {
        requestedMode: "live",
        effectiveMode: "live",
      },
    );

    expect(result.reasonCodes).toContain("permission_denied");
    expect(result.reasonCodes).toContain("execution_failed");
    expect(result.blockingReasonCodes).toContain("permission_denied");
  });

  it("keeps generic pattern fallback extensible", () => {
    const result = normalizeReasonMessage("missing fresh quotes for candidate", "generic");
    expect(result.blockingReasonCodes).toContain("quote_stale");
  });
});

