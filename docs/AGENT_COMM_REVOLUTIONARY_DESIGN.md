# Agent-Comm: A Revolutionary Communication Protocol

**TL;DR**: Agent-Comm is a blockchain-native, end-to-end encrypted, contact-based communication protocol that enables autonomous agents to establish trust and exchange messages without centralized infrastructure.

## Why Revolutionary?

### 1. No Central Server Required

Traditional agent communication relies on:
- WebSocket servers
- Message brokers (RabbitMQ, Kafka)
- API gateways
- Authentication servers

Agent-Comm eliminates all of these. The blockchain itself is the message bus.

**Impact**: Deploy agents anywhere, communicate globally, no infrastructure to maintain.

### 2. Cryptographic Trust by Default

Trust is not "configured" — it's **proven**:

- Identity = blockchain address (unforgeable)
- Messages signed by sender's private key
- Payload encrypted with recipient's public key
- Trust relationships recorded on-chain

**Impact**: No password leaks, no session hijacking, no man-in-the-middle.

### 3. Contact-First Design

Unlike traditional "add peer by IP:port", Agent-Comm uses **signed contact cards**:

```
Agent A publishes card → Agent B imports card → Agent B requests connection → Agent A approves/rejects
```

Cards contain:
- Identity wallet (long-term anchor)
- Active transport address (rotatable)
- Capabilities (what commands this agent supports)
- Cryptographic proof (EIP-712 signature)

**Impact**: Onboarding is QR-code simple, yet cryptographically secure.

### 4. Envelope v2: Dual-Stack Compatibility

Agent-Comm v2 supports both:
- **v2 receivers**: Full contact-based trust
- **v1 receivers**: Legacy peer-based trust

Senders automatically downgrade when needed.

**Impact**: Gradual migration, no flag day, no breaking changes.

### 5. Blockchain-Native Auditability

Every message is:
- Timestamped on-chain
- Immutably recorded
- Publicly verifiable (metadata)
- Privately encrypted (payload)

**Impact**: Perfect for compliance, dispute resolution, and forensic analysis.

## Core Design Principles

### Principle 1: Identity Over Infrastructure

Traditional systems ask: "What's your server address?"  
Agent-Comm asks: "What's your identity wallet?"

The identity is portable. The agent can move, the wallet stays.

### Principle 2: Trust is Explicit, Not Implicit

No "anyone can send me messages" mode.  
Every sender must be:
1. Known (contact imported)
2. Trusted (connection accepted)
3. Verified (signature + address match)

### Principle 3: Privacy by Design

Metadata is visible (who talks to whom, when).  
Payload is encrypted (what they say is private).

This is the right trade-off for most agent use cases:
- Regulators can see activity patterns
- Competitors cannot steal strategies

### Principle 4: Graceful Degradation

If the blockchain is slow, messages queue.  
If RPC fails, retry with backoff.  
If a contact rotates keys, old messages still decrypt (grace period).

No catastrophic failures.

### Principle 5: Developer Ergonomics

```bash
# Initialize
npm run dev -- agent-comm:wallet:init

# Export a machine-friendly JSON card bundle
npm run dev -- agent-comm:card:export --output card.json

# Or export a shareable, human-friendly HTML contact card (self-contained)
npm run dev -- agent-comm:card:export --html --output card.html

# Import remote card
npm run dev -- agent-comm:card:import remote-card.json

# Establish trust
npm run dev -- agent-comm:connect:invite <contactId>
npm run dev -- agent-comm:connect:accept <contactId>

# Send message
npm run dev -- agent-comm:send ping contact:<contactId>
```

Five commands. No YAML. No Kubernetes. No Docker Compose.

## What Makes It Reusable?

### 1. Chain-Agnostic

Works on any EVM chain:
- Ethereum mainnet
- L2s (Arbitrum, Optimism, Base)
- Sidechains (Polygon, X Layer)
- Private chains (Hyperledger Besu, Quorum)

Just change `COMM_CHAIN_ID` and `COMM_RPC_URL`.

### 2. Command-Extensible

Current commands:
- `ping`
- `start_discovery`
- `probe_onchainos`
- `request_mode_change`

Add your own:
1. Define schema in `types.ts`
2. Implement handler in `task-router.ts`
3. Register in `agentCommandTypes`

No protocol changes needed.

### 3. Storage-Agnostic

Current implementation uses SQLite.  
But the protocol doesn't care:
- Postgres for multi-agent clusters
- Redis for ephemeral state
- IPFS for decentralized storage

Just implement the `StateStore` interface.

### 4. Transport-Agnostic (Future)

Current: Direct on-chain transactions  
Future:
- Relayers (gasless for receivers)
- Bundlers (batch multiple messages)
- L2 rollups (cheaper, faster)
- State channels (off-chain, settle on-chain)

