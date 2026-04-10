import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { type ResolvedVkAccount } from "./accounts.js";
import { vkChannelPluginCommon } from "./channel-shared.js";
import { vkSetupAdapter } from "./setup-core.js";

export const vkSetupPlugin: ChannelPlugin<ResolvedVkAccount> = {
  id: "vk",
  ...vkChannelPluginCommon,
  setup: vkSetupAdapter,
};
