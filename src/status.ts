import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import {
  buildTokenChannelStatusSummary,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import { DEFAULT_ACCOUNT_ID, hasVkCredentials, type ResolvedVkAccount } from "./accounts.js";
import { probeVkAccount } from "./vk-core/setup/probe.js";
import type { VkProbeResult } from "./vk-core/types/config.js";

export const vkStatusAdapter: NonNullable<
  ChannelPlugin<ResolvedVkAccount, VkProbeResult>["status"]
> = {
  ...createComputedAccountStatusAdapter({
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
    buildChannelSummary: ({ snapshot }) =>
      buildTokenChannelStatusSummary(snapshot, {
        includeMode: true,
      }),
    probeAccount: async ({ account, timeoutMs }) =>
      await probeVkAccount({
        account,
        timeoutMs,
      }),
    resolveAccountSnapshot: ({ account }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: hasVkCredentials(account),
      extra: {
        tokenSource: account.tokenSource,
        mode: "long-poll",
      },
    }),
  }),
  // VK long poll can stay completely idle for long stretches while remaining
  // healthy, so "no recent events" is not a reliable stale-socket signal.
  skipStaleSocketHealthCheck: true,
};
