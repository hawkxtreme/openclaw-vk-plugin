import { createScopedChannelConfigAdapter } from "openclaw/plugin-sdk/channel-config-helpers";
import {
  listVkAccountIds,
  resolveDefaultVkAccountId,
  resolveVkAccount,
  type ResolvedVkAccount,
} from "./accounts.js";
import type { OpenClawConfig } from "./types.js";

export function normalizeVkAllowFrom(entry: string): string {
  return entry.replace(/^vk:(?:user:)?/i, "").trim();
}

export const vkConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedVkAccount,
  ResolvedVkAccount,
  OpenClawConfig
>({
  sectionKey: "vk",
  listAccountIds: listVkAccountIds,
  resolveAccount: (cfg, accountId) => resolveVkAccount({ cfg, accountId }),
  defaultAccountId: resolveDefaultVkAccountId,
  clearBaseFields: [
    "name",
    "groupId",
    "accessToken",
    "tokenFile",
    "transport",
    "apiVersion",
    "callback",
    "dmPolicy",
    "allowFrom",
    "groupPolicy",
    "groupAllowFrom",
    "groups",
  ],
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) =>
    allowFrom
      .map((entry) => String(entry).trim())
      .filter(Boolean)
      .map(normalizeVkAllowFrom),
});
