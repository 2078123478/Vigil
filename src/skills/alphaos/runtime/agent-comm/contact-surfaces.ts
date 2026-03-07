import { formatArtifactFingerprint } from "./artifact-contracts";
import type { StateStore } from "../state-store";
import { isLegacyOnlyProtocolSet } from "./protocol-negotiation";
import type {
  AgentConnectionEvent,
  AgentConnectionEventStatus,
  AgentContact,
  AgentContactStatus,
  AgentMessageDirection,
  AgentSignedArtifact,
  AgentTransportEndpoint,
} from "./types";

export interface AgentPendingInviteCounts {
  inbound: number;
  outbound: number;
  total: number;
}

export interface AgentPendingInviteSummary {
  direction: AgentMessageDirection;
  occurredAt: string;
  requestedProfile?: string;
  requestedCapabilities?: string[];
  note?: string;
}

export interface AgentContactSurfaceItem extends AgentContact {
  proofSigner?: string;
  signerFingerprint?: string;
  currentTransportAddress?: string;
  currentTransportKeyId?: string;
  pendingInvites: AgentPendingInviteCounts;
  latestPendingInvite?: AgentPendingInviteSummary;
  legacyMarkers: string[];
  legacyProtocolOnly: boolean;
  legacyManualPeerRecord: boolean;
}

