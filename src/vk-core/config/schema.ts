import {
  DEFAULT_VK_ACCOUNT_ID,
  DEFAULT_VK_API_VERSION,
  DEFAULT_VK_TRANSPORT,
  type VkAccountConfig,
  type VkCallbackConfig,
  type VkConfig,
  type VkConfigIssue,
  type VkDmPolicy,
  type VkGroupChatConfig,
  type VkGroupPolicy,
  type VkTransport,
} from "../types/config.js";

export class VkConfigError extends Error {
  readonly issues: VkConfigIssue[];

  constructor(issues: VkConfigIssue[]) {
    super(
      `Invalid VK config: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
    );
    this.name = "VkConfigError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeGroupId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return undefined;
}

function normalizeTransport(value: unknown): VkTransport | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  switch (normalized) {
    case "longpoll":
    case "long-poll":
      return "long-poll";
    default:
      return undefined;
  }
}

function normalizeDmPolicy(value: unknown): VkDmPolicy | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  switch (normalized) {
    case "pairing":
    case "allowlist":
    case "open":
    case "disabled":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeGroupPolicy(value: unknown): VkGroupPolicy | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  switch (normalized) {
    case "allowlist":
    case "open":
    case "disabled":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeAllowFrom(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        return String(entry);
      }
      if (typeof entry === "string") {
        return entry.trim();
      }
      return "";
    })
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeGroupConfig(
  value: unknown,
  path: string,
  issues: VkConfigIssue[],
): VkGroupChatConfig | undefined {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return undefined;
  }

  return withDefinedValues({
    enabled: normalizeBoolean(value.enabled),
    allowFrom: normalizeAllowFrom(value.allowFrom),
    requireMention: normalizeBoolean(value.requireMention),
  });
}

function normalizeGroups(
  value: unknown,
  path: string,
  issues: VkConfigIssue[],
): Record<string, VkGroupChatConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object map" });
    return undefined;
  }

  const groups: Record<string, VkGroupChatConfig> = {};
  for (const [groupId, groupValue] of Object.entries(value)) {
    const normalizedGroupId = normalizeString(groupId);
    if (!normalizedGroupId) {
      issues.push({
        path,
        message: "group ids must be non-empty strings",
      });
      continue;
    }

    const normalizedGroup = normalizeGroupConfig(
      groupValue,
      `${path}.${normalizedGroupId}`,
      issues,
    );
    if (normalizedGroup) {
      groups[normalizedGroupId] = normalizedGroup;
    }
  }

  return Object.keys(groups).length > 0 ? groups : undefined;
}

function withDefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function normalizeCallback(value: unknown): VkCallbackConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const path = normalizeString(value.path);
  const secret = normalizeString(value.secret);
  const confirmationCode = normalizeString(value.confirmationCode);
  const normalizedPath = path ? (path.startsWith("/") ? path : `/${path}`) : undefined;

  if (!normalizedPath && !secret && !confirmationCode) {
    return undefined;
  }

  return withDefinedValues({
    path: normalizedPath,
    secret,
    confirmationCode,
  });
}

function parseAccountConfig(
  value: unknown,
  path: string,
  issues: VkConfigIssue[],
): Partial<VkAccountConfig> {
  if (!isRecord(value)) {
    issues.push({ path, message: "expected an object" });
    return {};
  }

  const groupId = normalizeGroupId(value.groupId);
  if (value.groupId !== undefined && groupId === undefined) {
    issues.push({
      path: `${path}.groupId`,
      message: "must be a positive integer",
    });
  }

  const transport = normalizeTransport(value.transport);
  if (value.transport !== undefined && transport === undefined) {
    issues.push({
      path: `${path}.transport`,
      message: "must be long-poll; callback-api is archived on the callback branch",
    });
  }

  const dmPolicy = normalizeDmPolicy(value.dmPolicy);
  if (value.dmPolicy !== undefined && dmPolicy === undefined) {
    issues.push({
      path: `${path}.dmPolicy`,
      message: "must be pairing, allowlist, open, or disabled",
    });
  }

  const groupPolicy = normalizeGroupPolicy(value.groupPolicy);
  if (value.groupPolicy !== undefined && groupPolicy === undefined) {
    issues.push({
      path: `${path}.groupPolicy`,
      message: "must be allowlist, open, or disabled",
    });
  }

  const callback = normalizeCallback(value.callback);
  if (value.callback !== undefined && callback === undefined) {
    issues.push({ path: `${path}.callback`, message: "must be an object" });
  }

  const groups = normalizeGroups(value.groups, `${path}.groups`, issues);

  return withDefinedValues({
    name: normalizeString(value.name),
    enabled: normalizeBoolean(value.enabled),
    groupId,
    accessToken: normalizeString(value.accessToken),
    tokenFile: normalizeString(value.tokenFile),
    transport,
    apiVersion: normalizeString(value.apiVersion) ?? DEFAULT_VK_API_VERSION,
    callback,
    dmPolicy,
    allowFrom: normalizeAllowFrom(value.allowFrom),
    groupPolicy,
    groupAllowFrom: normalizeAllowFrom(value.groupAllowFrom),
    groups,
  });
}

function hasBaseAccountConfig(config: VkConfig): boolean {
  return Boolean(
    config.name ||
    config.groupId ||
    config.accessToken ||
    config.tokenFile ||
    config.callback ||
    config.defaultAccount ||
    config.transport ||
    config.allowFrom?.length ||
    config.groupAllowFrom?.length ||
    config.dmPolicy ||
    config.groupPolicy ||
    config.groups ||
    config.enabled !== undefined,
  );
}

export function parseVkConfig(input: unknown): VkConfig {
  const issues: VkConfigIssue[] = [];
  const root = isRecord(input) ? input : {};
  if (input !== undefined && !isRecord(input)) {
    issues.push({ path: "channels.vk", message: "expected an object" });
  }

  const rootConfig = parseAccountConfig(root, "channels.vk", issues);
  const config: VkConfig = {
    ...rootConfig,
    transport: rootConfig.transport ?? DEFAULT_VK_TRANSPORT,
    apiVersion: rootConfig.apiVersion ?? DEFAULT_VK_API_VERSION,
  };

  const defaultAccount = normalizeString(root.defaultAccount);
  if (root.defaultAccount !== undefined && !defaultAccount) {
    issues.push({
      path: "channels.vk.defaultAccount",
      message: "must be a non-empty string",
    });
  }
  if (defaultAccount) {
    config.defaultAccount = defaultAccount;
  }

  if (root.accounts !== undefined) {
    if (!isRecord(root.accounts)) {
      issues.push({
        path: "channels.vk.accounts",
        message: "must be an object map",
      });
    } else {
      const accounts: Record<string, Partial<VkAccountConfig>> = {};
      for (const [accountId, accountValue] of Object.entries(root.accounts)) {
        const normalizedAccountId = normalizeString(accountId);
        if (!normalizedAccountId) {
          issues.push({
            path: "channels.vk.accounts",
            message: "account ids must be non-empty strings",
          });
          continue;
        }

        accounts[normalizedAccountId] = parseAccountConfig(
          accountValue,
          `channels.vk.accounts.${normalizedAccountId}`,
          issues,
        );
      }

      if (Object.keys(accounts).length > 0) {
        config.accounts = accounts;
      }
    }
  }

  if (config.defaultAccount) {
    const defaultAccountIsBase = config.defaultAccount === DEFAULT_VK_ACCOUNT_ID;
    const defaultAccountExists = Boolean(config.accounts?.[config.defaultAccount]);
    if (!defaultAccountIsBase && !defaultAccountExists) {
      issues.push({
        path: "channels.vk.defaultAccount",
        message: "must point to an existing account id",
      });
    }
  }

  if (!config.defaultAccount && !config.accounts && !hasBaseAccountConfig(config)) {
    config.defaultAccount = DEFAULT_VK_ACCOUNT_ID;
  }

  if (issues.length > 0) {
    throw new VkConfigError(issues);
  }

  return config;
}
