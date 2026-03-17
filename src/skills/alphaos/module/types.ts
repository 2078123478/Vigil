import type {
  DiscoveryApproveResult,
  DiscoveryCandidate,
  EvalResult,
  Opportunity,
  SimulationResult,
  TradeResult,
} from "../types";

export type ArbitrageModuleId = "arbitrage";
export type ArbitrageOpportunityType = "dex_spread";
export type ArbitrageRequestedMode = "scout" | "paper" | "assisted-live" | "live";
export type ArbitrageEffectiveMode = "scout" | "paper" | "assisted-live" | "live";

export type ArbitrageCandidateLifecycleStatus =
  | "discovered"
  | "enriched"
  | "validated"
  | "simulated"
  | "approved"
  | "executed"
  | "rejected"
  | "expired"
  | "failed";

export type ArbitrageDecision =
  | "reject"
  | "monitor"
  | "simulate_only"
  | "paper_trade"
  | "propose_execution"
  | "execute";

export type ArbitrageDecisionStatus =
  | "accepted"
  | "rejected"
  | "monitoring"
  | "pending_approval"
  | "executed"
  | "failed";

export type ArbitrageModuleStatus =
  | "candidate_rejected"
  | "candidate_accepted"
  | "candidate_ready_for_approval"
  | "candidate_executed"
  | "candidate_executed_with_downgrade"
  | "candidate_failed"
  | "candidate_monitored"
  | "candidate_simulated"
  | "summary_prepared";

export type ArbitrageSimulationStatus = "pass" | "fail";
export type ArbitrageExecutionStatus = "completed" | "failed" | "awaiting_approval" | "skipped";
export type ArbitrageTradeStatus = "pending" | "submitted" | "confirmed" | "failed";

export type ArbitrageReasonCode =
  | "spread_detected"
  | "spread_above_threshold"
  | "candidate_ranked_high"
  | "signal_supported_candidate"
  | "market_rank_selected"
  | "event_driven_candidate"
  | "token_info_attached"
  | "token_audit_attached"
  | "address_intel_attached"
  | "balance_context_attached"
  | "signal_context_attached"
  | "chain_context_attached"
  | "net_edge_above_threshold"
  | "liquidity_sufficient"
  | "quote_fresh"
  | "balance_ready"
  | "audit_clear"
  | "address_risk_acceptable"
  | "execution_backend_ready"
  | "risk_policy_passed"
  | "mode_allowed"
  | "spread_below_threshold"
  | "net_edge_below_threshold"
  | "liquidity_too_low"
  | "quote_stale"
  | "balance_insufficient"
  | "audit_flagged"
  | "address_risk_high"
  | "execution_backend_unready"
  | "risk_policy_failed"
  | "candidate_expired"
  | "mode_not_allowed"
  | "simulation_completed"
  | "simulation_profitable"
  | "latency_risk_within_bounds"
  | "expected_shortfall_acceptable"
  | "failure_probability_acceptable"
  | "simulation_failed"
  | "simulation_unprofitable"
  | "latency_risk_too_high"
  | "expected_shortfall_too_high"
  | "failure_probability_too_high"
  | "invalid_execution_price"
  | "monitor_only"
  | "paper_mode_selected"
  | "approval_required"
  | "auto_execute_allowed"
  | "degraded_to_paper"
  | "daily_loss_cap_reached"
  | "too_many_recent_failures"
  | "live_gate_failed"
  | "live_gate_passed"
  | "execution_started"
  | "execution_submitted"
  | "execution_confirmed"
  | "paper_execution_recorded"
  | "trade_recorded"
  | "notification_sent"
  | "execution_failed"
  | "permission_denied"
  | "whitelist_restricted"
  | "network_error"
  | "validation_error"
  | "unknown_execution_error"
  | "trade_record_failed"
  | "notification_failed"
  | "summary_generated"
  | "share_card_generated"
  | "square_post_prepared"
  | "square_post_published"
  | "distribution_skipped"
  | "distribution_failed";

export type ArbitrageReasonStage =
  | "discovery"
  | "evaluate"
  | "simulation"
  | "risk"
  | "execution"
  | "policy"
  | "reporting"
  | "generic";

export interface NormalizedReasonBundle {
  reasonCodes: ArbitrageReasonCode[];
  blockingReasonCodes: ArbitrageReasonCode[];
}

export interface NormalizedMarketContext {
  pair: string;
  venue?: string;
  bid?: number;
  ask?: number;
  quoteTs?: string;
  gasUsd?: number;
  marketContext?: {
    chainId?: number;
    marketType?: string;
    alphaContext?: boolean;
  };
  sourceSkill: string;
}

export interface NormalizedReadinessContext {
  accountScope?: string;
  balanceReady: boolean;
  availableNotionalUsd?: number;
  assetReadiness?: {
    baseAssetReady?: boolean;
    quoteAssetReady?: boolean;
  };
  blocking?: boolean;
  sourceSkill: string;
}