export interface AgentInviteSurfaceItem extends AgentConnectionEvent {
  contactStatus?: AgentContactStatus;
  displayName?: string;
  handle?: string;
  capabilityProfile?: string;
  capabilities?: string[];
  proofSigner?: string;
  signerFingerprint?: string;
  currentTransportAddress?: string;
  currentTransportKeyId?: string;
  requestedProfile?: string;
  requestedCapabilities?: string[];
  note?: string;
  senderPeerId?: string;
  legacyMarkers?: string[];
  legacyProtocolOnly?: boolean;
  legacyManualPeerRecord?: boolean;
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readMetadataStringArray(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? [...new Set(items)] : undefined;
}

function getActiveTransportEndpoint(
  store: StateStore,
  contactId: string,
): AgentTransportEndpoint | undefined {
  return store.listAgentTransportEndpoints(1, {
    contactId,
    endpointStatus: "active",
  })[0];
}

function getIdentityProofArtifact(
  store: StateStore,
  identityWallet: string,
  bindingDigest?: string,
): AgentSignedArtifact | undefined {
  const verifiedArtifacts = store
    .listAgentSignedArtifacts(20, { identityWallet })
    .filter((artifact) => artifact.verificationStatus === "verified");

  const contactCardArtifact = verifiedArtifacts.find((artifact) => artifact.artifactType === "ContactCard");
  if (contactCardArtifact) {
    return contactCardArtifact;
  }

  if (bindingDigest) {
    const bindingArtifact = store.getAgentSignedArtifact(bindingDigest);
    if (bindingArtifact?.verificationStatus === "verified") {
      return bindingArtifact;
    }
  }

  return verifiedArtifacts.find((artifact) => artifact.artifactType === "TransportBinding");
}

function listPendingInviteEvents(
  store: StateStore,
  contactId: string,
  direction: AgentMessageDirection,
): AgentConnectionEvent[] {
  return store.listAgentConnectionEvents(1000, {
    contactId,
    direction,
    eventType: "connection_invite",
    eventStatus: "pending" as AgentConnectionEventStatus,
  });
}

function buildPendingInviteCounts(
  inboundPendingInvites: AgentConnectionEvent[],
  outboundPendingInvites: AgentConnectionEvent[],
): AgentPendingInviteCounts {
  return {
    inbound: inboundPendingInvites.length,
    outbound: outboundPendingInvites.length,
    total: inboundPendingInvites.length + outboundPendingInvites.length,
  };
}

function toPendingInviteSummary(event: AgentConnectionEvent): AgentPendingInviteSummary {
  return {
    direction: event.direction,
    occurredAt: event.occurredAt,
    requestedProfile: readMetadataString(event.metadata, "requestedProfile"),
    requestedCapabilities: readMetadataStringArray(event.metadata, "requestedCapabilities"),
    note: readMetadataString(event.metadata, "note"),
  };
}

function getLatestPendingInvite(
  inboundPendingInvites: AgentConnectionEvent[],
  outboundPendingInvites: AgentConnectionEvent[],
): AgentPendingInviteSummary | undefined {
  const latestInbound = inboundPendingInvites[0];
  const latestOutbound = outboundPendingInvites[0];

  if (!latestInbound && !latestOutbound) {
    return undefined;
  }
  if (!latestInbound) {
    return toPendingInviteSummary(latestOutbound as AgentConnectionEvent);
  }
  if (!latestOutbound) {
    return toPendingInviteSummary(latestInbound);
  }

  return latestInbound.occurredAt >= latestOutbound.occurredAt
    ? toPendingInviteSummary(latestInbound)
    : toPendingInviteSummary(latestOutbound);
}

function buildLegacyMarkers(contact: AgentContact): {
  legacyMarkers: string[];
  legacyProtocolOnly: boolean;
  legacyManualPeerRecord: boolean;
} {
  const legacyProtocolOnly = isLegacyOnlyProtocolSet(contact.supportedProtocols);
  const legacyManualPeerRecord = Boolean(
    contact.metadata
    && typeof contact.metadata === "object"
    && !Array.isArray(contact.metadata)
    && "legacyBackfill" in contact.metadata,
  );
  const legacyMarkers = [
    ...(legacyProtocolOnly ? ["v1_only"] : []),
    ...(legacyManualPeerRecord ? ["manual_peer_record"] : []),
  ];
  return {
    legacyMarkers,
    legacyProtocolOnly,
    legacyManualPeerRecord,
  };
}

function buildContactSurfaceDetails(
  store: StateStore,
  contact: AgentContact,
): Omit<AgentContactSurfaceItem, keyof AgentContact> {
  const activeEndpoint = getActiveTransportEndpoint(store, contact.contactId);
  const proofArtifact = getIdentityProofArtifact(
    store,
    contact.identityWallet,
    activeEndpoint?.bindingDigest,
  );
  const inboundPendingInvites = listPendingInviteEvents(store, contact.contactId, "inbound");
  const outboundPendingInvites = listPendingInviteEvents(store, contact.contactId, "outbound");

  return {
    ...(proofArtifact
      ? {
          proofSigner: proofArtifact.signer,
          signerFingerprint: formatArtifactFingerprint(
            proofArtifact.digest as `0x${string}`,
          ),
        }
      : {}),
    ...(activeEndpoint
      ? {
          currentTransportAddress: activeEndpoint.receiveAddress,
          currentTransportKeyId: activeEndpoint.keyId,
        }
      : {}),
    pendingInvites: buildPendingInviteCounts(inboundPendingInvites, outboundPendingInvites),
    ...(getLatestPendingInvite(inboundPendingInvites, outboundPendingInvites)
      ? {
          latestPendingInvite: getLatestPendingInvite(inboundPendingInvites, outboundPendingInvites),
        }
      : {}),
    ...buildLegacyMarkers(contact),
  };
}

function buildInviteSurfaceDetails(
  store: StateStore,
  event: AgentConnectionEvent,
): Omit<AgentInviteSurfaceItem, keyof AgentConnectionEvent> {
  const contact =
    store.getAgentContact(event.contactId) ?? store.getAgentContactByIdentityWallet(event.identityWallet);
  if (!contact) {
    return {
      requestedProfile: readMetadataString(event.metadata, "requestedProfile"),
      requestedCapabilities: readMetadataStringArray(event.metadata, "requestedCapabilities"),
      note: readMetadataString(event.metadata, "note"),
      senderPeerId: readMetadataString(event.metadata, "senderPeerId"),
      legacyMarkers: [],
      legacyProtocolOnly: false,
      legacyManualPeerRecord: false,
    };
  }

  const contactDetails = buildContactSurfaceDetails(store, contact);
  return {
    contactStatus: contact.status,
    displayName: contact.displayName,
    handle: contact.handle,
    capabilityProfile: contact.capabilityProfile,
    capabilities: contact.capabilities,
    proofSigner: contactDetails.proofSigner,
    signerFingerprint: contactDetails.signerFingerprint,
    currentTransportAddress: contactDetails.currentTransportAddress,
    currentTransportKeyId: contactDetails.currentTransportKeyId,
    requestedProfile: readMetadataString(event.metadata, "requestedProfile"),
    requestedCapabilities: readMetadataStringArray(event.metadata, "requestedCapabilities"),
    note: readMetadataString(event.metadata, "note"),
    senderPeerId: readMetadataString(event.metadata, "senderPeerId"),
    legacyMarkers: contactDetails.legacyMarkers,
    legacyProtocolOnly: contactDetails.legacyProtocolOnly,
    legacyManualPeerRecord: contactDetails.legacyManualPeerRecord,
  };
}

export function listAgentContactSurfaceItems(
  store: StateStore,
  limit = 100,
  filters?: {
    status?: AgentContactStatus;
    identityWallet?: string;
    legacyPeerId?: string;
  },
): AgentContactSurfaceItem[] {
  return store.listAgentContacts(limit, filters).map((contact) => ({
    ...contact,
    ...buildContactSurfaceDetails(store, contact),
  }));
}

export function listAgentInviteSurfaceItems(
  store: StateStore,
  limit = 100,
  filters?: {
    contactId?: string;
    identityWallet?: string;
    direction?: AgentMessageDirection;
    eventStatus?: AgentConnectionEventStatus;
  },
): AgentInviteSurfaceItem[] {
  return store
    .listAgentConnectionEvents(limit, {
      ...filters,
      eventType: "connection_invite",
    })
    .map((event) => ({
      ...event,
      ...buildInviteSurfaceDetails(store, event),
    }));
}
