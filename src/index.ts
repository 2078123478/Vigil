import { createLogger } from "./skills/alphaos/runtime/logger";
import { loadConfig } from "./skills/alphaos/runtime/config";
import { getNetworkProfileReadinessSnapshot } from "./skills/alphaos/runtime/network-profile-probe";
import { createAlphaOsSkill } from "./skills/alphaos/skill";
import { createServer } from "./skills/alphaos/api/server";
import { StateStore } from "./skills/alphaos/runtime/state-store";
import { VaultService } from "./skills/alphaos/runtime/vault";
import {
  getCommIdentity,
  initCommWallet,
  registerTrustedPeerEntry,
  sendCommPing,
  sendCommStartDiscovery,
} from "./skills/alphaos/runtime/agent-comm/entrypoints";
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

const plannedAgentCommCommands = new Set([
  "agent-comm:card:export",
  "agent-comm:card:import",
  "agent-comm:contacts:list",
  "agent-comm:connect:invite",
  "agent-comm:connect:accept",
  "agent-comm:connect:reject",
]);

function getAgentCommHelpText(): string {
  return [
    "Agent-Comm CLI",
    "",
    "Available now:",
    "  agent-comm:wallet:init",
    "  agent-comm:identity",
    "  agent-comm:peer:trust    (legacy/manual v1 fallback)",
    "  agent-comm:send <ping|start_discovery> <peerId>",
    "",
    "Planned v2 identity-artifact commands (reserved, not implemented in this phase):",
    "  agent-comm:card:export",
    "  agent-comm:card:import <file|url>",
    "  agent-comm:contacts:list",
    "  agent-comm:connect:invite <contactRef>",
    "  agent-comm:connect:accept <contactRef>",
    "  agent-comm:connect:reject <contactRef>",
    "",
    "Canonical typed-data contracts:",
    "  docs/AGENT_COMM_V2_ARTIFACT_CONTRACTS.md",
  ].join("\n");
}

async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === "agent-comm:help") {
    process.stdout.write(`${getAgentCommHelpText()}\n`);
    return;
  }

  if (command && plannedAgentCommCommands.has(command)) {
    throw new Error(
      `${command} is reserved for the Agent-Comm v2 identity-artifact flow and is not implemented yet. See docs/AGENT_COMM_V2_ARTIFACT_CONTRACTS.md and use agent-comm:help for current status.`,
    );
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

  if (command === "agent-comm:identity") {
    const parsed = parseCliArgs(argv.slice(1));
    const store = new StateStore(config.dataDir);
    const vault = new VaultService(store);
    try {
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
      writeJson({
        action: "agent-comm:identity",
        ...identity,
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

void run();
