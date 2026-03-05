import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import type {
  BacktestSnapshotRow,
  ExecutionMode,
  Opportunity,
  ShareCard,
  StrategyProfile,
  StrategyStatus,
  TokenCacheEntry,
  TodayMetrics,
  TradeResult,
  WhaleSignal,
} from "../types";
import { utcDay } from "./time";

export interface HookOutboxRow {
  id: string;
  endpoint: string;
  payload: string;
  retryCount: number;
  nextRetryAt: string;
  status: "pending" | "sent" | "dead";
}

interface SimulationRecord {
  opportunityId: string;
  mode: ExecutionMode;
  inputJson: string;
  resultJson: string;
  createdAt: string;
}

function createDb(filePath: string): Database.Database {
  return new Database(filePath);
}

export class StateStore {
  private alphaDb: Database.Database;
  private vaultDb: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.alphaDb = createDb(path.join(dataDir, "alpha.db"));
    this.vaultDb = createDb(path.join(dataDir, "vault.db"));
    this.alphaDb.pragma("journal_mode = WAL");
    this.vaultDb.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.alphaDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS market_snapshots (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        dex TEXT NOT NULL,
        bid REAL NOT NULL,
        ask REAL NOT NULL,
        ts TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        pair TEXT NOT NULL,
        buy_dex TEXT NOT NULL,
        sell_dex TEXT NOT NULL,
        gross_edge_bps REAL NOT NULL,
        est_cost_usd REAL NOT NULL,
        est_net_usd REAL NOT NULL,
        status TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS simulations (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        input_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        gross_usd REAL NOT NULL,
        fee_usd REAL NOT NULL,
        net_usd REAL NOT NULL,
        error_type TEXT,
        latency_ms REAL,
        slippage_deviation_bps REAL,
        created_at TEXT NOT NULL,
        settled_at TEXT
      );

      CREATE TABLE IF NOT EXISTS pnl_daily (
        day TEXT NOT NULL,
        mode TEXT NOT NULL,
        gross_usd REAL NOT NULL,
        fee_usd REAL NOT NULL,
        net_usd REAL NOT NULL,
        trades_count INTEGER NOT NULL,
        PRIMARY KEY(day, mode)
      );

      CREATE TABLE IF NOT EXISTS quote_quality_daily (
        day TEXT PRIMARY KEY,
        total_quotes INTEGER NOT NULL,
        stale_quotes INTEGER NOT NULL,
        latency_sum_ms REAL NOT NULL,
        latency_samples INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hook_outbox (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL,
        next_retry_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS whale_signals (
        id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        token TEXT NOT NULL,
        side TEXT NOT NULL,
        size_usd REAL NOT NULL,
        confidence REAL NOT NULL,
        source_tx_hash TEXT,
        status TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS strategy_profiles (
        strategy_id TEXT PRIMARY KEY,
        variant TEXT NOT NULL,
        params_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS token_cache (
        symbol TEXT NOT NULL,
        chain_index TEXT NOT NULL,
        token_address TEXT NOT NULL,
        token_decimals INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(symbol, chain_index)
      );

      CREATE TABLE IF NOT EXISTS mode_balances (
        mode TEXT PRIMARY KEY,
        baseline_usd REAL NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_opportunities_status_detected_at
      ON opportunities(status, detected_at DESC);

      CREATE INDEX IF NOT EXISTS idx_trades_mode_created_at
      ON trades(mode, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_pnl_daily_day
      ON pnl_daily(day);

      CREATE INDEX IF NOT EXISTS idx_hook_outbox_status_next_retry
      ON hook_outbox(status, next_retry_at);

      CREATE INDEX IF NOT EXISTS idx_whale_signals_status_received
      ON whale_signals(status, received_at DESC);

      CREATE INDEX IF NOT EXISTS idx_token_cache_expires
      ON token_cache(expires_at);
    `);

    this.ensureColumn(this.alphaDb, "opportunities", "metadata_json", "TEXT");
    this.ensureColumn(this.alphaDb, "trades", "error_type", "TEXT");
    this.ensureColumn(this.alphaDb, "trades", "latency_ms", "REAL");
    this.ensureColumn(this.alphaDb, "trades", "slippage_deviation_bps", "REAL");

    this.vaultDb.exec(`
      CREATE TABLE IF NOT EXISTS vault_items (
        id TEXT PRIMARY KEY,
        key_alias TEXT UNIQUE NOT NULL,
        cipher_text TEXT NOT NULL,
        nonce TEXT NOT NULL,
        salt TEXT NOT NULL,
        kdf_iter INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        rotated_at TEXT
      );
    `);
  }

  private ensureColumn(db: Database.Database, table: string, column: string, def: string): void {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const exists = columns.some((c) => c.name === column);
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  }

  upsertStrategy(pluginId: string, config: unknown): string {
    const existing = this.alphaDb
      .prepare("SELECT id FROM strategies WHERE plugin_id = ?")
      .get(pluginId) as { id: string } | undefined;

    const now = new Date().toISOString();
    if (existing) {
      this.alphaDb
        .prepare("UPDATE strategies SET enabled = 1, config_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(config), now, existing.id);
      return existing.id;
    }

    const id = crypto.randomUUID();
    this.alphaDb
      .prepare(
        "INSERT INTO strategies (id, plugin_id, enabled, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, pluginId, 1, JSON.stringify(config), now, now);
    return id;
  }

  upsertStrategyProfile(strategyId: string, variant: "A" | "B", params: Record<string, unknown>): void {
    const now = new Date().toISOString();
    this.alphaDb
      .prepare(
        `INSERT INTO strategy_profiles (strategy_id, variant, params_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(strategy_id) DO UPDATE SET
           variant = excluded.variant,
           params_json = excluded.params_json,
           updated_at = excluded.updated_at`,
      )
      .run(strategyId, variant, JSON.stringify(params), now);
  }

  getStrategyProfile(strategyId: string): StrategyProfile | null {
    const row = this.alphaDb
      .prepare(
        `SELECT strategy_id AS strategyId, variant, params_json AS paramsJson, updated_at AS updatedAt
         FROM strategy_profiles
         WHERE strategy_id = ?`,
      )
      .get(strategyId) as
      | {
          strategyId: string;
          variant: "A" | "B";
          paramsJson: string;
          updatedAt: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      strategyId: row.strategyId,
      variant: row.variant,
      params: JSON.parse(row.paramsJson) as Record<string, unknown>,
      updatedAt: row.updatedAt,
    };
  }

  listStrategyProfiles(): StrategyProfile[] {
    const rows = this.alphaDb
      .prepare(
        `SELECT strategy_id AS strategyId, variant, params_json AS paramsJson, updated_at AS updatedAt
         FROM strategy_profiles
         ORDER BY strategy_id`,
      )
      .all() as Array<{
      strategyId: string;
      variant: "A" | "B";
      paramsJson: string;
      updatedAt: string;
    }>;

    return rows.map((row) => ({
      strategyId: row.strategyId,
      variant: row.variant,
      params: JSON.parse(row.paramsJson) as Record<string, unknown>,
      updatedAt: row.updatedAt,
    }));
  }

  getTokenCache(symbol: string, chainIndex: string): TokenCacheEntry | null {
    const row = this.alphaDb
      .prepare(
        `SELECT symbol,
                chain_index AS chainIndex,
                token_address AS address,
                token_decimals AS decimals,
                expires_at AS expiresAt,
                updated_at AS updatedAt
         FROM token_cache
         WHERE symbol = ? AND chain_index = ?`,
      )
      .get(symbol.toUpperCase(), chainIndex) as TokenCacheEntry | undefined;
    if (!row) {
      return null;
    }
    return row;
  }

  upsertTokenCache(entry: {
    symbol: string;
    chainIndex: string;
    address: string;
    decimals: number;
    expiresAt: string;
  }): void {
    const now = new Date().toISOString();
    this.alphaDb
      .prepare(
        `INSERT INTO token_cache (symbol, chain_index, token_address, token_decimals, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol, chain_index) DO UPDATE SET
           token_address = excluded.token_address,
           token_decimals = excluded.token_decimals,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
      .run(entry.symbol.toUpperCase(), entry.chainIndex, entry.address, entry.decimals, entry.expiresAt, now);
  }

  listTokenCache(limit = 200, symbol?: string, chainIndex?: string): TokenCacheEntry[] {
    const safeLimit = Math.max(1, Math.min(2000, Math.floor(limit)));
    const symbolNorm = symbol?.trim().toUpperCase();
    const chain = chainIndex?.trim();

    if (symbolNorm && chain) {
      const row = this.getTokenCache(symbolNorm, chain);
      return row ? [row] : [];
    }

    if (symbolNorm) {
      return this.alphaDb
        .prepare(
          `SELECT symbol,
                  chain_index AS chainIndex,
                  token_address AS address,
                  token_decimals AS decimals,
                  expires_at AS expiresAt,
                  updated_at AS updatedAt
           FROM token_cache
           WHERE symbol = ?
           ORDER BY updated_at DESC
           LIMIT ?`,
        )
        .all(symbolNorm, safeLimit) as TokenCacheEntry[];
    }

    if (chain) {
      return this.alphaDb
        .prepare(
          `SELECT symbol,
                  chain_index AS chainIndex,
                  token_address AS address,
                  token_decimals AS decimals,
                  expires_at AS expiresAt,
                  updated_at AS updatedAt
           FROM token_cache
           WHERE chain_index = ?
           ORDER BY updated_at DESC
           LIMIT ?`,
        )
        .all(chain, safeLimit) as TokenCacheEntry[];
    }

    return this.alphaDb
      .prepare(
        `SELECT symbol,
                chain_index AS chainIndex,
                token_address AS address,
                token_decimals AS decimals,
                expires_at AS expiresAt,
                updated_at AS updatedAt
         FROM token_cache
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(safeLimit) as TokenCacheEntry[];
  }

  insertMarketSnapshot(input: { pair: string; dex: string; bid: number; ask: number; ts: string }): void {
    this.alphaDb
      .prepare(
        "INSERT INTO market_snapshots (id, pair, dex, bid, ask, ts) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(crypto.randomUUID(), input.pair, input.dex, input.bid, input.ask, input.ts);
  }

  recordQuoteQuality(input: { stale: boolean; latencyMs: number | null; ts?: string }): void {
    const day = input.ts ? utcDay(new Date(input.ts)) : utcDay();
    this.alphaDb
      .prepare(
        `INSERT INTO quote_quality_daily (
          day, total_quotes, stale_quotes, latency_sum_ms, latency_samples
        )
        VALUES (?, 1, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET
          total_quotes = quote_quality_daily.total_quotes + 1,
          stale_quotes = quote_quality_daily.stale_quotes + excluded.stale_quotes,
          latency_sum_ms = quote_quality_daily.latency_sum_ms + excluded.latency_sum_ms,
          latency_samples = quote_quality_daily.latency_samples + excluded.latency_samples`,
      )
      .run(
        day,
        input.stale ? 1 : 0,
        input.latencyMs ?? 0,
        input.latencyMs === null ? 0 : 1,
      );
  }

  insertOpportunity(input: Opportunity, estCostUsd: number, estNetUsd: number, status = "detected"): void {
    this.alphaDb
      .prepare(
        `INSERT INTO opportunities (
          id, strategy_id, pair, buy_dex, sell_dex, gross_edge_bps, est_cost_usd, est_net_usd, status, detected_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.strategyId,
        input.pair,
        input.buyDex,
        input.sellDex,
        input.grossEdgeBps,
        estCostUsd,
        estNetUsd,
        status,
        input.detectedAt,
        input.metadata ? JSON.stringify(input.metadata) : null,
      );
  }

  updateOpportunityStatus(id: string, status: string): void {
    this.alphaDb.prepare("UPDATE opportunities SET status = ? WHERE id = ?").run(status, id);
  }

  updateOpportunityEstimate(id: string, estCostUsd: number, estNetUsd: number, status: string): void {
    this.alphaDb
      .prepare("UPDATE opportunities SET est_cost_usd = ?, est_net_usd = ?, status = ? WHERE id = ?")
      .run(estCostUsd, estNetUsd, status, id);
  }

  insertSimulation(sim: SimulationRecord): void {
    this.alphaDb
      .prepare(
        "INSERT INTO simulations (id, opportunity_id, mode, input_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(crypto.randomUUID(), sim.opportunityId, sim.mode, sim.inputJson, sim.resultJson, sim.createdAt);
  }

  insertTrade(opportunityId: string, mode: ExecutionMode, trade: TradeResult, createdAt: string): void {
    const day = utcDay(new Date(createdAt));
    const transaction = this.alphaDb.transaction(() => {
      this.alphaDb
        .prepare(
          `INSERT INTO trades (
            id, opportunity_id, mode, tx_hash, status, gross_usd, fee_usd, net_usd,
            error_type, latency_ms, slippage_deviation_bps, created_at, settled_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          opportunityId,
          mode,
          trade.txHash,
          trade.status,
          trade.grossUsd,
          trade.feeUsd,
          trade.netUsd,
          trade.errorType ?? null,
          trade.latencyMs ?? null,
          trade.slippageDeviationBps ?? null,
          createdAt,
          createdAt,
        );

      this.alphaDb
        .prepare(
          `INSERT INTO pnl_daily (day, mode, gross_usd, fee_usd, net_usd, trades_count)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(day, mode) DO UPDATE SET
             gross_usd = pnl_daily.gross_usd + excluded.gross_usd,
             fee_usd = pnl_daily.fee_usd + excluded.fee_usd,
             net_usd = pnl_daily.net_usd + excluded.net_usd,
             trades_count = pnl_daily.trades_count + 1`,
        )
        .run(day, mode, trade.grossUsd, trade.feeUsd, trade.netUsd);
    });
    transaction();
  }

  insertAlert(level: string, eventType: string, message: string): void {
    this.alphaDb
      .prepare("INSERT INTO alerts (id, level, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), level, eventType, message, new Date().toISOString());
  }

  getTodayMetrics(): TodayMetrics {
    const day = utcDay();
    const oppRow = this.alphaDb
      .prepare("SELECT COUNT(1) AS count FROM opportunities WHERE substr(detected_at, 1, 10) = ?")
      .get(day) as { count: number };

    const tradeRow = this.alphaDb
      .prepare("SELECT COUNT(1) AS count FROM trades WHERE substr(created_at, 1, 10) = ?")
      .get(day) as { count: number };

    const pnlRows = this.alphaDb
      .prepare("SELECT COALESCE(SUM(gross_usd), 0) AS gross, COALESCE(SUM(fee_usd), 0) AS fee, COALESCE(SUM(net_usd), 0) AS net FROM pnl_daily WHERE day = ?")
      .get(day) as { gross: number; fee: number; net: number };

    const curveRows = this.alphaDb
      .prepare(
        `SELECT created_at AS ts, net_usd AS netUsd
         FROM trades
         WHERE substr(created_at, 1, 10) = ?
         ORDER BY created_at DESC
         LIMIT 10`,
      )
      .all(day) as Array<{ ts: string; netUsd: number }>;

    const quoteQualityRow = this.alphaDb
      .prepare(
        `SELECT stale_quotes AS staleQuotes,
                latency_sum_ms AS latencySumMs,
                latency_samples AS latencySamples
         FROM quote_quality_daily
         WHERE day = ?`,
      )
      .get(day) as { staleQuotes: number; latencySumMs: number; latencySamples: number } | undefined;

    return {
      day,
      opportunities: oppRow.count,
      trades: tradeRow.count,
      netUsd: pnlRows.net,
      grossUsd: pnlRows.gross,
      feeUsd: pnlRows.fee,
      staleQuotes: quoteQualityRow?.staleQuotes ?? 0,
      avgQuoteLatencyMs:
        quoteQualityRow && quoteQualityRow.latencySamples > 0
          ? quoteQualityRow.latencySumMs / quoteQualityRow.latencySamples
          : 0,
      curve: curveRows.reverse(),
    };
  }

  listOpportunities(limit: number): unknown[] {
    const rows = this.alphaDb
      .prepare(
        `SELECT id, strategy_id, pair, buy_dex, sell_dex, gross_edge_bps, est_cost_usd, est_net_usd, status, detected_at, metadata_json
         FROM opportunities
         ORDER BY detected_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      strategy_id: string;
      pair: string;
      buy_dex: string;
      sell_dex: string;
      gross_edge_bps: number;
      est_cost_usd: number;
      est_net_usd: number;
      status: string;
      detected_at: string;
      metadata_json: string | null;
    }>;

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    }));
  }

  getReplayDataset(hours: number, strategyId?: string): Array<{
    id: string;
    strategyId: string;
    pair: string;
    grossEdgeBps: number;
    estCostUsd: number;
    estNetUsd: number;
    status: string;
    detectedAt: string;
  }> {
    const safeHours = Math.max(1, Math.min(24 * 30, Math.floor(hours)));
    const since = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();
    const baseQuery = `SELECT id,
                              strategy_id AS strategyId,
                              pair,
                              gross_edge_bps AS grossEdgeBps,
                              est_cost_usd AS estCostUsd,
                              est_net_usd AS estNetUsd,
                              status,
                              detected_at AS detectedAt
                       FROM opportunities
                       WHERE detected_at >= ?`;
    const query = strategyId ? `${baseQuery} AND strategy_id = ? ORDER BY detected_at ASC` : `${baseQuery} ORDER BY detected_at ASC`;
    return (strategyId
      ? this.alphaDb.prepare(query).all(since, strategyId)
      : this.alphaDb.prepare(query).all(since)) as Array<{
      id: string;
      strategyId: string;
      pair: string;
      grossEdgeBps: number;
      estCostUsd: number;
      estNetUsd: number;
      status: string;
      detectedAt: string;
    }>;
  }

  listTrades(limit: number): unknown[] {
    return this.alphaDb
      .prepare(
        `SELECT t.id, t.opportunity_id, o.strategy_id, t.mode, t.tx_hash, t.status, t.gross_usd, t.fee_usd, t.net_usd, t.created_at, t.settled_at, o.pair
         FROM trades t
         LEFT JOIN opportunities o ON o.id = t.opportunity_id
         ORDER BY t.created_at DESC
         LIMIT ?`,
      )
      .all(limit);
  }

  listAlerts(limit: number): Array<{ level: string; eventType: string; message: string; createdAt: string }> {
    return this.alphaDb
      .prepare(
        `SELECT level, event_type AS eventType, message, created_at AS createdAt
         FROM alerts
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{ level: string; eventType: string; message: string; createdAt: string }>;
  }

  listStrategyStatusToday(): StrategyStatus[] {
    const day = utcDay();
    return this.alphaDb
      .prepare(
        `SELECT o.strategy_id AS strategyId,
                COUNT(DISTINCT o.id) AS opportunities,
                COUNT(t.id) AS trades,
                COALESCE(SUM(t.net_usd), 0) AS netUsd
         FROM opportunities o
         LEFT JOIN trades t
           ON t.opportunity_id = o.id
          AND substr(t.created_at, 1, 10) = ?
         WHERE substr(o.detected_at, 1, 10) = ?
         GROUP BY o.strategy_id
         ORDER BY netUsd DESC`,
      )
      .all(day, day) as StrategyStatus[];
  }

  getLatestShareCard(): ShareCard | null {
    const row = this.alphaDb
      .prepare(
        `SELECT t.tx_hash AS txHash,
                t.mode AS mode,
                t.net_usd AS netUsd,
                t.created_at AS timestamp,
                o.pair AS pair,
                o.strategy_id AS strategyId
         FROM trades t
         JOIN opportunities o ON o.id = t.opportunity_id
         WHERE t.status != 'failed'
         ORDER BY t.created_at DESC
         LIMIT 1`,
      )
      .get() as
      | {
          txHash: string;
          mode: ExecutionMode;
          netUsd: number;
          timestamp: string;
          pair: string;
          strategyId: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const signed = row.netUsd >= 0 ? `+${row.netUsd.toFixed(2)}` : row.netUsd.toFixed(2);
    return {
      ...row,
      title: `AlphaOS ${row.strategyId} ${signed} USD`,
      text: `AlphaOS ${row.strategyId} executed ${row.pair} in ${row.mode} mode, PnL ${signed} USD. tx=${row.txHash}`,
    };
  }

  getBacktestSnapshot(hours: number): BacktestSnapshotRow[] {
    const safeHours = Math.max(1, Math.min(24 * 30, Math.floor(hours)));
    const since = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();
    const rows = this.alphaDb
      .prepare(
        `SELECT o.strategy_id AS strategyId,
                COUNT(1) AS opportunities,
                SUM(CASE WHEN o.status = 'planned' OR o.status = 'executed' THEN 1 ELSE 0 END) AS planned,
                SUM(CASE WHEN o.status = 'executed' THEN 1 ELSE 0 END) AS executed,
                SUM(CASE WHEN o.status = 'failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN o.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
                COALESCE(AVG(o.est_net_usd), 0) AS avgEstimatedNetUsd,
                COALESCE(SUM(t.net_usd), 0) AS realizedNetUsd,
                COALESCE(AVG(CASE WHEN t.status = 'failed' THEN 0 ELSE 1 END), 0) AS tradeWinRate
         FROM opportunities o
         LEFT JOIN trades t ON t.opportunity_id = o.id
         WHERE o.detected_at >= ?
         GROUP BY o.strategy_id
         ORDER BY realizedNetUsd DESC`,
      )
      .all(since) as Array<{
      strategyId: string;
      opportunities: number;
      planned: number | null;
      executed: number | null;
      failed: number | null;
      rejected: number | null;
      avgEstimatedNetUsd: number;
      realizedNetUsd: number;
      tradeWinRate: number;
    }>;

    return rows.map((row) => ({
      strategyId: row.strategyId,
      opportunities: row.opportunities,
      planned: row.planned ?? 0,
      executed: row.executed ?? 0,
      failed: row.failed ?? 0,
      rejected: row.rejected ?? 0,
      avgEstimatedNetUsd: row.avgEstimatedNetUsd,
      realizedNetUsd: row.realizedNetUsd,
      tradeWinRate: row.tradeWinRate,
    }));
  }

  getSimulationStats(hours: number): { netUsd: number; winRate: number } {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = this.alphaDb
      .prepare("SELECT result_json FROM simulations WHERE created_at >= ?")
      .all(since) as Array<{ result_json: string }>;

    if (rows.length === 0) {
      return { netUsd: 0, winRate: 0 };
    }

    let wins = 0;
    let net = 0;
    for (const row of rows) {
      const parsed = JSON.parse(row.result_json) as { netUsd: number; pass: boolean };
      net += parsed.netUsd;
      if (parsed.pass) {
        wins += 1;
      }
    }

    return {
      netUsd: net,
      winRate: wins / rows.length,
    };
  }

  getRecentConsecutiveFailures(limit: number): number {
    const rows = this.alphaDb
      .prepare("SELECT status FROM trades ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{ status: string }>;

    let failures = 0;
    for (const row of rows) {
      if (row.status !== "failed") {
        break;
      }
      failures += 1;
    }
    return failures;
  }

  getTodayNetUsd(mode: ExecutionMode): number {
    const row = this.alphaDb
      .prepare("SELECT net_usd FROM pnl_daily WHERE day = ? AND mode = ?")
      .get(utcDay(), mode) as { net_usd: number } | undefined;
    return row?.net_usd ?? 0;
  }

  ensureBalanceBaseline(mode: ExecutionMode, baselineUsd: number): void {
    const now = new Date().toISOString();
    this.alphaDb
      .prepare(
        `INSERT INTO mode_balances (mode, baseline_usd, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(mode) DO NOTHING`,
      )
      .run(mode, baselineUsd, now);
  }

  getCurrentBalance(mode: ExecutionMode): number {
    const baselineRow = this.alphaDb
      .prepare("SELECT baseline_usd AS baselineUsd FROM mode_balances WHERE mode = ?")
      .get(mode) as { baselineUsd: number } | undefined;
    const pnlRow = this.alphaDb
      .prepare("SELECT COALESCE(SUM(net_usd), 0) AS cumulativeNetUsd FROM pnl_daily WHERE mode = ?")
      .get(mode) as { cumulativeNetUsd: number };
    const baseline = baselineRow?.baselineUsd ?? 0;
    return baseline + pnlRow.cumulativeNetUsd;
  }

  getExecutionQualityStats(hours: number): {
    permissionFailures: number;
    rejectRate: number;
    avgLatencyMs: number;
    avgSlippageDeviationBps: number;
  } {
    const safeHours = Math.max(1, Math.min(24 * 30, Math.floor(hours)));
    const since = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();

    const permissionTradeRow = this.alphaDb
      .prepare(
        `SELECT COUNT(1) AS count
         FROM trades
         WHERE created_at >= ?
           AND error_type IN ('permission_denied', 'whitelist_restricted')`,
      )
      .get(since) as { count: number };
    const permissionAlertRow = this.alphaDb
      .prepare(
        `SELECT COUNT(1) AS count
         FROM alerts
         WHERE created_at >= ?
           AND event_type = 'live_permission_degraded'`,
      )
      .get(since) as { count: number };

    const opportunityRow = this.alphaDb
      .prepare(
        `SELECT COUNT(1) AS total,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
         FROM opportunities
         WHERE detected_at >= ?`,
      )
      .get(since) as { total: number; rejected: number | null };

    const tradeQualityRow = this.alphaDb
      .prepare(
        `SELECT COALESCE(AVG(latency_ms), 0) AS avgLatencyMs,
                COALESCE(AVG(ABS(slippage_deviation_bps)), 0) AS avgSlippageDeviationBps
         FROM trades
         WHERE created_at >= ?`,
      )
      .get(since) as { avgLatencyMs: number; avgSlippageDeviationBps: number };

    return {
      permissionFailures: permissionTradeRow.count + permissionAlertRow.count,
      rejectRate:
        opportunityRow.total > 0 ? (opportunityRow.rejected ?? 0) / opportunityRow.total : 0,
      avgLatencyMs: tradeQualityRow.avgLatencyMs,
      avgSlippageDeviationBps: tradeQualityRow.avgSlippageDeviationBps,
    };
  }

  insertWhaleSignal(input: {
    wallet: string;
    token: string;
    side: "buy" | "sell";
    sizeUsd: number;
    confidence: number;
    sourceTxHash?: string;
  }): string {
    const id = crypto.randomUUID();
    this.alphaDb
      .prepare(
        `INSERT INTO whale_signals (
          id, wallet, token, side, size_usd, confidence, source_tx_hash, status, received_at, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
      )
      .run(
        id,
        input.wallet,
        input.token,
        input.side,
        input.sizeUsd,
        input.confidence,
        input.sourceTxHash ?? null,
        new Date().toISOString(),
      );
    return id;
  }

  listWhaleSignals(status: "pending" | "processing" | "consumed" | "ignored" | "all", limit: number): WhaleSignal[] {
    const sql =
      status === "all"
        ? `SELECT id, wallet, token, side, size_usd AS sizeUsd, confidence, source_tx_hash AS sourceTxHash,
                  status, received_at AS receivedAt, processed_at AS processedAt
           FROM whale_signals ORDER BY received_at DESC LIMIT ?`
        : `SELECT id, wallet, token, side, size_usd AS sizeUsd, confidence, source_tx_hash AS sourceTxHash,
                  status, received_at AS receivedAt, processed_at AS processedAt
           FROM whale_signals WHERE status = ? ORDER BY received_at DESC LIMIT ?`;
    return (status === "all"
      ? this.alphaDb.prepare(sql).all(limit)
      : this.alphaDb.prepare(sql).all(status, limit)) as WhaleSignal[];
  }

  claimPendingWhaleSignals(limit: number): WhaleSignal[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const now = new Date().toISOString();
    const transaction = this.alphaDb.transaction(() => {
      const signals = this.alphaDb
        .prepare(
          `SELECT id, wallet, token, side, size_usd AS sizeUsd, confidence, source_tx_hash AS sourceTxHash,
                  status, received_at AS receivedAt, processed_at AS processedAt
           FROM whale_signals
           WHERE status = 'pending'
           ORDER BY received_at ASC
           LIMIT ?`,
        )
        .all(safeLimit) as WhaleSignal[];

      for (const signal of signals) {
        this.alphaDb
          .prepare("UPDATE whale_signals SET status = 'processing', processed_at = ? WHERE id = ? AND status = 'pending'")
          .run(now, signal.id);
      }

      return signals.map((signal) => ({
        ...signal,
        status: "processing" as const,
        processedAt: now,
      }));
    });
    return transaction();
  }

  updateWhaleSignalStatus(id: string, status: "consumed" | "ignored"): void {
    this.alphaDb
      .prepare("UPDATE whale_signals SET status = ?, processed_at = ? WHERE id = ? AND status = 'processing'")
      .run(status, new Date().toISOString(), id);
  }

  enqueueOutbox(endpoint: string, payload: string, nextRetryAt: string, status: "pending" | "dead" = "pending", retryCount = 0, lastError: string | null = null): void {
    this.alphaDb
      .prepare(
        `INSERT INTO hook_outbox (id, endpoint, payload, status, retry_count, next_retry_at, last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), endpoint, payload, status, retryCount, nextRetryAt, lastError, new Date().toISOString());
  }

  getDueOutbox(nowIso: string, limit = 50): HookOutboxRow[] {
    return this.alphaDb
      .prepare(
        `SELECT id, endpoint, payload, retry_count AS retryCount, next_retry_at AS nextRetryAt, status
         FROM hook_outbox
         WHERE status = 'pending' AND next_retry_at <= ?
         ORDER BY next_retry_at ASC
         LIMIT ?`,
      )
      .all(nowIso, limit) as HookOutboxRow[];
  }

  markOutboxSent(id: string): void {
    this.alphaDb.prepare("UPDATE hook_outbox SET status = 'sent' WHERE id = ?").run(id);
  }

  markOutboxRetry(id: string, retryCount: number, nextRetryAt: string, lastError: string): void {
    const status = retryCount >= 5 ? "dead" : "pending";
    this.alphaDb
      .prepare(
        "UPDATE hook_outbox SET status = ?, retry_count = ?, next_retry_at = ?, last_error = ? WHERE id = ?",
      )
      .run(status, retryCount, nextRetryAt, lastError.slice(0, 512), id);
  }

  upsertVaultItem(params: {
    keyAlias: string;
    cipherText: string;
    nonce: string;
    salt: string;
    kdfIter: number;
  }): void {
    const existing = this.vaultDb
      .prepare("SELECT id, created_at FROM vault_items WHERE key_alias = ?")
      .get(params.keyAlias) as { id: string; created_at: string } | undefined;
    const now = new Date().toISOString();

    if (!existing) {
      this.vaultDb
        .prepare(
          `INSERT INTO vault_items
           (id, key_alias, cipher_text, nonce, salt, kdf_iter, created_at, rotated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          crypto.randomUUID(),
          params.keyAlias,
          params.cipherText,
          params.nonce,
          params.salt,
          params.kdfIter,
          now,
        );
      return;
    }

    this.vaultDb
      .prepare(
        `UPDATE vault_items
         SET cipher_text = ?, nonce = ?, salt = ?, kdf_iter = ?, rotated_at = ?
         WHERE id = ?`,
      )
      .run(params.cipherText, params.nonce, params.salt, params.kdfIter, now, existing.id);
  }

  getVaultItem(keyAlias: string):
    | {
        keyAlias: string;
        cipherText: string;
        nonce: string;
        salt: string;
        kdfIter: number;
      }
    | null {
    const row = this.vaultDb
      .prepare(
        "SELECT key_alias AS keyAlias, cipher_text AS cipherText, nonce, salt, kdf_iter AS kdfIter FROM vault_items WHERE key_alias = ?",
      )
      .get(keyAlias) as
      | {
          keyAlias: string;
          cipherText: string;
          nonce: string;
          salt: string;
          kdfIter: number;
        }
      | undefined;

    return row ?? null;
  }

  close(): void {
    this.alphaDb.close();
    this.vaultDb.close();
  }
}
