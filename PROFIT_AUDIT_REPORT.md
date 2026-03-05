# PROFIT_AUDIT_REPORT

审计日期：2026-03-05  
范围：
- `src/skills/alphaos/plugins/dex-arbitrage.ts`
- `src/skills/alphaos/runtime/cost-model.ts`
- `src/skills/alphaos/runtime/simulator.ts`
- `src/skills/alphaos/engine/alpha-engine.ts`
- `src/skills/alphaos/runtime/risk-engine.ts`

已验证测试：
- `tests/dex-arbitrage.test.ts`
- `tests/cost-model.test.ts`
- `tests/simulator.test.ts`
- `tests/risk.test.ts`
- `tests/engine-degrade.test.ts`

## 总结

- `Critical`: 0（未发现“绕过风控直接执行负 EV”的单点致命漏洞）
- `Warning`: 6
- `OK`: 5

结论：当前链路具备“二次过滤”（`plugin.evaluate -> simulator.estimate -> risk pass`），能拦截大量负 EV 交易；但参数口径与成本建模仍偏乐观，尤其是 `evaluate` 阶段不计 gas、风险阈值静态化、信号去重不足，会提高边缘交易进入执行链路的概率。

## Findings（按严重度）

### Warning 1: `evaluate` 阶段净边际未计 gas，前置过滤偏乐观
- 文件：`src/skills/alphaos/plugins/dex-arbitrage.ts:145-155`
- 现象：`calculateCostBreakdown` 传入 `gasBuyUsd: 0`, `gasSellUsd: 0`。
- 影响：`evaluate` 接受率高于真实可执行水平，增加后续 `simulator` 才被拒绝的比例，浪费机会窗口与算力。
- 建议：在 `evaluate` 里使用 `quote.gasUsd` 或配置默认 gas，保持与 `simulator` 一致口径。

### Warning 2: `evaluate` 使用固定名义本金，阈值与真实下单规模脱节
- 文件：`src/skills/alphaos/plugins/dex-arbitrage.ts:147`, `:175`
- 现象：评估使用固定 `evalNotionalUsdDefault`，而真实下单来自余额比例（`maxTradePctBalance`）和 profile multiplier。
- 影响：当真实 notional 与评估 notional 偏离较大时，滑点与风险估计失真。
- 建议：`evaluate` 使用计划 notional（或按余额动态估算区间）做一致化预估。

### Warning 3: `SLIPPAGE_BPS` 参数在主路径几乎不生效
- 文件：`src/skills/alphaos/runtime/simulator.ts:55`, `src/skills/alphaos/skill.ts:111-119`
- 现象：`slippageBps` 仅用于“缺省流动性反推”分支；默认配置已提供 `liquidityUsdDefault`，该参数通常不会进入核心计算。
- 影响：运维侧调 `SLIPPAGE_BPS` 可能不改变结果，造成“参数已调整但收益曲线不变”的误判。
- 建议：
  1. 明确废弃 `slippageBps`，只保留流动性驱动模型；或
  2. 把 `slippageBps` 作为 `estimateSlippage` 的显式基线参数。

### Warning 4: `expectedShortfall` 尾部损失模型对高波动场景惩罚不足
- 文件：`src/skills/alphaos/runtime/cost-model.ts:100-110`
- 现象：尾部波动 `tailMoveBps` 主要由 `netEdgeBps` 驱动，正 edge 时固定下限 12 bps；未直接使用 volatility。
- 影响：高波动但暂时正 edge 的时段，尾部风险可能被低估。
- 建议：`tailMoveBps = f(volatility, latency, liquidity, netEdge)`，并引入分位数校准。

### Warning 5: 信号到交易缺少机会去重，可能重复执行同一价差
- 文件：`src/skills/alphaos/engine/alpha-engine.ts:245`, `:373-420`
- 现象：每个 tick 扫描到机会即入库并继续执行，未见按 `(pair,buyDex,sellDex,priceBucket,timeBucket)` 的幂等键去重。
- 影响：同一市场状态下可能重复下单，放大交易成本与冲击。
- 建议：增加机会 TTL + 幂等键 + 最小价差变化门槛。

