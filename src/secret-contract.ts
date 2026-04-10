import {
  collectSecretInputAssignment,
  getChannelSurface,
  hasOwnProperty,
  type ResolverContext,
  type SecretDefaults,
  type SecretTargetRegistryEntry,
} from "openclaw/plugin-sdk/security-runtime";

function hasOwnVkTokenSource(account: Record<string, unknown>): boolean {
  return hasOwnProperty(account, "accessToken") || hasOwnProperty(account, "tokenFile");
}

export const secretTargetRegistryEntries = [
  {
    id: "channels.vk.accounts.*.accessToken",
    targetType: "channels.vk.accounts.*.accessToken",
    configFile: "openclaw.json",
    pathPattern: "channels.vk.accounts.*.accessToken",
    secretShape: "secret_input",
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: true,
    includeInAudit: true,
  },
  {
    id: "channels.vk.accessToken",
    targetType: "channels.vk.accessToken",
    configFile: "openclaw.json",
    pathPattern: "channels.vk.accessToken",
    secretShape: "secret_input",
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: true,
    includeInAudit: true,
  },
] satisfies SecretTargetRegistryEntry[];

export function collectRuntimeConfigAssignments(params: {
  config: { channels?: Record<string, unknown> };
  defaults: SecretDefaults | undefined;
  context: ResolverContext;
}): void {
  const resolved = getChannelSurface(params.config, "vk");
  if (!resolved) {
    return;
  }

  const { channel: vk, surface } = resolved;
  collectSecretInputAssignment({
    value: vk.accessToken,
    path: "channels.vk.accessToken",
    expected: "string",
    defaults: params.defaults,
    context: params.context,
    active:
      surface.channelEnabled &&
      (!surface.hasExplicitAccounts ||
        surface.accounts.some(({ account, enabled }) => enabled && !hasOwnVkTokenSource(account))),
    inactiveReason:
      "no enabled VK surface inherits this top-level accessToken because every enabled account defines its own token source.",
    apply: (value) => {
      vk.accessToken = value;
    },
  });

  if (!surface.hasExplicitAccounts) {
    return;
  }

  for (const { accountId, account, enabled } of surface.accounts) {
    if (hasOwnProperty(account, "accessToken")) {
      collectSecretInputAssignment({
        value: account.accessToken,
        path: `channels.vk.accounts.${accountId}.accessToken`,
        expected: "string",
        defaults: params.defaults,
        context: params.context,
        active: enabled,
        inactiveReason: "VK account is disabled.",
        apply: (value) => {
          account.accessToken = value;
        },
      });
    }
  }
}
