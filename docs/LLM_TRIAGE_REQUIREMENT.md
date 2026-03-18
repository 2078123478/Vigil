# LLM Signal Triage + Natural Brief Generation

## 背景

当前 Living Assistant 的判断引擎和语音简报都是规则/模板驱动的：
- contact-policy/engine.ts 根据 urgency + watchlist 机械分流
- voice-brief/generator.ts 用模板拼接文本

问题：80条 Binance 公告进来，所有 `new_listing` 都触发 `voice_brief`，刷屏。语音内容千篇一律。

## 目标

让 Living Assistant 像真人助理一样：
1. **批量审阅**信号，判断哪几条真正值得打扰
2. **同类聚合**（3条 new_listing → 1条摘要）
3. **自然语言**生成简报（小音风格，不是模板）
4. 规则引擎作为 **fallback**（LLM 不可用时降级）

## 实现要求

### 1. 新增 `src/skills/alphaos/living-assistant/llm/` 模块

#### `llm-client.ts` — 零依赖 LLM 调用
- 用 `fetch` 调 DashScope OpenAI-compatible endpoint
- `POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- Auth: `Bearer ${process.env.TTS_API_KEY || process.env.LLM_API_KEY}`（复用 DashScope key）
- 默认模型: `qwen-plus`（便宜够用）
- 接口：`async function chatCompletion(messages: Message[], options?: { model?: string, temperature?: number, response_format?: { type: 'json_object' } }): Promise<string>`
- 超时 30s，错误时返回 null（让调用方 fallback）

#### `signal-triage.ts` — LLM 信号审核
- 输入：`NormalizedSignal[]`（一批信号）+ `UserContext`
- 输出：`TriageResult`
```typescript
interface TriagedSignal {
  signalId: string;
  verdict: 'notify' | 'digest' | 'skip';  // 通知/摘要/跳过
  attentionLevel: AttentionLevel;
  reason: string;  // LLM 给的理由
  groupKey?: string;  // 同类聚合 key，相同 key 的信号会被合并
}

interface SignalGroup {
  groupKey: string;
  signals: NormalizedSignal[];
  mergedTitle: string;  // LLM 生成的聚合标题
  attentionLevel: AttentionLevel;
}

interface TriageResult {
  triaged: TriagedSignal[];
  groups: SignalGroup[];
  notifyCount: number;
  digestCount: number;
  skipCount: number;
  llmUsed: boolean;  // false = fallback to rules
}
```

- Prompt 设计要点：
  - 你是一个 BNB 生态助理的判断引擎
  - 用户关注的 watchlist: [...]
  - 用户的风险偏好: conservative/moderate/aggressive
  - 以下是一批信号，请判断每条是否值得打扰用户
  - 同类信号请聚合（给相同 groupKey）
  - 输出 JSON
- LLM 失败时 fallback 到现有 `evaluateContactPolicy` 逐条处理

#### `natural-brief.ts` — LLM 自然语言简报
- 输入：`SignalGroup | NormalizedSignal` + `ContactDecision` + `language: 'zh' | 'en'`
- 输出：`string`（小音风格的自然语言）
- Prompt 设计要点：
  - 你是小音，一个元气满满的 AI 助理
  - 用简短、自然、口语化的方式告诉老大这个信号
  - 不超过 3 句话，15 秒内能说完
  - 如果是聚合信号，概括重点，不要逐条念
  - 最后给一个行动建议
- LLM 失败时 fallback 到现有 `generateVoiceBrief`

### 2. 修改 `loop.ts` — 支持批量模式

新增 `runBatchTriage` 函数：
```typescript
async function runBatchTriage(
  signals: NormalizedSignal[],
  userContext: UserContext,
  policyConfig: ContactPolicyConfig,
  options?: { llmApiKey?: string; llmModel?: string }
): Promise<TriageResult>
```

现有 `runLivingAssistantLoop` 保持不变（单信号模式），新增批量入口。

### 3. 修改 brief 生成流程

在 `runLivingAssistantLoop` 中，如果 LLM 可用，用 `natural-brief.ts` 生成文本替代模板。
如果 LLM 不可用，fallback 到现有 `generateVoiceBrief`。

### 4. 修改 demo 脚本

`scripts/living-assistant-demo.ts` 的 `--live` 模式：
- 拉取信号后，先走 `runBatchTriage` 批量审核
- 只对 verdict=notify 的信号/组执行 TTS + 投递
- digest 的信号入队
- skip 的信号跳过
- 打印 triage 摘要（"80 signals → 3 notify, 12 digest, 65 skip"）

### 5. 环境变量

```bash
LLM_API_KEY=sk-...          # 可选，默认复用 TTS_API_KEY
LLM_MODEL=qwen-plus         # 可选，默认 qwen-plus
LLM_ENABLED=true             # 可选，默认 true，设 false 强制用规则引擎
```

## 约束

- 零新依赖（只用 fetch）
- 所有现有测试必须继续通过
- LLM 调用失败时必须 graceful fallback 到规则引擎
- 新代码需要有测试（mock LLM 响应）
- TypeScript strict mode

## 文件清单

新增：
- `src/skills/alphaos/living-assistant/llm/llm-client.ts`
- `src/skills/alphaos/living-assistant/llm/signal-triage.ts`
- `src/skills/alphaos/living-assistant/llm/natural-brief.ts`
- `src/skills/alphaos/living-assistant/llm/index.ts`
- `src/skills/alphaos/living-assistant/llm/types.ts`

修改：
- `src/skills/alphaos/living-assistant/loop.ts` — 新增 batch triage 入口
- `scripts/living-assistant-demo.ts` — live 模式用 batch triage

## 验证

1. `npx tsc --noEmit` 通过
2. `npm test` 全部通过（包括新测试）
3. 手动测试：`LLM_API_KEY=sk-5ee9759a496e4562b976cf3ba4dbebfc npx tsx scripts/living-assistant-demo.ts --live` 应该只输出少量有价值的信号
