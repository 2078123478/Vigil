import type { DiscoveryCandidate, EvalResult, Opportunity, SimulationResult, TradeResult } from "../types";
import {
  mergeReasonBundles,
  normalizeEvalReasonBundle,
  normalizeExecutionReasonBundle,
  normalizeReasonMessage,
  normalizeRiskReasonBundle,
  normalizeSimulationReasonBundle,
} from "./reason-normalizer";
import type {
  ArbitrageCandidateLifecycleStatus,
  ArbitrageCandidateRecord,
  ArbitrageDecision,
  ArbitrageDecisionStatus,
  ArbitrageEffectiveMode,
  ArbitrageModuleResponse,
  ArbitrageModuleStatus,
  ArbitrageReasonCode,
  ArbitrageResponseAdapterInput,
  ArbitrageRequestedMode,
  ArbitrageSkillUsage,
  ArbitrageSummaryView,
  ArbitrageTradeStatus,
} from "./types";

const DEFAULT_SKILL_USAGE: ArbitrageSkillUsage = {
  required: ["binance/spot", "binance/assets"],
  enrichment: [],
  distribution: [],
  metadata: {
    source: "placeholder",
    notes: "prototype placeholder attribution; replace with real adapter wiring when upstream skills are connected",
  },
};

interface OpportunityLike {
  id: string;
  pair: string;
  buyDex: string;
  sellDex: string;
  grossEdgeBps: number;
  detectedAt: string;
  metadata?: Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function toRequestedMode(mode: string | undefined): ArbitrageRequestedMode | undefined {
  if (!mode) {
    return undefined;
  }
  if (mode === "paper" || mode === "live" || mode === "scout" || mode === "assisted-live") {
    return mode;
  }
  return undefined;
}

function toEffectiveMode(mode: string | undefined): ArbitrageEffectiveMode | undefined {
  if (!mode) {
    return undefined;
  }
  if (mode === "paper" || mode === "live" || mode === "scout" || mode === "assisted-live") {
    return mode;
  }
  return undefined;
}

function toOpportunityFromDiscoveryCandidate(candidate: DiscoveryCandidate | undefined): OpportunityLike | undefined {
  if (!candidate) {
    return undefined;
  }
  return {
    id: candidate.id,
    pair: candidate.pair,
    buyDex: candidate.buyDex,
    sellDex: candidate.sellDex,
    grossEdgeBps: asNumber(candidate.input?.spreadBps) ?? candidate.expectedNetBps,
    detectedAt: candidate.signalTs,
    metadata: candidate.input,
  };
}

function toOpportunityLike(opportunity: Opportunity | undefined): OpportunityLike | undefined {
  if (!opportunity) {
    return undefined;
  }
  return {
    id: opportunity.id,
    pair: opportunity.pair,
    buyDex: opportunity.buyDex,
    sellDex: opportunity.sellDex,
    grossEdgeBps: opportunity.grossEdgeBps,
    detectedAt: opportunity.detectedAt,
    metadata: opportunity.metadata,
  };
}

function resolveCandidateLifecycleStatus(input: {
  discoveryCandidate?: DiscoveryCandidate;
  evalResult?: EvalResult;
  simulation?: SimulationResult;
  trade?: TradeResult;
}): ArbitrageCandidateLifecycleStatus {
  const discoveryStatus = input.discoveryCandidate?.status;
  if (discoveryStatus === "rejected") {
    return "rejected";
  }
  if (discoveryStatus === "failed") {
    return "failed";
  }
  if (discoveryStatus === "executed") {
    return "executed";
  }
  if (input.trade) {
    return input.trade.success ? "executed" : "failed";
  }
  if (input.simulation) {
    return input.simulation.pass ? "simulated" : "rejected";
  }
  if (input.evalResult) {
    return input.evalResult.accepted ? "validated" : "rejected";
  }
  if (discoveryStatus === "approved") {
    return "approved";
  }
  return "discovered";
}

function resolveDecision(input: {
  requestedMode: ArbitrageRequestedMode;
  effectiveMode: ArbitrageEffectiveMode;
  degradedToPaper: boolean;
  evalResult?: EvalResult;
  simulation?: SimulationResult;
  trade?: TradeResult;
}): ArbitrageDecision {
  if (input.evalResult && !input.evalResult.accepted) {
    return "reject";
  }
  if (input.simulation && !input.simulation.pass) {
    return "reject";
  }
  if (input.trade) {
    if (!input.trade.success) {
      if (input.effectiveMode === "paper") {
        return "paper_trade";
      }
      return "execute";
    }
    if (input.effectiveMode === "paper" || input.degradedToPaper) {
      return "paper_trade";
    }
    return "execute";
  }
  if (input.requestedMode === "assisted-live") {
    return "propose_execution";
  }
  if (input.requestedMode === "scout") {
    return "simulate_only";
  }
  if (input.simulation?.pass) {
    return input.requestedMode === "live" ? "execute" : "paper_trade";
  }
  return "monitor";
}

function resolveDecisionStatus(
  decision: ArbitrageDecision,
  trade: TradeResult | undefined,
): ArbitrageDecisionStatus {
  if (decision === "reject") {
    return "rejected";
  }
  if (decision === "monitor") {
    return "monitoring";
  }
  if (decision === "propose_execution") {
    return "pending_approval";
  }
  if (trade) {
    return trade.success ? "executed" : "failed";
  }
  return "accepted";
}

function resolveTopLevelStatus(input: {
  decision: ArbitrageDecision;
  degradedToPaper: boolean;
  trade?: TradeResult;
}): ArbitrageModuleStatus {
  if (input.decision === "reject") {
    return "candidate_rejected";
  }
  if (input.decision === "monitor") {
    return "candidate_monitored";
  }
  if (input.decision === "simulate_only") {
    return "candidate_simulated";
  }
  if (input.decision === "propose_execution") {
    return "candidate_ready_for_approval";
  }
  if (!input.trade) {
    return "candidate_accepted";
  }
  if (input.degradedToPaper) {
    return "candidate_executed_with_downgrade";
  }
  if (!input.trade.success) {
    return "candidate_failed";
  }
  if (input.decision === "execute") {
    return "candidate_executed";
  }
  return "candidate_accepted";
}

function ensureReasonCoverage(
  decision: ArbitrageDecision,
  reasonCodes: ArbitrageReasonCode[],
  blockingReasonCodes: ArbitrageReasonCode[],
): { reasonCodes: ArbitrageReasonCode[]; blockingReasonCodes: ArbitrageReasonCode[] } {
  const allReasonCodes = [...reasonCodes];
  const allBlocking = [...blockingReasonCodes];
  if (allReasonCodes.length === 0) {
    if (decision === "reject") {
      allReasonCodes.push("risk_policy_failed");
      allBlocking.push("risk_policy_failed");
    } else if (decision === "paper_trade") {
      allReasonCodes.push("paper_mode_selected");
    } else if (decision === "execute") {
      allReasonCodes.push("execution_started");
    } else if (decision === "propose_execution") {
      allReasonCodes.push("approval_required");
    } else if (decision === "simulate_only") {
      allReasonCodes.push("simulation_completed");
    } else {
      allReasonCodes.push("monitor_only");
    }
  }
  return {
    reasonCodes: dedupe(allReasonCodes),
    blockingReasonCodes: dedupe(allBlocking),
  };
}

function toTradeStatus(status: TradeResult["status"] | undefined): ArbitrageTradeStatus | undefined {
  if (!status) {
    return undefined;
  }
  if (status === "submitted" || status === "confirmed" || status === "failed") {
    return status;
  }
  return undefined;
}

function formatUsd(input: number | undefined): string {
  if (input === undefined) {
    return "n/a";
  }
  return `${input.toFixed(2)}USD`;
}

function formatBps(input: number | undefined): string {
  if (input === undefined) {
    return "n/a";
  }
  return `${input.toFixed(1)}bps`;
}

function normalizeTokenRisk(value: unknown): "low" | "normal" | "high" | "unknown" | undefined {
  if (value === "low" || value === "normal" || value === "high" || value === "unknown") {
    return value;
  }
  return undefined;
}

function mergeSkillUsage(input: ArbitrageResponseAdapterInput): ArbitrageSkillUsage {
  const required = dedupe([
    ...DEFAULT_SKILL_USAGE.required,
    ...(input.skillUsage?.required ?? []),
    ...(input.marketContext?.sourceSkill ? [input.marketContext.sourceSkill] : []),
    ...(input.readinessContext?.sourceSkill ? [input.readinessContext.sourceSkill] : []),
  ]);
  const enrichment = dedupe([
    ...DEFAULT_SKILL_USAGE.enrichment,
    ...(input.skillUsage?.enrichment ?? []),
    ...(input.enrichmentContext?.sourceSkills ?? []),
  ]);
  const distribution = dedupe([
    ...DEFAULT_SKILL_USAGE.distribution,
    ...(input.skillUsage?.distribution ?? []),
    ...(input.distributionContext?.sourceSkill ? [input.distributionContext.sourceSkill] : []),
  ]);
  const metadata = input.skillUsage?.metadata ?? DEFAULT_SKILL_USAGE.metadata;
  return {
    required,
    enrichment,
    distribution,
    metadata,
  };
}

function buildSummary(input: {
  decision: ArbitrageDecision;
  status: ArbitrageModuleStatus;
  requestedMode: ArbitrageRequestedMode;
  effectiveMode: ArbitrageEffectiveMode;
  degradedToPaper: boolean;
  pair: string;
  buyVenue: string | undefined;
  sellVenue: string | undefined;
  expectedNetUsd: number | undefined;
  expectedNetEdgeBps: number | undefined;
  reasonCodes: ArbitrageReasonCode[];
}): ArbitrageSummaryView {
  let headline: string;
  let explanation: string;
  if (input.status === "candidate_rejected") {
    headline = "Candidate rejected before simulation or execution.";
    explanation = "A candidate was detected, but validation or policy checks blocked progress.";
  } else if (input.status === "candidate_ready_for_approval") {
    headline = "Candidate proposed for assisted-live execution.";
    explanation = "The candidate passed checks and simulation, but policy requires approval before execution.";
  } else if (input.status === "candidate_executed_with_downgrade") {
    headline = "Candidate executed in paper mode after live downgrade.";
    explanation = "Live execution was requested, but safety gates downgraded execution to paper mode.";
  } else if (input.status === "candidate_executed") {
    headline = "Candidate executed in live mode.";
    explanation = "Validation and simulation passed, and execution completed in live mode.";
  } else if (input.status === "candidate_failed") {
    headline = "Candidate execution failed.";
    explanation = "The candidate reached execution, but the trade failed and was recorded for review.";
  } else if (input.status === "candidate_simulated") {
    headline = "Candidate simulated without execution.";
    explanation = "The candidate remained in simulation/analysis mode and was not executed.";
  } else if (input.status === "candidate_monitored") {
    headline = "Candidate marked for monitoring.";
    explanation = "A spread signal was observed but routed to monitor-only flow.";
  } else {
    headline = "Arbitrage candidate accepted for paper trade.";
    explanation = "The candidate passed validation and simulation and was accepted for paper execution flow.";
  }

  const route = `${input.buyVenue ?? "unknown"}→${input.sellVenue ?? "unknown"}`;
  const decisionText =
    input.decision === "reject"
      ? "rejected"
      : input.decision === "propose_execution"
        ? "proposed"
        : input.decision === "execute"
          ? "executed"
          : "accepted";
  const operatorText =
    `[arbitrage][${input.effectiveMode}] ${decisionText} ${input.pair || "unknown"} ${route} ` +
    `expectedNet=${formatUsd(input.expectedNetUsd)} netEdge=${formatBps(input.expectedNetEdgeBps)} ` +
    `reasons=${input.reasonCodes.slice(0, 4).join(",")}`;
  const judgeText =
    `We detected an arbitrage candidate on ${input.pair || "a tracked pair"}, validated context and safety checks, ` +
    `then routed it to ${input.effectiveMode} mode with decision ${input.decision}.`;

  return {
    headline,
    explanation,
    operatorText,
    judgeText,
  };
}

export function adaptArbitrageModuleResponse(input: ArbitrageResponseAdapterInput): ArbitrageModuleResponse {
  const evalResult = input.evalResult;
  const approveResult = input.approveResult;
  const simulation = input.simulationResult ?? approveResult?.simulation;
  const trade = input.tradeResult ?? approveResult?.tradeResult;
  const discoveryCandidate = input.discoveryCandidate;
  const opportunity =
    toOpportunityLike(input.opportunity ?? evalResult?.opportunity) ??
    toOpportunityFromDiscoveryCandidate(discoveryCandidate);
  const requestedMode =
    input.requestedMode ??
    toRequestedMode(approveResult?.mode) ??
    input.mode ??
    "paper";
  const effectiveMode =
    input.effectiveMode ??
    toEffectiveMode(approveResult?.effectiveMode) ??
    requestedMode;
  const degradedToPaper = Boolean(
    approveResult?.degradedToPaper ??
    (requestedMode === "live" && effectiveMode === "paper"),
  );

  const readinessBundle = input.readinessContext
    ? input.readinessContext.balanceReady
      ? { reasonCodes: ["balance_context_attached", "balance_ready"] satisfies ArbitrageReasonCode[], blockingReasonCodes: [] }
      : {
          reasonCodes: ["balance_context_attached", "balance_insufficient"] satisfies ArbitrageReasonCode[],
          blockingReasonCodes: ["balance_insufficient"] satisfies ArbitrageReasonCode[],
        }
    : { reasonCodes: [], blockingReasonCodes: [] };

  const enrichmentReasonCodes: ArbitrageReasonCode[] = [];
  const enrichmentBlockingCodes: ArbitrageReasonCode[] = [];
  if (input.enrichmentContext?.token) {
    enrichmentReasonCodes.push("token_info_attached");
  }
  if (input.enrichmentContext?.risk) {
    enrichmentReasonCodes.push("token_audit_attached");
    if ((input.enrichmentContext.risk.auditFlags ?? []).length > 0) {
      enrichmentReasonCodes.push("audit_flagged");
      enrichmentBlockingCodes.push("audit_flagged");
    } else {
      enrichmentReasonCodes.push("audit_clear");
    }
    if (input.enrichmentContext.risk.addressRiskLevel === "high") {
      enrichmentReasonCodes.push("address_risk_high");
      enrichmentBlockingCodes.push("address_risk_high");
    } else if (input.enrichmentContext.risk.addressRiskLevel) {
      enrichmentReasonCodes.push("address_risk_acceptable");
    }
  }
  if (input.enrichmentContext?.signal) {
    enrichmentReasonCodes.push("signal_context_attached");
    if (input.enrichmentContext.signal.signalSupport) {
      enrichmentReasonCodes.push("signal_supported_candidate");
    }
  }
  if (input.enrichmentContext?.marketNarrative?.rankSource) {
    enrichmentReasonCodes.push("market_rank_selected");
  }
  if (input.enrichmentContext?.marketNarrative?.eventDriven) {
    enrichmentReasonCodes.push("event_driven_candidate");
  }
  if (input.marketContext) {
    enrichmentReasonCodes.push("chain_context_attached");
  }

  const spreadReasonBundle = opportunity
    ? opportunity.grossEdgeBps >= 0
      ? { reasonCodes: ["spread_detected"] satisfies ArbitrageReasonCode[], blockingReasonCodes: [] }
      : {
          reasonCodes: ["spread_below_threshold"] satisfies ArbitrageReasonCode[],
          blockingReasonCodes: ["spread_below_threshold"] satisfies ArbitrageReasonCode[],
        }
    : { reasonCodes: [], blockingReasonCodes: [] };

  const modeReasonBundle = {
    reasonCodes: [
      requestedMode === "paper" || effectiveMode === "paper" ? ("paper_mode_selected" satisfies ArbitrageReasonCode) : undefined,
      requestedMode === "assisted-live" ? ("approval_required" satisfies ArbitrageReasonCode) : undefined,
      requestedMode === "live" && effectiveMode === "live" ? ("auto_execute_allowed" satisfies ArbitrageReasonCode) : undefined,
      degradedToPaper ? ("degraded_to_paper" satisfies ArbitrageReasonCode) : undefined,
      requestedMode === "live" && effectiveMode === "live" ? ("live_gate_passed" satisfies ArbitrageReasonCode) : undefined,
      requestedMode === "live" && effectiveMode === "paper" ? ("live_gate_failed" satisfies ArbitrageReasonCode) : undefined,
    ].filter((code): code is ArbitrageReasonCode => Boolean(code)),
    blockingReasonCodes: [
      requestedMode === "live" && effectiveMode === "paper" ? ("execution_backend_unready" satisfies ArbitrageReasonCode) : undefined,
    ].filter((code): code is ArbitrageReasonCode => Boolean(code)),
  };

  const reasonBundle = mergeReasonBundles([
    discoveryCandidate?.reason
      ? normalizeReasonMessage(discoveryCandidate.reason, "discovery")
      : { reasonCodes: [], blockingReasonCodes: [] },
    evalResult ? normalizeEvalReasonBundle(evalResult) : { reasonCodes: [], blockingReasonCodes: [] },
    simulation ? normalizeSimulationReasonBundle(simulation) : { reasonCodes: [], blockingReasonCodes: [] },
    input.riskGate ? normalizeRiskReasonBundle(input.riskGate) : { reasonCodes: [], blockingReasonCodes: [] },
    trade
      ? normalizeExecutionReasonBundle(trade, {
          requestedMode,
          effectiveMode,
          degradedToPaper,
        })
      : { reasonCodes: [], blockingReasonCodes: [] },
    spreadReasonBundle,
    readinessBundle,
    {
      reasonCodes: dedupe(enrichmentReasonCodes),
      blockingReasonCodes: dedupe(enrichmentBlockingCodes),
    },
    modeReasonBundle,
  ]);

  const decision = resolveDecision({
    requestedMode,
    effectiveMode,
    degradedToPaper,
    evalResult,
    simulation,
    trade,
  });
  const normalizedReasons = ensureReasonCoverage(decision, reasonBundle.reasonCodes, reasonBundle.blockingReasonCodes);

  const candidateStatus = resolveCandidateLifecycleStatus({
    discoveryCandidate,
    evalResult,
    simulation,
    trade,
  });
  const moduleStatus = resolveTopLevelStatus({
    decision,
    degradedToPaper,
    trade,
  });
  const decisionStatus = resolveDecisionStatus(decision, trade);

  const candidateId = discoveryCandidate?.id ?? opportunity?.id ?? approveResult?.candidateId ?? "candidate_unknown";
  const pair = opportunity?.pair ?? discoveryCandidate?.pair ?? "unknown";
  const buyVenue = opportunity?.buyDex ?? discoveryCandidate?.buyDex;
  const sellVenue = opportunity?.sellDex ?? discoveryCandidate?.sellDex;
  const detectedAt =
    opportunity?.detectedAt ??
    discoveryCandidate?.signalTs ??
    new Date().toISOString();
  const notionalUsd =
    asNumber(opportunity?.metadata?.notionalUsd) ??
    asNumber(discoveryCandidate?.input?.notionalUsd) ??
    undefined;
  const expectedNetUsd = simulation?.latencyAdjustedNetUsd ?? simulation?.netUsd ?? discoveryCandidate?.expectedNetUsd;
  const expectedNetEdgeBps =
    simulation
      ? notionalUsd && notionalUsd > 0
        ? (simulation.latencyAdjustedNetUsd / notionalUsd) * 10_000
        : simulation.netEdgeBps
      : discoveryCandidate?.expectedNetBps;
  const skillUsage = mergeSkillUsage(input);

  const candidate: ArbitrageCandidateRecord = {
    candidateId,
    module: "arbitrage",
    status: candidateStatus,
    opportunityType: "dex_spread",
    pair,
    buyVenue,
    sellVenue,
    detectedAt,
    metrics: {
      grossEdgeBps: opportunity?.grossEdgeBps ?? discoveryCandidate?.expectedNetBps,
      expectedNetEdgeBps,
      expectedNetUsd,
      notionalUsd,
      liquidityUsd: asNumber(opportunity?.metadata?.liquidityUsd),
      volatility: asNumber(opportunity?.metadata?.volatility),
      avgLatencyMs: asNumber(opportunity?.metadata?.avgLatencyMs),
    },
    context: {
      chainId:
        input.marketContext?.marketContext?.chainId ??
        input.enrichmentContext?.token?.chainId ??
        asNumber(opportunity?.metadata?.chainId),
      tokenRisk:
        input.enrichmentContext?.risk?.tokenRisk ??
        normalizeTokenRisk(opportunity?.metadata?.tokenRisk),
      balanceReady:
        input.readinessContext?.balanceReady ??
        asBoolean(opportunity?.metadata?.balanceReady),
      signalSupport:
        input.enrichmentContext?.signal?.signalSupport ??
        asBoolean(opportunity?.metadata?.signalSupport),
      quoteFreshnessMs:
        asNumber(opportunity?.metadata?.quoteFreshnessMs) ??
        asNumber(opportunity?.metadata?.avgLatencyMs),
    },
    reasonCodes: normalizedReasons.reasonCodes,
    blockingReasonCodes: normalizedReasons.blockingReasonCodes,
    skillSources: dedupe([
      ...skillUsage.required,
      ...skillUsage.enrichment,
      ...skillUsage.distribution,
    ]),
    discoveredAt: detectedAt,
    simulatedAt: simulation ? detectedAt : undefined,
    approvedAt: decision === "propose_execution" ? detectedAt : undefined,
    executedAt: trade?.success ? detectedAt : undefined,
    closedAt: trade || decision === "reject" ? detectedAt : undefined,
  };

  const simulationView = simulation
    ? {
        status: simulation.pass ? "pass" : "fail",
        summary: simulation.reason,
        metrics: {
          grossUsd: simulation.grossUsd,
          feeUsd: simulation.feeUsd,
          netUsd: simulation.netUsd,
          netEdgeBps: simulation.netEdgeBps,
          latencyAdjustedNetUsd: simulation.latencyAdjustedNetUsd,
          expectedShortfall: simulation.expectedShortfall,
          pFail: simulation.pFail,
        },
        reasonCodes: normalizeSimulationReasonBundle(simulation).reasonCodes,
      }
    : null;

  const executionView =
    trade || decision === "paper_trade" || decision === "execute" || decision === "propose_execution"
      ? {
          requestedMode,
          effectiveMode,
          degradedToPaper,
          status: trade
            ? (trade.success ? "completed" : "failed")
            : (decision === "propose_execution" ? "awaiting_approval" : "skipped"),
          tradeStatus: trade ? toTradeStatus(trade.status) : (decision === "propose_execution" ? "pending" : undefined),
          txHash: trade ? trade.txHash || null : null,
          tradeId: approveResult?.tradeId,
          summary: trade
            ? (trade.success
              ? (degradedToPaper
                ? "Live execution was requested but downgraded to paper for safety."
                : "Execution completed successfully.")
              : `Execution failed: ${trade.error ?? "unknown error"}`)
            : (decision === "propose_execution"
              ? "Candidate prepared for execution but awaiting approval."
              : "Execution not attempted in this stage."),
          reasonCodes: trade
            ? normalizeExecutionReasonBundle(trade, {
                requestedMode,
                effectiveMode,
                degradedToPaper,
              }).reasonCodes
            : modeReasonBundle.reasonCodes,
        }
      : null;

  const summary = buildSummary({
    decision,
    status: moduleStatus,
    requestedMode,
    effectiveMode,
    degradedToPaper,
    pair,
    buyVenue,
    sellVenue,
    expectedNetUsd,
    expectedNetEdgeBps,
    reasonCodes: normalizedReasons.reasonCodes,
  });

  const response: ArbitrageModuleResponse = {
    module: "arbitrage",
    requestId: input.requestId,
    mode: requestedMode,
    status: moduleStatus,
    decision,
    candidate,
    simulation: simulationView,
    execution: executionView,
    summary,
    skillUsage,
    decisionView: {
      decision,
      status: decisionStatus,
      summary: summary.explanation,
      reasonCodes: normalizedReasons.reasonCodes,
      blockingReasonCodes: normalizedReasons.blockingReasonCodes,
      confidence: discoveryCandidate?.confidence,
    },
    marketContext: input.marketContext,
    readinessContext: input.readinessContext,
    enrichmentContext: input.enrichmentContext,
    distributionContext: input.distributionContext,
  };

  return response;
}
