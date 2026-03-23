# Vigil - BNB 生态智能生活助手

> Vigil 是一个面向 BNB 生态的执行型 AI Assistant：持续感知信号、判断是否需要打扰用户，并以可复验的 paper-first 流程输出决策。

---

## Judge Quick Start (5 分钟)

```bash
npm install
cp .env.example .env

# Terminal A: 启动服务（可选但推荐）
npm run dev

# Terminal B: 运行评委演示包装脚本
npm run demo:judge
```

`demo:judge` 提供一个快速检查主路径的入口：先跑稳定的本地验证路径（`demo:living-assistant`），再在服务可用时尝试 `demo:discovery`，并将输出写到 `demo-output/`。它是审阅捷径，不是产品边界。

运行时说明：Vigil 深度依托 OpenClaw 作为 assistant runtime。多通道接入、会话编排、提醒投递与交互闭环由运行时承接；对终端用户而言，Telegram / 语音 / 电话就是实际入口。

## Fastest Reading Path

如果时间有限，按这个顺序看：

- **30 秒**：先看本页的 `3 Core Capabilities` + 架构速览
- **3 分钟**：再看 [`docs/JUDGE_GUIDE.md`](docs/JUDGE_GUIDE.md)
- **10 分钟**：补看 [`docs/JUDGE_ONE_PAGER.md`](docs/JUDGE_ONE_PAGER.md)
- **要核对官方 skill 接入**：直接看 [`docs/official-skills-manifest.json`](docs/official-skills-manifest.json)

## Terminology Quick Map

| Term | Meaning in this repo |
|------|----------------------|
| Living Assistant | 主动感知信号、判断是否打扰用户、并生成简报的主链路 |
| Signal Radar | Binance 公告 / Square 等信号输入层 |
| Contact Policy | 决定 `silent -> call_escalation` 的中断策略层 |
| Voice Brief | 面向用户的短语音简报输出 |
| Execution | `paper-first` 的执行与风控闭环 |
| Agent-Comm | 基于钱包身份的可信通信与连接层 |

---

## 3 Core Capabilities

1. **主动感知与判断（Living Assistant）**
   `Signal Radar -> Contact Policy -> Voice Brief`，支持 `silent` 到 `call_escalation` 的注意力分级。
2. **风险优先的执行闭环（Execution）**
   默认 `paper` 模式，包含成本建模、门控与熔断，强调长期执行约束而不是一次性 live 成败。
3. **Agent-Comm 链上可信通信**
   钱包身份、签名名片、加密消息与连接生命周期管理，支持可验证的 Agent 间交互。

## Judge References

| 资源 | 用途 |
|------|------|
| [Judge Guide](docs/JUDGE_GUIDE.md) | 一页理解项目价值、快速审阅路径 |
| [Official Skills Manifest](docs/official-skills-manifest.json) | 官方技能覆盖、阶段、运行状态、输出可见性 |
| [Judge One Pager](docs/JUDGE_ONE_PAGER.md) | 扩展版评审说明 |
| [Judge Demo Script](scripts/judge-demo.sh) | 统一评审演示入口 |
| [Living Assistant Demo Runner](docs/LIVING_ASSISTANT_DEMO_RUNNER.md) | API 路由级演示命令 |
| [`demo-output/`](demo-output/) | 验证输出目录（运行验证脚本后生成） |

---

## 核心能力一览（架构速览）

```
Binance 公告/Square ──→ Signal Radar ──→ LLM Triage (示例场景: 80→8/12/60，约87%降噪)
                                              │
                                              ▼
                                     Contact Policy Engine
                                      (6级注意力阶梯)
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                         text_nudge     voice_brief    call_escalation
                        (Telegram)    (克隆音色TTS)    (Twilio电话)
                              │               │               │
                              └───────┬───────┘               │
                                      ▼                       ▼
                              Inline Keyboard            紧急电话呼叫
                           (一键操作 → 闭环)
```

## 四大模块

### 1. 🔗 Agent-Comm - 链上铭文通信协议

把 BNB Chain 本身变成 Agent 消息总线，减少对中心化中间设施的依赖。

- 钱包 = 身份，EIP-712 签名名片
- secp256k1-ECDH + AES-256-GCM 端到端加密
- 完整连接生命周期：发现 → 邀请 → 信任 → 通信 → 撤销

![Agent-Comm 名片卡片 — 真实钱包身份](docs/assets/agent-comm-card-real.jpg)

### 2. 💰 套利执行引擎

信息差套利 + 三层风控，不是延迟内卷。

- 六维成本模型（手续费 / 滑点 / MEV / Gas / 延迟 / 尾部风险）
- 三层风控（准入门控 → 熔断器 → 动态阈值）
- 自动 Paper ↔ Live 模式切换

![套利引擎 PnL Performance](docs/assets/pnl-performance.png)

### 3. 📡 Living Assistant - 主动感知 + 智能判断

- Signal Radar 实时轮询 Binance 公告 + Square
- LLM Triage：`80 -> 8 notify / 12 digest / 60 skip`，约 87% 降噪
- 6 级注意力阶梯：silent → digest → text_nudge → voice_brief → strong_interrupt → call_escalation

### 4. 📞 多渠道投递

