import crypto from "node:crypto";
import type { AlphaOsConfig } from "../config";
import type { StateStore } from "../state-store";
import type { VaultService } from "../vault";
import { encodeEnvelope } from "./calldata-codec";
import { deriveSharedKey, encrypt } from "./ecdh-crypto";
import {
  AGENT_COMM_DEFAULT_ACW_ROTATION_GRACE_HOURS,
  ensureLegacyDualUseLocalIdentityProfiles,
  initializeDistinctLocalIdentityState,
  resolveLocalIdentityState,
  rotateLocalCommWallet,
  type ResolvedLocalIdentityState,
} from "./local-identity";
import {
  getLocalSupportedProtocols,
  negotiateProtocolVersion,
} from "./protocol-negotiation";
import { registerPeer } from "./peer-registry";
import { generateShadowWallet, restoreShadowWallet, type ShadowWallet } from "./shadow-wallet";
import {
  sendCalldata,
  type OutboundMessageContext,
  type SendResult,
  type TxSenderOptions,
} from "./tx-sender";
import type {
  AgentCommSignedContactCardArtifact,
  AgentCommSignedIdentityArtifactBundle,
  AgentCommSignedRevocationNoticeArtifact,
  AgentCommSignedTransportBindingArtifact,
} from "./artifact-workflow";
import {
  buildLocalIdentityArtifacts,
  parseSignedRevocationNoticeArtifact,
  parseSignedIdentityArtifactBundle,
  signRevocationNoticeArtifact,
  signIdentityArtifactBundle,
  verifyRevocationNoticeArtifact,
  verifySignedIdentityArtifactBundle,
} from "./artifact-workflow";
import { buildIdentityArtifactBundleShareUrl } from "./card-packaging";
import {
  AGENT_COMM_EMPTY_ARTIFACT_DIGEST,
  AGENT_COMM_REVOCATION_NOTICE_VERSION,
  type RevocableAgentCommArtifactType,
} from "./artifact-contracts";
import {
  getPendingInviteEvent,
  normalizeOptionalStringList,
  normalizeOptionalText,
  readConnectionEventMetadataString,
  readConnectionEventMetadataStringArray,
} from "./connection-helpers";
import {
  AGENT_COMM_KEX_SUITE_V2,
  AGENT_COMM_LEGACY_ENVELOPE_VERSION,
  AGENT_COMM_ENVELOPE_VERSION,
  agentCommandSchema,
  encryptedEnvelopeV2BodySchema,
  type AgentCommand,
  type AgentArtifactRevocationStatus,
  type AgentConnectionEvent,
  type AgentConnectionEventStatus,
  type AgentConnectionEventType,
  type AgentContact,
  type AgentContactStatus,
  type AgentLocalIdentity,
  type AgentPeer,
  type AgentPeerCapability,
  type AgentTransportEndpoint,
  type ConnectionAcceptCommandPayload,
  type ConnectionConfirmCommandPayload,
  type ConnectionInviteCommandPayload,
  type ConnectionRejectCommandPayload,
  type PingCommandPayload,
  type ProbeOnchainOsCommandPayload,
  type RequestModeChangeCommandPayload,
  type StartDiscoveryCommandPayload,
} from "./types";
import {
  persistSignedContactCardArtifact,
  persistSignedRevocationNoticeArtifact,
  persistSignedTransportBindingArtifact,
} from "./signed-artifact-store";

const DEFAULT_TRUSTED_PEER_CAPABILITIES: AgentPeerCapability[] = ["ping", "start_discovery"];
const DEFAULT_CONTACT_CARD_PROTOCOLS = ["agent-comm/2", "agent-comm/1"] as const;
const DEFAULT_CONTACT_CARD_EXPIRY_DAYS = 180;
const DEFAULT_TEMPORARY_DEMO_WALLET_ALIAS_SUFFIX = "-demo";
export const LEGACY_MANUAL_PEER_TRUST_WARNING =
  "legacy/manual v1 fallback record created; prefer card import plus invite/accept for new contacts";

export const identityArtifactFailureCodes = [
  "bad_signature",
  "expired_artifact",
  "domain_mismatch",
  "malformed_transport_binding",
  "invalid_artifact",
] as const;

export const revocationArtifactFailureCodes = [
  "bad_signature",
  "domain_mismatch",
  "invalid_artifact",
] as const;

export interface AgentCommEntrypointDependencies {
  config: AlphaOsConfig;
  store: StateStore;
  vault: VaultService;
}

export interface AgentCommIdentity {
  address: string;
  pubkey: string;
  chainId: number;
  walletAlias: string;
  defaultSenderPeerId: string;
  identityWallet: string;
  transportAddress: string;
  transportKeyId?: string;
  localIdentityMode: AgentLocalIdentity["mode"];
  supportedProtocols: string[];
}

export interface InitCommWalletOptions {
  masterPassword?: string;
  privateKey?: string;
  senderPeerId?: string;
}

export interface InitCommWalletResult extends AgentCommIdentity {
  source: "generated" | "restored";
  replaced: boolean;
  reusedExisting?: boolean;
}

export interface InitTemporaryDemoWalletOptions extends InitCommWalletOptions {
  walletAlias?: string;
}

export interface RotateCommWalletOptions {
  masterPassword?: string;
  gracePeriodHours?: number;
  privateKey?: string;
  senderPeerId?: string;
  displayName?: string;
  handle?: string;
  capabilityProfile?: string;
  capabilities?: string[];
  expiresInDays?: number;
  keyId?: string;
  legacyPeerId?: string;
  nowUnixSeconds?: number;
}

export interface RotateCommWalletResult extends AgentCommIdentity {
  previousTransportAddress: string;
  previousTransportKeyId?: string;
  archivedWalletAlias: string;
  graceExpiresAt: string;
  contactCardDigest: string;
  contactCardFingerprint: string;
  transportBindingDigest: string;
  transportBindingFingerprint: string;
  shareUrl: string;
}

export interface InitTemporaryDemoWalletResult extends AgentCommIdentity {
  source: "generated" | "restored";
  replaced: boolean;
  role: "temporary_demo";
}

export interface RegisterTrustedPeerOptions {
  peerId: string;
  walletAddress: string;
  pubkey: string;
  name?: string;
  capabilities?: AgentPeerCapability[];
  metadata?: Record<string, unknown>;
}

export interface SendCommCommandOptions {
  masterPassword?: string;
  peerId: string;
  senderPeerId?: string;
  command: AgentCommand;
}

export interface SendCommCommandResult extends AgentCommIdentity, SendResult {
  peerId: string;
  recipient: string;
  senderPeerId: string;
  commandType: AgentCommand["type"];
  envelopeVersion: number;
  msgId?: string;
  contactId?: string;
  legacyFallbackUsed: boolean;
}

interface ResolvedCommRecipient {
  peerId: string;
  walletAddress: string;
  pubkey: string;
}

interface ResolvedBusinessSendTarget {
  peer?: AgentPeer;
  contactTarget?: ResolvedOutboundContactTarget;
}

interface ResolvedOutboundContactTarget {
  contact: AgentContact;
  endpoint: AgentTransportEndpoint;
  peerId: string;
}

export interface SendCommConnectionInviteOptions {
  masterPassword?: string;
  contactId: string;
  senderPeerId?: string;
  requestedProfile?: ConnectionInviteCommandPayload["requestedProfile"];
  requestedCapabilities?: ConnectionInviteCommandPayload["requestedCapabilities"];
  note?: ConnectionInviteCommandPayload["note"];
  attachInlineCard?: boolean;
}

export interface SendCommConnectionAcceptOptions {
  masterPassword?: string;
  contactId: string;
  senderPeerId?: string;
  capabilityProfile?: ConnectionAcceptCommandPayload["capabilityProfile"];
  capabilities?: ConnectionAcceptCommandPayload["capabilities"];
  note?: ConnectionAcceptCommandPayload["note"];
  attachInlineCard?: boolean;
}

export interface SendCommConnectionRejectOptions {
  masterPassword?: string;
  contactId: string;
  senderPeerId?: string;
  reason?: ConnectionRejectCommandPayload["reason"];
  note?: ConnectionRejectCommandPayload["note"];
}

export interface SendCommConnectionConfirmOptions {
  masterPassword?: string;
  contactId: string;
  senderPeerId?: string;
  note?: ConnectionConfirmCommandPayload["note"];
  attachInlineCard?: boolean;
}

export interface SendCommConnectionCommandResult extends SendCommCommandResult {
  contactId: string;
  contactStatus: AgentContactStatus;
  connectionEventId: string;
  connectionEventType: AgentConnectionEventType;
  connectionEventStatus: AgentConnectionEventStatus;
}

export interface ExportIdentityArtifactBundleOptions {
  masterPassword?: string;
  displayName?: string;
  handle?: string;
  capabilityProfile?: string;
  capabilities?: string[];
  expiresInDays?: number;
  keyId?: string;
  legacyPeerId?: string;
  nowUnixSeconds?: number;
}