### Warning 6: 风控阈值静态，缺少市场状态自适应
- 文件：`src/skills/alphaos/runtime/risk-engine.ts:24-40`, `:56-63`
- 现象：reject rate / latency / slippage deviation 阈值固定。
- 影响：高波动阶段可能过松，低波动阶段可能过严，导致风险收益失配。
- 建议：阈值按近期波动率、gas 百分位、流动性分位动态调整。

## Checkpoint 逐项结论

### 1) `dex-arbitrage.ts` calculateEdge 公式和单位
- `OK`：毛边际公式正确，单位为 bps。  
  位置：`src/skills/alphaos/plugins/dex-arbitrage.ts:82`  
  公式：`((sell.bid - buy.ask) / buy.ask) * 10_000`
- `OK`：`volatility` 使用小数制（`bps / 10_000`），与成本模型输入口径一致。  
  位置：`src/skills/alphaos/plugins/dex-arbitrage.ts:97`
- `Warning`：代码中并无独立 `calculateEdge()` 函数，逻辑内联在 `scan`；后续维护时易在多策略产生公式漂移。

### 2) `cost-model.ts` 双腿 taker fee 和 slippage
- `OK`：双腿 taker fee 计算正确。  
  位置：`src/skills/alphaos/runtime/cost-model.ts:49`, `:56-57`
- `OK`：双腿 slippage 计算正确。  
  位置：`src/skills/alphaos/runtime/cost-model.ts:51-52`, `:58-59`
- `OK`：总成本包含买卖 gas、fee、slippage、latency、MEV。  
  位置：`src/skills/alphaos/runtime/cost-model.ts:62-70`
- `Warning`：`netEdgeBps` 不含 gas（只在 `totalCostUsd` 体现），与某些调用方口径不一致。

### 3) `simulator.ts estimate()` 中 `pFail / expectedShortfall`
- `OK`：`pFail` 已进入期望损失计算，且 `pass` 基于风险调整后净边际。  
  位置：`src/skills/alphaos/runtime/simulator.ts:72-83`
- `Warning`：`expectedShortfall` 的 tail 模型偏简化（见 Warning 4），可能低估极端行情损失。

### 4) `alpha-engine.ts` 信号 -> 交易转换
- `OK`：转换链路完整：`scan -> evaluate -> plan -> simulation -> execute`。  
  位置：`src/skills/alphaos/engine/alpha-engine.ts:254-337`
- `OK`：live 权限失败可降级 paper 执行，避免实盘中断。  
  位置：`src/skills/alphaos/engine/alpha-engine.ts:427-477`
- `Warning`：缺少机会去重机制（见 Warning 5）。

### 5) `risk-engine.ts` 阈值和降级机制
- `OK`：具备 live gate + circuit breaker 双层机制。  
  位置：`src/skills/alphaos/runtime/risk-engine.ts:16-66`
- `OK`：连续失败与日亏损阈值均已纳入。  
  位置：`src/skills/alphaos/runtime/risk-engine.ts:47-52`
- `Warning`：阈值固定，非自适应（见 Warning 6）。

## 真实期望收益（默认参数）

默认参数（来自当前配置/默认值）：
- `notional=1000`
- `takerFee=20bps/leg`
- `mevPenalty=5bps`
- `liquidity=250000`
- `volatility=0.02`
- `avgLatency=250ms`
- `gas=1.25 USD/leg`

模型估算结果（风险调整后）：
- `grossEdge=100bps` -> `riskAdjustedNetEdge≈8.95bps`（低于 paper 45bps）
- `grossEdge=120bps` -> `riskAdjustedNetEdge≈34.59bps`（仍低于 paper 45bps）
- `grossEdge=140bps` -> `riskAdjustedNetEdge≈54.06bps`（可过 paper，仍低于 live 60bps）

阈值交叉点（同一组参数）：
- 过 `paper(45bps)` 约需 `grossEdge >= 131bps`
- 过 `live(60bps)` 约需 `grossEdge >= 147bps`

结论：在默认成本假设下，低于约 `130-150bps` 的毛边际交易，大概率无法提供稳定正的风险调整收益。

## 优先级建议

1. P0：统一 `evaluate` 与 `simulator` 成本口径（至少 gas + notional 一致）。
2. P1：引入机会去重/TTL，减少重复执行。
3. P1：重构 `expectedShortfall` 为波动率感知模型。
4. P2：将风险阈值改为动态分位数阈值。
