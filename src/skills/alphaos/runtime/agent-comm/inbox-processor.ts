import { getAddress, type Address } from "viem";
import type { StateStore } from "../state-store";
import {
  verifySignedIdentityArtifactBundle,
  type AgentCommSignedContactCardArtifact,
  type AgentCommSignedIdentityArtifactBundle,
  type AgentCommSignedTransportBindingArtifact,
} from "./artifact-workflow";
import type { ResolvedReceiveKey } from "./local-identity";
import { decodeEnvelope } from "./calldata-codec";
import { decrypt, deriveSharedKey } from "./ecdh-crypto";
import type { ShadowWallet } from "./shadow-wallet";
import {
  AGENT_COMM_KEX_SUITE_V2,
  agentCommandSchema,
  encryptedEnvelopeV2BodySchema,
  isBusinessCommandType,
  isConnectionCommandType,
  type AgentCommand,
  type AgentConnectionEventStatus,
  type AgentConnectionEventType,
  type AgentContact,
  type AgentMessage,
  type AgentMessageStatus,
  type AgentPeer,
} from "./types";
import type { TransactionEvent } from "./tx-listener";

export interface InboxProcessorOptions {
  wallet: ShadowWallet;
  store: StateStore;
  expectedChainId?: number;
  receiveKeys?: ResolvedReceiveKey[];
}

export interface ProcessInboxResult {
  message: AgentMessage;
  command: AgentCommand;
}

export class InboxProcessingError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "InboxProcessingError";
    this.code = code;
    this.details = details;
  }
}

function normalizeAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InboxProcessingError("INVALID_ADDRESS", `Invalid ${label}: ${reason}`, {
      value,
    });
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withInboxError<T>(
  code: string,
  message: string,
  details: Record<string, unknown> | undefined,
  run: () => T,
): T {
  try {
    return run();
  } catch (error) {
    throw new InboxProcessingError(code, `${message}: ${toErrorMessage(error)}`, details);
  }
}

const LEGACY_PROTOCOL_V1 = "agent-comm/1";
const UNKNOWN_INBOUND_DECRYPT_WINDOW_MS = 60_000;
const UNKNOWN_INBOUND_DECRYPT_MAX_ATTEMPTS = 5;

