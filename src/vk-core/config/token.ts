import {
  DEFAULT_VK_ACCOUNT_ID,
  type VkAccountConfig,
  type VkConfig,
  type VkTokenSource,
} from "../types/config.js";
import { readSecretFile } from "../utils/file.js";
import { resolveSecretValue } from "../utils/secret.js";

export type VkTokenResolution = {
  token: string;
  source: VkTokenSource;
  error?: string;
};

function resolveConfiguredToken(
  config: Partial<VkAccountConfig> | undefined,
  env: NodeJS.ProcessEnv,
): VkTokenResolution {
  const directToken = resolveSecretValue(config?.accessToken, env);
  if (directToken.value) {
    return {
      token: directToken.value,
      source: directToken.source,
    };
  }

  const fileToken = readSecretFile(config?.tokenFile, env);
  if (fileToken.value) {
    return {
      token: fileToken.value,
      source: "configFile",
    };
  }

  return {
    token: "",
    source: "none",
    error: directToken.error ?? fileToken.error,
  };
}

export function resolveVkToken(params: {
  config: VkConfig;
  accountId: string;
  env?: NodeJS.ProcessEnv;
}): VkTokenResolution {
  const env = params.env ?? process.env;
  const accountOverride = params.config.accounts?.[params.accountId];
  const accountDefinesOwnToken = Boolean(
    accountOverride &&
    (Object.prototype.hasOwnProperty.call(accountOverride, "accessToken") ||
      Object.prototype.hasOwnProperty.call(accountOverride, "tokenFile")),
  );

  if (accountDefinesOwnToken) {
    return resolveConfiguredToken(accountOverride, env);
  }

  const rootToken = resolveConfiguredToken(params.config, env);
  if (rootToken.token || rootToken.error) {
    return rootToken;
  }

  if (params.accountId === DEFAULT_VK_ACCOUNT_ID) {
    const envToken = env.VK_GROUP_TOKEN?.trim();
    if (envToken) {
      return {
        token: envToken,
        source: "env",
      };
    }
  }

  return {
    token: "",
    source: "none",
  };
}
