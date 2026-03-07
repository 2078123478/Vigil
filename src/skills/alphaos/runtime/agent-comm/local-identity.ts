import type { AlphaOsConfig } from "../config";
import type { StateStore } from "../state-store";
import type { VaultService } from "../vault";
import {
  generateShadowWallet,
  restoreShadowWallet,
  type ShadowWallet,
} from "./shadow-wallet";
import type { AgentLocalIdentity } from "./types";

export const AGENT_COMM_DEFAULT_ACW_ROTATION_GRACE_HOURS = 24;
const LIW_ALIAS_SUFFIX = "-liw";
const ARCHIVED_ACW_ALIAS_SEGMENT = "-acw-prev-";
const GRACE_METADATA_KEY = "graceReceiveKeys";

export interface AgentCommGraceReceiveKeyMetadata {
  walletAlias: string;
  walletAddress: string;
  transportKeyId?: string;
  bindingDigest?: string;
  expiresAt: string;
}

export interface ResolvedReceiveKey {
  walletAlias: string;
  wallet: ShadowWallet;
  walletAddress: string;
  pubkey: string;
  transportKeyId?: string;
  bindingDigest?: string;
  expiresAt?: string;
  status: "active" | "grace";
}

export interface ResolvedLocalIdentityState {
  liwProfile: AgentLocalIdentity;
  acwProfile: AgentLocalIdentity;
  liwWallet: ShadowWallet;
  acwWallet: ShadowWallet;
  receiveKeys: ResolvedReceiveKey[];
}

export interface RotateLocalCommWalletResult {
  liwProfile: AgentLocalIdentity;
  acwProfile: AgentLocalIdentity;
  liwWallet: ShadowWallet;
  acwWallet: ShadowWallet;
  previousTransportAddress: string;
  previousTransportKeyId?: string;
  archivedWalletAlias: string;
  graceExpiresAt: string;
}

interface IdentityDeps {
  config: AlphaOsConfig;
  store: StateStore;
}

interface IdentityVaultDeps extends IdentityDeps {
  vault: VaultService;
}

export function getLiwWalletAlias(config: AlphaOsConfig): string {
  return `${config.commWalletAlias}${LIW_ALIAS_SUFFIX}`;
}

