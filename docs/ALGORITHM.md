# Vigil 执行算法说明（中文）

## 盈利原理（先看）

Vigil 当前执行层的核心不是预测方向，而是捕捉**同一交易对在不同 DEX 的瞬时价差**。

执行逻辑：

1. 在 `ask` 最低的 DEX 买入。
2. 在 `bid` 最高的 DEX 卖出。
3. 只有当价差覆盖全部成本与风险折扣后，才允许执行。

毛边际公式（bps）：

```text
grossEdgeBps = ((sellBid - buyAsk) / buyAsk) * 10_000
```

收益公式：

```text
grossUsd = notionalUsd * grossEdgeBps / 10_000
netUsd   = grossUsd - totalCostUsd
```

其中 `totalCostUsd` 包含：

- 双边 gas
- 双边 taker fee
- 双边滑点
- 延迟惩罚
- MEV 惩罚

系统最终看的是**风险调整后边际**是否达标，而不是只看毛价差。

## 关键风险点（先看）

1. **价差幻觉风险**：可见价差在下单瞬间消失。
2. **滑点 / 流动性风险**：仓位相对流动性过大时，冲击成本非线性上升。
3. **延迟风险**：报价延迟与链路延迟会吞噬边际。
4. **MEV 风险**：夹子、重排导致预期收益偏离。
5. **权限风险**：live 下 simulate / broadcast 可能被白名单或权限限制。
6. **模型风险**：成本与失败概率是估计值，真实成交会偏离。
7. **市场状态切换风险**：波动、gas、深度变化会使阈值失效。

---

## 决策流水线

```text
scan -> evaluate -> plan -> simulate -> execute -> record -> notify
```

对应代码：

- 策略扫描 / 评估 / 规划：`src/skills/alphaos/plugins/dex-arbitrage.ts`
- 成本模型：`src/skills/alphaos/runtime/cost-model.ts`
- 模拟与通过判定：`src/skills/alphaos/runtime/simulator.ts`
- 编排、去重、降级：`src/skills/alphaos/engine/alpha-engine.ts`
- 风控门控与熔断：`src/skills/alphaos/runtime/risk-engine.ts`

## `dex-arbitrage` 核心逻辑

### 1) Scan（发现机会）

每个 tick 从行情中选择：

- `buy`: 最低 `ask`
- `sell`: 最高 `bid`

过滤条件：

- 报价少于 2 条
- 买卖在同一 DEX
- `sell.bid <= buy.ask`

### 2) Evaluate（评估）

把机会转换为可执行收益预估：

1. 读取余额、gas、延迟、流动性、波动。
2. 计算成本分解。
3. 计算净边际（`netEdgeBps`）。
4. 与模式阈值比较：
   - `paper` 用 `minNetEdgeBpsPaper`
   - `live` 用 `minNetEdgeBpsLive`

### 3) Plan（下单规模）

基础仓位约束：

```text
notionalUsd = max(20, balanceUsd * maxTradePctBalance)
```

引擎还会做 profile 乘数与硬上限裁剪：

```text
boundedNotional = min(rawNotional * profileMultiplier, riskEngine.maxNotional(balance))
```

## 成本模型细节

净边际分解：

```text
feeBps            = takerFeeBps * 2
slippagePerLegBps = f(notional/liquidity, volatility, slippageBps)
slippageBps       = slippagePerLegBps * 2
latencyPenaltyBps = max(0, grossEdgeBps) * 0.01 * (avgLatencyMs / 100)
netEdgeBps        = grossEdgeBps - feeBps - slippageBps - latencyPenaltyBps - mevPenaltyBps
```

滑点模型：

```text
slippageScale = clamp(slippageBps / 12, 0.25, 4)
baseBps       = 3 * slippageScale
impact        = (notionalUsd / liquidityUsd)^0.5 * 10 * slippageScale * (1 + volatility)
slippagePerLegBps = baseBps + impact
```

## 风险调整收益（Simulator）

模拟器会计算：

- `pFail`（失败概率）
- `expectedShortfall`（预期尾部损失）

最终判定指标：

```text
latencyAdjustedNetUsd  = netUsd - expectedShortfall
riskAdjustedNetEdgeBps = latencyAdjustedNetUsd / notionalUsd * 10_000
pass = riskAdjustedNetEdgeBps >= modeThreshold
```

## 引擎安全机制

### 1) 报价新鲜度

超过 `QUOTE_STALE_MS` 的报价直接丢弃，并记录质量指标与告警。

### 2) 机会去重

在 `OPPORTUNITY_DEDUP_TTL_MS` 窗口内，重复机会会被跳过；仅当边际差超过 `OPPORTUNITY_DEDUP_MIN_EDGE_DELTA_BPS` 才重放。

### 3) Live 准入门（Live Gate）

升到 `live` 必须同时满足：

- `LIVE_ENABLED=true`
- 24h 模拟净收益 > 0
- 24h 模拟胜率 >= 55%
- 24h 权限失败 = 0
- 拒单率 / 延迟 / 滑点偏差不超过动态阈值

动态阈值会随市场压力（波动、gas、流动性）收紧。

### 4) 熔断（Circuit Breaker）

出现以下任一情况会退回 `paper`：

- 连续失败超限
- 日内亏损超过 `MAX_DAILY_LOSS_PCT`
- 权限失败累计过多
- 拒单率 / 延迟 / 滑点偏差恶化

### 5) 权限降级

live 成交若返回 `permission_denied` 或 `whitelist_restricted`：

1. 标记机会降级
2. 发送风险告警
3. 同计划改为 `paper` 执行

## 参数速查

- `MIN_NET_EDGE_BPS_PAPER`, `MIN_NET_EDGE_BPS_LIVE`：最小可接受边际
- `MAX_TRADE_PCT_BALANCE`：单笔仓位上限
- `MAX_DAILY_LOSS_PCT`：日亏损熔断阈值
- `MAX_CONSECUTIVE_FAILURES`：连续失败上限
- `SLIPPAGE_BPS`, `TAKER_FEE_BPS`, `MEV_PENALTY_BPS`：成本模型参数
- `QUOTE_STALE_MS`：报价时效
- `OPPORTUNITY_DEDUP_TTL_MS`, `OPPORTUNITY_DEDUP_MIN_EDGE_DELTA_BPS`：去重参数
