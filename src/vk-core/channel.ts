import { resolveDefaultVkAccountId } from "./config/accounts.js";
import { parseVkConfig } from "./config/schema.js";
import {
  DEFAULT_VK_API_VERSION,
  DEFAULT_VK_TRANSPORT,
  type VkChannelDefinition,
} from "./types/config.js";

export function createVkChannel(configInput?: unknown): VkChannelDefinition {
  const config = parseVkConfig(configInput);

  return {
    id: "vk",
    transport: config.transport ?? DEFAULT_VK_TRANSPORT,
    defaultAccountId: resolveDefaultVkAccountId(config),
    apiVersion: config.apiVersion ?? DEFAULT_VK_API_VERSION,
  };
}
