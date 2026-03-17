import { describe, expect, it } from "vitest";
import { adaptArbitrageModuleResponse } from "../src/skills/alphaos/module/response-adapter";
import type { DiscoveryApproveResult, DiscoveryCandidate, EvalResult, Opportunity } from "../src/skills/alphaos/types";

function makeDiscoveryCandidate(): DiscoveryCandidate {
  return {
    id: "cand_001",
    sessionId: "session_001",
    strategyId: "spread-threshold",
    pair: "ETH/USDC",
    buyDex: "dex-a",
    sellDex: "dex-b",
    signalTs: "2026-03-17T01:00:00.000Z",
    score: 88,
    expectedNetBps: 72,
    expectedNetUsd: 7.2,
    confidence: 0.81,
    reason: "spread detected and ranked high",
    input: {
      spreadBps: 110,
      notionalUsd: 1000,
      liquidityUsd: 240000,
      volatility: 0.02,
      avgLatencyMs: 280,
    },
    status: "approved",
  };
}

function makeApproveResult(overrides?: Partial<DiscoveryApproveResult>): DiscoveryApproveResult {
  return {
    approved: true,
    sessionId: "session_001",
    candidateId: "cand_001",
    mode: "paper",
    effectiveMode: "paper",
    opportunityId: "opp_001",
    simulation: {
      grossUsd: 10.8,
      feeUsd: 2.1,
      netUsd: 8.7,
      netEdgeBps: 87,
      pFail: 0.09,
      expectedShortfall: 1.2,
      latencyAdjustedNetUsd: 7.2,
      pass: true,
      reason: "risk-adjusted net edge 72.00bps passed",
    },
    tradeResult: {
      success: true,
      txHash: "paper-cand_001",
      status: "confirmed",
      grossUsd: 10.8,
      feeUsd: 2.1,
      netUsd: 8.7,
    },
    degradedToPaper: false,
    tradeId: "trade_001",
    ...overrides,
  };
}

describe("arbitrage module response adapter", () => {
  it("adapts a successful paper approval into module-facing output shape", () => {
    const candidate = makeDiscoveryCandidate();
    const response = adaptArbitrageModuleResponse({
      requestId: "req_paper_001",
      mode: "paper",
      requestedMode: "paper",
      discoveryCandidate: candidate,
      approveResult: makeApproveResult(),
    });

    expect(response.module).toBe("arbitrage");
    expect(response.status).toBe("candidate_accepted");
    expect(response.decision).toBe("paper_trade");
    expect(response.execution?.requestedMode).toBe("paper");
    expect(response.execution?.effectiveMode).toBe("paper");
    expect(response.execution?.degradedToPaper).toBe(false);
    expect(response.candidate?.reasonCodes).toContain("simulation_profitable");
    expect(response.skillUsage.required).toContain("binance/spot");
  });

  it("surfaces requested live vs effective paper downgrade with normalized reasons", () => {
    const candidate = makeDiscoveryCandidate();
    const response = adaptArbitrageModuleResponse({
      requestId: "req_degrade_001",
      mode: "live",
      requestedMode: "live",
      effectiveMode: "paper",
      discoveryCandidate: candidate,
      approveResult: makeApproveResult({
        mode: "live",
        effectiveMode: "paper",
        degradedToPaper: true,
      }),
    });

    expect(response.status).toBe("candidate_executed_with_downgrade");
    expect(response.decision).toBe("paper_trade");
    expect(response.execution?.requestedMode).toBe("live");
    expect(response.execution?.effectiveMode).toBe("paper");
    expect(response.execution?.degradedToPaper).toBe(true);
    expect(response.execution?.reasonCodes).toEqual(
      expect.arrayContaining(["degraded_to_paper", "live_gate_failed"]),
    );
  });

  it("returns reject shape for validation-blocked candidate", () => {
    const opportunity: Opportunity = {
      id: "opp_reject_001",
      strategyId: "dex-arbitrage",
      pair: "BTC/USDC",
      buyDex: "dex-a",
      sellDex: "dex-b",
      buyPrice: 100,
      sellPrice: 100.4,
      grossEdgeBps: 40,
      detectedAt: "2026-03-17T01:30:00.000Z",
      metadata: {
        notionalUsd: 1000,
      },
    };
    const evalResult: EvalResult = {
      accepted: false,
      reason: "net edge 18.6 bps below threshold",
      opportunity,
    };

    const response = adaptArbitrageModuleResponse({
      requestId: "req_reject_001",
      mode: "paper",
      evalResult,
      opportunity,
      readinessContext: {
        balanceReady: true,
        sourceSkill: "binance/assets",
      },
    });

    expect(response.status).toBe("candidate_rejected");
    expect(response.decision).toBe("reject");
    expect(response.simulation).toBeNull();
    expect(response.execution).toBeNull();
    expect(response.candidate?.blockingReasonCodes).toContain("net_edge_below_threshold");
  });
});

