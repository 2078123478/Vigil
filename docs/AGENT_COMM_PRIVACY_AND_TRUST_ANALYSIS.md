# Agent-Comm 隐私与建联便利性分析

这份文档回答两个面向产品化的问题：

1. 当前还有哪些字段可以进一步加密或隐藏
2. 如何降低用户与用户之间建立 trusted peer 的门槛

目标不是追求理论上最强，而是找出 **对传播、冷启动、用户理解成本** 最有帮助的改进点。

## 决策快照（对应 v2 草案）

- 核心隐私范围仍然是 **direct-tx mode**，不把 relayer/private routing 当作本轮主线。
- outer envelope 的目标是只保留 `version + kex + ciphertext` 这类最低必需字段。
- 签名标准建议收敛为 **`EIP-712`**；direct-tx 的单条消息本身依赖链上 tx 签名，不再额外要求每条消息再带一层独立离链签名。
- 陌生人策略要分开看：`connection_invite` 可以进入轻量 accept 路径；未建 trust 的业务消息默认拒绝，只能选择在附带转账且金额达到阈值时提醒。

---

## 一、现状：已经保护了什么，暴露了什么

### 已保护
当前 payload 明文已经不直接上链，而是进入 `ciphertext`：

- 具体消息正文
- discovery 参数
- candidateId
- mode change reason
- 业务层细节

这部分已经属于“内容保密”。

### 仍暴露
当前 envelope 中，第三者可以看到：

- `senderPeerId`
- `senderPubkey`
- `recipient`
- `nonce`
- `timestamp`
- `command.type`
- `schemaVersion`
- `x402`（如果带）
- `ciphertext`
- `signature`
- 链上 `from` / `to`

所以现在的问题不是“消息正文泄露”，而是 **元数据泄露较多**。

---

## 二、哪些字段还可以进一步加密？

按优先级看，我会分成三档。

---

## A 档：最值得优先隐藏的字段

### 1. `command.type`
这是当前最明显的元数据泄露点之一。

因为它是明文，旁观者可以直接知道：

- 这是 ping
- 这是 start_discovery
- 这是 approve_candidate
- 这是 request_mode_change

### 为什么它值得优先处理？
因为它直接暴露“业务动作类型”。

对链上旁观者来说，不知道 payload 也没关系，光知道：
- 你什么时候开始 discovery
- 什么时候批准候选
- 什么时候切换 mode

就已经能猜出业务流程。

### 建议改法
把 `command.type` 从 envelope 明文层拿掉，改成：

- envelope 明文只保留统一协议版本/路由字段
- 真正命令类型进入 ciphertext 内部

#### 结果
第三者只能看到：
- 有一条 agent-comm 消息
- 看不到具体是哪种命令

#### 代价
- 调试可读性下降
- 收包后要先解密才能分发路由

**这个代价是值得的。**

---

### 2. `senderPeerId`
`senderPeerId` 如果直接暴露，会泄露身份语义。

比如：
- `vip-client-hk-01`
- `xiaoyin-prod`
- `market-maker-a`

这会让旁观者几乎直接读懂业务关系。

### 建议改法
有 3 种可选路径：

#### 方案 A：随机 peerId
链上永远只用随机字符串，不用可读名字。

例如：
- `p_83fd2c`
- `p_bf912a`

#### 方案 B：本地别名映射
链上是随机 ID，本地 UI 再显示：
- `p_83fd2c` -> `老王`
- `p_bf912a` -> `小音`

#### 方案 C：彻底不暴露 senderPeerId
把它也移入 ciphertext，仅保留最小路由标识。

### 我更推荐
**B 路线**：
- 链上随机 ID
- 本地别名映射

这样兼顾产品可用性和隐私。

---

## B 档：能优化，但收益低于 A 档

### 3. `recipient`
理论上它也暴露“发给谁”。

但这里有个现实问题：
链上交易本身已经有 `to` 了。

所以即使 envelope 里不写 `recipient`，旁观者通常还是能从交易层看到目标地址。

### 那为什么还值得讨论？
因为 envelope 里再写一次 `recipient`，会让解析方更方便，也让旁观者做批量分析更轻松。

