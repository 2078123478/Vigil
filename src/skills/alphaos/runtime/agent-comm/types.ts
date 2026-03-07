import { z } from "zod";
import type { DiscoveryStrategyId, ExecutionMode } from "../../types";
import { signedIdentityArtifactBundleSchema } from "./artifact-workflow";

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false;

export const AGENT_COMM_LEGACY_ENVELOPE_VERSION = 1;
export const AGENT_COMM_ENVELOPE_VERSION = 2;
export const AGENT_COMM_DEFAULT_MAX_MESSAGE_BYTES = 16384;
export const AGENT_COMM_PROTOCOL_V1 = "agent-comm/1";
export const AGENT_COMM_PROTOCOL_V2 = "agent-comm/2";
export const AGENT_COMM_KEX_SUITE_V2 = "secp256k1-ecdh-aes256gcm-v2";

export const agentBusinessCommandTypes = [
  "ping",
  "probe_onchainos",
  "start_discovery",
  "get_discovery_report",
  "approve_candidate",
  "request_mode_change",
] as const;
export const agentConnectionCommandTypes = [
  "connection_invite",
  "connection_accept",
  "connection_reject",
  "connection_confirm",
] as const;
export const agentCommandTypes = [
  ...agentBusinessCommandTypes,
  ...agentConnectionCommandTypes,
] as const;

export const agentPeerStatuses = ["pending", "trusted", "blocked", "revoked"] as const;
export const agentMessageDirections = ["inbound", "outbound"] as const;
export const agentMessageStatuses = [
  "pending",
  "sent",
  "confirmed",
  "received",
  "decrypted",
  "executed",
  "rejected",
  "failed",
] as const;
export const agentMessageReceiptTypes = ["ack", "status", "execution", "error", "x402"] as const;
export const agentLocalIdentityRoles = ["liw", "acw", "temporary_demo"] as const;
export const agentLocalIdentityModes = ["standard", "temporary_dual_use"] as const;
export const agentSignedArtifactTypes = ["ContactCard", "TransportBinding", "RevocationNotice"] as const;
export const agentSignedArtifactVerificationStatuses = ["verified", "invalid"] as const;
export const agentContactStatuses = [
  "imported",
  "pending_inbound",
  "pending_outbound",
  "trusted",
  "blocked",
  "revoked",
] as const;
export const agentTransportEndpointStatuses = ["active", "inactive", "revoked"] as const;
export const agentConnectionEventTypes = agentConnectionCommandTypes;
export const agentConnectionEventStatuses = ["pending", "applied", "rejected", "ignored"] as const;
export const agentArtifactRevocationStatuses = ["active", "revoked", "superseded"] as const;
export const commListenerModes = ["disabled", "poll", "ws"] as const;
export const x402Modes = ["disabled", "observe", "enforce"] as const;

const executionModes = ["paper", "live"] as const;
const discoveryStrategyIds = [
  "spread-threshold",
  "mean-reversion",
  "volatility-breakout",
] as const;

type _ExecutionModeMatches = Assert<
  IsEqual<(typeof executionModes)[number], ExecutionMode>
>;
type _DiscoveryStrategyMatches = Assert<
  IsEqual<(typeof discoveryStrategyIds)[number], DiscoveryStrategyId>
>;

export const jsonObjectSchema = z.record(z.string(), z.unknown());
export const executionModeSchema = z.enum(executionModes);
const discoveryStrategyIdSchema = z.enum(discoveryStrategyIds);
const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected EVM address");
const bytes32HexSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected bytes32 hex");

