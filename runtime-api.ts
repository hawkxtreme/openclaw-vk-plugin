export type {
  ChannelPlugin,
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
} from "openclaw/plugin-sdk/core";
export { setVkRuntime, clearVkRuntime, getVkRuntime, tryGetVkRuntime } from "./src/runtime.js";
export type { VkRuntime } from "./src/types.js";