### 建议改法
可以考虑：
- envelope 内不重复写 `recipient`
- 运行时直接使用链上 `to`

### 预期收益
- 略微减少冗余元数据
- 降低旁观者直接解析 envelope 的便利度

### 但注意
这不会真正隐藏接收方。

所以它是优化项，不是核心突破项。

---

### 4. `timestamp`
时间戳会暴露交互节奏。

不过链上区块时间本身就提供了接近的信息。

### 建议
- 可以不在 envelope 明文再放业务时间戳
- 只保留 nonce / 链上确认时间

收益有限，但能减少冗余元数据。

---

### 5. `x402`
如果后续 x402 证明直接明文带在 envelope 里，可能会暴露：
- 谁付费
- 支付资产
- 金额级别
- 过期时间

### 建议
如果 x402 要进入正式协议，最好分层：
- 链上必要结算标识最小化
- 业务证明细节尽量放进密文或链下回执

否则支付信息会极大增强旁观者的画像能力。

---

## C 档：在 v2 中可以顺手收敛的字段

### 6. `senderPubkey`
如果继续把静态 `senderPubkey` 放在 outer envelope，旁观者会更容易把多笔消息长期关联到同一个发送方。

v2 更合适的做法是：

- outer envelope 只保留每条消息的 `ephemeralPubkey`
- 长期通信 `pubkey` 放在签名后的身份卡 / transport binding 中
- 需要时再在密文里携带引用或摘要

这样既不影响 ECDH，也能减少静态身份暴露。

### 建议
在 v2 一并处理，不再把静态 `senderPubkey` 作为长期保留的明文字段。

---

## 三、如果按“隐私收益 / 工程成本”排序

我建议的优先级是：

### P1
1. `command.type` 进入密文
2. `senderPeerId` 改随机 ID + 本地别名

### P2
3. envelope 不再重复写 `recipient`
4. 弱化或移除明文 `timestamp`
5. 静态 `senderPubkey` 改成 outer `ephemeralPubkey` + 名片里的长期 pubkey

### P3
6. 重新设计 x402 暴露面

---

## 四、如何提高用户与用户之间建立通信信任的便利性？

这个问题非常重要，因为它直接决定传播能力。

如果建联过程太像“SSH 手工配公钥”，产品就很难爆发。

当前最痛的点有：

1. 要交换 address + pubkey + peerId
2. senderPeerId 还容易配错
3. trusted peer 是本地概念，用户难理解
4. 多设备、多钱包时更容易乱

所以真正要优化的是：
**把“手工登记三元组”变成“可点击、可扫码、可分享的身份卡片”。**

---

## 五、我建议的建联便利化路线

### 方案 1：身份卡片 / 通信名片（强烈推荐）

每个用户生成一张标准身份卡：

```json
{
  "version": 1,
  "identityWallet": "0x...",
  "transport": {
    "walletAddress": "0x...",
    "pubkey": "0x...",
    "chainId": 196
  },
  "capabilities": ["ping", "start_discovery"],
  "displayName": "Xiaoyin",
  "proof": {
    "type": "eip712",
    "signature": "0x..."
  }
}
```

用户之间建联时，只做一件事：

- 分享身份卡
- 对方一键导入
- 本地自动创建 trusted peer

### 为什么这个最关键？
因为它把：
- identity
- walletAddress / pubkey
- capability

打包成一个可传播对象。

传播体验会从：
- “发我 3 个字段，我手动填 CLI”

变成：
- “把你的 Agent 名片发我，我点一下就加你”

这对爆发传播差别非常大。

---

### 方案 2：二维码建联

身份卡天生适合做二维码。

适合场景：
- 手机面对面扫码
- 群里发二维码图
- 官网展示“点击连接 Agent”

### 用户体验
- A 展示二维码
- B 扫码
- B 本地自动导入 trusted peer
- 可选：B 再回传一张自己的身份卡完成双向 trust

这会比手工复制参数方便太多。

---

### 方案 3：一键双向建联握手

目前是：
- A trust B
- B trust A
- 还得确认 senderPeerId 一致

这个太工程味了。

更产品化的方式应该是：