export const agentCommandTypeSchema = z.enum(agentCommandTypes);
export const agentPeerStatusSchema = z.enum(agentPeerStatuses);
export const agentMessageDirectionSchema = z.enum(agentMessageDirections);
export const agentMessageStatusSchema = z.enum(agentMessageStatuses);
export const agentMessageReceiptTypeSchema = z.enum(agentMessageReceiptTypes);
export const agentLocalIdentityRoleSchema = z.enum(agentLocalIdentityRoles);
export const agentLocalIdentityModeSchema = z.enum(agentLocalIdentityModes);
export const agentSignedArtifactTypeSchema = z.enum(agentSignedArtifactTypes);
export const agentSignedArtifactVerificationStatusSchema = z.enum(
  agentSignedArtifactVerificationStatuses,
);
export const agentContactStatusSchema = z.enum(agentContactStatuses);
export const agentTransportEndpointStatusSchema = z.enum(agentTransportEndpointStatuses);
export const agentConnectionEventTypeSchema = z.enum(agentConnectionEventTypes);
export const agentConnectionEventStatusSchema = z.enum(agentConnectionEventStatuses);
export const agentArtifactRevocationStatusSchema = z.enum(agentArtifactRevocationStatuses);
export const commListenerModeSchema = z.enum(commListenerModes);
export const x402ModeSchema = z.enum(x402Modes);
export const agentPeerCapabilitySchema = agentCommandTypeSchema;

const agentBusinessCommandTypeSet = new Set<string>(agentBusinessCommandTypes);
const agentConnectionCommandTypeSet = new Set<string>(agentConnectionCommandTypes);

export function isBusinessCommandType(
  type: string,
): type is (typeof agentBusinessCommandTypes)[number] {
  return agentBusinessCommandTypeSet.has(type);
}

export function isConnectionCommandType(
  type: string,
): type is (typeof agentConnectionCommandTypes)[number] {
  return agentConnectionCommandTypeSet.has(type);
}

export const pingCommandPayloadSchema = z
  .object({
    echo: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();

export const probeOnchainOsCommandPayloadSchema = z
  .object({
    pair: z.string().optional(),
    chainIndex: z.string().optional(),
    notionalUsd: z.number().finite().optional(),
  })
  .strict();

export const startDiscoveryCommandPayloadSchema = z
  .object({
    strategyId: discoveryStrategyIdSchema.optional(),
    pairs: z.array(z.string().min(1)).optional(),
    durationMinutes: z.number().int().positive().optional(),
    sampleIntervalSec: z.number().int().positive().optional(),
    topN: z.number().int().positive().optional(),
  })
  .strict();

export const getDiscoveryReportCommandPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

export const approveCandidateCommandPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    candidateId: z.string().min(1),
    mode: executionModeSchema.optional(),
  })
  .strict();

export const requestModeChangeCommandPayloadSchema = z
  .object({
    requestedMode: executionModeSchema,
    reason: z.string().optional(),
  })
  .strict();

export const connectionInviteCommandPayloadSchema = z
  .object({
    requestedProfile: z.string().min(1).optional(),
    requestedCapabilities: z.array(z.string().min(1)).optional(),
    note: z.string().optional(),
    inlineCard: signedIdentityArtifactBundleSchema.optional(),
  })
  .strict();

export const connectionAcceptCommandPayloadSchema = z
  .object({
    capabilityProfile: z.string().min(1).optional(),
    capabilities: z.array(z.string().min(1)).optional(),
    note: z.string().optional(),
    inlineCard: signedIdentityArtifactBundleSchema.optional(),
  })
  .strict();

export const connectionRejectCommandPayloadSchema = z
  .object({
    reason: z.string().min(1).optional(),
    note: z.string().optional(),
    inlineCard: signedIdentityArtifactBundleSchema.optional(),
  })
  .strict();

export const connectionConfirmCommandPayloadSchema = z
  .object({
    note: z.string().optional(),
    inlineCard: signedIdentityArtifactBundleSchema.optional(),
  })
  .strict();

export const agentCommandDescriptorSchema = z
  .object({
    type: agentCommandTypeSchema,
    schemaVersion: z.number().int().positive(),
  })
  .strict();

export const versionedAgentCommandSchema = z
  .object({
    type: agentCommandTypeSchema,
    schemaVersion: z.number().int().positive(),
    payload: z.unknown(),
  })
  .strict();

