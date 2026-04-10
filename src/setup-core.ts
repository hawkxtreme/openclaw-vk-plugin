import type { ChannelSetupAdapter } from "openclaw/plugin-sdk/setup";
import { DEFAULT_ACCOUNT_ID, getVkConfig, normalizeVkAccountId } from "./accounts.js";
import type { OpenClawConfig } from "./types.js";

export function patchVkAccountConfig(params: {
  cfg: OpenClawConfig;
  accountId: string;
  patch: Record<string, unknown>;
  clearFields?: string[];
  enabled?: boolean;
}): OpenClawConfig {
  const accountId = normalizeVkAccountId(params.accountId);
  const vkConfig = getVkConfig(params.cfg);
  const clearFields = params.clearFields ?? [];

  if (accountId === DEFAULT_ACCOUNT_ID) {
    const nextVk = { ...vkConfig } as Record<string, unknown>;
    for (const field of clearFields) {
      delete nextVk[field];
    }
    return {
      ...params.cfg,
      channels: {
        ...params.cfg.channels,
        vk: {
          ...nextVk,
          ...(params.enabled ? { enabled: true } : {}),
          ...params.patch,
        },
      },
    };
  }

  const nextAccount = {
    ...(vkConfig.accounts?.[accountId] ?? {}),
  } as Record<string, unknown>;
  for (const field of clearFields) {
    delete nextAccount[field];
  }

  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      vk: {
        ...vkConfig,
        ...(params.enabled ? { enabled: true } : {}),
        accounts: {
          ...vkConfig.accounts,
          [accountId]: {
            ...nextAccount,
            ...(params.enabled ? { enabled: true } : {}),
            ...params.patch,
          },
        },
      },
    },
  };
}

export const vkSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeVkAccountId(accountId),
  applyAccountName: ({ cfg, accountId, name }) =>
    patchVkAccountConfig({
      cfg: cfg as OpenClawConfig,
      accountId,
      patch: name?.trim() ? { name: name.trim() } : {},
    }),
  validateInput: ({ input }) => {
    if (input.useEnv) {
      return null;
    }
    if (input.accessToken?.trim() || input.token?.trim() || input.tokenFile?.trim()) {
      return null;
    }
    return "VK requires a community access token, token file, or --use-env.";
  },
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const token = input.accessToken?.trim() || input.token?.trim();
    return patchVkAccountConfig({
      cfg: cfg as OpenClawConfig,
      accountId,
      enabled: true,
      clearFields: input.useEnv ? ["accessToken", "tokenFile", "callback"] : ["callback"],
      patch: input.useEnv
        ? {}
        : {
            transport: "long-poll",
            ...(input.tokenFile?.trim()
              ? { tokenFile: input.tokenFile.trim() }
              : token
                ? { accessToken: token }
                : {}),
          },
    });
  },
};
