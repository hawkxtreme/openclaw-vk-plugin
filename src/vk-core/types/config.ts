export const DEFAULT_VK_ACCOUNT_ID = "default";
export const DEFAULT_VK_API_VERSION = "5.199";
export const DEFAULT_VK_TRANSPORT = "long-poll";

export type VkTransport = "callback-api" | "long-poll";
export type VkDmPolicy = "pairing" | "allowlist" | "open" | "disabled";
export type VkGroupPolicy = "allowlist" | "open" | "disabled";
export type VkTokenSource = "env" | "config" | "configFile" | "none";

export type VkCallbackConfig = {
  path?: string;
  secret?: string;
  confirmationCode?: string;
};

export type VkGroupChatConfig = {
  enabled?: boolean;
  allowFrom?: string[];
  requireMention?: boolean;
};

export type VkAccountConfig = {
  name?: string;
  enabled?: boolean;
  groupId?: number;
  accessToken?: string;
  tokenFile?: string;
  transport?: VkTransport;
  apiVersion?: string;
  callback?: VkCallbackConfig;
  dmPolicy?: VkDmPolicy;
  allowFrom?: string[];
  groupPolicy?: VkGroupPolicy;
  groupAllowFrom?: string[];
  groups?: Record<string, VkGroupChatConfig>;
};

export type VkConfig = VkAccountConfig & {
  accounts?: Record<string, Partial<VkAccountConfig>>;
  defaultAccount?: string;
};

export type ResolvedVkAccountConfig = Omit<
  VkAccountConfig,
  "callback" | "transport" | "apiVersion"
> & {
  callback: VkCallbackConfig;
  transport: VkTransport;
  apiVersion: string;
};

export type ResolvedVkAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: VkTokenSource;
  tokenError?: string;
  config: ResolvedVkAccountConfig;
};

export type VkGroupSummary = {
  id: number;
  name?: string;
  screenName?: string;
};

export type VkProbeResult =
  | {
      ok: true;
      accountId: string;
      tokenSource: VkTokenSource;
      group: VkGroupSummary;
    }
  | {
      ok: false;
      accountId: string;
      tokenSource: VkTokenSource;
      error: string;
    };

export type VkRuntimeStatus = {
  healthy: boolean;
  enabled: boolean;
  accountId: string;
  transport: VkTransport;
  tokenSource: VkTokenSource;
  groupId?: number;
  issue?: string;
};

export type VkChannelDefinition = {
  id: "vk";
  transport: VkTransport;
  defaultAccountId: string;
  apiVersion: string;
};

export type VkConfigIssue = {
  path: string;
  message: string;
};