export interface ExportIdentityArtifactBundleResult {
  identity: AgentCommIdentity;
  profiles: AgentLocalIdentity[];
  bundle: AgentCommSignedIdentityArtifactBundle;
  contactCardDigest: string;
  contactCardFingerprint: string;
  transportBindingDigest: string;
  transportBindingFingerprint: string;
  shareUrl: string;
}

export interface ImportIdentityArtifactBundleResult {
  ok: boolean;
  reasons: string[];
  failureCodes: IdentityArtifactFailureCode[];
  contactId?: string;
  identityWallet?: string;
  status?: AgentContactStatus;
  supportedProtocols?: string[];
  activeTransportAddress?: string;
  contactCardDigest?: string;
  contactCardFingerprint?: string;
  transportBindingDigest?: string;
  transportBindingFingerprint?: string;
}

export interface RevokeIdentityArtifactOptions {
  masterPassword?: string;
  artifactDigest: string;
  artifactType: RevocableAgentCommArtifactType;
  replacementDigest?: string;
  reason?: string;
  revokedAt?: number;
  source?: string;
}

export interface ImportRevocationNoticeInput {
  notice: unknown;
  source?: string;
  expectedChainId?: number;
  nowUnixSeconds?: number;
}

export interface ImportRevocationNoticeResult {
  ok: boolean;
  reasons: string[];
  failureCodes: RevocationArtifactFailureCode[];
  noticeDigest?: string;
  noticeFingerprint?: string;
  artifactDigest?: string;
  artifactType?: RevocableAgentCommArtifactType;
  artifactStatus?: AgentArtifactRevocationStatus;
  affectedEndpointIds: string[];
  affectedContactIds: string[];
}

export interface RevokeIdentityArtifactResult extends ImportRevocationNoticeResult {
  notice: AgentCommSignedRevocationNoticeArtifact;
  identityWallet: string;
}

export interface BootstrapAgentCommStateResult {
  legacyPeerBackfill: ReturnType<StateStore["backfillAgentContactsFromLegacyPeers"]>;
  localIdentity?: AgentCommIdentity;
}

interface ResolvedLocalWallet {
  state: ResolvedLocalIdentityState;
  identity: AgentCommIdentity;
}

function getRequiredMasterPassword(masterPassword?: string): string {
  const resolved = masterPassword ?? process.env.VAULT_MASTER_PASSWORD;
  if (!resolved) {
    throw new Error("VAULT_MASTER_PASSWORD is required for agent-comm wallet access");
  }
  return resolved;
}

function getRequiredCommRpcUrl(config: AlphaOsConfig): string {
  if (!config.commRpcUrl) {
    throw new Error("COMM_RPC_URL is required to send agent-comm messages");
  }
  return config.commRpcUrl;
}

function resolveSenderPeerId(config: AlphaOsConfig, senderPeerId?: string): string {
  const resolved = senderPeerId?.trim();
  return resolved && resolved.length > 0 ? resolved : config.commWalletAlias;
}

function toIdentity(
  config: AlphaOsConfig,
  state: ResolvedLocalIdentityState,
  senderPeerId?: string,
): AgentCommIdentity {
  return {
    address: state.acwWallet.getAddress(),
    pubkey: state.acwWallet.getPublicKey(),
    chainId: config.commChainId,
    walletAlias: state.acwProfile.walletAlias,
    defaultSenderPeerId: resolveSenderPeerId(config, senderPeerId),
    identityWallet: state.liwProfile.identityWallet,
    transportAddress: state.acwWallet.getAddress(),
    transportKeyId: state.acwProfile.transportKeyId,
    localIdentityMode: state.acwProfile.mode,
    supportedProtocols: getLocalSupportedProtocols(),
  };
}

function resolveLocalWallet(
  deps: AgentCommEntrypointDependencies,
  masterPassword: string,
  senderPeerId?: string,
): ResolvedLocalWallet {
  const state = resolveLocalIdentityState(deps, masterPassword);
  return {
    state,
    identity: toIdentity(deps.config, state, senderPeerId),
  };
}

function hasConfiguredLocalIdentityProfiles(store: StateStore): boolean {
  return Boolean(store.getAgentLocalIdentity("liw") && store.getAgentLocalIdentity("acw"));
}

function upsertConfiguredAcwProfile(
  deps: AgentCommEntrypointDependencies,
  state: ResolvedLocalIdentityState,
  wallet: ShadowWallet,
): void {
  deps.store.upsertAgentLocalIdentity({
    role: "acw",
    walletAlias: deps.config.commWalletAlias,
    walletAddress: wallet.getAddress(),
    identityWallet: state.liwProfile.identityWallet,
    chainId: deps.config.commChainId,
    mode: state.acwProfile.mode,
    activeBindingDigest: state.acwProfile.activeBindingDigest,
    transportKeyId: state.acwProfile.transportKeyId,
    metadata: state.acwProfile.metadata,
  });
}

export function bootstrapAgentCommState(
  deps: AgentCommEntrypointDependencies,
  options: { masterPassword?: string; senderPeerId?: string } = {},
): BootstrapAgentCommStateResult {
  const legacyPeerBackfill = deps.store.backfillAgentContactsFromLegacyPeers({
    chainId: deps.config.commChainId,
  });

  const resolvedMasterPassword = options.masterPassword ?? process.env.VAULT_MASTER_PASSWORD;
  const localIdentity = deps.store.getVaultItem(deps.config.commWalletAlias) && resolvedMasterPassword
    ? getCommIdentity(deps, {
        masterPassword: resolvedMasterPassword,
        senderPeerId: options.senderPeerId,
      })
    : undefined;

  return {
    legacyPeerBackfill,
    localIdentity,
  };
}

function getTrustedPeer(store: StateStore, peerId: string): AgentPeer {
  const peer = store.getAgentPeer(peerId);
  if (!peer) {
    throw new Error(`Trusted peer not found: ${peerId}`);
  }
  if (peer.status !== "trusted") {
    throw new Error(`Peer is not trusted: ${peerId}`);
  }
  return peer;
}

function resolveTrustedSendTarget(
  store: StateStore,
  peerId: string,
): ResolvedBusinessSendTarget {
  const trustedPeer = store.getAgentPeer(peerId);
  if (trustedPeer) {
    if (trustedPeer.status !== "trusted") {
      throw new Error(`Peer is not trusted: ${peerId}`);
    }

    return {
      peer: trustedPeer,
      contactTarget: resolveContactTargetForTrustedPeer(store, trustedPeer) ?? undefined,
    };
  }

  const contactRefPrefix = "contact:";
  const trustedContact = peerId.startsWith(contactRefPrefix)
    ? store.getAgentContact(peerId.slice(contactRefPrefix.length))
    : store.getAgentContactByLegacyPeerId(peerId);
  if (!trustedContact) {
    throw new Error(`Trusted peer or contact not found: ${peerId}`);
  }
  if (trustedContact.status !== "trusted") {
    throw new Error(`Contact is not trusted: ${peerId}`);
  }

  return {
    contactTarget: resolveOutboundContactTarget(store, trustedContact.contactId),
  };
}

function ensurePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeExpiresInDays(expiresInDays?: number): number {
  if (expiresInDays === undefined) {
    return DEFAULT_CONTACT_CARD_EXPIRY_DAYS;
  }
  return ensurePositiveInteger(expiresInDays, "expiresInDays");
}

function defaultDisplayName(config: AlphaOsConfig, address: string): string {
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  return `${config.commWalletAlias} (${shortAddress})`;
}

function defaultKeyId(nowUnixSeconds: number): string {
  return `rk_${nowUnixSeconds}`;
}

function defaultTemporaryDemoWalletAlias(config: AlphaOsConfig): string {
  return `${config.commWalletAlias}${DEFAULT_TEMPORARY_DEMO_WALLET_ALIAS_SUFFIX}`;
}

function resolveContactById(store: StateStore, contactId: string): AgentContact {
  const contact = store.getAgentContact(contactId);
  if (!contact) {
    throw new Error(`contact not found: ${contactId}`);
  }
  return contact;
}

function resolveActiveContactEndpoint(store: StateStore, contactId: string): AgentTransportEndpoint {
  const endpoint = store.listAgentTransportEndpoints(1, {
    contactId,
    endpointStatus: "active",
  })[0];
  if (!endpoint) {
    throw new Error(`active transport endpoint not found for contact: ${contactId}`);
  }
  return endpoint;
}

function resolveOutboundPeerId(contact: AgentContact): string {
  return contact.legacyPeerId ?? `contact:${contact.contactId}`;
}

function resolveOutboundContactTarget(store: StateStore, contactId: string): ResolvedOutboundContactTarget {
  const contact = resolveContactById(store, contactId);
  const endpoint = resolveActiveContactEndpoint(store, contact.contactId);
  if (endpoint.identityWallet !== contact.identityWallet) {
    throw new Error(
      `contact endpoint identity mismatch for ${contact.contactId}: expected ${contact.identityWallet}, got ${endpoint.identityWallet}`,
    );
  }
  return {
    contact,
    endpoint,
    peerId: resolveOutboundPeerId(contact),
  };
}