- Telegram 文字 + Inline Keyboard 一键操作
- CosyVoice 克隆音色语音播报
- Twilio 电话呼叫（紧急升级）
- One-Breath Voice Brief（≤15 秒、≤3 句话、克隆音色）

---

## Skills Hub 深度融合

当前已完成首批核心官方 Skills 融合，重点不是罗列覆盖率，而是把官方能力接进 Vigil 的主路径。覆盖、阶段、runtime 状态与输出可见性详见 `docs/official-skills-manifest.json`。

| 产品阶段 | 已接入官方能力 | 作用 |
|---|---|---|
| Signal | Binance Announcements / Binance Square | 生态信号输入 |
| Market | `binance/spot` | 套利引擎市场上下文 |
| Readiness | `binance/assets` | 执行前置检查 |
| Enrichment | `binance-web3/query-token-info` / `binance-web3/query-token-audit` | 决策上下文与安全审计 |

下一步优先补强判断层与结果分发层：先接 `trading-signal`、`query-address-info`，再接 `binance/square-post`。

适配器模式下，新增 Skill 通常只需约百行适配代码（视 Skill 差异而定）。

评审可见性说明：在套利审批相关 API 输出中，`moduleResponse.skillUsage` + `moduleResponse.candidate.skillSources` 会被汇总为 `skillAttribution`（含 `requiredSkillsUsed` / `enrichmentSkillsUsed` / `distributionSkillsUsed` / `skillSources`）。

---

## 技术指标

| 维度 | 数据 |
|------|------|
| 代码规模 | 5100+ 行 TypeScript |
| 测试 | 53 文件，379 个用例，100% 通过 |
| Skills Hub | 首批核心官方 skills 已进入主路径，详见 `docs/official-skills-manifest.json` |
| 信噪比 | 约 87% 降噪（80 → 8 通知 / 12 摘要 / 60 跳过） |
| 通信协议 | 16KB 加密负载，双版本信封，前向安全 |
| 投递 | Telegram / CosyVoice 克隆 / Twilio 电话 |
| 风控 | 3 层自动降级 |

### 当前已落地能力（非路线图）

以下能力在当前仓库中已有对应代码、测试或可运行验证路径：

- Signal Radar 实时轮询 Binance 公告 + Square，输出 `NormalizedSignal`
- LLM Signal Triage 批量审核 + 规则引擎降级
- Contact Policy 6 级注意力阶梯 + quiet hours + 频率限制
- CosyVoice 克隆音色语音合成 + Telegram 语音投递
- Twilio 电话触达（紧急升级路径）
- Telegram Inline Keyboard 回调闭环
- 套利引擎：六维成本模型 + 三层风控 + paper/live 自动切换
- Agent-Comm：钱包身份 + EIP-712 签名名片 + E2E 加密 + 连接生命周期
- 首批官方 Skills 适配器已接入主路径（`binance/spot`、`binance/assets`、`query-token-info`、`query-token-audit`）
- API 路由可直接调用验证（`/evaluate`、`/demo/:scenarioName`、`/approve`）

验证方式：`npm run demo:judge` 或逐个运行 `demo:living-assistant` / `demo:discovery`。

---

## Quick Start

```bash
# 安装依赖
npm install

# Agent 身份初始化
VAULT_MASTER_PASSWORD=pass123 npx tsx src/index.ts agent-comm:wallet:init

# 导出 HTML 名片（含 QR 码）
VAULT_MASTER_PASSWORD=pass123 npx tsx src/index.ts agent-comm:card:export --html --output ./my-card.html

# Living Assistant 验证路径（默认 fixture；可切换 live Binance 信号）
cp .env.example .env  # 配置 Telegram Bot Token、DashScope API Key
npx tsx scripts/hackathon-e2e-demo.ts

# 套利执行验证路径
npm run demo:discovery

# 完整套利周期
npm run demo:run
```

---

## 更多文档

- [项目介绍（简版）](项目介绍-简版.md) ⭐
- [项目介绍（深度版）](项目介绍.md) ⭐
- [BNB Chain One Pager](docs/BNBCHAIN_ONE_PAGER.md)
- [Agent-Comm V2 Design](docs/AGENT_COMM_V2_DESIGN.md)
- [Agent-Comm One Pager](docs/AGENT_COMM_ONE_PAGER.md)
- [Arbitrage Module Spec](docs/ARBITRAGE_MODULE_SPEC.md)
- [Living Assistant MVP Plan](docs/LIVING_ASSISTANT_MVP_PLAN.md)
- [Champion Agent System](docs/CHAMPION_AGENT_SYSTEM.md)
- [BNB Skills Compatibility Plan](docs/BNB_SKILLS_COMPATIBILITY_PLAN.md)

---

## 三个可复用生态贡献

| 缺失层 | 贡献 | 价值 |
|--------|------|------|
| Agent 信任层 | Agent-Comm 链上铭文协议 | Agent 间零基础设施信任 + E2E 加密通信 |
| 判断层 | Contact Policy Engine + 6 级注意力阶梯 | 被动 Skill → 主动感知的"大脑" |
| 表达层 | Voice Brief Protocol + 多渠道投递 | Agent 像人一样联系用户 |

---

*Vigil - 让 BNB 生态的每一个重要信号，都能用对的方式、在对的时间、找到对的人。*

---

## License

[MIT License](LICENSE)
