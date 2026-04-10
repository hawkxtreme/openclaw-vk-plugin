export type {
  ChannelPlugin,
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
} from "openclaw/plugin-sdk/core";
export { vkPlugin } from "./src/channel.js";
export { vkSetupPlugin } from "./src/channel.setup.js";
export { setVkRuntime, clearVkRuntime, getVkRuntime, tryGetVkRuntime } from "./src/runtime.js";
export * from "./src/vk-core/index.js";
export * from "./src/config-schema.js";
export * from "./src/gateway.js";
export * from "./src/inbound.js";
export * from "./src/outbound.js";
export * from "./src/setup-core.js";
export * from "./src/status.js";
export {
  DEFAULT_ACCOUNT_ID,
  getVkConfig,
  hasVkCredentials,
  normalizeVkAccountId,
} from "./src/accounts.js";
export type {
  OpenClawConfig as VkHostOpenClawConfig,
  ResolvedVkPluginAccount,
  VkPluginConfig,
  VkRuntime,
} from "./src/types.js";