function assertContactStatus(
  contact: AgentContact,
  allowedStatuses: AgentContactStatus[],
  actionLabel: string,
): void {
  if (allowedStatuses.includes(contact.status)) {
    return;
  }
  throw new Error(
    `cannot ${actionLabel} for contact ${contact.contactId}: expected status ${allowedStatuses.join(
      " or ",
    )}, received ${contact.status}`,
  );
}

function updateContactStatus(
  store: StateStore,
  contact: AgentContact,
  patch: {
    status: AgentContactStatus;
    capabilityProfile?: string;
    capabilities?: string[];
  },
): AgentContact {
  return store.upsertAgentContact({
    contactId: contact.contactId,
    identityWallet: contact.identityWallet,
    legacyPeerId: contact.legacyPeerId,
    status: patch.status,
    capabilityProfile: patch.capabilityProfile,
    capabilities: patch.capabilities,
  });
}

function findOutboundMessageId(
  store: StateStore,
  peerId: string,
  nonce: string,
): string | undefined {
  return store.findAgentMessage(peerId, "outbound", nonce)?.id;
}

function upsertOutboundConnectionEvent(
  store: StateStore,
  input: {
    contact: AgentContact;
    eventType: AgentConnectionEventType;
    eventStatus: AgentConnectionEventStatus;
    messageId?: string;
    txHash?: string;
    reason?: string;
    occurredAt: string;
    metadata?: Record<string, unknown>;
  },
): AgentConnectionEvent {
  return store.upsertAgentConnectionEvent({
    contactId: input.contact.contactId,
    identityWallet: input.contact.identityWallet,
    direction: "outbound",
    eventType: input.eventType,
    eventStatus: input.eventStatus,
    messageId: input.messageId,
    txHash: input.txHash,
    reason: input.reason,
    occurredAt: input.occurredAt,
    metadata: input.metadata,
  });
}

interface OutboundInlineCardAttachment {
  bundle: AgentCommSignedIdentityArtifactBundle;
  contactCardDigest: string;
  transportBindingDigest: string;
}

async function resolveOutboundInlineCardAttachment(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    senderPeerId?: string;
    attachInlineCard?: boolean;
  },
): Promise<OutboundInlineCardAttachment | undefined> {
  if (!options.attachInlineCard) {
    return undefined;
  }

  const senderPeerId = resolveSenderPeerId(deps.config, options.senderPeerId);
  const exported = await exportIdentityArtifactBundle(deps, {
    masterPassword: options.masterPassword,
    legacyPeerId: senderPeerId,
  });

  return {
    bundle: exported.bundle,
    contactCardDigest: exported.contactCardDigest,
    transportBindingDigest: exported.transportBindingDigest,
  };
}

function classifyIdentityArtifactFailure(reason: string): IdentityArtifactFailureCode {
  const normalized = reason.toLowerCase();
  if (normalized.includes("malformed transport binding")) {
    return "malformed_transport_binding";
  }
  if (normalized.includes("domain mismatch")) {
    return "domain_mismatch";
  }
  if (normalized.includes("expired artifact")) {
    return "expired_artifact";
  }
  if (normalized.includes("bad signature")) {
    return "bad_signature";
  }
  return "invalid_artifact";
}

function classifyIdentityArtifactFailures(reasons: string[]): IdentityArtifactFailureCode[] {
  const codes = reasons.map((reason) => classifyIdentityArtifactFailure(reason));
  return [...new Set(codes)];
}

function classifyRevocationArtifactFailure(reason: string): RevocationArtifactFailureCode {
  const normalized = reason.toLowerCase();
  if (normalized.includes("domain mismatch")) {
    return "domain_mismatch";
  }
  if (normalized.includes("bad signature")) {
    return "bad_signature";
  }
  return "invalid_artifact";
}

function classifyRevocationArtifactFailures(reasons: string[]): RevocationArtifactFailureCode[] {
  const codes = reasons.map((reason) => classifyRevocationArtifactFailure(reason));
  return [...new Set(codes)];
}

