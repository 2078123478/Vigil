import fs from "node:fs";
import path from "node:path";
import { createLogger } from "./skills/alphaos/runtime/logger";
import { loadConfig } from "./skills/alphaos/runtime/config";
import { getNetworkProfileReadinessSnapshot } from "./skills/alphaos/runtime/network-profile-probe";
import { createAlphaOsSkill } from "./skills/alphaos/skill";
import { createServer } from "./skills/alphaos/api/server";
import { StateStore } from "./skills/alphaos/runtime/state-store";
import { VaultService } from "./skills/alphaos/runtime/vault";
import {
  bootstrapAgentCommState,
  exportIdentityArtifactBundle,
  getCommIdentity,
  importIdentityArtifactBundleFromJson,
  initCommWallet,
  initTemporaryDemoWallet,
  listLocalIdentityProfiles,
  registerTrustedPeerEntry,
  rotateCommWallet,
  sendCommConnectionAccept,
  sendCommConnectionInvite,
  sendCommConnectionReject,
  sendCommPing,
  sendCommStartDiscovery,
} from "./skills/alphaos/runtime/agent-comm/entrypoints";
import { listAgentContactSurfaceItems } from "./skills/alphaos/runtime/agent-comm/contact-surfaces";
import { startAgentCommRuntime } from "./skills/alphaos/runtime/agent-comm/runtime";
import { agentCommandTypes, type AgentPeerCapability } from "./skills/alphaos/runtime/agent-comm/types";

