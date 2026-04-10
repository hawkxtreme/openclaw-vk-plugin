import {
  DEFAULT_VK_ACCOUNT_ID,
  type ResolvedVkAccount,
  type VkConfig,
} from "./vk-core/types/config.js";
import {
  listVkAccountIds as listCoreVkAccountIds,
  resolveDefaultVkAccountId as resolveCoreDefaultVkAccountId,
  resolveVkAccount as resolveCoreVkAccount,
} from "./vk-core/index.js";
import type { OpenClawConfig } from "./types.js";

export { DEFAULT_VK_ACCOUNT_ID as DEFAULT_ACCOUNT_ID } from "./vk-core/types/config.js";
export type { ResolvedVkAccount };

export function getVkConfig(cfg: OpenClawConfig): VkConfig {
  return ((cfg.channels ?? {}).vk ?? {}) as VkConfig;
}

export function normalizeVkAccountId(accountId?: string | null): string {
  const normalized = accountId?.trim();
  return normalized || DEFAULT_VK_ACCOUNT_ID;
}

export function listVkAccountIds(cfg: OpenClawConfig): string[] {
  return listCoreVkAccountIds(getVkConfig(cfg), process.env);
}

export function resolveDefaultVkAccountId(cfg: OpenClawConfig): string {
  return resolveCoreDefaultVkAccountId(getVkConfig(cfg), process.env);
}

export function resolveVkAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedVkAccount {
  return resolveCoreVkAccount({
    config: getVkConfig(params.cfg),
    accountId: params.accountId ?? undefined,
    env: process.env,
  });
}

export function hasVkCredentials(account: ResolvedVkAccount): boolean {
  return Boolean(account.token.trim() && account.config.groupId);
}
