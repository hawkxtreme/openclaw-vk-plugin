import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { createPairingPrefixStripper } from "openclaw/plugin-sdk/channel-pairing";
import { resolveVkAccount, type ResolvedVkAccount } from "./accounts.js";
import { vkMessageActions } from "./channel-actions.js";
import { vkChannelPluginCommon, vkSecurityAdapter } from "./channel-shared.js";
import {
  buildVkCommandsListChannelData,
  buildVkModelBrowseChannelData,
  buildVkModelsListChannelData,
  buildVkModelsProviderChannelData,
  buildVkToolDetailsChannelData,
  buildVkToolsGroupListChannelData,
  buildVkToolsListChannelData,
} from "./command-ui.js";
import { vkGatewayAdapter } from "./gateway.js";
import { resolveVkGroupRequireMention } from "./group-policy.js";
import { vkMessagingAdapter, vkOutboundAdapter } from "./outbound.js";
import { collectRuntimeConfigAssignments, secretTargetRegistryEntries } from "./secret-contract.js";
import { vkSetupAdapter } from "./setup-core.js";
import { sendVkText } from "./vk-core/outbound/send.js";
import type { VkProbeResult } from "./vk-core/types/config.js";
import { vkStatusAdapter } from "./status.js";

type VkCommandAdapterCompat = NonNullable<ChannelPlugin<ResolvedVkAccount, VkProbeResult>["commands"]> & {
  buildToolsGroupListChannelData?: typeof buildVkToolsGroupListChannelData;
  buildToolsListChannelData?: typeof buildVkToolsListChannelData;
  buildToolDetailsChannelData?: typeof buildVkToolDetailsChannelData;
};

export const vkPlugin: ChannelPlugin<ResolvedVkAccount, VkProbeResult> = createChatChannelPlugin({
  base: {
    id: "vk",
    ...vkChannelPluginCommon,
    setup: vkSetupAdapter,
    status: vkStatusAdapter,
    messaging: vkMessagingAdapter,
    commands: {
      buildCommandsListChannelData: buildVkCommandsListChannelData,
      buildModelsProviderChannelData: buildVkModelsProviderChannelData,
      buildModelsListChannelData: buildVkModelsListChannelData,
      buildModelBrowseChannelData: buildVkModelBrowseChannelData,
      buildToolsGroupListChannelData: buildVkToolsGroupListChannelData,
      buildToolsListChannelData: buildVkToolsListChannelData,
      buildToolDetailsChannelData: buildVkToolDetailsChannelData,
    } as VkCommandAdapterCompat,
    groups: {
      resolveRequireMention: resolveVkGroupRequireMention,
    },
    secrets: {
      secretTargetRegistryEntries,
      collectRuntimeConfigAssignments,
    },
    gateway: vkGatewayAdapter,
    agentPrompt: {
      messageToolCapabilities: () => ["inlineButtons"],
    },
    actions: vkMessageActions,
  },
  pairing: {
    text: {
      idLabel: "vkUserId",
      message: "OpenClaw: your VK access has been approved.",
      normalizeAllowEntry: createPairingPrefixStripper(/^vk:(?:user:)?/i),
      notify: async ({ cfg, id, message, accountId }) => {
        const account = resolveVkAccount({
          cfg,
          accountId,
        });
        await sendVkText({
          account,
          peerId: id,
          text: message,
        });
      },
    },
  },
  security: vkSecurityAdapter,
  outbound: vkOutboundAdapter,
});