export function ensureLegacyDualUseLocalIdentityProfiles(
  deps: IdentityDeps,
  wallet: ShadowWallet,
  acwPatch: {
    activeBindingDigest?: string;
    transportKeyId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): AgentLocalIdentity[] {
  const walletAddress = wallet.getAddress();
  const sharedInput = {
    walletAlias: deps.config.commWalletAlias,
    walletAddress,
    identityWallet: walletAddress,
    chainId: deps.config.commChainId,
    mode: "temporary_dual_use" as const,
  };
  const liw = deps.store.upsertAgentLocalIdentity({
    role: "liw",
    ...sharedInput,
  });
  const acw = deps.store.upsertAgentLocalIdentity({
    role: "acw",
    ...sharedInput,
    activeBindingDigest: acwPatch.activeBindingDigest,
    transportKeyId: acwPatch.transportKeyId,
    metadata: mergeAcwMetadata(undefined, acwPatch.metadata),
  });

  const temporaryDemo = deps.store.getAgentLocalIdentity("temporary_demo");
  return temporaryDemo ? [liw, acw, temporaryDemo] : [liw, acw];
}

export function initializeDistinctLocalIdentityState(
  deps: IdentityVaultDeps,
  options: {
    masterPassword: string;
    acwPrivateKey?: string;
    liwPrivateKey?: string;
  } = { masterPassword: "" },
): ResolvedLocalIdentityState {
  const acwWallet = options.acwPrivateKey
    ? restoreShadowWallet(options.acwPrivateKey)
    : generateShadowWallet();
  const liwWallet = options.liwPrivateKey
    ? restoreShadowWallet(options.liwPrivateKey)
    : generateShadowWallet();

  deps.vault.setSecret(deps.config.commWalletAlias, acwWallet.privateKey, options.masterPassword);
  deps.vault.setSecret(getLiwWalletAlias(deps.config), liwWallet.privateKey, options.masterPassword);

  const liwProfile = deps.store.upsertAgentLocalIdentity({
    role: "liw",
    walletAlias: getLiwWalletAlias(deps.config),
    walletAddress: liwWallet.getAddress(),
    identityWallet: liwWallet.getAddress(),
    chainId: deps.config.commChainId,
    mode: "standard",
  });
  const acwProfile = deps.store.upsertAgentLocalIdentity({
    role: "acw",
    walletAlias: deps.config.commWalletAlias,
    walletAddress: acwWallet.getAddress(),
    identityWallet: liwWallet.getAddress(),
    chainId: deps.config.commChainId,
    mode: "standard",
    metadata: mergeAcwMetadata(undefined),
  });

  return buildResolvedLocalIdentityState({
    config: deps.config,
    store: deps.store,
    vault: deps.vault,
    masterPassword: options.masterPassword,
    liwProfile,
    acwProfile,
    liwWallet,
    acwWallet,
  });
}

export function resolveLocalIdentityState(
  deps: IdentityVaultDeps,
  masterPassword: string,
  now = new Date(),
): ResolvedLocalIdentityState {
  let liwProfile = deps.store.getAgentLocalIdentity("liw");
  let acwProfile = deps.store.getAgentLocalIdentity("acw");

  if (!liwProfile || !acwProfile) {
    const secret = deps.vault.getSecret(deps.config.commWalletAlias, masterPassword);
    const legacyWallet = restoreShadowWallet(secret);
    ensureLegacyDualUseLocalIdentityProfiles(deps, legacyWallet);
    liwProfile = deps.store.getAgentLocalIdentity("liw");
    acwProfile = deps.store.getAgentLocalIdentity("acw");
  }

  if (!liwProfile || !acwProfile) {
    throw new Error("Local LIW/ACW profiles are unavailable");
  }

  const liwWallet = restoreShadowWallet(deps.vault.getSecret(liwProfile.walletAlias, masterPassword));
  const acwWallet = restoreShadowWallet(deps.vault.getSecret(acwProfile.walletAlias, masterPassword));

  pruneExpiredGraceReceiveKeys(deps.store, acwProfile, now);
  const refreshedAcwProfile = deps.store.getAgentLocalIdentity("acw") ?? acwProfile;

  return buildResolvedLocalIdentityState({
    config: deps.config,
    store: deps.store,
    vault: deps.vault,
    masterPassword,
    liwProfile,
    acwProfile: refreshedAcwProfile,
    liwWallet,
    acwWallet,
    now,
  });
}

export function rotateLocalCommWallet(
  deps: IdentityVaultDeps,
  options: {
    masterPassword: string;
    now?: Date;
    gracePeriodHours?: number;
    privateKey?: string;
  },
): RotateLocalCommWalletResult {
  const now = options.now ?? new Date();
  const graceHours = normalizeGraceHours(options.gracePeriodHours);
  const state = resolveLocalIdentityState(deps, options.masterPassword, now);

  let liwProfile = state.liwProfile;
  let liwWallet = state.liwWallet;
  const currentAcwProfile = state.acwProfile;
  const currentAcwWallet = state.acwWallet;

  if (
    liwProfile.mode === "temporary_dual_use"
    || liwProfile.walletAlias === currentAcwProfile.walletAlias
    || liwProfile.walletAddress.toLowerCase() === currentAcwProfile.walletAddress.toLowerCase()
  ) {
    const liwAlias = getLiwWalletAlias(deps.config);
    deps.vault.setSecret(liwAlias, currentAcwWallet.privateKey, options.masterPassword);
    liwWallet = currentAcwWallet;
    liwProfile = deps.store.upsertAgentLocalIdentity({
      role: "liw",
      walletAlias: liwAlias,
      walletAddress: liwWallet.getAddress(),
      identityWallet: liwWallet.getAddress(),
      chainId: deps.config.commChainId,
      mode: "standard",
      metadata: state.liwProfile.metadata,
    });
  }

  const archivedWalletAlias = `${deps.config.commWalletAlias}${ARCHIVED_ACW_ALIAS_SEGMENT}${now.getTime()}`;
  deps.vault.setSecret(archivedWalletAlias, currentAcwWallet.privateKey, options.masterPassword);

  const nextAcwWallet = options.privateKey
    ? restoreShadowWallet(options.privateKey)
    : generateShadowWallet();
  deps.vault.setSecret(deps.config.commWalletAlias, nextAcwWallet.privateKey, options.masterPassword);

  const existingGraceKeys = readGraceReceiveKeys(currentAcwProfile.metadata).filter(
    (entry) => Date.parse(entry.expiresAt) > now.getTime(),
  );
  const graceExpiresAt = new Date(now.getTime() + graceHours * 60 * 60 * 1000).toISOString();
  const nextGraceKeys = [
    ...existingGraceKeys,
    {
      walletAlias: archivedWalletAlias,
      walletAddress: currentAcwWallet.getAddress(),
      transportKeyId: currentAcwProfile.transportKeyId,
      bindingDigest: currentAcwProfile.activeBindingDigest,
      expiresAt: graceExpiresAt,
    },
  ];

  const acwProfile = deps.store.upsertAgentLocalIdentity({
    role: "acw",
    walletAlias: deps.config.commWalletAlias,
    walletAddress: nextAcwWallet.getAddress(),
    identityWallet: liwProfile.identityWallet,
    chainId: deps.config.commChainId,
    mode: "standard",
    metadata: mergeAcwMetadata(currentAcwProfile.metadata, {
      [GRACE_METADATA_KEY]: nextGraceKeys,
    }),
  });

  return {
    liwProfile,
    acwProfile,
    liwWallet,
    acwWallet: nextAcwWallet,
    previousTransportAddress: currentAcwWallet.getAddress(),
    previousTransportKeyId: currentAcwProfile.transportKeyId,
    archivedWalletAlias,
    graceExpiresAt,
  };
}

function buildResolvedLocalIdentityState(input: {
  config: AlphaOsConfig;
  store: StateStore;
  vault: VaultService;
  masterPassword: string;
  liwProfile: AgentLocalIdentity;
  acwProfile: AgentLocalIdentity;
  liwWallet: ShadowWallet;
  acwWallet: ShadowWallet;
  now?: Date;
}): ResolvedLocalIdentityState {
  const now = input.now ?? new Date();
  const graceKeys = readGraceReceiveKeys(input.acwProfile.metadata)
    .filter((entry) => Date.parse(entry.expiresAt) > now.getTime())
    .map((entry) => {
      const wallet = restoreShadowWallet(input.vault.getSecret(entry.walletAlias, input.masterPassword));
      return {
        walletAlias: entry.walletAlias,
        wallet,
        walletAddress: wallet.getAddress(),
        pubkey: wallet.getPublicKey(),
        transportKeyId: entry.transportKeyId,
        bindingDigest: entry.bindingDigest,
        expiresAt: entry.expiresAt,
        status: "grace" as const,
      };
    });

  const receiveKeys: ResolvedReceiveKey[] = [
    {
      walletAlias: input.acwProfile.walletAlias,
      wallet: input.acwWallet,
      walletAddress: input.acwWallet.getAddress(),
      pubkey: input.acwWallet.getPublicKey(),
      transportKeyId: input.acwProfile.transportKeyId,
      bindingDigest: input.acwProfile.activeBindingDigest,
      status: "active",
    },
    ...graceKeys,
  ];

  return {
    liwProfile: input.liwProfile,
    acwProfile: input.acwProfile,
    liwWallet: input.liwWallet,
    acwWallet: input.acwWallet,
    receiveKeys,
  };
}

function normalizeGraceHours(value: number | undefined): number {
  if (value === undefined) {
    return AGENT_COMM_DEFAULT_ACW_ROTATION_GRACE_HOURS;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("gracePeriodHours must be a positive integer");
  }
  return value;
}

function pruneExpiredGraceReceiveKeys(
  store: StateStore,
  acwProfile: AgentLocalIdentity,
  now: Date,
): void {
  const nextEntries = readGraceReceiveKeys(acwProfile.metadata).filter(
    (entry) => Date.parse(entry.expiresAt) > now.getTime(),
  );
  if (nextEntries.length === readGraceReceiveKeys(acwProfile.metadata).length) {
    return;
  }
  store.upsertAgentLocalIdentity({
    role: acwProfile.role,
    walletAlias: acwProfile.walletAlias,
    walletAddress: acwProfile.walletAddress,
    identityWallet: acwProfile.identityWallet,
    chainId: acwProfile.chainId,
    mode: acwProfile.mode,
    activeBindingDigest: acwProfile.activeBindingDigest,
    transportKeyId: acwProfile.transportKeyId,
    metadata: mergeAcwMetadata(acwProfile.metadata, {
      [GRACE_METADATA_KEY]: nextEntries,
    }),
  });
}

function readGraceReceiveKeys(
  metadata: Record<string, unknown> | undefined,
): AgentCommGraceReceiveKeyMetadata[] {
  const raw = metadata?.[GRACE_METADATA_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    const walletAlias = typeof candidate.walletAlias === "string" ? candidate.walletAlias.trim() : "";
    const walletAddress =
      typeof candidate.walletAddress === "string" ? candidate.walletAddress.trim() : "";
    const expiresAt = typeof candidate.expiresAt === "string" ? candidate.expiresAt.trim() : "";
    if (!walletAlias || !walletAddress || !expiresAt) {
      return [];
    }
    return [
      {
        walletAlias,
        walletAddress,
        expiresAt,
        transportKeyId:
          typeof candidate.transportKeyId === "string" && candidate.transportKeyId.trim().length > 0
            ? candidate.transportKeyId.trim()
            : undefined,
        bindingDigest:
          typeof candidate.bindingDigest === "string" && candidate.bindingDigest.trim().length > 0
            ? candidate.bindingDigest.trim()
            : undefined,
      },
    ];
  });
}

function mergeAcwMetadata(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    [GRACE_METADATA_KEY]: readGraceReceiveKeys({ ...existing, ...patch }),
    ...patch,
  };
}