export const pingCommandSchema = z
  .object({
    type: z.literal("ping"),
    payload: pingCommandPayloadSchema,
  })
  .strict();

export const probeOnchainOsCommandSchema = z
  .object({
    type: z.literal("probe_onchainos"),
    payload: probeOnchainOsCommandPayloadSchema,
  })
  .strict();

export const startDiscoveryCommandSchema = z
  .object({
    type: z.literal("start_discovery"),
    payload: startDiscoveryCommandPayloadSchema,
  })
  .strict();

export const getDiscoveryReportCommandSchema = z
  .object({
    type: z.literal("get_discovery_report"),
    payload: getDiscoveryReportCommandPayloadSchema,
  })
  .strict();

export const approveCandidateCommandSchema = z
  .object({
    type: z.literal("approve_candidate"),
    payload: approveCandidateCommandPayloadSchema,
  })
  .strict();

export const requestModeChangeCommandSchema = z
  .object({
    type: z.literal("request_mode_change"),
    payload: requestModeChangeCommandPayloadSchema,
  })
  .strict();

export const connectionInviteCommandSchema = z
  .object({
    type: z.literal("connection_invite"),
    payload: connectionInviteCommandPayloadSchema,
  })
  .strict();

export const connectionAcceptCommandSchema = z
  .object({
    type: z.literal("connection_accept"),
    payload: connectionAcceptCommandPayloadSchema,
  })
  .strict();

export const connectionRejectCommandSchema = z
  .object({
    type: z.literal("connection_reject"),
    payload: connectionRejectCommandPayloadSchema,
  })
  .strict();

export const connectionConfirmCommandSchema = z
  .object({
    type: z.literal("connection_confirm"),
    payload: connectionConfirmCommandPayloadSchema,
  })
  .strict();

export const agentCommandSchema = z.discriminatedUnion("type", [
  pingCommandSchema,
  probeOnchainOsCommandSchema,
  startDiscoveryCommandSchema,
  getDiscoveryReportCommandSchema,
  approveCandidateCommandSchema,
  requestModeChangeCommandSchema,
  connectionInviteCommandSchema,
  connectionAcceptCommandSchema,
  connectionRejectCommandSchema,
  connectionConfirmCommandSchema,
]);

export const x402ProofSchema = z
  .object({
    scheme: z.literal("x402"),
    version: z.string().optional(),
    network: z.string().optional(),
    payer: z.string().optional(),
    payee: z.string().optional(),
    asset: z.string().optional(),
    amount: z.string().optional(),
    nonce: z.string().optional(),
    expiresAt: z.string().optional(),
    signature: z.string().optional(),
    metadata: jsonObjectSchema.optional(),
  })
  .strict();

export const encryptedEnvelopeV1Schema = z
  .object({
    version: z.literal(AGENT_COMM_LEGACY_ENVELOPE_VERSION),
    senderPeerId: z.string().min(1),
    senderPubkey: z.string().min(1),
    recipient: z.string().min(1),
    nonce: z.string().min(1),
    timestamp: z.string().min(1),
    command: agentCommandDescriptorSchema,
    x402: x402ProofSchema.optional(),
    ciphertext: z.string().min(1),
    signature: z.string().min(1),
  })
  .strict();

export const encryptedEnvelopeV2Schema = z
  .object({
    version: z.literal(AGENT_COMM_ENVELOPE_VERSION),
    kex: z
      .object({
        suite: z.literal(AGENT_COMM_KEX_SUITE_V2),
        recipientKeyId: z.string().min(1),
        ephemeralPubkey: z.string().min(1),
      })
      .strict(),
    ciphertext: z.string().min(1),
  })
  .strict();

export const encryptedEnvelopeSchema = z.union([
  encryptedEnvelopeV1Schema,
  encryptedEnvelopeV2Schema,
]);

