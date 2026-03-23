# Agent-Comm 说明书（给用户看的版本）

> **Status**: Legacy. This document describes the earlier v1 runtime model. For the current v2 flow, see `docs/AGENT_COMM_V2_OPERATIONS.md`.

这份文档回答 3 个最常见的问题：

1. 发送消息时到底要填什么
2. 系统怎么确认这条链上消息是发给谁的
3. 第三者能看到什么、看不到什么

也顺手解释一个容易混淆的点：**长期身份钱包** 和 **一次性演示钱包** 不应该混在一起。

---

## 一、先说结论

Agent-Comm 不是“随便往链上写点数据”。

它更像一套最小化的链上信封协议：

- 用 **链上交易的 `to` 地址** 标识接收方
- 用 **envelope.recipient** 再做一次收件人校验
- 用 **trusted peer 表** 校验发送方身份
- 用 **ECDH + AES-256-GCM** 加密真正的消息内容

所以它具备：

- **内容保密**：第三者通常看不到 payload 明文
- **身份校验**：只有你信任的 peer 才会被执行
- **链上可验证**：发送交易、接收时间、txHash 都可追踪

但它**不等于完全匿名**：

- 谁和谁通信，通常还是能看见
- 发的是什么大类命令，目前也能看见

---

## 二、发送消息时，需要填哪些内容？

当前实现里，一条 Agent-Comm 消息的最小输入是：

### 1. 目标 peer
也就是你想发给谁。

例如：

- `peer-b`
- `agent-a`
- `customer-01`

这是本地路由层使用的逻辑标识。

### 2. 命令类型
当前支持的命令类型有：

- `ping`
- `probe_execution`
- `start_discovery`
- `get_discovery_report`
- `approve_candidate`
- `request_mode_change`

### 3. 命令 payload
不同命令需要的字段不同。

例如：

#### `ping`
可带：
- `echo`
- `note`

#### `start_discovery`
可带：
- `strategyId`
- `pairs`
- `durationMinutes`
- `sampleIntervalSec`
- `topN`

### 4. senderPeerId（建议显式传）
如果不传，会用本地默认值。

但要注意：
**对端 trust 你的 peerId，必须和你实际发送时用的 senderPeerId 一致。**

这是联调里最容易踩的坑之一。

### 5. 本地身份钱包
这部分通常不是手填，而是系统从本地 vault 读取：

- wallet address
- pubkey
- private key（只在本地用于签名/解密，不明文上链）

---

## 三、具体发送示例

### 示例 1：发送 ping

```bash
npm run dev -- agent-comm:send ping peer-b \
  --sender-peer-id peer-a \
  --echo hello \
  --note smoke
```

你提供的是：

- 发给谁：`peer-b`
- 我是谁：`peer-a`
- 内容：`echo=hello, note=smoke`

### 示例 2：发送 start_discovery

```bash
npm run dev -- agent-comm:send start_discovery peer-b \
  --sender-peer-id peer-a \
  --strategy-id spread-threshold \
  --pairs ETH/USDC,BTC/USDC \
  --duration-minutes 30 \
  --sample-interval-sec 5 \
  --top-n 10
```

你提供的是：

- 发给谁：`peer-b`
- 我是谁：`peer-a`
- 让对方做什么：启动 discovery
- 具体参数：pairs / duration / topN 等

---

## 四、系统怎么确认这条消息“是发给你的”？

当前实现不是只靠一个字段判断，而是 **三层确认**。

### 第一层：链上交易 `to`
接收方 runtime 先看链上交易：

- `event.to` 是否等于我的钱包地址

如果不是，直接拒绝。

这意味着：
**不是打到我地址的交易，我根本不会处理。**

### 第二层：envelope.recipient
链上 calldata 里还封了一层 envelope，里面有：

- `senderPeerId`
- `senderPubkey`
- `recipient`
- `nonce`
- `timestamp`
- `command`
- `ciphertext`
- `signature`

接收方会再次验证：

- `envelope.recipient` 是否等于我的钱包地址

如果链上 `to` 和 envelope 里的 `recipient` 不一致，也会拒绝。

### 第三层：trusted peer 校验
接收方不会因为“消息打到了我地址”就自动信任。

还会做三步：

1. 用 `senderPeerId` 找本地 trusted peer
2. 校验链上 `from` 是否等于 trusted peer 的 walletAddress
3. 校验 `senderPubkey` 是否等于 trusted peer 记录的 pubkey