#### 单向
“添加联系人”

#### 双向
“发起建联请求” -> 对方确认 -> 自动完成双向 trust

### 可设计成：
- `connection_invite`
- `connection_accept`
- `connection_reject`

这里要和冷启动业务消息明确区分：

- `connection_invite` 是显式建联请求，不等同于陌生业务私信；OpenClaw 可以直接接受，或者把它放进一个很轻的 accept flow。
- `start_discovery`、`approve_candidate` 这类未建 trust 的业务消息应该默认拒绝；只有在附带转账且金额超过阈值时，才可以选择提醒用户，但仍然不直接执行。

建立后系统自动落库：
- peerId
- walletAddress
- pubkey
- capability
- trust status

这样用户理解的是“加好友/建联”，而不是“注册 trusted peer”。

---

### 方案 4：human-friendly handle + 底层随机 ID

用户不应该天天看 `peer-a` / `peer-b` / `0x...`

建议分两层：

#### 展示层
- `@xiaoyin`
- `@marketbot`
- `@wilsen-lab`

#### 协议层
- `p_83fd2c`
- `p_4f1a99`

这样既便于传播，又不强制把公开 handle 直接刻进链上协议字段。

---

### 方案 5：预信任模板 / 推荐能力集

很多用户根本不知道 capability 是啥。

不要让他们手动选：
- ping
- start_discovery
- approve_candidate
- request_mode_change

更适合的做法是给模板：

- **只聊天**：`ping`
- **研究协作**：`ping + start_discovery + get_discovery_report`
- **高级托管**：更多权限

这样用户是在选“关系模式”，不是选底层 capability。

这对传播特别重要。

---

## 六、我会怎么定义“传播友好”的建联体验

如果目标是有传播爆发力，理想体验应该接近：

### Step 1
用户点“生成我的 Agent 名片”

### Step 2
把名片链接 / 二维码发给别人

### Step 3
对方点“添加到联系人”

### Step 4
如果需要双向通信，对方确认回连

### Step 5
双方直接开始发消息

用户感知是：
- 我在加一个 Agent 联系人

而不是：
- 我在管理 walletAddress / pubkey / peerId / senderPeerId

后者几乎不可能大规模传播。

---

## 七、如果从产品架构上重构，我建议这样分层

### 1. Identity Layer（长期身份层）
负责：
- 持久化身份钱包
- identity card 导出
- identity rotation
- display name / handle 映射

### 2. Trust Layer（信任关系层）
负责：
- 单向 trust
- 双向建联
- 邀请/确认/撤销
- capability 模板

### 3. Privacy Layer（隐私最小暴露层）
负责：
- 最小明文字段
- 命令类型内收至密文
- peerId 随机化
- x402 暴露面控制

### 4. Transport Layer（链上传输层）
负责：
- calldata envelope
- tx 发送
- listener 轮询/ws
- receipt / ack

### 5. UX Layer（用户体验层）
负责：
- 名片
- 二维码
- 一键建联
- 联系人列表
- 状态反馈

---

## 八、我对下一阶段的建议优先级

如果只能做 3 件事，我建议按这个顺序：

### 第一优先级：身份卡片 + 一键导入
理由：传播收益最大。

### 第二优先级：`command.type` 收进密文
理由：隐私收益最大。

### 第三优先级：长期身份钱包持久化
理由：产品边界更清晰，避免 demo 心智污染正式身份。

---

## 九、最终判断

### 关于隐私
当前方案已经做到了：
- 内容加密
- 发给谁可校验
- 谁发的可校验

但还没有做到：
- 隐藏命令类型
- 隐藏身份语义
- 隐藏交互图谱

### 关于传播
当前方案已经能联通，但建联仍偏工程化。

真正想扩散，必须把：
- wallet address
- pubkey
- peerId
- capability

从“手工配置项”变成“可分享的身份对象”。

一句话总结：

**现在的 Agent-Comm 已经像协议雏形，但距离传播级产品，还差一层 identity/trust UX。**

---

## 相关阅读

- `docs/AGENT_COMM_EXPLAINED.md`
- `docs/AGENT_COMM_MIN_REUSE.md`
- `README.md`
