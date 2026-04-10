import { createRestrictSendersChannelSecurity } from "openclaw/plugin-sdk/channel-policy";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { hasVkCredentials, resolveVkAccount, type ResolvedVkAccount } from "./accounts.js";
import { vkConfigAdapter } from "./config-adapter.js";
import { VkChannelConfigSchema } from "./config-schema.js";
import type { OpenClawConfig } from "./types.js";

export const vkChannelMeta = {
  id: "vk",
  label: "VK",
  selectionLabel: "VK (Long Poll)",
  detailLabel: "VK Bot",
  docsPath: "/channels/vk",
  docsLabel: "vk",
  blurb:
    "VK community bot for direct messages and group chats with buttons, media, and long-poll-first onboarding.",
  systemImage: "message",
} as const;

export const vkSecurityAdapter = createRestrictSendersChannelSecurity<ResolvedVkAccount>({
  channelKey: "vk",
  resolveDmPolicy: (account) => account.config.dmPolicy,
  resolveDmAllowFrom: (account) => account.config.allowFrom,
  resolveGroupPolicy: (account) => account.config.groupPolicy,
  surface: "VK group chats",
  openScope: "any participant in configured VK chats",
  groupPolicyPath: "channels.vk.groupPolicy",
  groupAllowFromPath: "channels.vk.groupAllowFrom",
  mentionGated: true,
  policyPathSuffix: "dmPolicy",
  approveHint: "openclaw pairing approve vk <id>",
  normalizeDmEntry: (raw) => raw.replace(/^vk:(?:user:)?/i, ""),
});

export const vkChannelPluginCommon = {
  meta: {
    ...vkChannelMeta,
    quickstartAllowFrom: true,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reply: true,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.vk"] },
  configSchema: VkChannelConfigSchema,
  config: {
    ...vkConfigAdapter,
    hasConfiguredState: ({ cfg }) =>
      listConfiguredVkAccounts(cfg).length > 0 || Boolean(process.env.VK_GROUP_TOKEN?.trim()),
    isConfigured: (account: ResolvedVkAccount) => hasVkCredentials(account),
    describeAccount: (account: ResolvedVkAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: hasVkCredentials(account),
      tokenSource: account.tokenSource,
      mode: "long-poll",
    }),
  },
} satisfies Pick<
  ChannelPlugin<ResolvedVkAccount>,
  "meta" | "capabilities" | "reload" | "configSchema" | "config"
>;

function listConfiguredVkAccounts(cfg: OpenClawConfig): ResolvedVkAccount[] {
  return vkConfigAdapter
    .listAccountIds(cfg)
    .map((accountId) => resolveVkAccount({ cfg, accountId }))
    .filter((account) => hasVkCredentials(account));
}
