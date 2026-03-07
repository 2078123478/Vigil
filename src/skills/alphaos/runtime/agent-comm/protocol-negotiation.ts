import {
  AGENT_COMM_LEGACY_ENVELOPE_VERSION,
  AGENT_COMM_ENVELOPE_VERSION,
  AGENT_COMM_PROTOCOL_V1,
  AGENT_COMM_PROTOCOL_V2,
} from "./types";

export interface AgentCommProtocolSelection {
  protocol: typeof AGENT_COMM_PROTOCOL_V1 | typeof AGENT_COMM_PROTOCOL_V2;
  envelopeVersion: 1 | 2;
  legacyFallback: boolean;
}

export function getLocalSupportedProtocols(): string[] {
  return [AGENT_COMM_PROTOCOL_V2, AGENT_COMM_PROTOCOL_V1];
}

export function isLegacyOnlyProtocolSet(protocols: string[]): boolean {
  return normalizeProtocols(protocols).includes(AGENT_COMM_PROTOCOL_V1)
    && !normalizeProtocols(protocols).includes(AGENT_COMM_PROTOCOL_V2);
}

export function allowsLegacyFallback(protocols: string[]): boolean {
  return normalizeProtocols(protocols).includes(AGENT_COMM_PROTOCOL_V1);
}

export function supportsEnvelopeV2(protocols: string[]): boolean {
  return normalizeProtocols(protocols).includes(AGENT_COMM_PROTOCOL_V2);
}

export function negotiateProtocolVersion(
  contactProtocols: string[],
  localProtocols = getLocalSupportedProtocols(),
): AgentCommProtocolSelection {
  const remote = new Set(normalizeProtocols(contactProtocols));
  const local = normalizeProtocols(localProtocols);

  for (const protocol of local) {
    if (!remote.has(protocol)) {
      continue;
    }
    if (protocol === AGENT_COMM_PROTOCOL_V2) {
      return {
        protocol,
        envelopeVersion: AGENT_COMM_ENVELOPE_VERSION,
        legacyFallback: false,
      };
    }
    return {
      protocol,
      envelopeVersion: AGENT_COMM_LEGACY_ENVELOPE_VERSION,
      legacyFallback: true,
    };
  }

  throw new Error(
    `No mutually supported agent-comm protocol version. Local=${local.join(",")}; remote=${[
      ...remote,
    ].join(",")}`,
  );
}

function normalizeProtocols(protocols: string[]): Array<typeof AGENT_COMM_PROTOCOL_V1 | typeof AGENT_COMM_PROTOCOL_V2> {
  const normalized = [...new Set(protocols.map((value) => value.trim()).filter(Boolean))];
  return normalized.filter(
    (value): value is typeof AGENT_COMM_PROTOCOL_V1 | typeof AGENT_COMM_PROTOCOL_V2 =>
      value === AGENT_COMM_PROTOCOL_V1 || value === AGENT_COMM_PROTOCOL_V2,
  );
}