function normalizeArtifactDigest(value: string, label: string): `0x${string}` {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a bytes32 hex string`);
  }
  return normalized as `0x${string}`;
}

function buildInlineCardDigestMetadata(
  attachment: OutboundInlineCardAttachment | undefined,
): Record<string, unknown> {
  if (!attachment) {
    return {};
  }

  return {
    inlineCardContactCardDigest: attachment.contactCardDigest,
    inlineCardTransportBindingDigest: attachment.transportBindingDigest,
  };
}

function recordOutboundConnectionEvent(
  store: StateStore,
  input: {
    sent: SendCommCommandResult;
    contact: AgentContact;
    eventType: AgentConnectionEventType;
    eventStatus: AgentConnectionEventStatus;
    reason?: string;
    metadata?: Record<string, unknown>;
  },
): AgentConnectionEvent {
  return upsertOutboundConnectionEvent(store, {
    contact: input.contact,
    eventType: input.eventType,
    eventStatus: input.eventStatus,
    messageId: findOutboundMessageId(store, input.sent.peerId, input.sent.nonce),
    txHash: input.sent.txHash,
    reason: input.reason,
    occurredAt: input.sent.sentAt,
    metadata: input.metadata,
  });
}

function buildConnectionCommandResult(
  sent: SendCommCommandResult,
  contact: AgentContact,
  event: AgentConnectionEvent,
): SendCommConnectionCommandResult {
  return {
    ...sent,
    contactId: contact.contactId,
    contactStatus: contact.status,
    connectionEventId: event.id,
    connectionEventType: event.eventType,
    connectionEventStatus: event.eventStatus,
  };
}

function materializeImportedContact(
  store: StateStore,
  input: {
    contactCard: AgentCommSignedContactCardArtifact;
    contactCardDigest: string;
    transportBinding: AgentCommSignedTransportBindingArtifact;
    transportBindingDigest: string;
    source: string;
  },
): { contact: AgentContact; endpoint: AgentTransportEndpoint } {
  const existingContact =
    store.getAgentContactByIdentityWallet(input.contactCard.identityWallet) ??
    (normalizeOptionalText(input.contactCard.legacyPeerId)
      ? store.getAgentContactByLegacyPeerId(input.contactCard.legacyPeerId)
      : null);

  const contact = store.upsertAgentContact({
    contactId: existingContact?.contactId,
    identityWallet: input.contactCard.identityWallet,
    legacyPeerId: normalizeOptionalText(input.contactCard.legacyPeerId) ?? existingContact?.legacyPeerId,
    displayName: normalizeOptionalText(input.contactCard.displayName) ?? existingContact?.displayName,
    handle: normalizeOptionalText(input.contactCard.handle) ?? existingContact?.handle,
    status: existingContact?.status ?? "imported",
    supportedProtocols:
      normalizeOptionalStringList([
        ...(existingContact?.supportedProtocols ?? []),
        ...input.contactCard.protocols,
      ]) ?? [],
    capabilityProfile:
      existingContact?.capabilityProfile ??
      normalizeOptionalText(input.contactCard.defaults.capabilityProfile),
    capabilities:
      existingContact?.capabilities && existingContact.capabilities.length > 0
        ? existingContact.capabilities
        : normalizeOptionalStringList(input.contactCard.defaults.capabilities) ?? [],
    metadata: {
      ...(existingContact?.metadata ?? {}),
      contactCardDigest: input.contactCardDigest,
    },
  });

  const endpoint = store.upsertAgentTransportEndpoint({
    contactId: contact.contactId,
    identityWallet: contact.identityWallet,
    chainId: input.transportBinding.chainId,
    receiveAddress: input.transportBinding.receiveAddress,
    pubkey: input.transportBinding.pubkey,
    keyId: input.transportBinding.keyId,
    bindingDigest: input.transportBindingDigest,
    endpointStatus: "active",
    source: input.source,
  });

  return { contact, endpoint };
}

export function getCommIdentity(
  deps: AgentCommEntrypointDependencies,
  options: { masterPassword?: string; senderPeerId?: string } = {},
): AgentCommIdentity {
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const local = resolveLocalWallet(deps, masterPassword, options.senderPeerId);
  return local.identity;
}

export function initCommWallet(
  deps: AgentCommEntrypointDependencies,
  options: InitCommWalletOptions = {},
): InitCommWalletResult {
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const existingVaultItem = deps.store.getVaultItem(deps.config.commWalletAlias);
  const configuredProfiles = hasConfiguredLocalIdentityProfiles(deps.store);

  if (!existingVaultItem && !configuredProfiles) {
    const state = initializeDistinctLocalIdentityState(deps, {
      masterPassword,
      acwPrivateKey: options.privateKey,
    });
    const identity = toIdentity(deps.config, state, options.senderPeerId);
    return {
      ...identity,
      source: options.privateKey ? "restored" : "generated",
      replaced: false,
    };
  }

  if (existingVaultItem && !configuredProfiles) {
    const wallet = options.privateKey
      ? restoreShadowWallet(options.privateKey)
      : restoreShadowWallet(deps.vault.getSecret(deps.config.commWalletAlias, masterPassword));
    if (options.privateKey) {
      deps.vault.setSecret(deps.config.commWalletAlias, wallet.privateKey, masterPassword);
    }
    ensureLegacyDualUseLocalIdentityProfiles(deps, wallet);
    const state = resolveLocalIdentityState(deps, masterPassword);
    const identity = toIdentity(deps.config, state, options.senderPeerId);
    return {
      ...identity,
      source: options.privateKey ? "restored" : "generated",
      replaced: Boolean(options.privateKey),
    };
  }

  if (options.privateKey) {
    const current = resolveLocalIdentityState(deps, masterPassword);
    const restoredWallet = restoreShadowWallet(options.privateKey);

    if (current.acwProfile.mode === "temporary_dual_use") {
      deps.vault.setSecret(deps.config.commWalletAlias, restoredWallet.privateKey, masterPassword);
      ensureLegacyDualUseLocalIdentityProfiles(
        deps,
        restoredWallet,
        {
          activeBindingDigest: current.acwProfile.activeBindingDigest,
          transportKeyId: current.acwProfile.transportKeyId,
          metadata: current.acwProfile.metadata,
        },
      );
    } else {
      deps.vault.setSecret(deps.config.commWalletAlias, restoredWallet.privateKey, masterPassword);
      upsertConfiguredAcwProfile(deps, current, restoredWallet);
    }

    const state = resolveLocalIdentityState(deps, masterPassword);
    const identity = toIdentity(deps.config, state, options.senderPeerId);
    return {
      ...identity,
      source: "restored",
      replaced: true,
    };
  }

  const state = resolveLocalIdentityState(deps, masterPassword);
  const identity = toIdentity(deps.config, state, options.senderPeerId);
  return {
    ...identity,
    source: "generated",
    replaced: false,
    reusedExisting: true,
  };
}

export function initTemporaryDemoWallet(
  deps: AgentCommEntrypointDependencies,
  options: InitTemporaryDemoWalletOptions = {},
): InitTemporaryDemoWalletResult {
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const walletAlias =
    normalizeOptionalText(options.walletAlias) ?? defaultTemporaryDemoWalletAlias(deps.config);
  const wallet = options.privateKey
    ? restoreShadowWallet(options.privateKey)
    : generateShadowWallet();
  const replaced = deps.store.getVaultItem(walletAlias) !== null;

  deps.vault.setSecret(walletAlias, wallet.privateKey, masterPassword);
  deps.store.upsertAgentLocalIdentity({
    role: "temporary_demo",
    walletAlias,
    walletAddress: wallet.getAddress(),
    identityWallet: wallet.getAddress(),
    chainId: deps.config.commChainId,
    mode: "standard",
    metadata: {
      purpose: "temporary_demo",
    },
  });

  return {
    address: wallet.getAddress(),
    pubkey: wallet.getPublicKey(),
    chainId: deps.config.commChainId,
    walletAlias,
    defaultSenderPeerId: resolveSenderPeerId(deps.config, options.senderPeerId),
    identityWallet: wallet.getAddress(),
    transportAddress: wallet.getAddress(),
    localIdentityMode: "standard",
    supportedProtocols: getLocalSupportedProtocols(),
    source: options.privateKey ? "restored" : "generated",
    replaced,
    role: "temporary_demo",
  };
}

export function registerTrustedPeerEntry(
  deps: Pick<AgentCommEntrypointDependencies, "store">,
  options: RegisterTrustedPeerOptions,
): AgentPeer {
  const peer = registerPeer(deps.store, {
    peerId: options.peerId,
    walletAddress: options.walletAddress,
    pubkey: options.pubkey,
    name: options.name,
    status: "trusted",
    capabilities: options.capabilities ?? DEFAULT_TRUSTED_PEER_CAPABILITIES,
    metadata: options.metadata,
  });
  deps.store.backfillAgentContactFromLegacyPeer(peer.peerId);
  return peer;
}

export function listLocalIdentityProfiles(
  deps: AgentCommEntrypointDependencies,
  options: { masterPassword?: string } = {},
): AgentLocalIdentity[] {
  const existingProfiles = deps.store.listAgentLocalIdentities();
  if (existingProfiles.length > 0) {
    return existingProfiles;
  }

  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const local = resolveLocalIdentityState(deps, masterPassword);
  const temporaryDemo = deps.store.getAgentLocalIdentity("temporary_demo");
  return temporaryDemo
    ? [local.liwProfile, local.acwProfile, temporaryDemo]
    : [local.liwProfile, local.acwProfile];
}

export async function rotateCommWallet(
  deps: AgentCommEntrypointDependencies,
  options: RotateCommWalletOptions = {},
): Promise<RotateCommWalletResult> {
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const rotated = rotateLocalCommWallet(deps, {
    masterPassword,
    gracePeriodHours: options.gracePeriodHours,
    privateKey: options.privateKey,
    now: options.nowUnixSeconds !== undefined
      ? new Date(options.nowUnixSeconds * 1000)
      : undefined,
  });

  const exported = await exportIdentityArtifactBundle(deps, {
    masterPassword,
    displayName: options.displayName,
    handle: options.handle,
    capabilityProfile: options.capabilityProfile,
    capabilities: options.capabilities,
    expiresInDays: options.expiresInDays,
    keyId: options.keyId,
    legacyPeerId: options.legacyPeerId,
    nowUnixSeconds: options.nowUnixSeconds,
  });

  return {
    ...exported.identity,
    previousTransportAddress: rotated.previousTransportAddress,
    previousTransportKeyId: rotated.previousTransportKeyId,
    archivedWalletAlias: rotated.archivedWalletAlias,
    graceExpiresAt: rotated.graceExpiresAt,
    contactCardDigest: exported.contactCardDigest,
    contactCardFingerprint: exported.contactCardFingerprint,
    transportBindingDigest: exported.transportBindingDigest,
    transportBindingFingerprint: exported.transportBindingFingerprint,
    shareUrl: exported.shareUrl,
  };
}

export async function exportIdentityArtifactBundle(
  deps: AgentCommEntrypointDependencies,
  options: ExportIdentityArtifactBundleOptions = {},
): Promise<ExportIdentityArtifactBundleResult> {
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const local = resolveLocalWallet(deps, masterPassword);
  const nowUnixSeconds = options.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(nowUnixSeconds) || nowUnixSeconds < 0) {
    throw new Error("nowUnixSeconds must be a non-negative integer");
  }
  const expiresInDays = normalizeExpiresInDays(options.expiresInDays);
  const expiresAt = nowUnixSeconds + expiresInDays * 24 * 60 * 60;
  const keyId = normalizeOptionalText(options.keyId) ?? defaultKeyId(nowUnixSeconds);
  const displayName =
    normalizeOptionalText(options.displayName) ??
    defaultDisplayName(deps.config, local.identity.address);

  const capabilities = options.capabilities?.map((value) => value.trim()).filter(Boolean);
  const artifacts = buildLocalIdentityArtifacts({
    identityWallet: local.state.liwWallet.getAddress(),
    transportAddress: local.state.acwWallet.getAddress(),
    transportPubkey: local.state.acwWallet.getPublicKey(),
    chainId: deps.config.commChainId,
    displayName,
    handle: options.handle,
    keyId,
    capabilityProfile: options.capabilityProfile,
    capabilities: capabilities && capabilities.length > 0 ? capabilities : undefined,
    issuedAt: nowUnixSeconds,
    expiresAt,
    protocols: [...DEFAULT_CONTACT_CARD_PROTOCOLS],
    legacyPeerId: normalizeOptionalText(options.legacyPeerId) ?? "",
  });

  const bundle = await signIdentityArtifactBundle({
    ...artifacts,
    signerPrivateKey: local.state.liwWallet.privateKey,
    exportedAt: nowUnixSeconds,
  });

  const verification = await verifySignedIdentityArtifactBundle(bundle, {
    expectedChainId: deps.config.commChainId,
    nowUnixSeconds,
  });

  if (!verification.ok || !verification.contactCard || !verification.transportBinding) {
    throw new Error(
      `failed to self-verify exported identity artifacts: ${verification.errors.join("; ")}`,
    );
  }

  persistSignedContactCardArtifact(deps.store, verification.contactCard.artifact, {
    digest: verification.contactCard.digest,
    source: "local_export",
    verificationStatus: "verified",
  });
  persistSignedTransportBindingArtifact(deps.store, verification.transportBinding.artifact, {
    digest: verification.transportBinding.digest,
    source: "local_export",
    verificationStatus: "verified",
  });
  deps.store.upsertAgentLocalIdentity({
    role: "acw",
    walletAlias: local.state.acwProfile.walletAlias,
    walletAddress: local.state.acwWallet.getAddress(),
    identityWallet: local.state.liwProfile.identityWallet,
    chainId: deps.config.commChainId,
    mode: local.state.acwProfile.mode,
    activeBindingDigest: verification.transportBinding.digest,
    transportKeyId: keyId,
    metadata: local.state.acwProfile.metadata,
  });

  const profiles = listLocalIdentityProfiles(deps, {
    masterPassword,
  });

  return {
    identity: local.identity,
    profiles,
    bundle,
    contactCardDigest: verification.contactCard.digest,
    contactCardFingerprint: verification.contactCard.fingerprint,
    transportBindingDigest: verification.transportBinding.digest,
    transportBindingFingerprint: verification.transportBinding.fingerprint,
    shareUrl: buildIdentityArtifactBundleShareUrl(bundle),
  };
}

export async function importIdentityArtifactBundle(
  deps: Pick<AgentCommEntrypointDependencies, "config" | "store">,
  input: {
    bundle: unknown;
    source?: string;
    expectedChainId?: number;
    nowUnixSeconds?: number;
  },
): Promise<ImportIdentityArtifactBundleResult> {
  const verification = await verifySignedIdentityArtifactBundle(input.bundle, {
    expectedChainId: input.expectedChainId ?? deps.config.commChainId,
    nowUnixSeconds: input.nowUnixSeconds,
  });
  const source = input.source ?? "local_import";
  const reasons = verification.errors;
  let importedContact: { contact: AgentContact; endpoint: AgentTransportEndpoint } | null = null;

  if (verification.contactCard) {
    persistSignedContactCardArtifact(deps.store, verification.contactCard.artifact, {
      digest: verification.contactCard.digest,
      source,
      verificationStatus: verification.contactCard.ok ? "verified" : "invalid",
      verificationError: verification.contactCard.ok ? undefined : reasons.join("; "),
    });
  }

  if (verification.transportBinding) {
    persistSignedTransportBindingArtifact(deps.store, verification.transportBinding.artifact, {
      digest: verification.transportBinding.digest,
      source,
      verificationStatus: verification.transportBinding.ok ? "verified" : "invalid",
      verificationError: verification.transportBinding.ok ? undefined : reasons.join("; "),
    });
  }

  if (verification.ok && verification.contactCard && verification.transportBinding) {
    importedContact = materializeImportedContact(deps.store, {
      contactCard: verification.contactCard.artifact,
      contactCardDigest: verification.contactCard.digest,
      transportBinding: verification.transportBinding.artifact,
      transportBindingDigest: verification.transportBinding.digest,
      source,
    });
  }

  return {
    ok: verification.ok,
    reasons,
    failureCodes: classifyIdentityArtifactFailures(reasons),
    contactId: importedContact?.contact.contactId,
    identityWallet: importedContact?.contact.identityWallet,
    status: importedContact?.contact.status,
    supportedProtocols: importedContact?.contact.supportedProtocols,
    activeTransportAddress: importedContact?.endpoint.receiveAddress,
    contactCardDigest: verification.contactCard?.digest,
    contactCardFingerprint: verification.contactCard?.fingerprint,
    transportBindingDigest: verification.transportBinding?.digest,
    transportBindingFingerprint: verification.transportBinding?.fingerprint,
  };
}

export async function importIdentityArtifactBundleFromJson(
  deps: Pick<AgentCommEntrypointDependencies, "config" | "store">,
  rawJson: string,
  options: {
    source?: string;
    expectedChainId?: number;
    nowUnixSeconds?: number;
  } = {},
): Promise<ImportIdentityArtifactBundleResult> {
  let bundle: AgentCommSignedIdentityArtifactBundle;
  try {
    bundle = parseSignedIdentityArtifactBundle(rawJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reasons: [reason],
      failureCodes: ["invalid_artifact"],
    };
  }
  return importIdentityArtifactBundle(deps, {
    bundle,
    source: options.source,
    expectedChainId: options.expectedChainId,
    nowUnixSeconds: options.nowUnixSeconds,
  });
}

function toRevocationMetadata(input: {
  noticeDigest: string;
  artifactType: RevocableAgentCommArtifactType;
  artifactDigest: string;
  revokedAt: number;
  reason?: string;
  replacementDigest?: string;
}): Record<string, unknown> {
  return {
    noticeDigest: input.noticeDigest,
    artifactType: input.artifactType,
    artifactDigest: input.artifactDigest,
    revokedAt: input.revokedAt,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.replacementDigest ? { replacementDigest: input.replacementDigest } : {}),
  };
}

function applyRevocationNoticeState(
  store: StateStore,
  notice: AgentCommSignedRevocationNoticeArtifact,
  noticeDigest: string,
): {
  artifactStatus: AgentArtifactRevocationStatus;
  affectedEndpointIds: string[];
  affectedContactIds: string[];
} {
  const replacementDigest =
    notice.replacementDigest !== AGENT_COMM_EMPTY_ARTIFACT_DIGEST
      ? notice.replacementDigest
      : undefined;
  store.upsertAgentArtifactStatus({
    artifactDigest: notice.artifactDigest,
    artifactType: notice.artifactType,
    identityWallet: notice.identityWallet,
    status: "revoked",
    revokedByDigest: noticeDigest,
    revokedAt: notice.revokedAt,
    reason: normalizeOptionalText(notice.reason),
    metadata: toRevocationMetadata({
      noticeDigest,
      artifactType: notice.artifactType,
      artifactDigest: notice.artifactDigest,
      revokedAt: notice.revokedAt,
      reason: normalizeOptionalText(notice.reason),
      replacementDigest,
    }),
  });

  if (notice.artifactType === "TransportBinding") {
    const candidateEndpoints = store.listAgentTransportEndpointsByBindingDigest(
      notice.artifactDigest,
    );
    const affectedEndpointIds: string[] = [];
    const candidateContactIds = new Set<string>();

    for (const endpoint of candidateEndpoints) {
      const updated = store.upsertAgentTransportEndpoint({
        id: endpoint.id,
        contactId: endpoint.contactId,
        identityWallet: endpoint.identityWallet,
        chainId: endpoint.chainId,
        receiveAddress: endpoint.receiveAddress,
        pubkey: endpoint.pubkey,
        keyId: endpoint.keyId,
        bindingDigest: endpoint.bindingDigest ?? undefined,
        endpointStatus: "revoked",
        source: "revocation_notice",
        metadata: {
          ...(endpoint.metadata ?? {}),
          revocation: toRevocationMetadata({
            noticeDigest,
            artifactType: notice.artifactType,
            artifactDigest: notice.artifactDigest,
            revokedAt: notice.revokedAt,
            reason: normalizeOptionalText(notice.reason),
            replacementDigest,
          }),
        },
      });
      affectedEndpointIds.push(updated.id);
      candidateContactIds.add(updated.contactId);
    }

    const affectedContactIds: string[] = [];
    for (const contactId of candidateContactIds) {
      const activeEndpointCount = store.listAgentTransportEndpoints(1, {
        contactId,
        endpointStatus: "active",
      }).length;
      if (activeEndpointCount > 0) {
        continue;
      }
      const contact = store.getAgentContact(contactId);
      if (!contact) {
        continue;
      }
      const updated = store.upsertAgentContact({
        contactId: contact.contactId,
        identityWallet: contact.identityWallet,
        legacyPeerId: contact.legacyPeerId,
        status: "revoked",
        metadata: {
          ...(contact.metadata ?? {}),
          revocation: toRevocationMetadata({
            noticeDigest,
            artifactType: notice.artifactType,
            artifactDigest: notice.artifactDigest,
            revokedAt: notice.revokedAt,
            reason: normalizeOptionalText(notice.reason),
            replacementDigest,
          }),
        },
      });
      affectedContactIds.push(updated.contactId);
    }

    return {
      artifactStatus: "revoked",
      affectedEndpointIds,
      affectedContactIds,
    };
  }

  const contact = store.getAgentContactByIdentityWallet(notice.identityWallet);
  const affectedContactIds = contact ? [contact.contactId] : [];
  for (const contactId of affectedContactIds) {
    const contact = store.getAgentContact(contactId);
    if (!contact) {
      continue;
    }
    store.upsertAgentContact({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      legacyPeerId: contact.legacyPeerId,
      status: "revoked",
      metadata: {
        ...(contact.metadata ?? {}),
        revocation: toRevocationMetadata({
          noticeDigest,
          artifactType: notice.artifactType,
          artifactDigest: notice.artifactDigest,
          revokedAt: notice.revokedAt,
          reason: normalizeOptionalText(notice.reason),
          replacementDigest,
        }),
      },
    });
  }

  return {
    artifactStatus: "revoked",
    affectedEndpointIds: [],
    affectedContactIds,
  };
}

export async function importRevocationNotice(
  deps: Pick<AgentCommEntrypointDependencies, "config" | "store">,
  input: ImportRevocationNoticeInput,
): Promise<ImportRevocationNoticeResult> {
  let verification: Awaited<ReturnType<typeof verifyRevocationNoticeArtifact>>;
  try {
    verification = await verifyRevocationNoticeArtifact(input.notice, {
      expectedChainId: input.expectedChainId ?? deps.config.commChainId,
      nowUnixSeconds: input.nowUnixSeconds,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reasons: [reason],
      failureCodes: ["invalid_artifact"],
      affectedEndpointIds: [],
      affectedContactIds: [],
    };
  }

  const source = input.source ?? "local_import";
  persistSignedRevocationNoticeArtifact(deps.store, verification.artifact, {
    digest: verification.digest,
    source,
    verificationStatus: verification.ok ? "verified" : "invalid",
    verificationError: verification.ok ? undefined : verification.errors.join("; "),
  });

  if (!verification.ok) {
    return {
      ok: false,
      reasons: verification.errors,
      failureCodes: classifyRevocationArtifactFailures(verification.errors),
      noticeDigest: verification.digest,
      noticeFingerprint: verification.fingerprint,
      artifactDigest: verification.artifact.artifactDigest,
      artifactType: verification.artifact.artifactType,
      affectedEndpointIds: [],
      affectedContactIds: [],
    };
  }

  const applied = applyRevocationNoticeState(
    deps.store,
    verification.artifact,
    verification.digest,
  );

  return {
    ok: true,
    reasons: [],
    failureCodes: [],
    noticeDigest: verification.digest,
    noticeFingerprint: verification.fingerprint,
    artifactDigest: verification.artifact.artifactDigest,
    artifactType: verification.artifact.artifactType,
    artifactStatus: applied.artifactStatus,
    affectedEndpointIds: applied.affectedEndpointIds,
    affectedContactIds: applied.affectedContactIds,
  };
}

export async function revokeIdentityArtifact(
  deps: AgentCommEntrypointDependencies,
  options: RevokeIdentityArtifactOptions,
): Promise<RevokeIdentityArtifactResult> {
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const local = resolveLocalWallet(deps, masterPassword);
  const revokedAt = options.revokedAt ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(revokedAt) || revokedAt < 0) {
    throw new Error("revokedAt must be a non-negative integer");
  }

  const signedNotice = await signRevocationNoticeArtifact({
    notice: {
      noticeVersion: AGENT_COMM_REVOCATION_NOTICE_VERSION,
      identityWallet: local.state.liwWallet.getAddress(),
      chainId: deps.config.commChainId,
      artifactType: options.artifactType,
      artifactDigest: normalizeArtifactDigest(options.artifactDigest, "artifactDigest"),
      replacementDigest: options.replacementDigest
        ? normalizeArtifactDigest(options.replacementDigest, "replacementDigest")
        : AGENT_COMM_EMPTY_ARTIFACT_DIGEST,
      reason: normalizeOptionalText(options.reason) ?? "",
      revokedAt,
    },
    signerPrivateKey: local.state.liwWallet.privateKey,
  });

  const imported = await importRevocationNotice(
    {
      config: deps.config,
      store: deps.store,
    },
    {
      notice: signedNotice,
      source: options.source ?? "local_revoke",
      expectedChainId: deps.config.commChainId,
      nowUnixSeconds: revokedAt,
    },
  );

  if (!imported.ok) {
    throw new Error(`failed to import locally-signed revocation notice: ${imported.reasons.join("; ")}`);
  }

  return {
    ...imported,
    notice: signedNotice,
    identityWallet: local.state.liwWallet.getAddress(),
  };
}

export async function importRevocationNoticeFromJson(
  deps: Pick<AgentCommEntrypointDependencies, "config" | "store">,
  rawJson: string,
  options: {
    source?: string;
    expectedChainId?: number;
    nowUnixSeconds?: number;
  } = {},
): Promise<ImportRevocationNoticeResult> {
  let notice: AgentCommSignedRevocationNoticeArtifact;
  try {
    notice = parseSignedRevocationNoticeArtifact(rawJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reasons: [reason],
      failureCodes: ["invalid_artifact"],
      affectedEndpointIds: [],
      affectedContactIds: [],
    };
  }

  return importRevocationNotice(deps, {
    notice,
    source: options.source,
    expectedChainId: options.expectedChainId,
    nowUnixSeconds: options.nowUnixSeconds,
  });
}

export type IdentityArtifactFailureCode = (typeof identityArtifactFailureCodes)[number];
export type RevocationArtifactFailureCode = (typeof revocationArtifactFailureCodes)[number];

function findLocalContactCardDigest(
  store: StateStore,
  input: {
    identityWallet: string;
    transportAddress: string;
    transportKeyId?: string;
  },
): string | undefined {
  const artifacts = store.listAgentSignedArtifacts(100, {
    identityWallet: input.identityWallet,
    artifactType: "ContactCard",
  });
  for (const artifact of artifacts) {
    if (artifact.verificationStatus !== "verified") {
      continue;
    }
    const payload = artifact.payload as Record<string, unknown>;
    const transport = payload.transport;
    if (!transport || typeof transport !== "object") {
      continue;
    }
    const receiveAddress =
      typeof (transport as Record<string, unknown>).receiveAddress === "string"
        ? ((transport as Record<string, unknown>).receiveAddress as string)
        : undefined;
    const keyId =
      typeof (transport as Record<string, unknown>).keyId === "string"
        ? ((transport as Record<string, unknown>).keyId as string)
        : undefined;
    if (
      receiveAddress?.toLowerCase() === input.transportAddress.toLowerCase()
      && (!input.transportKeyId || keyId === input.transportKeyId)
    ) {
      return artifact.digest;
    }
  }
  return undefined;
}

async function ensureLocalOutboundArtifacts(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    senderPeerId?: string;
  },
): Promise<{
  local: ResolvedLocalWallet;
  contactCardDigest: string;
  transportBindingDigest: string;
}> {
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const local = resolveLocalWallet(deps, masterPassword, options.senderPeerId);
  const existingBindingDigest = local.state.acwProfile.activeBindingDigest;
  const existingCardDigest = findLocalContactCardDigest(deps.store, {
    identityWallet: local.state.liwProfile.identityWallet,
    transportAddress: local.state.acwWallet.getAddress(),
    transportKeyId: local.state.acwProfile.transportKeyId,
  });

  if (existingBindingDigest && existingCardDigest) {
    return {
      local,
      contactCardDigest: existingCardDigest,
      transportBindingDigest: existingBindingDigest,
    };
  }

  const exported = await exportIdentityArtifactBundle(deps, {
    masterPassword,
    keyId: local.state.acwProfile.transportKeyId,
    legacyPeerId: resolveSenderPeerId(deps.config, options.senderPeerId),
  });

  return {
    local: resolveLocalWallet(deps, masterPassword, options.senderPeerId),
    contactCardDigest: exported.contactCardDigest,
    transportBindingDigest: exported.transportBindingDigest,
  };
}

function resolveContactTargetForTrustedPeer(
  store: StateStore,
  peer: AgentPeer,
): ResolvedOutboundContactTarget | null {
  const contact =
    store.getAgentContactByLegacyPeerId(peer.peerId)
    ?? store.getAgentContactByIdentityWallet(peer.walletAddress);
  if (!contact) {
    return null;
  }
  const endpoint = resolveActiveContactEndpoint(store, contact.contactId);
  return {
    contact,
    endpoint,
    peerId: peer.peerId,
  };
}

function buildTxSenderOptions(
  deps: AgentCommEntrypointDependencies,
  local: ResolvedLocalWallet,
  outboundMessage: OutboundMessageContext,
): TxSenderOptions {
  return {
    rpcUrl: getRequiredCommRpcUrl(deps.config),
    chainId: deps.config.commChainId,
    walletAlias: local.state.acwProfile.walletAlias,
    relayUrl: deps.config.commRelayUrl,
    relayTimeoutMs: deps.config.commRelayTimeoutMs,
    submitMode: deps.config.commSubmitMode,
    store: deps.store,
    outboundMessage,
  };
}

async function sendCommCommandV1ToRecipient(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    senderPeerId?: string;
    recipient: ResolvedCommRecipient;
    command: AgentCommand;
    contact?: AgentContact;
    legacyFallbackUsed?: boolean;
  },
): Promise<SendCommCommandResult> {
  const command = agentCommandSchema.parse(options.command);
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const local = resolveLocalWallet(deps, masterPassword, options.senderPeerId);
  const senderPeerId = resolveSenderPeerId(deps.config, options.senderPeerId);
  const nonce = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sharedKey = deriveSharedKey(local.state.acwWallet.privateKey, options.recipient.pubkey);
  const ciphertext = encrypt(JSON.stringify(command), sharedKey);
  const calldata = encodeEnvelope({
    version: AGENT_COMM_LEGACY_ENVELOPE_VERSION,
    senderPeerId,
    senderPubkey: local.identity.pubkey,
    recipient: options.recipient.walletAddress,
    nonce,
    timestamp,
    command: {
      type: command.type,
      schemaVersion: 1,
    },
    ciphertext,
    signature: local.identity.pubkey,
  });
  const outboundMessage: OutboundMessageContext = {
    peerId: options.recipient.peerId,
    nonce,
    commandType: command.type,
    envelopeVersion: AGENT_COMM_LEGACY_ENVELOPE_VERSION,
    contactId: options.contact?.contactId,
    identityWallet: options.contact?.identityWallet,
    transportAddress: options.recipient.walletAddress,
    trustOutcome: options.legacyFallbackUsed ? "legacy_fallback_v1" : undefined,
    decryptedCommandType: command.type,
  };
  const result = await sendCalldata(
    buildTxSenderOptions(deps, local, outboundMessage),
    local.state.acwWallet,
    options.recipient.walletAddress,
    calldata,
  );

  return {
    ...local.identity,
    ...result,
    peerId: options.recipient.peerId,
    recipient: options.recipient.walletAddress,
    senderPeerId,
    commandType: command.type,
    envelopeVersion: AGENT_COMM_LEGACY_ENVELOPE_VERSION,
    contactId: options.contact?.contactId,
    legacyFallbackUsed: Boolean(options.legacyFallbackUsed),
  };
}

async function sendCommCommandV2ToContact(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    senderPeerId?: string;
    target: ResolvedOutboundContactTarget;
    command: AgentCommand;
    inlineCard?: AgentCommSignedIdentityArtifactBundle;
  },
): Promise<SendCommCommandResult> {
  const command = agentCommandSchema.parse(options.command);
  const masterPassword = getRequiredMasterPassword(options.masterPassword);
  const outboundArtifacts = await ensureLocalOutboundArtifacts(deps, {
    masterPassword,
    senderPeerId: options.senderPeerId,
  });
  const local = outboundArtifacts.local;
  const senderPeerId = resolveSenderPeerId(deps.config, options.senderPeerId);
  const msgId = crypto.randomUUID();
  const sentAt = new Date().toISOString();
  const ephemeralWallet = generateShadowWallet();
  const sharedKey = deriveSharedKey(ephemeralWallet.privateKey, options.target.endpoint.pubkey);
  const body = encryptedEnvelopeV2BodySchema.parse({
    msgId,
    sentAt,
    sender: {
      identityWallet: local.identity.identityWallet,
      transportAddress: local.identity.transportAddress,
      cardDigest: outboundArtifacts.contactCardDigest,
    },
    command: {
      type: command.type,
      schemaVersion: 2,
      payload: command.payload,
    },
    ...(options.inlineCard
      ? {
          attachments: {
            inlineCard: options.inlineCard,
          },
        }
      : {}),
  });
  const ciphertext = encrypt(JSON.stringify(body), sharedKey);
  const calldata = encodeEnvelope({
    version: AGENT_COMM_ENVELOPE_VERSION,
    kex: {
      suite: AGENT_COMM_KEX_SUITE_V2,
      recipientKeyId: options.target.endpoint.keyId,
      ephemeralPubkey: ephemeralWallet.getPublicKey(),
    },
    ciphertext,
  });
  const outboundMessage: OutboundMessageContext = {
    messageId: msgId,
    peerId: options.target.peerId,
    nonce: msgId,
    commandType: command.type,
    envelopeVersion: AGENT_COMM_ENVELOPE_VERSION,
    msgId,
    contactId: options.target.contact.contactId,
    identityWallet: options.target.contact.identityWallet,
    transportAddress: options.target.endpoint.receiveAddress,
    decryptedCommandType: command.type,
  };
  const result = await sendCalldata(
    buildTxSenderOptions(deps, local, outboundMessage),
    local.state.acwWallet,
    options.target.endpoint.receiveAddress,
    calldata,
  );

  return {
    ...local.identity,
    ...result,
    peerId: options.target.peerId,
    recipient: options.target.endpoint.receiveAddress,
    senderPeerId,
    commandType: command.type,
    envelopeVersion: AGENT_COMM_ENVELOPE_VERSION,
    msgId,
    contactId: options.target.contact.contactId,
    legacyFallbackUsed: false,
  };
}

export async function sendCommCommand(
  deps: AgentCommEntrypointDependencies,
  options: SendCommCommandOptions,
): Promise<SendCommCommandResult> {
  const target = resolveTrustedSendTarget(deps.store, options.peerId);
  const peer = target.peer;
  const contactTarget = target.contactTarget;

  if (!contactTarget) {
    if (!peer) {
      throw new Error(`Trusted contact has no active transport route: ${options.peerId}`);
    }

    return sendCommCommandV1ToRecipient(deps, {
      masterPassword: options.masterPassword,
      senderPeerId: options.senderPeerId,
      recipient: {
        peerId: peer.peerId,
        walletAddress: peer.walletAddress,
        pubkey: peer.pubkey,
      },
      command: options.command,
      legacyFallbackUsed: true,
    });
  }

  const selection = negotiateProtocolVersion(contactTarget.contact.supportedProtocols);
  if (selection.envelopeVersion === AGENT_COMM_ENVELOPE_VERSION) {
    return sendCommCommandV2ToContact(deps, {
      masterPassword: options.masterPassword,
      senderPeerId: options.senderPeerId,
      target: contactTarget,
      command: options.command,
    });
  }

  return sendCommCommandV1ToRecipient(deps, {
    masterPassword: options.masterPassword,
    senderPeerId: options.senderPeerId,
    recipient: {
      peerId: contactTarget.peerId,
      walletAddress: contactTarget.endpoint.receiveAddress,
      pubkey: contactTarget.endpoint.pubkey,
    },
    contact: contactTarget.contact,
    command: options.command,
    legacyFallbackUsed: selection.legacyFallback,
  });
}

export async function sendCommPing(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    peerId: string;
    senderPeerId?: string;
    echo?: PingCommandPayload["echo"];
    note?: PingCommandPayload["note"];
  },
): Promise<SendCommCommandResult> {
  return sendCommCommand(deps, {
    masterPassword: options.masterPassword,
    peerId: options.peerId,
    senderPeerId: options.senderPeerId,
    command: {
      type: "ping",
      payload: {
        ...(options.echo ? { echo: options.echo } : {}),
        ...(options.note ? { note: options.note } : {}),
      },
    },
  });
}

export async function sendCommStartDiscovery(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    peerId: string;
    senderPeerId?: string;
    strategyId: string;
    pairs?: StartDiscoveryCommandPayload["pairs"];
    durationMinutes?: StartDiscoveryCommandPayload["durationMinutes"];
    sampleIntervalSec?: StartDiscoveryCommandPayload["sampleIntervalSec"];
    topN?: StartDiscoveryCommandPayload["topN"];
  },
): Promise<SendCommCommandResult> {
  return sendCommCommand(deps, {
    masterPassword: options.masterPassword,
    peerId: options.peerId,
    senderPeerId: options.senderPeerId,
    command: {
      type: "start_discovery",
      payload: {
        strategyId: options.strategyId as StartDiscoveryCommandPayload["strategyId"],
        ...(options.pairs ? { pairs: options.pairs } : {}),
        ...(options.durationMinutes ? { durationMinutes: options.durationMinutes } : {}),
        ...(options.sampleIntervalSec ? { sampleIntervalSec: options.sampleIntervalSec } : {}),
        ...(options.topN ? { topN: options.topN } : {}),
      },
    },
  });
}

function buildProbeExecutionPayload(options: {
  pair?: ProbeOnchainOsCommandPayload["pair"];
  chainIndex?: ProbeOnchainOsCommandPayload["chainIndex"];
  notionalUsd?: ProbeOnchainOsCommandPayload["notionalUsd"];
}) {
  return {
    ...(options.pair ? { pair: options.pair } : {}),
    ...(options.chainIndex ? { chainIndex: options.chainIndex } : {}),
    ...(options.notionalUsd !== undefined ? { notionalUsd: options.notionalUsd } : {}),
  };
}

export async function sendCommProbeExecution(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    peerId: string;
    senderPeerId?: string;
    pair?: ProbeOnchainOsCommandPayload["pair"];
    chainIndex?: ProbeOnchainOsCommandPayload["chainIndex"];
    notionalUsd?: ProbeOnchainOsCommandPayload["notionalUsd"];
  },
): Promise<SendCommCommandResult> {
  return sendCommCommand(deps, {
    masterPassword: options.masterPassword,
    peerId: options.peerId,
    senderPeerId: options.senderPeerId,
    command: {
      type: "probe_execution",
      payload: buildProbeExecutionPayload(options),
    },
  });
}

export async function sendCommProbeOnchainOs(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    peerId: string;
    senderPeerId?: string;
    pair?: ProbeOnchainOsCommandPayload["pair"];
    chainIndex?: ProbeOnchainOsCommandPayload["chainIndex"];
    notionalUsd?: ProbeOnchainOsCommandPayload["notionalUsd"];
  },
): Promise<SendCommCommandResult> {
  return sendCommCommand(deps, {
    masterPassword: options.masterPassword,
    peerId: options.peerId,
    senderPeerId: options.senderPeerId,
    command: {
      type: "probe_onchainos",
      payload: buildProbeExecutionPayload(options),
    },
  });
}

export async function sendCommRequestModeChange(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    peerId: string;
    senderPeerId?: string;
    requestedMode: RequestModeChangeCommandPayload["requestedMode"];
    reason?: RequestModeChangeCommandPayload["reason"];
  },
): Promise<SendCommCommandResult> {
  return sendCommCommand(deps, {
    masterPassword: options.masterPassword,
    peerId: options.peerId,
    senderPeerId: options.senderPeerId,
    command: {
      type: "request_mode_change",
      payload: {
        requestedMode: options.requestedMode,
        ...(options.reason ? { reason: options.reason } : {}),
      },
    },
  });
}

async function sendNegotiatedContactCommand(
  deps: AgentCommEntrypointDependencies,
  options: {
    masterPassword?: string;
    senderPeerId?: string;
    target: ResolvedOutboundContactTarget;
    command: AgentCommand;
    inlineCard?: AgentCommSignedIdentityArtifactBundle;
  },
): Promise<SendCommCommandResult> {
  const selection = negotiateProtocolVersion(options.target.contact.supportedProtocols);
  if (selection.envelopeVersion === AGENT_COMM_ENVELOPE_VERSION) {
    return sendCommCommandV2ToContact(deps, {
      masterPassword: options.masterPassword,
      senderPeerId: options.senderPeerId,
      target: options.target,
      command: options.command,
      inlineCard: options.inlineCard,
    });
  }

  return sendCommCommandV1ToRecipient(deps, {
    masterPassword: options.masterPassword,
    senderPeerId: options.senderPeerId,
    recipient: {
      peerId: options.target.peerId,
      walletAddress: options.target.endpoint.receiveAddress,
      pubkey: options.target.endpoint.pubkey,
    },
    contact: options.target.contact,
    command: options.command,
    legacyFallbackUsed: selection.legacyFallback,
  });
}

export async function sendCommConnectionInvite(
  deps: AgentCommEntrypointDependencies,
  options: SendCommConnectionInviteOptions,
): Promise<SendCommConnectionCommandResult> {
  const target = resolveOutboundContactTarget(deps.store, options.contactId);
  if (target.contact.status === "blocked" || target.contact.status === "revoked") {
    throw new Error(
      `cannot send connection_invite to ${target.contact.status} contact: ${target.contact.contactId}`,
    );
  }

  const requestedProfile = normalizeOptionalText(options.requestedProfile);
  const requestedCapabilities = normalizeOptionalStringList(options.requestedCapabilities);
  const note = normalizeOptionalText(options.note);
  const inlineCardAttachment = await resolveOutboundInlineCardAttachment(deps, {
    masterPassword: options.masterPassword,
    senderPeerId: options.senderPeerId,
    attachInlineCard: options.attachInlineCard,
  });

  const sent = await sendNegotiatedContactCommand(deps, {
    masterPassword: options.masterPassword,
    senderPeerId: options.senderPeerId,
    target,
    inlineCard: inlineCardAttachment?.bundle,
    command: {
      type: "connection_invite",
      payload: {
        ...(requestedProfile ? { requestedProfile } : {}),
        ...(requestedCapabilities ? { requestedCapabilities } : {}),
        ...(note ? { note } : {}),
        ...(inlineCardAttachment ? { inlineCard: inlineCardAttachment.bundle } : {}),
      },
    },
  });

  const updatedContact = updateContactStatus(deps.store, target.contact, {
    status: "pending_outbound",
  });
  const event = recordOutboundConnectionEvent(deps.store, {
    sent,
    contact: updatedContact,
    eventType: "connection_invite",
    eventStatus: "pending",
    reason: note,
    metadata: {
      requestedProfile,
      requestedCapabilities,
      senderPeerId: sent.senderPeerId,
      ...buildInlineCardDigestMetadata(inlineCardAttachment),
    },
  });

  return buildConnectionCommandResult(sent, updatedContact, event);
}

export async function sendCommConnectionAccept(
  deps: AgentCommEntrypointDependencies,
  options: SendCommConnectionAcceptOptions,
): Promise<SendCommConnectionCommandResult> {
  const target = resolveOutboundContactTarget(deps.store, options.contactId);
  assertContactStatus(target.contact, ["pending_inbound"], "send connection_accept");

  const pendingInvite = getPendingInviteEvent(deps.store, target.contact.contactId, "inbound");
  const capabilityProfile =
    normalizeOptionalText(options.capabilityProfile) ??
    readConnectionEventMetadataString(pendingInvite?.metadata, "requestedProfile") ??
    target.contact.capabilityProfile;
  const capabilities =
    normalizeOptionalStringList(options.capabilities) ??
    readConnectionEventMetadataStringArray(pendingInvite?.metadata, "requestedCapabilities") ??
    target.contact.capabilities;
  const note = normalizeOptionalText(options.note);
  const inlineCardAttachment = await resolveOutboundInlineCardAttachment(deps, {
    masterPassword: options.masterPassword,
    senderPeerId: options.senderPeerId,
    attachInlineCard: options.attachInlineCard,
  });

  const sent = await sendNegotiatedContactCommand(deps, {
    masterPassword: options.masterPassword,
    senderPeerId: options.senderPeerId,
    target,
    inlineCard: inlineCardAttachment?.bundle,
    command: {
      type: "connection_accept",
      payload: {
        ...(capabilityProfile ? { capabilityProfile } : {}),
        ...(capabilities ? { capabilities } : {}),
        ...(note ? { note } : {}),
        ...(inlineCardAttachment ? { inlineCard: inlineCardAttachment.bundle } : {}),
      },
    },
  });

  const updatedContact = updateContactStatus(deps.store, target.contact, {
    status: "trusted",
    capabilityProfile,
    capabilities,
  });
  const event = recordOutboundConnectionEvent(deps.store, {
    sent,
    contact: updatedContact,
    eventType: "connection_accept",
    eventStatus: "applied",
    reason: note,
    metadata: {
      capabilityProfile,
      capabilities,
      senderPeerId: sent.senderPeerId,
      ...buildInlineCardDigestMetadata(inlineCardAttachment),
    },
  });

  return buildConnectionCommandResult(sent, updatedContact, event);
}

export async function sendCommConnectionReject(
  deps: AgentCommEntrypointDependencies,
  options: SendCommConnectionRejectOptions,
): Promise<SendCommConnectionCommandResult> {
  const target = resolveOutboundContactTarget(deps.store, options.contactId);
  assertContactStatus(target.contact, ["pending_inbound"], "send connection_reject");

  const reason = normalizeOptionalText(options.reason);
  const note = normalizeOptionalText(options.note);

  const sent = await sendNegotiatedContactCommand(deps, {
    masterPassword: options.masterPassword,
    senderPeerId: options.senderPeerId,
    target,
    command: {
      type: "connection_reject",
      payload: {
        ...(reason ? { reason } : {}),
        ...(note ? { note } : {}),
      },
    },
  });

  const updatedContact = updateContactStatus(deps.store, target.contact, {
    status: "imported",
  });
  const event = recordOutboundConnectionEvent(deps.store, {
    sent,
    contact: updatedContact,
    eventType: "connection_reject",
    eventStatus: "applied",
    reason: reason ?? note,
    metadata: {
      reason,
      note,
      senderPeerId: sent.senderPeerId,
    },
  });

  return buildConnectionCommandResult(sent, updatedContact, event);
}

export async function sendCommConnectionConfirm(
  deps: AgentCommEntrypointDependencies,
  options: SendCommConnectionConfirmOptions,
): Promise<SendCommConnectionCommandResult> {
  const target = resolveOutboundContactTarget(deps.store, options.contactId);
  assertContactStatus(target.contact, ["trusted", "pending_outbound"], "send connection_confirm");

  const note = normalizeOptionalText(options.note);
  const inlineCardAttachment = await resolveOutboundInlineCardAttachment(deps, {
    masterPassword: options.masterPassword,
    senderPeerId: options.senderPeerId,
    attachInlineCard: options.attachInlineCard,
  });

  const sent = await sendNegotiatedContactCommand(deps, {
    masterPassword: options.masterPassword,
    senderPeerId: options.senderPeerId,
    target,
    inlineCard: inlineCardAttachment?.bundle,
    command: {
      type: "connection_confirm",
      payload: {
        ...(note ? { note } : {}),
        ...(inlineCardAttachment ? { inlineCard: inlineCardAttachment.bundle } : {}),
      },
    },
  });

  const updatedContact = updateContactStatus(deps.store, target.contact, {
    status: "trusted",
  });
  const event = recordOutboundConnectionEvent(deps.store, {
    sent,
    contact: updatedContact,
    eventType: "connection_confirm",
    eventStatus: "applied",
    reason: note,
    metadata: {
      senderPeerId: sent.senderPeerId,
      ...buildInlineCardDigestMetadata(inlineCardAttachment),
    },
  });

  return buildConnectionCommandResult(sent, updatedContact, event);
}
