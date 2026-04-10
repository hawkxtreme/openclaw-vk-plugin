import { resolveVkAccount } from "./config/accounts.js";
import { parseVkConfig } from "./config/schema.js";
import type { VkRuntimeStatus } from "./types/config.js";

export function createVkRuntime(params?: {
  config?: unknown;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
}): VkRuntimeStatus {
  const config = parseVkConfig(params?.config);
  const account = resolveVkAccount({
    config,
    accountId: params?.accountId,
    env: params?.env,
  });

  return {
    healthy: account.enabled && Boolean(account.token) && !account.tokenError,
    enabled: account.enabled,
    accountId: account.accountId,
    transport: account.config.transport,
    tokenSource: account.tokenSource,
    groupId: account.config.groupId,
    issue: account.tokenError,
  };
}
