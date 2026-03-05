import dotenv from "dotenv";
import type { ExecutionMode, RiskPolicy } from "../types";

dotenv.config();

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function readMode(name: string, fallback: ExecutionMode): ExecutionMode {
  const raw = process.env[name];
  if (raw === "paper" || raw === "live") {
    return raw;
  }
  return fallback;
}

function readCsv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function readJsonObject(name: string, fallback: Record<string, unknown>): Record<string, unknown> {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

type OnchainAuthMode = "bearer" | "api-key" | "hmac";

function readAuthMode(name: string, fallback: OnchainAuthMode): OnchainAuthMode {
  const raw = process.env[name];
  if (raw === "bearer" || raw === "api-key" || raw === "hmac") {
    return raw;
  }
  return fallback;
}

export interface AlphaOsConfig {
  port: number;
  logLevel: string;
  apiSecret?: string;
  demoPublic: boolean;
  engineIntervalMs: number;
  pair: string;
  dexes: [string, string];
  startMode: ExecutionMode;
  liveEnabled: boolean;
  paperStartingBalanceUsd: number;
  liveBalanceUsd: number;
  onchainOsApiBase?: string;
  onchainOsApiKey?: string;
  onchainOsApiSecret?: string;
  onchainOsPassphrase?: string;
  onchainOsProjectId?: string;
  onchainAuthMode: OnchainAuthMode;
  onchainApiKeyHeader: string;
  onchainChainIndex: string;
  onchainRequireSimulate: boolean;
  onchainEnableCompatFallback: boolean;
  onchainTokenCacheTtlSeconds: number;
  onchainTokenProfilePath: string;
  onchainPrivateRpcUrl?: string;
  onchainRelayUrl?: string;
  onchainUsePrivateSubmit: boolean;
  openClawHookUrl?: string;
  openClawHookToken?: string;
  dataDir: string;
  enabledStrategies: string[];
  mirrorMinConfidence: number;
  slippageBps: number;
  takerFeeBps: number;
  gasUsdDefault: number;
  mevPenaltyBps: number;
  liquidityUsdDefault: number;
  volatilityDefault: number;
  avgLatencyMsDefault: number;
  evalNotionalUsdDefault: number;
  autoPromoteToLive: boolean;
  wsEnabled: boolean;
  wsUrl: string;
  wsReconnectMs: number;
  quoteStaleMs: number;
  riskPolicy: RiskPolicy;
  strategyProfileDefaults: Record<string, unknown>;
}

export function loadConfig(): AlphaOsConfig {
  return {
    port: readNumber("PORT", 3000),
    logLevel: process.env.LOG_LEVEL ?? "info",
    apiSecret: process.env.API_SECRET,
    demoPublic: readBoolean("DEMO_PUBLIC", false),
    engineIntervalMs: readNumber("ENGINE_INTERVAL_MS", 5000),
    pair: process.env.PAIR ?? "ETH/USDC",
    dexes: [process.env.DEX_A ?? "okx-dex-a", process.env.DEX_B ?? "okx-dex-b"],
    startMode: readMode("START_MODE", "paper"),
    liveEnabled: readBoolean("LIVE_ENABLED", false),
    paperStartingBalanceUsd: readNumber("PAPER_START_BALANCE_USD", 10000),
    liveBalanceUsd: readNumber("LIVE_BALANCE_USD", 3000),
    onchainOsApiBase: process.env.ONCHAINOS_API_BASE,
    onchainOsApiKey: process.env.ONCHAINOS_API_KEY,
    onchainOsApiSecret: process.env.ONCHAINOS_API_SECRET,
    onchainOsPassphrase: process.env.ONCHAINOS_PASSPHRASE,
    onchainOsProjectId: process.env.ONCHAINOS_PROJECT_ID,
    onchainAuthMode: readAuthMode("ONCHAINOS_AUTH_MODE", "bearer"),
    onchainApiKeyHeader: process.env.ONCHAINOS_API_KEY_HEADER ?? "X-API-Key",
    onchainChainIndex: process.env.ONCHAINOS_CHAIN_INDEX ?? "196",
    onchainRequireSimulate: readBoolean("ONCHAINOS_REQUIRE_SIMULATE", true),
    onchainEnableCompatFallback: readBoolean("ONCHAINOS_ENABLE_COMPAT_FALLBACK", true),
    onchainTokenCacheTtlSeconds: readNumber("ONCHAINOS_TOKEN_CACHE_TTL_SECONDS", 600),
    onchainTokenProfilePath:
      process.env.ONCHAINOS_TOKEN_PROFILE_PATH ?? "/api/v6/market/token/profile/current",
    onchainPrivateRpcUrl: process.env.ONCHAINOS_PRIVATE_RPC_URL,
    onchainRelayUrl: process.env.ONCHAINOS_RELAY_URL,
    onchainUsePrivateSubmit: readBoolean("ONCHAINOS_USE_PRIVATE_SUBMIT", false),
    openClawHookUrl: process.env.OPENCLAW_HOOK_URL,
    openClawHookToken: process.env.OPENCLAW_HOOK_TOKEN,
    dataDir: process.env.DATA_DIR ?? "data",
    enabledStrategies: readCsv("ENABLED_STRATEGIES", ["dex-arbitrage", "smart-money-mirror"]),
    mirrorMinConfidence: readNumber("MIRROR_MIN_CONFIDENCE", 0.62),
    slippageBps: readNumber("SLIPPAGE_BPS", 12),
    takerFeeBps: readNumber("TAKER_FEE_BPS", 20),
    gasUsdDefault: readNumber("GAS_USD_DEFAULT", 1.25),
    mevPenaltyBps: readNumber("MEV_PENALTY_BPS", 5),
    liquidityUsdDefault: readNumber("LIQUIDITY_USD_DEFAULT", 250000),
    volatilityDefault: readNumber("VOLATILITY_DEFAULT", 0.02),
    avgLatencyMsDefault: readNumber("AVG_LATENCY_MS_DEFAULT", 250),
    evalNotionalUsdDefault: readNumber("EVAL_NOTIONAL_USD_DEFAULT", 1000),
    autoPromoteToLive: readBoolean("AUTO_PROMOTE_TO_LIVE", false),
    wsEnabled: readBoolean("WS_ENABLED", false),
    wsUrl: process.env.WS_URL ?? "",
    wsReconnectMs: readNumber("WS_RECONNECT_MS", 2000),
    quoteStaleMs: readNumber("QUOTE_STALE_MS", 1000),
    riskPolicy: {
      minNetEdgeBpsPaper: readNumber("MIN_NET_EDGE_BPS_PAPER", 45),
      minNetEdgeBpsLive: readNumber("MIN_NET_EDGE_BPS_LIVE", 60),
      maxTradePctBalance: readNumber("MAX_TRADE_PCT_BALANCE", 0.03),
      maxDailyLossPct: readNumber("MAX_DAILY_LOSS_PCT", 0.015),
      maxConsecutiveFailures: readNumber("MAX_CONSECUTIVE_FAILURES", 3),
    },
    strategyProfileDefaults: readJsonObject("STRATEGY_PROFILE_DEFAULTS", {
      "dex-arbitrage": { variant: "A", notionalMultiplier: 1 },
      "smart-money-mirror": { variant: "A", notionalMultiplier: 1 },
    }),
  };
}
