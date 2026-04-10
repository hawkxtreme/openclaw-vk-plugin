import { resolveVkAccount } from "./accounts.js";
import type { OpenClawConfig } from "./types.js";

export function resolveVkGroupRequireMention(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  groupId?: string | null;
}): boolean {
  const account = resolveVkAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const groupId = params.groupId?.trim();
  const exactGroup = groupId ? account.config.groups?.[groupId] : undefined;
  const wildcardGroup = account.config.groups?.["*"];
  return exactGroup?.requireMention ?? wildcardGroup?.requireMention ?? false;
}
