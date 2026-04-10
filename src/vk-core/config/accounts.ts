import {
  DEFAULT_VK_ACCOUNT_ID,
  DEFAULT_VK_API_VERSION,
  DEFAULT_VK_TRANSPORT,
  type ResolvedVkAccount,
  type ResolvedVkAccountConfig,
  type VkGroupChatConfig,
  type VkConfig,
} from "../types/config.js";
import { resolveVkToken } from "./token.js";

function normalizeAccountId(accountId?: string | null): string {
  const normalized = accountId?.trim();
  return normalized || DEFAULT_VK_ACCOUNT_ID;
}

function hasBaseAccountConfig(
  config: VkConfig,
  env: NodeJS.ProcessEnv,
): boolean {
  return Boolean(
    config.name ||
    config.groupId ||
    config.accessToken ||
    config.tokenFile ||
    config.callback ||
    config.allowFrom?.length ||
    config.groupAllowFrom?.length ||
    config.dmPolicy ||
    config.groupPolicy ||
    config.groups ||
    config.enabled !== undefined ||
    env.VK_GROUP_TOKEN?.trim(),
  );
}

function mergeGroupConfigs(
  baseGroups: VkConfig["groups"],
  overrideGroups: VkConfig["groups"],
): Record<string, VkGroupChatConfig> {
  const mergedEntries = new Map<string, VkGroupChatConfig>();

  for (const [groupId, groupConfig] of Object.entries(baseGroups ?? {})) {
    mergedEntries.set(groupId, { ...groupConfig });
  }

  for (const [groupId, groupConfig] of Object.entries(overrideGroups ?? {})) {
    mergedEntries.set(groupId, {
      ...(mergedEntries.get(groupId) ?? {}),
      ...groupConfig,
    });
  }

  return Object.fromEntries(mergedEntries);
}

function mergeAccountConfig(
  config: VkConfig,
  accountId: string,
): ResolvedVkAccountConfig {
  const override = config.accounts?.[accountId];

  return {
    name: override?.name ?? config.name,
    enabled: override?.enabled ?? config.enabled,
    groupId: override?.groupId ?? config.groupId,
    accessToken: override?.accessToken ?? config.accessToken,
    tokenFile: override?.tokenFile ?? config.tokenFile,
    transport: override?.transport ?? config.transport ?? DEFAULT_VK_TRANSPORT,
    apiVersion:
      override?.apiVersion ?? config.apiVersion ?? DEFAULT_VK_API_VERSION,
    callback: {
      ...config.callback,
      ...override?.callback,
    },
    dmPolicy: override?.dmPolicy ?? config.dmPolicy,
    allowFrom: override?.allowFrom ?? config.allowFrom,
    groupPolicy: override?.groupPolicy ?? config.groupPolicy,
    groupAllowFrom: override?.groupAllowFrom ?? config.groupAllowFrom,
    groups: mergeGroupConfigs(config.groups, override?.groups),
  };
}

export function listVkAccountIds(
  config: VkConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const accountIds = Object.keys(config.accounts ?? {});
  if (hasBaseAccountConfig(config, env) || accountIds.length === 0) {
    return [
      DEFAULT_VK_ACCOUNT_ID,
      ...accountIds.filter((id) => id !== DEFAULT_VK_ACCOUNT_ID),
    ];
  }

  return accountIds;
}

export function resolveDefaultVkAccountId(
  config: VkConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const accountIds = listVkAccountIds(config, env);
  const preferred = normalizeAccountId(config.defaultAccount);
  return accountIds.includes(preferred)
    ? preferred
    : (accountIds[0] ?? DEFAULT_VK_ACCOUNT_ID);
}

export function resolveVkAccount(params: {
  config: VkConfig;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
}): ResolvedVkAccount {
  const env = params.env ?? process.env;
  const accountId = normalizeAccountId(params.accountId);
  const mergedConfig = mergeAccountConfig(params.config, accountId);
  const token = resolveVkToken({
    config: params.config,
    accountId,
    env,
  });
  const globallyEnabled = params.config.enabled !== false;
  const accountEnabled = mergedConfig.enabled !== false;

  return {
    accountId,
    enabled: globallyEnabled && accountEnabled,
    name: mergedConfig.name?.trim() || undefined,
    token: token.token,
    tokenSource: token.source,
    tokenError: token.error,
    config: mergedConfig,
  };
}

export function listEnabledVkAccounts(
  config: VkConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedVkAccount[] {
  return listVkAccountIds(config, env)
    .map((accountId) => resolveVkAccount({ config, accountId, env }))
    .filter((account) => account.enabled);
}

export function mergeVkAccountConfig(
  config: VkConfig,
  accountId?: string | null,
): ResolvedVkAccountConfig {
  return mergeAccountConfig(config, normalizeAccountId(accountId));
}
