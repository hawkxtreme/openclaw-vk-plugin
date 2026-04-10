import { getVkGroupsById, getVkLongPollSettings } from "../core/api.js";
import type { ResolvedVkAccount, VkProbeResult } from "../types/config.js";

const REQUIRED_LONG_POLL_EVENTS = [
  "message_new",
  "message_allow",
  "message_deny",
  "message_event",
] as const;

function isLongPollSettingEnabled(value: unknown): boolean {
  return value === true || value === 1;
}

export async function probeVkAccount(params: {
  account: ResolvedVkAccount;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<VkProbeResult> {
  const timeoutMs = params.timeoutMs ?? 2500;
  if (!params.account.token) {
    return {
      ok: false,
      accountId: params.account.accountId,
      tokenSource: params.account.tokenSource,
      error: params.account.tokenError ?? "VK token is not configured",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const groups = await getVkGroupsById({
      token: params.account.token,
      groupId: params.account.config.groupId,
      apiVersion: params.account.config.apiVersion,
      signal: controller.signal,
      fetchImpl: params.fetchImpl,
    });
    const group = groups[0];

    if (!group) {
      return {
        ok: false,
        accountId: params.account.accountId,
        tokenSource: params.account.tokenSource,
        error: "VK token did not resolve a group",
      };
    }

    if (params.account.config.groupId !== undefined && group.id !== params.account.config.groupId) {
      return {
        ok: false,
        accountId: params.account.accountId,
        tokenSource: params.account.tokenSource,
        error: `Configured groupId ${String(params.account.config.groupId)} does not match probed group ${String(group.id)}`,
      };
    }

    const settings = await getVkLongPollSettings({
      token: params.account.token,
      groupId: params.account.config.groupId ?? group.id,
      apiVersion: params.account.config.apiVersion,
      signal: controller.signal,
      fetchImpl: params.fetchImpl,
    });

    if (!isLongPollSettingEnabled(settings.is_enabled)) {
      return {
        ok: false,
        accountId: params.account.accountId,
        tokenSource: params.account.tokenSource,
        error:
          "VK Bots Long Poll is disabled. Enable Bots Long Poll API and the required events in VK community settings.",
      };
    }

    const missingEvents = REQUIRED_LONG_POLL_EVENTS.filter(
      (eventName) => !isLongPollSettingEnabled(settings.events?.[eventName]),
    );
    if (missingEvents.length > 0) {
      return {
        ok: false,
        accountId: params.account.accountId,
        tokenSource: params.account.tokenSource,
        error: `VK Bots Long Poll is missing required events: ${missingEvents.join(", ")}.`,
      };
    }

    return {
      ok: true,
      accountId: params.account.accountId,
      tokenSource: params.account.tokenSource,
      group,
    };
  } catch (error) {
    const isAbort =
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError");

    return {
      ok: false,
      accountId: params.account.accountId,
      tokenSource: params.account.tokenSource,
      error: isAbort
        ? `VK probe timed out after ${String(timeoutMs)}ms`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
