import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "vk",
  name: "VK",
  description: "VK channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./api.js",
    exportName: "vkPlugin",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setVkRuntime",
  },
});