interface ParsedCliArgs {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

function parseCliArgs(args: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const key = current.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return {
    positionals,
    flags,
  };
}

function readFlag(args: ParsedCliArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function readBooleanFlag(args: ParsedCliArgs, name: string): boolean | undefined {
  const value = args.flags.get(name);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`--${name} must be true|false`);
}

function parsePositiveIntegerFlag(raw: string | undefined, label: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseCsv(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseCapabilities(raw: string | undefined): AgentPeerCapability[] | undefined {
  const values = parseCsv(raw);
  if (!values) {
    return undefined;
  }

  const allowed = new Set<string>(agentCommandTypes);
  for (const value of values) {
    if (!allowed.has(value)) {
      throw new Error(`Invalid capability: ${value}`);
    }
  }

  return values as AgentPeerCapability[];
}

function parseJsonObject(raw: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${reason}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function getAgentCommHelpText(): string {
  return [
    "Agent-Comm CLI",
    "",
    "Available now:",
    "  agent-comm:wallet:init",
    "  agent-comm:wallet:init-demo",
    "  agent-comm:wallet:rotate",
    "  agent-comm:identity",
    "  agent-comm:card:export [--display-name <name>] [--output <file>]",
    "  agent-comm:card:import <file>",
    "  agent-comm:contacts:list",
    "  agent-comm:connect:invite <contactRef> [--attach-inline-card]",
    "  agent-comm:connect:accept <contactRef> [--attach-inline-card]",
    "  agent-comm:connect:reject <contactRef>",
    "  agent-comm:peer:trust    (legacy/manual v1 fallback)",
    "  agent-comm:send <ping|start_discovery> <peerId>",
    "",
    "Notes:",
    "  Preferred flow: add contact via card import, then connect via invite/accept.",
    "  contactRef currently accepts contactId only.",
    "Canonical typed-data contracts:",
    "  docs/AGENT_COMM_V2_ARTIFACT_CONTRACTS.md",
  ].join("\n");
}

export async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === "agent-comm:help") {
    process.stdout.write(`${getAgentCommHelpText()}\n`);
    return;
  }

  if (command === "vault:set") {
    const alias = argv[1];
    const value = argv[2];
    const masterPassword = process.env.VAULT_MASTER_PASSWORD;
    if (!alias || !value || !masterPassword) {
      throw new Error("Usage: tsx src/index.ts vault:set <alias> <value> with VAULT_MASTER_PASSWORD");
    }
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    vault.setSecret(alias, value, masterPassword);
    store.close();
    logger.info({ alias }, "vault secret stored");
    return;
  }

  if (command === "vault:get") {
    const alias = argv[1];
    const masterPassword = process.env.VAULT_MASTER_PASSWORD;
    if (!alias || !masterPassword) {
      throw new Error("Usage: tsx src/index.ts vault:get <alias> with VAULT_MASTER_PASSWORD");
    }
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    const value = vault.getSecret(alias, masterPassword);
    store.close();
    process.stdout.write(`${value}\n`);
    return;
  }

  if (command === "agent-comm:wallet:init") {
    const parsed = parseCliArgs(argv.slice(1));
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      const result = initCommWallet(
        {
          config,
          store,
          vault,
        },
        {
          privateKey: readFlag(parsed, "private-key"),
          senderPeerId: readFlag(parsed, "sender-peer-id"),
        },
      );
      writeJson({
        action: "agent-comm:wallet:init",
        ...result,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:wallet:init-demo") {
    const parsed = parseCliArgs(argv.slice(1));
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      const result = initTemporaryDemoWallet(
        {
          config,
          store,
          vault,
        },
        {
          privateKey: readFlag(parsed, "private-key"),
          senderPeerId: readFlag(parsed, "sender-peer-id"),
          walletAlias: readFlag(parsed, "wallet-alias"),
        },
      );
      writeJson({
        action: "agent-comm:wallet:init-demo",
        ...result,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:wallet:rotate") {
    const parsed = parseCliArgs(argv.slice(1));
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      const result = await rotateCommWallet(
        {
          config,
          store,
          vault,
        },
        {
          privateKey: readFlag(parsed, "private-key"),
          senderPeerId: readFlag(parsed, "sender-peer-id"),
          displayName: readFlag(parsed, "display-name"),
          handle: readFlag(parsed, "handle"),
          capabilityProfile: readFlag(parsed, "capability-profile"),
          capabilities: parseCsv(readFlag(parsed, "capabilities")),
          keyId: readFlag(parsed, "key-id"),
          legacyPeerId: readFlag(parsed, "legacy-peer-id"),
          gracePeriodHours: parsePositiveIntegerFlag(
            readFlag(parsed, "grace-period-hours"),
            "grace-period-hours",
          ),
          expiresInDays: parsePositiveIntegerFlag(readFlag(parsed, "expires-in-days"), "expires-in-days"),
        },
      );
      writeJson({
        action: "agent-comm:wallet:rotate",
        ...result,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:identity") {
    const parsed = parseCliArgs(argv.slice(1));
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      bootstrapAgentCommState(
        {
          config,
          store,
          vault,
        },
        {
          senderPeerId: readFlag(parsed, "sender-peer-id"),
        },
      );
      const identity = getCommIdentity(
        {
          config,
          store,
          vault,
        },
        {
          senderPeerId: readFlag(parsed, "sender-peer-id"),
        },
      );
      const localProfiles = listLocalIdentityProfiles(
        {
          config,
          store,
          vault,
        },
        {},
      );
      writeJson({
        action: "agent-comm:identity",
        ...identity,
        localProfiles,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:card:export") {
    const parsed = parseCliArgs(argv.slice(1));
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      const output = readFlag(parsed, "output");
      const result = await exportIdentityArtifactBundle(
        {
          config,
          store,
          vault,
        },
        {
          displayName: readFlag(parsed, "display-name"),
          handle: readFlag(parsed, "handle"),
          capabilityProfile: readFlag(parsed, "capability-profile"),
          capabilities: parseCsv(readFlag(parsed, "capabilities")),
          expiresInDays: parsePositiveIntegerFlag(readFlag(parsed, "expires-in-days"), "expires-in-days"),
          keyId: readFlag(parsed, "key-id"),
          legacyPeerId: readFlag(parsed, "legacy-peer-id"),
        },
      );

      const outputPath = output ? path.resolve(output) : undefined;
      if (outputPath) {
        fs.writeFileSync(outputPath, `${JSON.stringify(result.bundle, null, 2)}\n`);
      }

      writeJson({
        action: "agent-comm:card:export",
        ...result,
        outputPath,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:card:import") {
    const parsed = parseCliArgs(argv.slice(1));
    const [inputPath] = parsed.positionals;
    if (!inputPath) {
      throw new Error("Usage: tsx src/index.ts agent-comm:card:import <file>");
    }

    const resolvedPath = path.resolve(inputPath);
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const store = new StateStore(config.dataDir);
    try {
      const result = await importIdentityArtifactBundleFromJson(
        {
          config,
          store,
        },
        raw,
        {
          source: `file:${resolvedPath}`,
        },
      );
      writeJson({
        action: "agent-comm:card:import",
        inputPath: resolvedPath,
        ...result,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:contacts:list") {
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      bootstrapAgentCommState(
        {
          config,
          store,
          vault,
        },
        {},
      );
      writeJson({
        action: "agent-comm:contacts:list",
        contacts: listAgentContactSurfaceItems(store),
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:connect:invite") {
    const parsed = parseCliArgs(argv.slice(1));
    const [contactId] = parsed.positionals;
    if (!contactId) {
      throw new Error(
        "Usage: tsx src/index.ts agent-comm:connect:invite <contactRef> [--sender-peer-id <peerId>] [--requested-profile <profile>] [--requested-capabilities ping,start_discovery] [--note <note>] [--attach-inline-card]",
      );
    }

    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      const result = await sendCommConnectionInvite(
        {
          config,
          store,
          vault,
        },
        {
          contactId,
          senderPeerId: readFlag(parsed, "sender-peer-id"),
          requestedProfile: readFlag(parsed, "requested-profile"),
          requestedCapabilities: parseCsv(readFlag(parsed, "requested-capabilities")),
          note: readFlag(parsed, "note"),
          attachInlineCard: readBooleanFlag(parsed, "attach-inline-card"),
        },
      );
      writeJson({
        action: "agent-comm:connect:invite",
        ...result,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:connect:accept") {
    const parsed = parseCliArgs(argv.slice(1));
    const [contactId] = parsed.positionals;
    if (!contactId) {
      throw new Error(
        "Usage: tsx src/index.ts agent-comm:connect:accept <contactRef> [--sender-peer-id <peerId>] [--capability-profile <profile>] [--capabilities ping,start_discovery] [--note <note>] [--attach-inline-card]",
      );
    }

    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      const result = await sendCommConnectionAccept(
        {
          config,
          store,
          vault,
        },
        {
          contactId,
          senderPeerId: readFlag(parsed, "sender-peer-id"),
          capabilityProfile: readFlag(parsed, "capability-profile"),
          capabilities: parseCsv(readFlag(parsed, "capabilities")),
          note: readFlag(parsed, "note"),
          attachInlineCard: readBooleanFlag(parsed, "attach-inline-card"),
        },
      );
      writeJson({
        action: "agent-comm:connect:accept",
        ...result,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:connect:reject") {
    const parsed = parseCliArgs(argv.slice(1));
    const [contactId] = parsed.positionals;
    if (!contactId) {
      throw new Error(
        "Usage: tsx src/index.ts agent-comm:connect:reject <contactRef> [--sender-peer-id <peerId>] [--reason <reason>] [--note <note>]",
      );
    }

    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      const result = await sendCommConnectionReject(
        {
          config,
          store,
          vault,
        },
        {
          contactId,
          senderPeerId: readFlag(parsed, "sender-peer-id"),
          reason: readFlag(parsed, "reason"),
          note: readFlag(parsed, "note"),
        },
      );
      writeJson({
        action: "agent-comm:connect:reject",
        ...result,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:peer:trust") {
    const parsed = parseCliArgs(argv.slice(1));
    const [peerId, walletAddress, pubkey] = parsed.positionals;
    if (!peerId || !walletAddress || !pubkey) {
      throw new Error(
        "Usage: tsx src/index.ts agent-comm:peer:trust <peerId> <walletAddress> <pubkey> [--name <name>] [--capabilities ping,start_discovery] [--metadata '{\"k\":\"v\"}'] (legacy/manual v1 fallback)",
      );
    }

    const store = new StateStore(config.dataDir);
    try {
      const peer = registerTrustedPeerEntry(
        {
          store,
        },
        {
          peerId,
          walletAddress,
          pubkey,
          name: readFlag(parsed, "name"),
          capabilities: parseCapabilities(readFlag(parsed, "capabilities")),
          metadata: parseJsonObject(readFlag(parsed, "metadata"), "metadata"),
        },
      );
      writeJson({
        action: "agent-comm:peer:trust",
        peer,
        legacyManualRecord: true,
        legacyMarkers: ["manual_peer_record"],
        contactId: store.getAgentContactByLegacyPeerId(peer.peerId)?.contactId,
      });
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agent-comm:send") {
    const parsed = parseCliArgs(argv.slice(1));
    const [commandType, peerId] = parsed.positionals;
    if (!commandType || !peerId) {
      throw new Error(
        "Usage: tsx src/index.ts agent-comm:send <ping|start_discovery> <peerId> [--sender-peer-id <peerId>] [ping flags] [start_discovery flags]",
      );
    }

    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
      if (commandType === "ping") {
        const result = await sendCommPing(
          {
            config,
            store,
            vault,
          },
          {
            peerId,
            senderPeerId: readFlag(parsed, "sender-peer-id"),
            echo: readFlag(parsed, "echo"),
            note: readFlag(parsed, "note"),
          },
        );
        writeJson({
          action: "agent-comm:send",
          ...result,
        });
        return;
      }

      if (commandType === "start_discovery") {
        const strategyId = readFlag(parsed, "strategy-id");
        if (!strategyId) {
          throw new Error("start_discovery requires --strategy-id");
        }
        const result = await sendCommStartDiscovery(
          {
            config,
            store,
            vault,
          },
          {
            peerId,
            senderPeerId: readFlag(parsed, "sender-peer-id"),
            strategyId,
            pairs: parseCsv(readFlag(parsed, "pairs")),
            durationMinutes: parsePositiveIntegerFlag(
              readFlag(parsed, "duration-minutes"),
              "duration-minutes",
            ),
            sampleIntervalSec: parsePositiveIntegerFlag(
              readFlag(parsed, "sample-interval-sec"),
              "sample-interval-sec",
            ),
            topN: parsePositiveIntegerFlag(readFlag(parsed, "top-n"), "top-n"),
          },
        );
        writeJson({
          action: "agent-comm:send",
          ...result,
        });
        return;
      }

      throw new Error(
        `Unsupported agent-comm command: ${commandType}. Supported values: ping, start_discovery`,
      );
    } finally {
      store.close();
    }
  }

  const skill = createAlphaOsSkill(config, logger);
  const vault = new VaultService(skill.store);
  const agentCommRuntime = await startAgentCommRuntime({
    config,
    logger,
    store: skill.store,
    discovery: skill.discovery,
    onchain: skill.onchain,
    vault,
  });
  const app = createServer(skill.engine, skill.store, skill.manifest, {
    config,
    defaultRiskPolicy: config.riskPolicy,
    onchainClient: skill.onchain,
    discoveryEngine: skill.discovery,
    apiSecret: config.apiSecret,
    demoPublic: config.demoPublic,
    agentCommRuntime,
    agentCommSendDeps: {
      config,
      vault,
    },
  });

  skill.engine.start();
  skill.discovery.start();
  const server = app.listen(config.port, () => {
    const networkProfile = getNetworkProfileReadinessSnapshot({
      config,
      onchainClient: skill.onchain,
    });
    logger.info(
      {
        port: config.port,
        skill: skill.manifest.id,
        networkProfile: {
          id: networkProfile.profile.id,
          readiness: networkProfile.readiness,
          summary: networkProfile.summary,
          reasons: networkProfile.reasons,
        },
      },
      "alphaos started",
    );
  });

  const shutdown = () => {
    agentCommRuntime.stop();
    skill.engine.stop();
    skill.discovery.stop();
    server.close(() => {
      skill.store.close();
      logger.info("alphaos stopped");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  void run();
}