interface ConnectionCommandDecision {
  messageStatus: AgentMessageStatus;
  messageError?: string;
  contact?: AgentContact;
  eventStatus?: AgentConnectionEventStatus;
  eventReason?: string;
  eventMetadata?: Record<string, unknown>;
  trustOutcome?: string;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalStringList(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function toNowUnixSeconds(input: string): number | undefined {
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.floor(parsed / 1000);
}

function getInlineCardAttachment(
  command: AgentCommand,
): AgentCommSignedIdentityArtifactBundle | undefined {
  switch (command.type) {
    case "connection_invite":
    case "connection_accept":
    case "connection_reject":
    case "connection_confirm":
      return command.payload.inlineCard;
    default:
      return undefined;
  }
}

function persistInlineCardContactCardArtifact(
  store: StateStore,
  artifact: AgentCommSignedContactCardArtifact,
  digest: string,
  verificationStatus: "verified" | "invalid",
  verificationError?: string,
): void {
  store.upsertAgentSignedArtifact({
    artifactType: "ContactCard",
    digest,
    signer: artifact.proof.signer,
    identityWallet: artifact.identityWallet,
    chainId: artifact.transport.chainId,
    issuedAt: artifact.issuedAt,
    expiresAt: artifact.expiresAt,
    payload: {
      cardVersion: artifact.cardVersion,
      protocols: artifact.protocols,
      displayName: artifact.displayName,
      handle: artifact.handle,
      identityWallet: artifact.identityWallet,
      transport: artifact.transport,
      defaults: artifact.defaults,
      issuedAt: artifact.issuedAt,
      expiresAt: artifact.expiresAt,
      legacyPeerId: artifact.legacyPeerId,
    },
    proof: artifact.proof as unknown as Record<string, unknown>,
    verificationStatus,
    verificationError,
    source: "inline_attachment",
  });
}

function persistInlineCardTransportBindingArtifact(
  store: StateStore,
  artifact: AgentCommSignedTransportBindingArtifact,
  digest: string,
  verificationStatus: "verified" | "invalid",
  verificationError?: string,
): void {
  store.upsertAgentSignedArtifact({
    artifactType: "TransportBinding",
    digest,
    signer: artifact.proof.signer,
    identityWallet: artifact.identityWallet,
    chainId: artifact.chainId,
    issuedAt: artifact.issuedAt,
    expiresAt: artifact.expiresAt,
    payload: {
      bindingVersion: artifact.bindingVersion,
      identityWallet: artifact.identityWallet,
      chainId: artifact.chainId,
      receiveAddress: artifact.receiveAddress,
      pubkey: artifact.pubkey,
      keyId: artifact.keyId,
      issuedAt: artifact.issuedAt,
      expiresAt: artifact.expiresAt,
    },
    proof: artifact.proof as unknown as Record<string, unknown>,
    verificationStatus,
    verificationError,
    source: "inline_attachment",
  });
}

function materializeInlineCardContact(
  store: StateStore,
  input: {
    existingContact: AgentContact | null;
    senderPeerId?: string;
    contactCard: AgentCommSignedContactCardArtifact;
    transportBinding: AgentCommSignedTransportBindingArtifact;
    transportBindingDigest: string;
  },
): AgentContact {
  const contactCardLegacyPeerId = normalizeOptionalText(input.contactCard.legacyPeerId);
  const contactByIdentity = store.getAgentContactByIdentityWallet(input.contactCard.identityWallet);
  const contactByLegacyPeerId = contactCardLegacyPeerId
    ? store.getAgentContactByLegacyPeerId(contactCardLegacyPeerId)
    : null;
  const existingContact = contactByIdentity ?? contactByLegacyPeerId ?? input.existingContact;

  const contact = store.upsertAgentContact({
    contactId: existingContact?.contactId,
    identityWallet: input.contactCard.identityWallet,
    legacyPeerId:
      existingContact?.legacyPeerId ?? contactCardLegacyPeerId ?? normalizeOptionalText(input.senderPeerId),
    displayName:
      existingContact?.displayName ?? normalizeOptionalText(input.contactCard.displayName),
    handle: existingContact?.handle ?? normalizeOptionalText(input.contactCard.handle),
    status: existingContact?.status ?? "imported",
    supportedProtocols:
      normalizeOptionalStringList([
        ...(existingContact?.supportedProtocols ?? []),
        ...input.contactCard.protocols,
      ]) ?? [LEGACY_PROTOCOL_V1],
    capabilityProfile:
      existingContact?.capabilityProfile ??
      normalizeOptionalText(input.contactCard.defaults.capabilityProfile),
    capabilities:
      existingContact?.capabilities && existingContact.capabilities.length > 0
        ? existingContact.capabilities
        : normalizeOptionalStringList(input.contactCard.defaults.capabilities) ?? [],
    metadata: existingContact?.metadata,
  });

  store.upsertAgentTransportEndpoint({
    contactId: contact.contactId,
    identityWallet: contact.identityWallet,
    chainId: input.transportBinding.chainId,
    receiveAddress: input.transportBinding.receiveAddress,
    pubkey: input.transportBinding.pubkey,
    keyId: input.transportBinding.keyId,
    bindingDigest: input.transportBindingDigest,
    endpointStatus: "active",
    source: "inline_attachment",
  });

  return contact;
}

interface InlineCardAttachmentDecision {
  contact: AgentContact | null;
  metadata?: Record<string, unknown>;
  rejectReason?: string;
  trustOutcome?: string;
}

async function evaluateInlineCardAttachment(
  store: StateStore,
  input: {
    command: AgentCommand;
    existingContact: AgentContact | null;
    senderAddress: Address;
    senderPeerId?: string;
    expectedChainId?: number;
    occurredAt: string;
  },
): Promise<InlineCardAttachmentDecision> {
  const inlineCard = getInlineCardAttachment(input.command);
  if (!inlineCard) {
    return {
      contact: input.existingContact,
    };
  }

  const verification = await verifySignedIdentityArtifactBundle(inlineCard, {
    expectedChainId: input.expectedChainId,
    nowUnixSeconds: toNowUnixSeconds(input.occurredAt),
  });
  const verificationError =
    verification.errors.length > 0 ? verification.errors.join("; ") : "invalid inline card";

  if (verification.contactCard) {
    persistInlineCardContactCardArtifact(
      store,
      verification.contactCard.artifact,
      verification.contactCard.digest,
      verification.contactCard.ok ? "verified" : "invalid",
      verification.contactCard.ok ? undefined : verificationError,
    );
  }
  if (verification.transportBinding) {
    persistInlineCardTransportBindingArtifact(
      store,
      verification.transportBinding.artifact,
      verification.transportBinding.digest,
      verification.transportBinding.ok ? "verified" : "invalid",
      verification.transportBinding.ok ? undefined : verificationError,
    );
  }

  const baseMetadata: Record<string, unknown> = {
    inlineCardAttached: true,
    ...(verification.contactCard
      ? { inlineCardContactCardDigest: verification.contactCard.digest }
      : {}),
    ...(verification.transportBinding
      ? { inlineCardTransportBindingDigest: verification.transportBinding.digest }
      : {}),
  };

  if (!verification.ok || !verification.contactCard || !verification.transportBinding) {
    return {
      contact: input.existingContact,
      metadata: {
        ...baseMetadata,
        inlineCardStatus: "invalid",
      },
      rejectReason: verificationError,
      trustOutcome: "inline_card_invalid",
    };
  }

  const transportAddress = normalizeAddress(
    verification.transportBinding.artifact.receiveAddress,
    "inline card transport address",
  );
  if (transportAddress !== input.senderAddress) {
    const mismatchReason =
      "inline card transport address does not match transaction sender";
    return {
      contact: input.existingContact,
      metadata: {
        ...baseMetadata,
        inlineCardStatus: "invalid",
        inlineCardIdentityWallet: verification.contactCard.artifact.identityWallet,
        inlineCardTransportAddress: verification.transportBinding.artifact.receiveAddress,
      },
      rejectReason: mismatchReason,
      trustOutcome: "inline_card_sender_mismatch",
    };
  }

  const importedContact = materializeInlineCardContact(store, {
    existingContact: input.existingContact,
    senderPeerId: input.senderPeerId,
    contactCard: verification.contactCard.artifact,
    transportBinding: verification.transportBinding.artifact,
    transportBindingDigest: verification.transportBinding.digest,
  });
  return {
    contact: importedContact,
    metadata: {
      ...baseMetadata,
      inlineCardStatus: "verified",
      inlineCardIdentityWallet: verification.contactCard.artifact.identityWallet,
      inlineCardTransportAddress: verification.transportBinding.artifact.receiveAddress,
    },
  };
}

function getTrustedPeerCandidate(store: StateStore, peerId: string): AgentPeer | null {
  const peer = store.getAgentPeer(peerId);
  if (!peer || peer.status !== "trusted") {
    return null;
  }
  return peer;
}

function assertTrustedPeerSenderBinding(
  peer: AgentPeer,
  event: TransactionEvent,
  senderAddress: Address,
  senderPubkey: string,
): void {
  const peerWalletAddress = normalizeAddress(peer.walletAddress, "peer wallet address");
  if (senderAddress !== peerWalletAddress) {
    throw new InboxProcessingError(
      "PEER_WALLET_MISMATCH",
      "Transaction sender does not match trusted peer wallet",
      {
        txHash: event.txHash,
        senderPeerId: peer.peerId,
        expected: peerWalletAddress,
        received: senderAddress,
      },
    );
  }

  if (peer.pubkey.toLowerCase() !== senderPubkey.toLowerCase()) {
    throw new InboxProcessingError("PEER_PUBKEY_MISMATCH", "Envelope senderPubkey does not match trusted peer", {
      txHash: event.txHash,
      senderPeerId: peer.peerId,
    });
  }
}

function getReceiveKeys(options: InboxProcessorOptions): ResolvedReceiveKey[] {
  if (options.receiveKeys && options.receiveKeys.length > 0) {
    return options.receiveKeys;
  }

  return [
    {
      walletAlias: "active",
      wallet: options.wallet,
      walletAddress: options.wallet.getAddress(),
      pubkey: options.wallet.getPublicKey(),
      status: "active",
    },
  ];
}

function resolveReceiveKeyByAddress(
  options: InboxProcessorOptions,
  recipientAddress: Address,
): ResolvedReceiveKey | undefined {
  return getReceiveKeys(options).find(
    (entry) => normalizeAddress(entry.walletAddress, "local receive address") === recipientAddress,
  );
}

function resolveReceiveKeyByKeyId(
  options: InboxProcessorOptions,
  recipientKeyId: string,
): ResolvedReceiveKey | undefined {
  return getReceiveKeys(options).find((entry) => entry.transportKeyId === recipientKeyId);
}

function findInboundMessage(store: StateStore, peerId: string, nonce: string): AgentMessage | null {
  return store.findAgentMessage(peerId, "inbound", nonce);
}

function findInboundMessageByMsgId(store: StateStore, msgId: string): AgentMessage | null {
  return store.findAgentMessageByMsgId("inbound", msgId);
}

function parseCommand(plaintext: string): AgentCommand {
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch (error) {
    const reason = toErrorMessage(error);
    throw new InboxProcessingError("INVALID_COMMAND_JSON", `Invalid command JSON: ${reason}`);
  }

  try {
    return agentCommandSchema.parse(decoded);
  } catch (error) {
    const reason = toErrorMessage(error);
    throw new InboxProcessingError("INVALID_COMMAND", `Invalid command payload: ${reason}`);
  }
}

function parseV2Body(plaintext: string): {
  msgId: string;
  sentAt: string;
  sender: {
    identityWallet: string;
    transportAddress: string;
    cardDigest?: string;
  };
  command: AgentCommand;
  attachments?: {
    inlineCard?: AgentCommSignedIdentityArtifactBundle;
  };
} {
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch (error) {
    const reason = toErrorMessage(error);
    throw new InboxProcessingError("INVALID_COMMAND_JSON", `Invalid command JSON: ${reason}`);
  }

  try {
    const parsed = encryptedEnvelopeV2BodySchema.parse(decoded);
    const command = agentCommandSchema.parse({
      type: parsed.command.type,
      payload: parsed.command.payload,
    });
    return {
      msgId: parsed.msgId,
      sentAt: parsed.sentAt,
      sender: parsed.sender,
      command,
      attachments: parsed.attachments,
    };
  } catch (error) {
    const reason = toErrorMessage(error);
    throw new InboxProcessingError("INVALID_COMMAND", `Invalid command payload: ${reason}`);
  }
}

function withInlineCardAttachment(
  command: AgentCommand,
  inlineCard: AgentCommSignedIdentityArtifactBundle | undefined,
): AgentCommand {
  if (!inlineCard) {
    return command;
  }

  switch (command.type) {
    case "connection_invite":
      return {
        ...command,
        payload: {
          ...command.payload,
          inlineCard,
        },
      };
    case "connection_accept":
      return {
        ...command,
        payload: {
          ...command.payload,
          inlineCard,
        },
      };
    case "connection_reject":
      return {
        ...command,
        payload: {
          ...command.payload,
          inlineCard,
        },
      };
    case "connection_confirm":
      return {
        ...command,
        payload: {
          ...command.payload,
          inlineCard,
        },
      };
    default:
      return command;
  }
}

function assertAuthorizedSenderTransport(
  store: StateStore,
  input: {
    contact: AgentContact;
    senderAddress: Address;
    senderIdentityWallet: string;
    senderCardDigest?: string;
  },
): void {
  const endpoint = store.listAgentTransportEndpoints(1, {
    contactId: input.contact.contactId,
    receiveAddress: input.senderAddress,
    endpointStatus: "active",
  })[0];
  if (!endpoint) {
    throw new InboxProcessingError(
      "UNAUTHORIZED_TRANSPORT",
      "Transaction sender is not an active authorized transport endpoint",
      {
        identityWallet: input.senderIdentityWallet,
        senderAddress: input.senderAddress,
      },
    );
  }
  if (!endpoint.bindingDigest) {
    throw new InboxProcessingError(
      "MISSING_TRANSPORT_BINDING",
      "Transport endpoint is missing a verified LIW binding",
      {
        identityWallet: input.senderIdentityWallet,
        senderAddress: input.senderAddress,
      },
    );
  }

  const bindingArtifact = store.getAgentSignedArtifact(endpoint.bindingDigest);
  if (!bindingArtifact || bindingArtifact.verificationStatus !== "verified") {
    throw new InboxProcessingError(
      "INVALID_TRANSPORT_BINDING",
      "Transport endpoint binding is not verified",
      {
        identityWallet: input.senderIdentityWallet,
        senderAddress: input.senderAddress,
        bindingDigest: endpoint.bindingDigest,
      },
    );
  }

  const bindingStatus = store.getAgentArtifactStatus(endpoint.bindingDigest);
  if (bindingStatus && bindingStatus.status === "revoked") {
    throw new InboxProcessingError(
      "REVOKED_TRANSPORT_BINDING",
      "Transport endpoint binding is revoked",
      {
        identityWallet: input.senderIdentityWallet,
        senderAddress: input.senderAddress,
        bindingDigest: endpoint.bindingDigest,
      },
    );
  }

  if (input.senderCardDigest) {
    const contactCardArtifact = store.getAgentSignedArtifact(input.senderCardDigest);
    if (
      !contactCardArtifact
      || contactCardArtifact.artifactType !== "ContactCard"
      || contactCardArtifact.verificationStatus !== "verified"
    ) {
      throw new InboxProcessingError(
        "INVALID_CONTACT_CARD_DIGEST",
        "Sender card digest does not resolve to a verified contact card",
        {
          identityWallet: input.senderIdentityWallet,
          senderAddress: input.senderAddress,
          cardDigest: input.senderCardDigest,
        },
      );
    }
  }
}

function resolveContactForSender(
  store: StateStore,
  senderAddress: Address,
  rawSenderAddress: string,
  senderPeerId: string,
): AgentContact | null {
  const senderPeerIdValue = senderPeerId.trim();
  return (
    store.getAgentContactByIdentityWallet(senderAddress) ??
    store.getAgentContactByIdentityWallet(rawSenderAddress) ??
    store.getAgentContactByIdentityWallet(rawSenderAddress.toLowerCase()) ??
    (senderPeerIdValue.length > 0
      ? store.getAgentContactByLegacyPeerId(senderPeerIdValue)
      : null)
  );
}

function ensureTrustedPeerContact(store: StateStore, peer: AgentPeer): AgentContact {
  const existingContact =
    store.getAgentContactByIdentityWallet(peer.walletAddress) ??
    store.getAgentContactByLegacyPeerId(peer.peerId);
  const stableStatus =
    existingContact?.status === "blocked" || existingContact?.status === "revoked"
      ? existingContact.status
      : "trusted";
  return store.upsertAgentContact({
    contactId: existingContact?.contactId,
    identityWallet: peer.walletAddress,
    legacyPeerId: peer.peerId,
    displayName: existingContact?.displayName ?? peer.name,
    status: stableStatus,
    supportedProtocols: dedupeStrings([...(existingContact?.supportedProtocols ?? []), LEGACY_PROTOCOL_V1]),
    capabilityProfile: existingContact?.capabilityProfile,
    capabilities:
      existingContact?.capabilities && existingContact.capabilities.length > 0
        ? existingContact.capabilities
        : peer.capabilities,
    metadata: existingContact?.metadata,
  });
}

function hasMatchingPendingOutboundInvite(store: StateStore, contact: AgentContact): boolean {
  if (contact.status === "pending_outbound") {
    return true;
  }
  return (
    store.listAgentConnectionEvents(1, {
      contactId: contact.contactId,
      direction: "outbound",
      eventType: "connection_invite",
      eventStatus: "pending",
    }).length > 0
  );
}

function hasMatchingPendingConnectionState(
  store: StateStore,
  command: AgentCommand,
  contact: AgentContact,
): boolean {
  if (command.type === "connection_confirm") {
    return contact.status === "trusted" || hasMatchingPendingOutboundInvite(store, contact);
  }
  return hasMatchingPendingOutboundInvite(store, contact);
}

function getPendingInviteEvent(
  store: StateStore,
  contactId: string,
  direction: "inbound" | "outbound",
) {
  return store.listAgentConnectionEvents(1, {
    contactId,
    direction,
    eventType: "connection_invite",
    eventStatus: "pending",
  })[0];
}

function readConnectionEventMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readConnectionEventMetadataStringArray(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
  return normalized.length > 0 ? normalized : undefined;
}

function toTimestampMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function countRecentInboundMessagesForSender(
  store: StateStore,
  senderAddress: Address,
  eventTimestampMs: number,
): number {
  const normalizedSender = senderAddress.toLowerCase();
  const windowStartMs = eventTimestampMs - UNKNOWN_INBOUND_DECRYPT_WINDOW_MS;
  return store
    .listAgentMessages(1000, {
      direction: "inbound",
    })
    .filter((message) => message.transportAddress?.toLowerCase() === normalizedSender)
    .filter((message) => {
      const messageTimestampMs = toTimestampMs(message.receivedAt ?? message.createdAt);
      return messageTimestampMs !== null && messageTimestampMs >= windowStartMs;
    }).length;
}

function enforceUnknownInboundRateLimit(
  store: StateStore,
  senderAddress: Address,
  eventTimestamp: string,
): void {
  const eventTimestampMs = toTimestampMs(eventTimestamp) ?? Date.now();
  const recentCount = countRecentInboundMessagesForSender(store, senderAddress, eventTimestampMs);
  if (recentCount < UNKNOWN_INBOUND_DECRYPT_MAX_ATTEMPTS) {
    return;
  }

  throw new InboxProcessingError(
    "UNKNOWN_INBOUND_RATE_LIMITED",
    "Unknown inbound decrypt path rate limit exceeded",
    {
      senderAddress,
      recentCount,
      windowMs: UNKNOWN_INBOUND_DECRYPT_WINDOW_MS,
    },
  );
}

function extractConnectionEventMetadata(command: AgentCommand): Record<string, unknown> {
  if (!isConnectionCommandType(command.type)) {
    return {};
  }

  switch (command.type) {
    case "connection_invite":
      return {
        ...(command.payload.requestedProfile
          ? { requestedProfile: command.payload.requestedProfile }
          : {}),
        ...(command.payload.requestedCapabilities
          ? { requestedCapabilities: command.payload.requestedCapabilities }
          : {}),
        ...(command.payload.note ? { note: command.payload.note } : {}),
      };
    case "connection_accept":
      return {
        ...(command.payload.capabilityProfile
          ? { capabilityProfile: command.payload.capabilityProfile }
          : {}),
        ...(command.payload.capabilities ? { capabilities: command.payload.capabilities } : {}),
        ...(command.payload.note ? { note: command.payload.note } : {}),
      };
    case "connection_reject":
      return {
        ...(command.payload.reason ? { reason: command.payload.reason } : {}),
        ...(command.payload.note ? { note: command.payload.note } : {}),
      };
    case "connection_confirm":
      return {
        ...(command.payload.note ? { note: command.payload.note } : {}),
      };
  }
}

function resolveInboundMessagePeerId(input: {
  trustedPeer?: AgentPeer | null;
  contact?: AgentContact;
  senderAddress: Address;
}): string {
  if (input.trustedPeer) {
    return input.trustedPeer.peerId;
  }
  if (input.contact) {
    return input.contact.legacyPeerId ?? `contact:${input.contact.contactId}`;
  }
  return `unknown:${input.senderAddress.toLowerCase()}`;
}

function persistInboundMessage(
  store: StateStore,
  input: {
    peerId: string;
    nonce: string;
    txHash: string;
    commandType: AgentCommand["type"];
    envelopeVersion: number;
    msgId?: string;
    contactId?: string;
    identityWallet?: string;
    transportAddress: string;
    trustOutcome?: string;
    decryptedCommandType?: AgentCommand["type"];
    ciphertext: string;
    sentAt: string;
    receivedAt: string;
    status: AgentMessageStatus;
    error?: string;
  },
): AgentMessage {
  if (input.msgId) {
    const existingByMsgId = findInboundMessageByMsgId(store, input.msgId);
    if (existingByMsgId) {
      return existingByMsgId;
    }
  }

  const existingMessage = findInboundMessage(store, input.peerId, input.nonce);
  if (existingMessage) {
    return existingMessage;
  }

  try {
    return store.insertAgentMessage({
      direction: "inbound",
      peerId: input.peerId,
      txHash: input.txHash,
      nonce: input.nonce,
      commandType: input.commandType,
      envelopeVersion: input.envelopeVersion,
      msgId: input.msgId,
      contactId: input.contactId,
      identityWallet: input.identityWallet,
      transportAddress: input.transportAddress,
      trustOutcome: input.trustOutcome,
      decryptedCommandType: input.decryptedCommandType,
      ciphertext: input.ciphertext,
      status: input.status,
      error: input.error,
      sentAt: input.sentAt,
      receivedAt: input.receivedAt,
    });
  } catch (error) {
    const reason = toErrorMessage(error);
    const duplicateMessage = findInboundMessage(store, input.peerId, input.nonce);
    if (duplicateMessage) {
      return duplicateMessage;
    }
    if (input.msgId) {
      const duplicateByMsgId = findInboundMessageByMsgId(store, input.msgId);
      if (duplicateByMsgId) {
        return duplicateByMsgId;
      }
    }
    throw new InboxProcessingError("MESSAGE_INSERT_FAILED", `Failed to persist inbound message: ${reason}`, {
      txHash: input.txHash,
      peerId: input.peerId,
      nonce: input.nonce,
      msgId: input.msgId,
    });
  }
}

async function evaluateConnectionCommand(
  store: StateStore,
  command: AgentCommand,
  contact: AgentContact | null,
  senderAddress: Address,
  senderPeerId: string | undefined,
  expectedChainId: number | undefined,
  occurredAt: string,
  inlineCardDecisionOverride?: InlineCardAttachmentDecision,
): Promise<ConnectionCommandDecision> {
  const inlineCardDecision =
    inlineCardDecisionOverride
    ?? await evaluateInlineCardAttachment(store, {
      command,
      existingContact: contact,
      senderAddress,
      senderPeerId,
      expectedChainId,
      occurredAt,
    });
  const resolvedContact = inlineCardDecision.contact;
  const eventMetadata = {
    ...extractConnectionEventMetadata(command),
    ...(inlineCardDecision.metadata ?? {}),
  };

  if (!isConnectionCommandType(command.type)) {
    return {
      messageStatus: "rejected",
      messageError: `unsupported control-plane command: ${command.type}`,
      contact: resolvedContact ?? undefined,
      eventStatus: "rejected",
      eventMetadata,
      trustOutcome: "unsupported_control_plane",
    };
  }

  if (inlineCardDecision.rejectReason) {
    return {
      messageStatus: "rejected",
      messageError: `${command.type} rejected: ${inlineCardDecision.rejectReason}`,
      contact: resolvedContact ?? undefined,
      eventStatus: "rejected",
      eventReason: "invalid_inline_card",
      eventMetadata,
      trustOutcome: inlineCardDecision.trustOutcome ?? "inline_card_invalid",
    };
  }

  if (command.type === "connection_invite") {
    const inviteContact = resolvedContact
      ? store.upsertAgentContact({
          contactId: resolvedContact.contactId,
          identityWallet: resolvedContact.identityWallet,
          legacyPeerId: resolvedContact.legacyPeerId ?? senderPeerId,
          status: resolvedContact.status === "trusted" ? "trusted" : "pending_inbound",
          supportedProtocols: dedupeStrings([
            ...resolvedContact.supportedProtocols,
            LEGACY_PROTOCOL_V1,
          ]),
          capabilityProfile: resolvedContact.capabilityProfile,
          capabilities: resolvedContact.capabilities,
          metadata: resolvedContact.metadata,
        })
      : store.upsertAgentContact({
          identityWallet: senderAddress,
          legacyPeerId: senderPeerId,
          status: "pending_inbound",
          supportedProtocols: [LEGACY_PROTOCOL_V1],
          capabilities: [],
        });

    if (inviteContact.status === "blocked" || inviteContact.status === "revoked") {
      return {
        messageStatus: "rejected",
        messageError: `connection invite ignored for ${inviteContact.status} contact`,
        contact: inviteContact,
        eventStatus: "ignored",
        eventReason: `contact_${inviteContact.status}`,
        eventMetadata,
        trustOutcome: `contact_${inviteContact.status}`,
      };
    }

    return {
      messageStatus: "received",
      contact: inviteContact,
      eventStatus: "pending",
      eventMetadata,
      trustOutcome: "pending_inbound",
    };
  }

  if (!resolvedContact) {
    return {
      messageStatus: "rejected",
      messageError: `${command.type} rejected: no matching contact`,
      eventStatus: "rejected",
      eventMetadata,
      trustOutcome: "missing_contact",
    };
  }

  if (!hasMatchingPendingConnectionState(store, command, resolvedContact)) {
    return {
      messageStatus: "rejected",
      messageError:
        command.type === "connection_confirm"
          ? `${command.type} rejected: no matching pending connection state`
          : `${command.type} rejected: no matching pending outbound invite`,
      contact: resolvedContact,
      eventStatus: "rejected",
      eventReason:
        command.type === "connection_confirm"
          ? "missing_pending_connection_state"
          : "missing_pending_outbound_invite",
      eventMetadata,
      trustOutcome:
        command.type === "connection_confirm"
          ? "missing_pending_connection_state"
          : "missing_pending_outbound_invite",
    };
  }

  if (resolvedContact.status === "blocked" || resolvedContact.status === "revoked") {
    return {
      messageStatus: "rejected",
      messageError: `${command.type} rejected for ${resolvedContact.status} contact`,
      contact: resolvedContact,
      eventStatus: "ignored",
      eventReason: `contact_${resolvedContact.status}`,
      eventMetadata,
      trustOutcome: `contact_${resolvedContact.status}`,
    };
  }

  if (command.type === "connection_accept") {
    const pendingInvite = getPendingInviteEvent(store, resolvedContact.contactId, "outbound");
    const grantedCapabilityProfile =
      command.payload.capabilityProfile ??
      readConnectionEventMetadataString(pendingInvite?.metadata, "requestedProfile") ??
      resolvedContact.capabilityProfile;
    const grantedCapabilities =
      command.payload.capabilities ??
      readConnectionEventMetadataStringArray(pendingInvite?.metadata, "requestedCapabilities") ??
      resolvedContact.capabilities;
    const acceptedContact = store.upsertAgentContact({
      contactId: resolvedContact.contactId,
      identityWallet: resolvedContact.identityWallet,
      legacyPeerId: resolvedContact.legacyPeerId,
      status: "trusted",
      supportedProtocols: dedupeStrings([...resolvedContact.supportedProtocols, LEGACY_PROTOCOL_V1]),
      capabilityProfile: grantedCapabilityProfile,
      capabilities: grantedCapabilities,
      metadata: resolvedContact.metadata,
    });
    return {
      messageStatus: "received",
      contact: acceptedContact,
      eventStatus: "applied",
      eventReason: command.payload.note,
      eventMetadata: {
        ...eventMetadata,
        ...(grantedCapabilityProfile ? { capabilityProfile: grantedCapabilityProfile } : {}),
        capabilities: grantedCapabilities,
      },
      trustOutcome: "trusted",
    };
  }

  if (command.type === "connection_reject") {
    const rejectedContact = store.upsertAgentContact({
      contactId: resolvedContact.contactId,
      identityWallet: resolvedContact.identityWallet,
      legacyPeerId: resolvedContact.legacyPeerId,
      status: "imported",
      supportedProtocols: dedupeStrings([...resolvedContact.supportedProtocols, LEGACY_PROTOCOL_V1]),
      capabilityProfile: resolvedContact.capabilityProfile,
      capabilities: resolvedContact.capabilities,
      metadata: resolvedContact.metadata,
    });
    return {
      messageStatus: "received",
      contact: rejectedContact,
      eventStatus: "applied",
      eventReason: command.payload.reason ?? command.payload.note,
      eventMetadata,
      trustOutcome: "rejected",
    };
  }

  const confirmedContact = store.upsertAgentContact({
    contactId: resolvedContact.contactId,
    identityWallet: resolvedContact.identityWallet,
    legacyPeerId: resolvedContact.legacyPeerId,
    status: "trusted",
    supportedProtocols: dedupeStrings([...resolvedContact.supportedProtocols, LEGACY_PROTOCOL_V1]),
    capabilityProfile: resolvedContact.capabilityProfile,
    capabilities: resolvedContact.capabilities,
    metadata: resolvedContact.metadata,
  });
  const confirmNote = command.type === "connection_confirm" ? command.payload.note : undefined;
  return {
    messageStatus: "received",
    contact: confirmedContact,
    eventStatus: "applied",
    eventReason: confirmNote,
    eventMetadata,
    trustOutcome: "trusted",
  };
}

async function processInboxV1(
  options: InboxProcessorOptions,
  event: TransactionEvent,
  localReceiveKey: ResolvedReceiveKey,
  envelope: ReturnType<typeof decodeEnvelope> & { version: 1 },
): Promise<ProcessInboxResult> {
  const localAddress = normalizeAddress(localReceiveKey.walletAddress, "wallet address");
  const envelopeRecipient = normalizeAddress(envelope.recipient, "envelope recipient");
  if (envelopeRecipient !== localAddress) {
    throw new InboxProcessingError("ENVELOPE_RECIPIENT_MISMATCH", "Envelope recipient does not match wallet", {
      txHash: event.txHash,
      expected: localAddress,
      received: envelopeRecipient,
    });
  }
  const senderAddress = normalizeAddress(event.from, "transaction sender");
  const trustedPeer = getTrustedPeerCandidate(options.store, envelope.senderPeerId);
  if (trustedPeer) {
    assertTrustedPeerSenderBinding(trustedPeer, event, senderAddress, envelope.senderPubkey);
  }
  const senderContact = trustedPeer
    ? ensureTrustedPeerContact(options.store, trustedPeer)
    : resolveContactForSender(options.store, senderAddress, event.from, envelope.senderPeerId);
  if (!trustedPeer && senderContact?.status !== "trusted") {
    enforceUnknownInboundRateLimit(options.store, senderAddress, event.timestamp);
  }

  const sharedKey = withInboxError(
    "ECDH_DERIVE_FAILED",
    "Failed to derive shared key",
    { txHash: event.txHash },
    () => deriveSharedKey(localReceiveKey.wallet.privateKey, envelope.senderPubkey),
  );

  const plaintext = withInboxError(
    "DECRYPT_FAILED",
    "Failed to decrypt inbound envelope",
    {
      txHash: event.txHash,
      senderPeerId: envelope.senderPeerId,
    },
    () => decrypt(envelope.ciphertext, sharedKey),
  );

  const command = parseCommand(plaintext);
  if (command.type !== envelope.command.type) {
    throw new InboxProcessingError("COMMAND_TYPE_MISMATCH", "Envelope command descriptor does not match plaintext command", {
      txHash: event.txHash,
      envelopeType: envelope.command.type,
      plaintextType: command.type,
    });
  }

  if (trustedPeer && !isConnectionCommandType(command.type)) {
    const message = persistInboundMessage(options.store, {
      peerId: trustedPeer.peerId,
      txHash: event.txHash,
      nonce: envelope.nonce,
      commandType: command.type,
      envelopeVersion: envelope.version,
      contactId: senderContact?.contactId,
      identityWallet: senderContact?.identityWallet,
      transportAddress: senderAddress,
      trustOutcome: "trusted_sender",
      decryptedCommandType: command.type,
      ciphertext: envelope.ciphertext,
      status: "decrypted",
      sentAt: envelope.timestamp,
      receivedAt: event.timestamp,
    });
    return {
      message,
      command,
    };
  }

  if (!trustedPeer && isBusinessCommandType(command.type)) {
    const message = persistInboundMessage(options.store, {
      peerId: resolveInboundMessagePeerId({
        contact: senderContact ?? undefined,
        senderAddress,
      }),
      txHash: event.txHash,
      nonce: envelope.nonce,
      commandType: command.type,
      envelopeVersion: envelope.version,
      contactId: senderContact?.contactId,
      identityWallet: senderContact?.identityWallet,
      transportAddress: senderAddress,
      trustOutcome: "unknown_business_rejected",
      decryptedCommandType: command.type,
      ciphertext: envelope.ciphertext,
      status: "rejected",
      error: `unknown business command rejected for untrusted sender: ${command.type}`,
      sentAt: envelope.timestamp,
      receivedAt: event.timestamp,
    });
    return {
      message,
      command,
    };
  }

  const controlPlaneDecision = await evaluateConnectionCommand(
    options.store,
    command,
    senderContact,
    senderAddress,
    envelope.senderPeerId,
    options.expectedChainId,
    event.timestamp,
  );
  const message = persistInboundMessage(options.store, {
    peerId: resolveInboundMessagePeerId({
      trustedPeer,
      contact: controlPlaneDecision.contact,
      senderAddress,
    }),
    txHash: event.txHash,
    nonce: envelope.nonce,
    commandType: command.type,
    envelopeVersion: envelope.version,
    contactId: controlPlaneDecision.contact?.contactId ?? senderContact?.contactId,
    identityWallet: controlPlaneDecision.contact?.identityWallet ?? senderContact?.identityWallet,
    transportAddress: senderAddress,
    trustOutcome: controlPlaneDecision.trustOutcome,
    decryptedCommandType: command.type,
    ciphertext: envelope.ciphertext,
    status: controlPlaneDecision.messageStatus,
    error: controlPlaneDecision.messageError,
    sentAt: envelope.timestamp,
    receivedAt: event.timestamp,
  });

  if (controlPlaneDecision.contact) {
    const eventType: AgentConnectionEventType =
      command.type === "connection_invite"
        ? "connection_invite"
        : command.type === "connection_accept"
          ? "connection_accept"
          : command.type === "connection_reject"
            ? "connection_reject"
            : "connection_confirm";
    options.store.upsertAgentConnectionEvent({
      contactId: controlPlaneDecision.contact.contactId,
      identityWallet: controlPlaneDecision.contact.identityWallet,
      direction: "inbound",
      eventType,
      eventStatus: controlPlaneDecision.eventStatus ?? "pending",
      messageId: message.id,
      txHash: event.txHash,
      reason: controlPlaneDecision.eventReason ?? controlPlaneDecision.messageError,
      occurredAt: event.timestamp,
      metadata: {
        ...(controlPlaneDecision.eventMetadata ?? {}),
        senderPeerId: envelope.senderPeerId,
        trustedSender: Boolean(trustedPeer),
        envelopeVersion: envelope.version,
      },
    });
  }

  return {
    message,
    command,
  };
}

async function processInboxV2(
  options: InboxProcessorOptions,
  event: TransactionEvent,
  _localReceiveKey: ResolvedReceiveKey,
  envelope: ReturnType<typeof decodeEnvelope> & { version: 2 },
): Promise<ProcessInboxResult> {
  if (envelope.kex.suite !== AGENT_COMM_KEX_SUITE_V2) {
    throw new InboxProcessingError("UNSUPPORTED_KEX_SUITE", "Unsupported agent-comm v2 key exchange suite", {
      txHash: event.txHash,
      suite: envelope.kex.suite,
    });
  }

  const resolvedByKeyId = resolveReceiveKeyByKeyId(options, envelope.kex.recipientKeyId);
  if (!resolvedByKeyId) {
    throw new InboxProcessingError(
      "UNKNOWN_RECIPIENT_KEY",
      "No local receive key matches envelope recipientKeyId",
      {
        txHash: event.txHash,
        recipientKeyId: envelope.kex.recipientKeyId,
      },
    );
  }

  const eventRecipient = normalizeAddress(event.to, "transaction recipient");
  const keyRecipient = normalizeAddress(resolvedByKeyId.walletAddress, "local receive address");
  if (eventRecipient != keyRecipient) {
    throw new InboxProcessingError(
      "RECIPIENT_KEY_MISMATCH",
      "Transaction recipient does not match the local key selected by recipientKeyId",
      {
        txHash: event.txHash,
        expected: keyRecipient,
        received: eventRecipient,
        recipientKeyId: envelope.kex.recipientKeyId,
      },
    );
  }

  const senderAddress = normalizeAddress(event.from, "transaction sender");
  const sharedKey = withInboxError(
    "ECDH_DERIVE_FAILED",
    "Failed to derive shared key",
    { txHash: event.txHash, recipientKeyId: envelope.kex.recipientKeyId },
    () => deriveSharedKey(resolvedByKeyId.wallet.privateKey, envelope.kex.ephemeralPubkey),
  );
  const plaintext = withInboxError(
    "DECRYPT_FAILED",
    "Failed to decrypt inbound envelope",
    { txHash: event.txHash, recipientKeyId: envelope.kex.recipientKeyId },
    () => decrypt(envelope.ciphertext, sharedKey),
  );
  const body = parseV2Body(plaintext);
  const senderTransportAddress = normalizeAddress(body.sender.transportAddress, "sender transport address");
  if (senderTransportAddress !== senderAddress) {
    throw new InboxProcessingError(
      "SENDER_TRANSPORT_MISMATCH",
      "Decrypted sender transportAddress does not match transaction sender",
      {
        txHash: event.txHash,
        expected: senderAddress,
        received: senderTransportAddress,
      },
    );
  }

  const existingContact = options.store.getAgentContactByIdentityWallet(body.sender.identityWallet);
  if (!existingContact || existingContact.status !== "trusted") {
    enforceUnknownInboundRateLimit(options.store, senderAddress, event.timestamp);
  }

  const command = withInlineCardAttachment(body.command, body.attachments?.inlineCard);
  const inlineCardDecision = await evaluateInlineCardAttachment(options.store, {
    command,
    existingContact,
    senderAddress,
    senderPeerId: existingContact?.legacyPeerId,
    expectedChainId: options.expectedChainId,
    occurredAt: event.timestamp,
  });
  const resolvedContact = inlineCardDecision.contact ?? existingContact;

  if (!resolvedContact && command.type === "connection_invite" && !body.attachments?.inlineCard) {
    const message = persistInboundMessage(options.store, {
      peerId: resolveInboundMessagePeerId({ senderAddress }),
      txHash: event.txHash,
      nonce: body.msgId,
      msgId: body.msgId,
      commandType: command.type,
      envelopeVersion: envelope.version,
      identityWallet: body.sender.identityWallet,
      transportAddress: senderAddress,
      trustOutcome: "missing_inline_card",
      decryptedCommandType: command.type,
      ciphertext: envelope.ciphertext,
      status: "rejected",
      error: "connection_invite rejected: missing inline card for unknown v2 sender",
      sentAt: body.sentAt,
      receivedAt: event.timestamp,
    });
    return { message, command };
  }

  if (resolvedContact) {
    assertAuthorizedSenderTransport(options.store, {
      contact: resolvedContact,
      senderAddress,
      senderIdentityWallet: body.sender.identityWallet,
      senderCardDigest: body.sender.cardDigest,
    });
  }

  if (isBusinessCommandType(command.type)) {
    if (!resolvedContact || resolvedContact.status !== "trusted") {
      const message = persistInboundMessage(options.store, {
        peerId: resolveInboundMessagePeerId({
          contact: resolvedContact ?? undefined,
          senderAddress,
        }),
        txHash: event.txHash,
        nonce: body.msgId,
        msgId: body.msgId,
        commandType: command.type,
        envelopeVersion: envelope.version,
        contactId: resolvedContact?.contactId,
        identityWallet: body.sender.identityWallet,
        transportAddress: senderAddress,
        trustOutcome: "unknown_business_rejected",
        decryptedCommandType: command.type,
        ciphertext: envelope.ciphertext,
        status: "rejected",
        error: `unknown business command rejected for untrusted sender: ${command.type}`,
        sentAt: body.sentAt,
        receivedAt: event.timestamp,
      });
      return { message, command };
    }

    const message = persistInboundMessage(options.store, {
      peerId: resolveInboundMessagePeerId({
        contact: resolvedContact,
        senderAddress,
      }),
      txHash: event.txHash,
      nonce: body.msgId,
      msgId: body.msgId,
      commandType: command.type,
      envelopeVersion: envelope.version,
      contactId: resolvedContact.contactId,
      identityWallet: body.sender.identityWallet,
      transportAddress: senderAddress,
      trustOutcome: "trusted_sender",
      decryptedCommandType: command.type,
      ciphertext: envelope.ciphertext,
      status: "decrypted",
      sentAt: body.sentAt,
      receivedAt: event.timestamp,
    });
    return { message, command };
  }

  const controlPlaneDecision = await evaluateConnectionCommand(
    options.store,
    command,
    existingContact,
    senderAddress,
    resolvedContact?.legacyPeerId,
    options.expectedChainId,
    event.timestamp,
    inlineCardDecision,
  );
  const message = persistInboundMessage(options.store, {
    peerId: resolveInboundMessagePeerId({
      contact: controlPlaneDecision.contact ?? resolvedContact ?? undefined,
      senderAddress,
    }),
    txHash: event.txHash,
    nonce: body.msgId,
    msgId: body.msgId,
    commandType: command.type,
    envelopeVersion: envelope.version,
    contactId: controlPlaneDecision.contact?.contactId ?? resolvedContact?.contactId,
    identityWallet: body.sender.identityWallet,
    transportAddress: senderAddress,
    trustOutcome: controlPlaneDecision.trustOutcome,
    decryptedCommandType: command.type,
    ciphertext: envelope.ciphertext,
    status: controlPlaneDecision.messageStatus,
    error: controlPlaneDecision.messageError,
    sentAt: body.sentAt,
    receivedAt: event.timestamp,
  });

  if (controlPlaneDecision.contact) {
    const eventType: AgentConnectionEventType =
      command.type === "connection_invite"
        ? "connection_invite"
        : command.type === "connection_accept"
          ? "connection_accept"
          : command.type === "connection_reject"
            ? "connection_reject"
            : "connection_confirm";
    options.store.upsertAgentConnectionEvent({
      contactId: controlPlaneDecision.contact.contactId,
      identityWallet: controlPlaneDecision.contact.identityWallet,
      direction: "inbound",
      eventType,
      eventStatus: controlPlaneDecision.eventStatus ?? "pending",
      messageId: message.id,
      txHash: event.txHash,
      reason: controlPlaneDecision.eventReason ?? controlPlaneDecision.messageError,
      occurredAt: event.timestamp,
      metadata: {
        ...(controlPlaneDecision.eventMetadata ?? {}),
        senderIdentityWallet: body.sender.identityWallet,
        trustedSender: controlPlaneDecision.contact.status === "trusted",
        envelopeVersion: envelope.version,
        recipientKeyId: envelope.kex.recipientKeyId,
      },
    });
  }

  return { message, command };
}

export async function processInbox(
  options: InboxProcessorOptions,
  event: TransactionEvent,
): Promise<ProcessInboxResult> {
  const eventRecipient = normalizeAddress(event.to, "transaction recipient");
  const localReceiveKey = resolveReceiveKeyByAddress(options, eventRecipient);
  if (!localReceiveKey) {
    throw new InboxProcessingError("RECIPIENT_MISMATCH", "Transaction is not addressed to a configured local receive wallet", {
      txHash: event.txHash,
      received: eventRecipient,
    });
  }

  const envelope = withInboxError(
    "INVALID_ENVELOPE",
    "Failed to decode calldata envelope",
    { txHash: event.txHash },
    () => decodeEnvelope(event.calldata),
  );

  if (envelope.version === 1) {
    return processInboxV1(options, event, localReceiveKey, envelope);
  }
  return processInboxV2(options, event, localReceiveKey, envelope);
}