export interface NormalizedEnrichmentContext {
  token?: {
    name?: string;
    symbol?: string;
    chainId?: number;
    contractAddress?: string;
  };
  risk?: {
    tokenRisk?: "low" | "normal" | "high" | "unknown";
    auditFlags?: string[];
    addressRiskLevel?: "low" | "normal" | "high" | "unknown";
  };
  signal?: {
    signalSupport?: boolean;
    signalType?: string;
    confidenceBoost?: number;
  };
  marketNarrative?: {
    rankSource?: string;
    eventDriven?: boolean;
  };
  sourceSkills: string[];
}

export interface NormalizedDistributionContext {
  distributionTarget: string;
  shareableText: string;
  ready: boolean;
  sourceSkill: string;
}

export interface ArbitrageCandidateMetrics {
  grossEdgeBps?: number;
  expectedNetEdgeBps?: number;
  expectedNetUsd?: number;
  notionalUsd?: number;
  liquidityUsd?: number;
  volatility?: number;
  avgLatencyMs?: number;
}

export interface ArbitrageCandidateContext {
  chainId?: number;
  tokenRisk?: "low" | "normal" | "high" | "unknown";
  balanceReady?: boolean;
  signalSupport?: boolean;
  quoteFreshnessMs?: number;
}

export interface ArbitrageCandidateRecord {
  candidateId: string;
  module: ArbitrageModuleId;
  status: ArbitrageCandidateLifecycleStatus;
  opportunityType: ArbitrageOpportunityType;
  pair: string;
  buyVenue?: string;
  sellVenue?: string;
  detectedAt: string;
  metrics: ArbitrageCandidateMetrics;
  context?: ArbitrageCandidateContext;
  reasonCodes: ArbitrageReasonCode[];
  blockingReasonCodes: ArbitrageReasonCode[];
  skillSources: string[];
  discoveredAt?: string;
  enrichedAt?: string;
  validatedAt?: string;
  simulatedAt?: string;
  approvedAt?: string;
  executedAt?: string;
  closedAt?: string;
}

export interface ArbitrageDecisionView {
  decision: ArbitrageDecision;
  status: ArbitrageDecisionStatus;
  summary: string;
  reasonCodes: ArbitrageReasonCode[];
  blockingReasonCodes: ArbitrageReasonCode[];
  confidence?: number;
}

export interface ArbitrageSimulationMetrics {
  grossUsd: number;
  feeUsd: number;
  netUsd: number;
  netEdgeBps: number;
  latencyAdjustedNetUsd: number;
  expectedShortfall: number;
  pFail: number;
}

export interface ArbitrageSimulationView {
  status: ArbitrageSimulationStatus;
  summary: string;
  metrics: ArbitrageSimulationMetrics;
  reasonCodes: ArbitrageReasonCode[];
}

export interface ArbitrageExecutionView {
  requestedMode?: ArbitrageRequestedMode;
  effectiveMode?: ArbitrageEffectiveMode;
  degradedToPaper?: boolean;
  status: ArbitrageExecutionStatus;
  tradeStatus?: ArbitrageTradeStatus;
  txHash?: string | null;
  tradeId?: string;
  summary: string;
  reasonCodes: ArbitrageReasonCode[];
}

export interface ArbitrageSummaryView {
  headline: string;
  explanation: string;
  operatorText: string;
  judgeText: string;
}

export interface ArbitrageSkillUsage {
  required: string[];
  enrichment: string[];
  distribution: string[];
  metadata?: {
    source: "placeholder" | "runtime" | "mixed";
    notes?: string;
  };
}

export interface ArbitrageModuleResponse {
  module: ArbitrageModuleId;
  requestId?: string;
  mode: ArbitrageRequestedMode;
  status: ArbitrageModuleStatus;
  decision: ArbitrageDecision;
  candidate: ArbitrageCandidateRecord | null;
  simulation: ArbitrageSimulationView | null;
  execution: ArbitrageExecutionView | null;
  summary: ArbitrageSummaryView;
  skillUsage: ArbitrageSkillUsage;
  decisionView: ArbitrageDecisionView;
  marketContext?: NormalizedMarketContext;
  readinessContext?: NormalizedReadinessContext;
  enrichmentContext?: NormalizedEnrichmentContext;
  distributionContext?: NormalizedDistributionContext;
}

export interface ArbitrageResponseAdapterInput {
  requestId?: string;
  mode?: ArbitrageRequestedMode;
  requestedMode?: ArbitrageRequestedMode;
  effectiveMode?: ArbitrageEffectiveMode;
  opportunity?: Opportunity;
  evalResult?: EvalResult;
  simulationResult?: SimulationResult;
  tradeResult?: TradeResult;
  discoveryCandidate?: DiscoveryCandidate;
  approveResult?: DiscoveryApproveResult;
  riskGate?: {
    passed: boolean;
    reasons: string[];
  };
  marketContext?: NormalizedMarketContext;
  readinessContext?: NormalizedReadinessContext;
  enrichmentContext?: NormalizedEnrichmentContext;
  distributionContext?: NormalizedDistributionContext;
  skillUsage?: Partial<ArbitrageSkillUsage>;
}

