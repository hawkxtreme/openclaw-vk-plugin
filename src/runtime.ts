import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { VkRuntime } from "./types.js";

const {
  setRuntime: setVkRuntime,
  clearRuntime: clearVkRuntime,
  tryGetRuntime: tryGetVkRuntime,
  getRuntime: getVkRuntime,
} = createPluginRuntimeStore<VkRuntime>(
  "VK runtime not initialized - plugin not registered",
);

export { clearVkRuntime, getVkRuntime, setVkRuntime, tryGetVkRuntime };
