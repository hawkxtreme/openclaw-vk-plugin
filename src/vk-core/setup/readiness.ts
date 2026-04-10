import { listEnabledVkAccounts } from "../config/accounts.js";
import { parseVkConfig } from "../config/schema.js";

export function runVkReleaseReadinessChecks(configInput: unknown): string[] {
  const config = parseVkConfig(configInput);
  const issues: string[] = [];

  for (const account of listEnabledVkAccounts(config, {})) {
    if (!account.config.groupId) {
      issues.push(`channels.vk.accounts.${account.accountId}.groupId is required`);
    }
    if (!account.token) {
      issues.push(`channels.vk.accounts.${account.accountId}.accessToken is required`);
    }
  }

  return issues;
}