export const encryptedEnvelopeV2PaymentSchema = z
  .object({
    asset: z.string().min(1).optional(),
    amount: z.string().min(1).optional(),
    metadata: jsonObjectSchema.optional(),
  })
  .strict();

export const encryptedEnvelopeV2AttachmentsSchema = z
  .object({
    inlineCard: signedIdentityArtifactBundleSchema.optional(),
  })
  .strict();

export const encryptedEnvelopeV2SenderSchema = z
  .object({
    identityWallet: evmAddressSchema,
    transportAddress: evmAddressSchema,
    cardDigest: bytes32HexSchema.optional(),
  })
  .strict();

export const encryptedEnvelopeV2BodySchema = z
  .object({
    msgId: z.string().uuid(),
    sentAt: z.string().min(1),
    sender: encryptedEnvelopeV2SenderSchema,
    command: versionedAgentCommandSchema,
    payment: encryptedEnvelopeV2PaymentSchema.optional(),
    attachments: encryptedEnvelopeV2AttachmentsSchema.optional(),
  })
  .strict();

export const agentPeerSchema = z
  .object({
    peerId: z.string().min(1),
    name: z.string().optional(),
    walletAddress: z.string().min(1),
    pubkey: z.string().min(1),
    status: agentPeerStatusSchema,
    capabilities: z.array(agentPeerCapabilitySchema),
    metadata: jsonObjectSchema.optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const agentMessageSchema = z
  .object({
    id: z.string().min(1),
    direction: agentMessageDirectionSchema,
    peerId: z.string().min(1),
    txHash: z.string().optional(),
    nonce: z.string().min(1),
    commandType: agentCommandTypeSchema,
    envelopeVersion: z.number().int().positive().optional(),
    msgId: z.string().uuid().optional(),
    contactId: z.string().min(1).optional(),
    identityWallet: z.string().min(1).optional(),
    transportAddress: z.string().min(1).optional(),
    trustOutcome: z.string().min(1).optional(),
    decryptedCommandType: agentCommandTypeSchema.optional(),
    ciphertext: z.string().min(1),
    status: agentMessageStatusSchema,
    error: z.string().optional(),
    sentAt: z.string().optional(),
    receivedAt: z.string().optional(),
    executedAt: z.string().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const agentMessageReceiptSchema = z
  .object({
    id: z.string().min(1),
    messageId: z.string().min(1),
    receiptType: agentMessageReceiptTypeSchema,
    payload: jsonObjectSchema,
    createdAt: z.string().min(1),
  })
  .strict();

export const agentSessionSchema = z
  .object({
    id: z.string().min(1),
    peerId: z.string().min(1),
    sharedKeyHint: z.string().optional(),
    lastNonce: z.string().optional(),
    lastTxHash: z.string().optional(),
    updatedAt: z.string().min(1),
  })
  .strict();

export const listenerCursorSchema = z
  .object({
    address: z.string().min(1),
    chainId: z.string().min(1),
    cursor: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const agentLocalIdentitySchema = z
  .object({
    role: agentLocalIdentityRoleSchema,
    walletAlias: z.string().min(1),
    walletAddress: evmAddressSchema,
    identityWallet: evmAddressSchema,
    chainId: z.number().int().positive(),
    mode: agentLocalIdentityModeSchema,
    activeBindingDigest: bytes32HexSchema.optional(),
    transportKeyId: z.string().min(1).optional(),
    metadata: jsonObjectSchema.optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const agentSignedArtifactSchema = z
  .object({
    id: z.string().min(1),
    artifactType: agentSignedArtifactTypeSchema,
    digest: bytes32HexSchema,
    signer: evmAddressSchema,
    identityWallet: evmAddressSchema,
    chainId: z.number().int().positive(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    payload: jsonObjectSchema,
    proof: jsonObjectSchema,
    verificationStatus: agentSignedArtifactVerificationStatusSchema,
    verificationError: z.string().optional(),
    source: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const agentContactSchema = z
  .object({
    contactId: z.string().min(1),
    identityWallet: z.string().min(1),
    legacyPeerId: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    handle: z.string().min(1).optional(),
    status: agentContactStatusSchema,
    supportedProtocols: z.array(z.string().min(1)),
    capabilityProfile: z.string().min(1).optional(),
    capabilities: z.array(z.string().min(1)),
    metadata: jsonObjectSchema.optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const agentTransportEndpointSchema = z
  .object({
    id: z.string().min(1),
    contactId: z.string().min(1),
    identityWallet: z.string().min(1),
    chainId: z.number().int().nonnegative(),
    receiveAddress: z.string().min(1),
    pubkey: z.string().min(1),
    keyId: z.string().min(1),
    bindingDigest: bytes32HexSchema.optional(),
    endpointStatus: agentTransportEndpointStatusSchema,
    source: z.string().min(1),
    metadata: jsonObjectSchema.optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const agentConnectionEventSchema = z
  .object({
    id: z.string().min(1),
    contactId: z.string().min(1),
    identityWallet: z.string().min(1),
    direction: agentMessageDirectionSchema,
    eventType: agentConnectionEventTypeSchema,
    eventStatus: agentConnectionEventStatusSchema,
    messageId: z.string().min(1).optional(),
    txHash: z.string().min(1).optional(),
    reason: z.string().optional(),
    metadata: jsonObjectSchema.optional(),
    occurredAt: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const agentArtifactStatusSchema = z
  .object({
    artifactDigest: bytes32HexSchema,
    artifactType: agentSignedArtifactTypeSchema,
    identityWallet: z.string().min(1),
    status: agentArtifactRevocationStatusSchema,
    revokedByDigest: bytes32HexSchema.optional(),
    revokedAt: z.number().int().nonnegative().optional(),
    reason: z.string().optional(),
    metadata: jsonObjectSchema.optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const x402ReceiptSchema = z
  .object({
    id: z.string().min(1),
    messageId: z.string().min(1),
    payer: z.string().min(1),
    amount: z.string().min(1),
    asset: z.string().min(1),
    proof: x402ProofSchema,
    verified: z.boolean(),
    createdAt: z.string().min(1),
  })
  .strict();

export const agentCommStatusSchema = z
  .object({
    enabled: z.boolean(),
    chainId: z.number().int().positive(),
    listenerMode: commListenerModeSchema,
    walletAlias: z.string().min(1),
    x402Mode: x402ModeSchema,
    peerCount: z.number().int().nonnegative(),
    pendingMessageCount: z.number().int().nonnegative(),
    lastCursor: listenerCursorSchema.optional(),
  })
  .strict();

export type AgentCommandType = z.infer<typeof agentCommandTypeSchema>;
export type AgentBusinessCommandType = (typeof agentBusinessCommandTypes)[number];
export type AgentConnectionCommandType = (typeof agentConnectionCommandTypes)[number];
export type AgentPeerCapability = z.infer<typeof agentPeerCapabilitySchema>;
export type AgentPeerStatus = z.infer<typeof agentPeerStatusSchema>;
export type AgentMessageDirection = z.infer<typeof agentMessageDirectionSchema>;
export type AgentMessageStatus = z.infer<typeof agentMessageStatusSchema>;
export type AgentMessageReceiptType = z.infer<typeof agentMessageReceiptTypeSchema>;
export type AgentLocalIdentityRole = z.infer<typeof agentLocalIdentityRoleSchema>;
export type AgentLocalIdentityMode = z.infer<typeof agentLocalIdentityModeSchema>;
export type AgentSignedArtifactType = z.infer<typeof agentSignedArtifactTypeSchema>;
export type AgentSignedArtifactVerificationStatus = z.infer<
  typeof agentSignedArtifactVerificationStatusSchema
>;
export type AgentContactStatus = z.infer<typeof agentContactStatusSchema>;
export type AgentTransportEndpointStatus = z.infer<typeof agentTransportEndpointStatusSchema>;
export type AgentConnectionEventType = z.infer<typeof agentConnectionEventTypeSchema>;
export type AgentConnectionEventStatus = z.infer<typeof agentConnectionEventStatusSchema>;
export type AgentArtifactRevocationStatus = z.infer<typeof agentArtifactRevocationStatusSchema>;
export type CommListenerMode = z.infer<typeof commListenerModeSchema>;
export type X402Mode = z.infer<typeof x402ModeSchema>;

export type PingCommandPayload = z.infer<typeof pingCommandPayloadSchema>;
export type ProbeOnchainOsCommandPayload = z.infer<typeof probeOnchainOsCommandPayloadSchema>;
export type StartDiscoveryCommandPayload = z.infer<typeof startDiscoveryCommandPayloadSchema>;
export type GetDiscoveryReportCommandPayload = z.infer<typeof getDiscoveryReportCommandPayloadSchema>;
export type ApproveCandidateCommandPayload = z.infer<typeof approveCandidateCommandPayloadSchema>;
export type RequestModeChangeCommandPayload = z.infer<typeof requestModeChangeCommandPayloadSchema>;
export type ConnectionInviteCommandPayload = z.infer<typeof connectionInviteCommandPayloadSchema>;
export type ConnectionAcceptCommandPayload = z.infer<typeof connectionAcceptCommandPayloadSchema>;
export type ConnectionRejectCommandPayload = z.infer<typeof connectionRejectCommandPayloadSchema>;
export type ConnectionConfirmCommandPayload = z.infer<typeof connectionConfirmCommandPayloadSchema>;
export type AgentCommandDescriptor = z.infer<typeof agentCommandDescriptorSchema>;
export type VersionedAgentCommand = z.infer<typeof versionedAgentCommandSchema>;
export type PingCommand = z.infer<typeof pingCommandSchema>;
export type ProbeOnchainOsCommand = z.infer<typeof probeOnchainOsCommandSchema>;
export type StartDiscoveryCommand = z.infer<typeof startDiscoveryCommandSchema>;
export type GetDiscoveryReportCommand = z.infer<typeof getDiscoveryReportCommandSchema>;
export type ApproveCandidateCommand = z.infer<typeof approveCandidateCommandSchema>;
export type RequestModeChangeCommand = z.infer<typeof requestModeChangeCommandSchema>;
export type ConnectionInviteCommand = z.infer<typeof connectionInviteCommandSchema>;
export type ConnectionAcceptCommand = z.infer<typeof connectionAcceptCommandSchema>;
export type ConnectionRejectCommand = z.infer<typeof connectionRejectCommandSchema>;
export type ConnectionConfirmCommand = z.infer<typeof connectionConfirmCommandSchema>;
export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type X402Proof = z.infer<typeof x402ProofSchema>;
export type EncryptedEnvelopeV1 = z.infer<typeof encryptedEnvelopeV1Schema>;
export type EncryptedEnvelopeV2 = z.infer<typeof encryptedEnvelopeV2Schema>;
export type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>;
export type EncryptedEnvelopeV2Body = z.infer<typeof encryptedEnvelopeV2BodySchema>;
export type AgentPeer = z.infer<typeof agentPeerSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentMessageReceipt = z.infer<typeof agentMessageReceiptSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type ListenerCursor = z.infer<typeof listenerCursorSchema>;
export type AgentLocalIdentity = z.infer<typeof agentLocalIdentitySchema>;
export type AgentSignedArtifact = z.infer<typeof agentSignedArtifactSchema>;
export type AgentContact = z.infer<typeof agentContactSchema>;
export type AgentTransportEndpoint = z.infer<typeof agentTransportEndpointSchema>;
export type AgentConnectionEvent = z.infer<typeof agentConnectionEventSchema>;
export type AgentArtifactStatus = z.infer<typeof agentArtifactStatusSchema>;
export type X402Receipt = z.infer<typeof x402ReceiptSchema>;
export type AgentCommStatus = z.infer<typeof agentCommStatusSchema>;
