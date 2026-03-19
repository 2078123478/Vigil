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
  "probe_execution",
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
  "paid_pending",
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

const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).strict();
const createCommandSchema = <
  Type extends (typeof agentCommandTypes)[number],
  Payload extends z.ZodTypeAny,
>(
  type: Type,
  payload: Payload,
) =>
  strictObject({
    type: z.literal(type),
    payload,
  });
const nonEmptyStringSchema = z.string().min(1);
const positiveIntSchema = z.number().int().positive();
const nonNegativeIntSchema = z.number().int().nonnegative();
const nonEmptyStringArraySchema = z.array(nonEmptyStringSchema);

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

export const pingCommandPayloadSchema = strictObject({
  echo: z.string().optional(),
  note: z.string().optional(),
});

export const probeOnchainOsCommandPayloadSchema = strictObject({
  pair: z.string().optional(),
  chainIndex: z.string().optional(),
  notionalUsd: z.number().finite().optional(),
});

export const startDiscoveryCommandPayloadSchema = strictObject({
  strategyId: discoveryStrategyIdSchema.optional(),
  pairs: nonEmptyStringArraySchema.optional(),
  durationMinutes: positiveIntSchema.optional(),
  sampleIntervalSec: positiveIntSchema.optional(),
  topN: positiveIntSchema.optional(),
});

export const getDiscoveryReportCommandPayloadSchema = strictObject({
  sessionId: nonEmptyStringSchema,
});

export const approveCandidateCommandPayloadSchema = strictObject({
  sessionId: nonEmptyStringSchema,
  candidateId: nonEmptyStringSchema,
  mode: executionModeSchema.optional(),
});

export const requestModeChangeCommandPayloadSchema = strictObject({
  requestedMode: executionModeSchema,
  reason: z.string().optional(),
});

export const connectionInviteCommandPayloadSchema = strictObject({
  requestedProfile: nonEmptyStringSchema.optional(),
  requestedCapabilities: nonEmptyStringArraySchema.optional(),
  note: z.string().optional(),
  inlineCard: signedIdentityArtifactBundleSchema.optional(),
});

export const connectionAcceptCommandPayloadSchema = strictObject({
  capabilityProfile: nonEmptyStringSchema.optional(),
  capabilities: nonEmptyStringArraySchema.optional(),
  note: z.string().optional(),
  inlineCard: signedIdentityArtifactBundleSchema.optional(),
});

export const connectionRejectCommandPayloadSchema = strictObject({
  reason: nonEmptyStringSchema.optional(),
  note: z.string().optional(),
  inlineCard: signedIdentityArtifactBundleSchema.optional(),
});

export const connectionConfirmCommandPayloadSchema = strictObject({
  note: z.string().optional(),
  inlineCard: signedIdentityArtifactBundleSchema.optional(),
});

export const agentCommandDescriptorSchema = strictObject({
  type: agentCommandTypeSchema,
  schemaVersion: positiveIntSchema,
});

export const versionedAgentCommandSchema = strictObject({
  type: agentCommandTypeSchema,
  schemaVersion: positiveIntSchema,
  payload: z.unknown(),
});

export const pingCommandSchema = createCommandSchema("ping", pingCommandPayloadSchema);
export const probeExecutionCommandSchema = createCommandSchema(
  "probe_execution",
  probeOnchainOsCommandPayloadSchema,
);
export const probeOnchainOsCommandSchema = createCommandSchema(
  "probe_onchainos",
  probeOnchainOsCommandPayloadSchema,
);
export const startDiscoveryCommandSchema = createCommandSchema(
  "start_discovery",
  startDiscoveryCommandPayloadSchema,
);
export const getDiscoveryReportCommandSchema = createCommandSchema(
  "get_discovery_report",
  getDiscoveryReportCommandPayloadSchema,
);
export const approveCandidateCommandSchema = createCommandSchema(
  "approve_candidate",
  approveCandidateCommandPayloadSchema,
);
export const requestModeChangeCommandSchema = createCommandSchema(
  "request_mode_change",
  requestModeChangeCommandPayloadSchema,
);
export const connectionInviteCommandSchema = createCommandSchema(
  "connection_invite",
  connectionInviteCommandPayloadSchema,
);
export const connectionAcceptCommandSchema = createCommandSchema(
  "connection_accept",
  connectionAcceptCommandPayloadSchema,
);
export const connectionRejectCommandSchema = createCommandSchema(
  "connection_reject",
  connectionRejectCommandPayloadSchema,
);
export const connectionConfirmCommandSchema = createCommandSchema(
  "connection_confirm",
  connectionConfirmCommandPayloadSchema,
);