Protocol stays the same.

## Real-World Use Cases

### 1. Autonomous Trading Agents

Agents discover arbitrage opportunities and share signals:

```
Agent A: "I found ETH/USDC spread on Uniswap"
Agent B: "Confirmed, executing trade"
```

No centralized exchange. No API keys. No rate limits.

### 2. Multi-Agent Research Collaboration

Agents coordinate long-running research tasks:

```
Agent A: "Start discovery on BTC/USDC, 30 minutes"
Agent B: "Discovery complete, top 10 candidates attached"
Agent A: "Approve candidate #3"
```

All communication auditable, all decisions traceable.

### 3. Decentralized Oracles

Agents report off-chain data to smart contracts:

```
Agent A: "Weather in NYC: 72°F"
Agent B: "Confirmed, 71°F"
Agent C: "Confirmed, 73°F"
Contract: "Consensus: 72°F, payout triggered"
```

No Chainlink subscription. No centralized oracle.

### 4. Agent-to-Agent Payments

Agents negotiate and settle payments:

```
Agent A: "I'll provide this data for 0.01 ETH"
Agent B: "Accepted" (sends payment)
Agent A: (delivers data)
```

Payment and message in the same transaction.

## Comparison to Alternatives

| Feature | Agent-Comm | HTTP API | WebSocket | MQTT | gRPC |
|---------|-----------|----------|-----------|------|------|
| Decentralized | ✅ | ❌ | ❌ | ❌ | ❌ |
| E2E Encrypted | ✅ | ⚠️ (TLS only) | ⚠️ (TLS only) | ⚠️ (TLS only) | ⚠️ (TLS only) |
| Cryptographic Identity | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auditable | ✅ | ⚠️ (logs) | ⚠️ (logs) | ⚠️ (logs) | ⚠️ (logs) |
| No Infrastructure | ✅ | ❌ | ❌ | ❌ | ❌ |
| Offline-Tolerant | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| Global Reach | ✅ | ⚠️ (DNS) | ⚠️ (DNS) | ⚠️ (broker) | ⚠️ (DNS) |

## Current Limitations

### 1. Latency

On-chain messages take ~3-15 seconds to confirm.

**Mitigation**: Use fast L2s (Arbitrum, Optimism) or state channels.

### 2. Cost

Each message costs gas (~$0.01-0.10 depending on chain).

**Mitigation**: Batch messages, use L2s, or implement relayers.

### 3. Metadata Visibility

Who talks to whom is visible on-chain.

**Mitigation**: Use mixnets, stealth addresses, or private chains.

### 4. Scalability

Block polling is slow when catching up.

**Mitigation**: Mitigated: batch RPC transport, cached chainId, unified receipts filtering. Poll mode handles real-time monitoring with minimal overhead (~1 HTTP request per poll cycle).

## Roadmap

### Phase 1: Core Protocol (✅ Complete)
- Envelope v2
- Contact cards
- Trust establishment
- E2E encryption

### Phase 2: Production Hardening (🚧 In Progress)
- getLogs optimization (replaced by unified receipts + batch RPC transport) ✅
- Webhook integration ✅
- Relayer support (in progress)
- Multi-chain deployment (in progress)
- Monitoring/alerting (in progress)

### Phase 3: Advanced Features (📋 Planned)
- State channels
- Payment integration
- Reputation system
- Dispute resolution

## Getting Started

1. Read: `docs/AGENT_COMM_PRODUCTION_DEPLOYMENT.md`
2. Deploy: Follow the 6-step guide
3. Extend: Add your own commands
4. Scale: Optimize for your use case

## Integrations

### OpenClaw Webhook Integration

Agent-Comm can POST inbound-message notifications to OpenClaw's `/hooks/wake` endpoint so orchestration reacts immediately to new on-chain messages.
The integration is optional and configured with `COMM_WEBHOOK_URL` and (optionally) `COMM_WEBHOOK_TOKEN`.
This keeps protocol transport fully on-chain while allowing low-latency off-chain wake-up behavior.

### Extensible Webhook Targets

The same webhook contract can be used with any webhook-compatible system (custom schedulers, alerting gateways, workflow engines, bots).
No protocol changes are required; only endpoint and auth configuration differ.

## Philosophy

Agent-Comm is not trying to replace HTTP or WebSocket.

It's for scenarios where:
- **Trust matters more than speed**
- **Decentralization matters more than cost**
- **Auditability matters more than privacy**

If you're building autonomous agents that need to coordinate without a central authority, Agent-Comm is the right tool.

---

**Protocol Version**: v2  
**Status**: Production-ready  
**License**: MIT (check repo for details)  
**Maintained by**: OnchainOS team
