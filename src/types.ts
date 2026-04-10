import type {
  ChannelPlugin as BaseChannelPlugin,
  OpenClawConfig as BaseOpenClawConfig,
  PluginRuntime,
} from "openclaw/plugin-sdk/core";
import type { VkProbeResult } from "./vk-core/types/config.js";
import type { ResolvedVkAccount, VkConfig } from "./vk-core/index.js";

export type OpenClawConfig = BaseOpenClawConfig & {
  channels?: (BaseOpenClawConfig["channels"] & {
    vk?: VkConfig;
  }) | null;
};

export type ResolvedVkOfficialAccount = ResolvedVkAccount;
export type VkOfficialConfig = VkConfig;
export type VkPlugin = BaseChannelPlugin<ResolvedVkOfficialAccount, VkProbeResult>;
export type VkRuntime = PluginRuntime & {
  channel: PluginRuntime["channel"] & {
    vk?: {
      resolveVkAccount?: typeof import("./accounts.js").resolveVkAccount;
      probeVkAccount?: typeof import("./vk-core/setup/probe.js").probeVkAccount;
    };
  };
};