export const agentCommandSchema = z.discriminatedUnion("type", [
  pingCommandSchema,
  probeExecutionCommandSchema,
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

export const x402ProofSchema = strictObject({
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
});

export const encryptedEnvelopeV1Schema = strictObject({
  version: z.literal(AGENT_COMM_LEGACY_ENVELOPE_VERSION),
  senderPeerId: nonEmptyStringSchema,
  senderPubkey: nonEmptyStringSchema,
  recipient: nonEmptyStringSchema,
  nonce: nonEmptyStringSchema,
  timestamp: nonEmptyStringSchema,
  command: agentCommandDescriptorSchema,
  x402: x402ProofSchema.optional(),
  ciphertext: nonEmptyStringSchema,
  signature: nonEmptyStringSchema,
});

export const encryptedEnvelopeV2Schema = strictObject({
  version: z.literal(AGENT_COMM_ENVELOPE_VERSION),
  kex: strictObject({
    suite: z.literal(AGENT_COMM_KEX_SUITE_V2),
    recipientKeyId: nonEmptyStringSchema,
    ephemeralPubkey: nonEmptyStringSchema,
  }),
  ciphertext: nonEmptyStringSchema,
});

export const encryptedEnvelopeSchema = z.union([
  encryptedEnvelopeV1Schema,
  encryptedEnvelopeV2Schema,
]);

export const encryptedEnvelopeV2PaymentSchema = strictObject({
  asset: nonEmptyStringSchema,
  amount: nonEmptyStringSchema,
  proof: x402ProofSchema.optional(),
  metadata: jsonObjectSchema.optional(),
});

export const encryptedEnvelopeV2AttachmentsSchema = strictObject({
  inlineCard: signedIdentityArtifactBundleSchema.optional(),
});

export const encryptedEnvelopeV2SenderSchema = strictObject({
  identityWallet: evmAddressSchema,
  transportAddress: evmAddressSchema,
  cardDigest: bytes32HexSchema.optional(),
});

export const encryptedEnvelopeV2BodySchema = strictObject({
  msgId: z.string().uuid(),
  sentAt: nonEmptyStringSchema,
  sender: encryptedEnvelopeV2SenderSchema,
  command: versionedAgentCommandSchema,
  payment: encryptedEnvelopeV2PaymentSchema.optional(),
  attachments: encryptedEnvelopeV2AttachmentsSchema.optional(),
});

export const agentPeerSchema = strictObject({
  peerId: nonEmptyStringSchema,
  name: z.string().optional(),
  walletAddress: nonEmptyStringSchema,
  pubkey: nonEmptyStringSchema,
  status: agentPeerStatusSchema,
  capabilities: z.array(agentPeerCapabilitySchema),
  metadata: jsonObjectSchema.optional(),
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

export const agentMessageSchema = strictObject({
  id: nonEmptyStringSchema,
  direction: agentMessageDirectionSchema,
  peerId: nonEmptyStringSchema,
  txHash: z.string().optional(),
  nonce: nonEmptyStringSchema,
  commandType: agentCommandTypeSchema,
  envelopeVersion: positiveIntSchema.optional(),
  msgId: z.string().uuid().optional(),
  contactId: nonEmptyStringSchema.optional(),
  identityWallet: nonEmptyStringSchema.optional(),
  transportAddress: nonEmptyStringSchema.optional(),
  trustOutcome: nonEmptyStringSchema.optional(),
  payment: encryptedEnvelopeV2PaymentSchema.optional(),
  decryptedCommandType: agentCommandTypeSchema.optional(),
  ciphertext: nonEmptyStringSchema,
  status: agentMessageStatusSchema,
  error: z.string().optional(),
  sentAt: z.string().optional(),
  receivedAt: z.string().optional(),
  executedAt: z.string().optional(),
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

export const agentMessageReceiptSchema = strictObject({
  id: nonEmptyStringSchema,
  messageId: nonEmptyStringSchema,
  receiptType: agentMessageReceiptTypeSchema,
  payload: jsonObjectSchema,
  createdAt: nonEmptyStringSchema,
});

export const agentSessionSchema = strictObject({
  id: nonEmptyStringSchema,
  peerId: nonEmptyStringSchema,
  sharedKeyHint: z.string().optional(),
  lastNonce: z.string().optional(),
  lastTxHash: z.string().optional(),
  updatedAt: nonEmptyStringSchema,
});

export const listenerCursorSchema = strictObject({
  address: nonEmptyStringSchema,
  chainId: nonEmptyStringSchema,
  cursor: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

export const agentLocalIdentitySchema = strictObject({
  role: agentLocalIdentityRoleSchema,
  walletAlias: nonEmptyStringSchema,
  walletAddress: evmAddressSchema,
  identityWallet: evmAddressSchema,
  chainId: positiveIntSchema,
  mode: agentLocalIdentityModeSchema,
  activeBindingDigest: bytes32HexSchema.optional(),
  transportKeyId: nonEmptyStringSchema.optional(),
  metadata: jsonObjectSchema.optional(),
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

export const agentSignedArtifactSchema = strictObject({
  id: nonEmptyStringSchema,
  artifactType: agentSignedArtifactTypeSchema,
  digest: bytes32HexSchema,
  signer: evmAddressSchema,
  identityWallet: evmAddressSchema,
  chainId: positiveIntSchema,
  issuedAt: nonNegativeIntSchema,
  expiresAt: nonNegativeIntSchema,
  payload: jsonObjectSchema,
  proof: jsonObjectSchema,
  verificationStatus: agentSignedArtifactVerificationStatusSchema,
  verificationError: z.string().optional(),
  source: nonEmptyStringSchema,
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

export const agentContactSchema = strictObject({
  contactId: nonEmptyStringSchema,
  identityWallet: nonEmptyStringSchema,
  legacyPeerId: nonEmptyStringSchema.optional(),
  displayName: nonEmptyStringSchema.optional(),
  handle: nonEmptyStringSchema.optional(),
  status: agentContactStatusSchema,
  supportedProtocols: nonEmptyStringArraySchema,
  capabilityProfile: nonEmptyStringSchema.optional(),
  capabilities: nonEmptyStringArraySchema,
  metadata: jsonObjectSchema.optional(),
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

export const agentTransportEndpointSchema = strictObject({
  id: nonEmptyStringSchema,
  contactId: nonEmptyStringSchema,
  identityWallet: nonEmptyStringSchema,
  chainId: nonNegativeIntSchema,
  receiveAddress: nonEmptyStringSchema,
  pubkey: nonEmptyStringSchema,
  keyId: nonEmptyStringSchema,
  bindingDigest: bytes32HexSchema.optional(),
  endpointStatus: agentTransportEndpointStatusSchema,
  source: nonEmptyStringSchema,
  metadata: jsonObjectSchema.optional(),
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

export const agentConnectionEventSchema = strictObject({
  id: nonEmptyStringSchema,
  contactId: nonEmptyStringSchema,
  identityWallet: nonEmptyStringSchema,
  direction: agentMessageDirectionSchema,
  eventType: agentConnectionEventTypeSchema,
  eventStatus: agentConnectionEventStatusSchema,
  messageId: nonEmptyStringSchema.optional(),
  txHash: nonEmptyStringSchema.optional(),
  reason: z.string().optional(),
  metadata: jsonObjectSchema.optional(),
  occurredAt: nonEmptyStringSchema,
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

export const agentArtifactStatusSchema = strictObject({
  artifactDigest: bytes32HexSchema,
  artifactType: agentSignedArtifactTypeSchema,
  identityWallet: nonEmptyStringSchema,
  status: agentArtifactRevocationStatusSchema,
  revokedByDigest: bytes32HexSchema.optional(),
  revokedAt: nonNegativeIntSchema.optional(),
  reason: z.string().optional(),
  metadata: jsonObjectSchema.optional(),
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

export const x402ReceiptSchema = strictObject({
  id: nonEmptyStringSchema,
  messageId: nonEmptyStringSchema,
  payer: nonEmptyStringSchema,
  amount: nonEmptyStringSchema,
  asset: nonEmptyStringSchema,
  proof: x402ProofSchema,
  verified: z.boolean(),
  createdAt: nonEmptyStringSchema,
});

export const agentCommStatusSchema = strictObject({
  enabled: z.boolean(),
  chainId: positiveIntSchema,
  listenerMode: commListenerModeSchema,
  walletAlias: nonEmptyStringSchema,
  x402Mode: x402ModeSchema,
  peerCount: nonNegativeIntSchema,
  pendingMessageCount: nonNegativeIntSchema,
  lastCursor: listenerCursorSchema.optional(),
});

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
export type ProbeExecutionCommand = z.infer<typeof probeExecutionCommandSchema>;
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
export type EncryptedEnvelopeV2Payment = z.infer<typeof encryptedEnvelopeV2PaymentSchema>;
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