只有这三步都对，才会继续解密和执行。

---

## 五、第三者能看到什么？

### 结论
**能看到一部分元数据，但通常看不到 payload 明文。**

因为交易和 calldata 都在链上，任何人都可以抓到。

### 第三者能看到的内容

当前 envelope 设计里，第三者可以直接看到：

- `version`
- `senderPeerId`
- `senderPubkey`
- `recipient`
- `nonce`
- `timestamp`
- `command.type`
- `schemaVersion`
- `x402`（如果有）
- `ciphertext`
- `signature`

再加上交易本身的：

- `from`
- `to`
- `txHash`
- 时间

### 这意味着第三者能知道什么？

#### 1. 谁和谁在通信
- 谁发起
- 谁接收
- 频率如何

#### 2. 大概在发什么类型的命令
因为 `command.type` 目前是明文的。

例如能看出这是：
- `ping`
- `start_discovery`
- `approve_candidate`

#### 3. 交互时间和节奏
- 什么时候联系
- 多久联系一次
- 哪些地址形成固定关系图谱

---

## 六、第三者看不到什么？

### 看不到 payload 明文
真正的消息正文在 `ciphertext` 里。

比如：

- ping 的 note/echo
- discovery 的参数
- candidateId
- mode change 的原因

这些默认不会以明文暴露在链上。

---

## 七、为什么第三者通常解不开内容？

当前实现大致是：

1. 发送方私钥 + 接收方公钥
2. 通过 ECDH 派生共享密钥
3. 再使用 AES-256-GCM 加密 plaintext

所以旁观者即使看到 ciphertext，通常也无法还原内容。

前提是：

- 私钥没有泄露
- pubkey 绑定没有被伪造
- 加密实现没有漏洞

---

## 八、这套方案的边界：保内容，不保元数据

这是最重要的现实判断。

当前 Agent-Comm 更接近：

- **内容保密**：是
- **身份校验**：是
- **完全匿名**：不是
- **元数据隐藏**：不是

所以如果你的目标是：

- 让链上旁观者完全看不出谁和谁在通信
- 完全看不出命令类别

当前方案优先保障内容保密，元数据隐藏是后续优化方向。

---

## 九、为什么“长期身份钱包”和“演示钱包”要分开？

这是产品化时非常关键的设计点。

### 更合理的分层应该是：

#### 1. 服务身份钱包 / 我的账号钱包
- 长期持久化
- 稳定 identity
- 除非主动更换，否则不重建
- 作为可信通信身份

#### 2. 客户 / 对端钱包
- 可以长期存在
- 也可以是特定场景临时身份
- 但生命周期应该被明确管理

#### 3. 演示脚本
- 只消费现有身份
- 不应该顺手重建身份
- 更不应该默认清空带余额的钱包数据

如果把这三者混在一起，就容易出现：

- 地址换了但人以为没换
- 钱打到旧地址
- trusted peer 关系失效
- 演示成功但产品不可维护

---

## 十、对普通用户的最小建议

如果你只是想先跑起来，请遵守这 5 条：

### 1. 一旦地址拿去收款，就冻结该钱包目录
不要再随手重建。

### 2. 发送前永远先看 identity
```bash
npm run dev -- agent-comm:identity
```

### 3. 对端 trust 你的 peerId，必须和你发送时一致
最稳妥的方式是显式传：
```bash
--sender-peer-id peer-a
```

### 4. 有余额的钱包禁止被 demo 脚本默认删除
脚本不应该自动 `rm -rf data-*`。

### 5. 调试时至少核对三件事
- 当前 identity
- 当前余额
- 当前 runtime 监听的是不是这组钱包

---

## 十一、当前版本的现实定位

如果你问：现在这个方案能做什么？

答案是：

### 已经能做
- 链上发消息
- 指定接收方
- trusted peer 校验
- 加密 payload
- 接收后执行命令
- 记录消息状态

---

## 十二、下一步应该关心什么？

如果要继续往产品化走，最值得优先研究的是两件事：

1. **哪些字段还能继续加密，减少元数据暴露**
2. **怎么让用户之间建立 trusted peer 更简单、更不容易配错**

下一步可深入分析隐私与信任建联的权衡。

---

## 相关阅读

- `docs/AGENT_COMM_V2_OPERATIONS.md`：操作指南与 CLI
- `README.md`：项目整体入口
