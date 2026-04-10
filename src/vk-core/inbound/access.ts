import type {
  VkAccessController,
  VkAccessControllerOptions,
  VkAccessDecision,
  VkConsentEvent,
  VkConsentState,
  VkPairingApproval,
  VkPairingRequest,
} from "../types/access.js";
import type { ResolvedVkAccount } from "../types/config.js";
import type { VkInboundMessage } from "../types/longpoll.js";
import { isVkSlashCommandMessage } from "../../text-format.js";

type VkAccountAccessState = {
  approvals: Map<number, VkPairingApproval>;
  pendingRequests: Map<number, VkPairingRequest>;
  consent: Map<number, VkConsentEvent>;
};

function getAccountState(
  stateByAccount: Map<string, VkAccountAccessState>,
  accountId: string,
): VkAccountAccessState {
  let state = stateByAccount.get(accountId);
  if (!state) {
    state = {
      approvals: new Map<number, VkPairingApproval>(),
      pendingRequests: new Map<number, VkPairingRequest>(),
      consent: new Map<number, VkConsentEvent>(),
    };
    stateByAccount.set(accountId, state);
  }

  return state;
}

function normalizeAllowEntry(entry: string): string | "*" | null {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === "*") {
    return "*";
  }

  const normalized = trimmed.replace(/^vk:(?:user:)?/i, "");
  return /^\d+$/.test(normalized) ? normalized : null;
}

function isSenderAllowlisted(
  allowFrom: string[] | undefined,
  senderId: number,
): boolean {
  const sender = String(senderId);

  for (const entry of allowFrom ?? []) {
    const normalized = normalizeAllowEntry(entry);
    if (!normalized) {
      continue;
    }
    if (normalized === "*" || normalized === sender) {
      return true;
    }
  }

  return false;
}

function resolveConversationKind(
  message: VkInboundMessage,
): "direct" | "group" {
  return message.isGroupChat ? "group" : "direct";
}

function resolveConversationId(message: VkInboundMessage): string {
  return String(message.isGroupChat ? message.peerId : message.senderId);
}

function resolveGroupConfig(
  account: ResolvedVkAccount,
  peerId: number,
): NonNullable<ResolvedVkAccount["config"]["groups"]>[string] | undefined {
  const wildcard = account.config.groups?.["*"];
  const specific = account.config.groups?.[String(peerId)];

  if (!wildcard && !specific) {
    return undefined;
  }

  return {
    ...wildcard,
    ...specific,
  };
}

function wasVkGroupMentioned(
  text: string,
  groupId: number | undefined,
): boolean {
  if (!groupId) {
    return false;
  }

  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes(`[club${String(groupId)}|`) ||
    normalized.includes(`[public${String(groupId)}|`) ||
    normalized.includes(`@club${String(groupId)}`) ||
    normalized.includes(`@public${String(groupId)}`) ||
    normalized.includes(`club${String(groupId)}`) ||
    normalized.includes(`public${String(groupId)}`)
  );
}

function buildDefaultPairingChallengeText(params: {
  senderId: number;
  requestCount: number;
}): string {
  const prefix =
    params.requestCount > 1
      ? "Access is still waiting for approval."
      : "Access to this VK bot requires approval.";

  return `${prefix} Your VK user id: ${String(params.senderId)}. Approve the pairing request or add this id to allowFrom.`;
}

function resolveConsentState(
  stateByAccount: Map<string, VkAccountAccessState>,
  accountId: string,
  senderId: number,
): VkConsentState {
  const event = stateByAccount.get(accountId)?.consent.get(senderId);
  return event?.consentState ?? "unknown";
}

function createPairingRequest(params: {
  account: ResolvedVkAccount;
  senderId: number;
  existingRequest?: VkPairingRequest;
  now: number;
  buildPairingChallengeText?: VkAccessControllerOptions["buildPairingChallengeText"];
}): VkPairingRequest {
  const requestCount = (params.existingRequest?.requestCount ?? 0) + 1;
  const createdAt = params.existingRequest?.createdAt ?? params.now;
  const text =
    params.buildPairingChallengeText?.({
      account: params.account,
      senderId: params.senderId,
      requestCount,
    }) ??
    buildDefaultPairingChallengeText({
      senderId: params.senderId,
      requestCount,
    });

  return {
    accountId: params.account.accountId,
    senderId: params.senderId,
    createdAt,
    lastRequestedAt: params.now,
    requestCount,
    text,
  };
}

export function createVkAccessController(
  options: VkAccessControllerOptions = {},
): VkAccessController {
  const now = options.now ?? Date.now;
  const stateByAccount = new Map<string, VkAccountAccessState>();

  function evaluateMessage(params: {
    account: ResolvedVkAccount;
    message: VkInboundMessage;
  }): VkAccessDecision {
    const conversationKind = resolveConversationKind(params.message);
    const conversationId = resolveConversationId(params.message);
    const accountState = getAccountState(
      stateByAccount,
      params.account.accountId,
    );
    const consentState = resolveConsentState(
      stateByAccount,
      params.account.accountId,
      params.message.senderId,
    );

    if (!params.account.enabled) {
      return {
        decision: "deny",
        reason: "account-disabled",
        senderId: params.message.senderId,
        consentState,
        conversationKind,
        conversationId,
        wasMentioned: false,
      };
    }

    if (params.message.isGroupChat) {
      const groupConfig = resolveGroupConfig(
        params.account,
        params.message.peerId,
      );
      const groupPolicy =
        groupConfig?.enabled === false
          ? "disabled"
          : (params.account.config.groupPolicy ?? "disabled");
      const groupAllowFrom =
        groupConfig?.allowFrom ?? params.account.config.groupAllowFrom;
      const mentioned = wasVkGroupMentioned(
        params.message.text,
        params.account.config.groupId,
      );

      if (groupPolicy === "disabled") {
        return {
          decision: "deny",
          reason: "group-disabled",
          senderId: params.message.senderId,
          consentState,
          conversationKind,
          conversationId,
          wasMentioned: mentioned,
        };
      }

      if (
        groupConfig?.requireMention &&
        !mentioned &&
        !isVkSlashCommandMessage(params.message)
      ) {
        return {
          decision: "deny",
          reason: "group-mention-required",
          senderId: params.message.senderId,
          consentState,
          conversationKind,
          conversationId,
          wasMentioned: mentioned,
        };
      }

      if (groupPolicy === "allowlist") {
        if (!isSenderAllowlisted(groupAllowFrom, params.message.senderId)) {
          return {
            decision: "deny",
            reason: "group-not-allowlisted",
            senderId: params.message.senderId,
            consentState,
            conversationKind,
            conversationId,
            wasMentioned: mentioned,
          };
        }

        return {
          decision: "allow",
          reason: "group-allowlist",
          senderId: params.message.senderId,
          consentState,
          conversationKind,
          conversationId,
          wasMentioned: mentioned,
        };
      }

      return {
        decision: "allow",
        reason: "group-open",
        senderId: params.message.senderId,
        consentState,
        conversationKind,
        conversationId,
        wasMentioned: mentioned,
      };
    }

    if (consentState === "denied") {
      return {
        decision: "deny",
        reason: "consent-denied",
        senderId: params.message.senderId,
        consentState,
        conversationKind,
        conversationId,
        wasMentioned: false,
      };
    }

    const isAllowlisted = isSenderAllowlisted(
      params.account.config.allowFrom,
      params.message.senderId,
    );
    const isPaired = accountState.approvals.has(params.message.senderId);
    const dmPolicy = params.account.config.dmPolicy ?? "pairing";

    if (isAllowlisted) {
      return {
        decision: "allow",
        reason: "allowlist",
        senderId: params.message.senderId,
        consentState,
        conversationKind,
        conversationId,
        wasMentioned: false,
      };
    }

    if (isPaired) {
      return {
        decision: "allow",
        reason: "paired",
        senderId: params.message.senderId,
        consentState,
        conversationKind,
        conversationId,
        wasMentioned: false,
      };
    }

    if (dmPolicy === "open") {
      return {
        decision: "allow",
        reason: "dm-open",
        senderId: params.message.senderId,
        consentState,
        conversationKind,
        conversationId,
        wasMentioned: false,
      };
    }

    if (dmPolicy === "disabled") {
      return {
        decision: "deny",
        reason: "dm-disabled",
        senderId: params.message.senderId,
        consentState,
        conversationKind,
        conversationId,
        wasMentioned: false,
      };
    }

    if (dmPolicy === "allowlist") {
      return {
        decision: "deny",
        reason: "not-allowlisted",
        senderId: params.message.senderId,
        consentState,
        conversationKind,
        conversationId,
        wasMentioned: false,
      };
    }

    const request = createPairingRequest({
      account: params.account,
      senderId: params.message.senderId,
      existingRequest: accountState.pendingRequests.get(
        params.message.senderId,
      ),
      now: now(),
      buildPairingChallengeText: options.buildPairingChallengeText,
    });
    accountState.pendingRequests.set(params.message.senderId, request);

    return {
      decision: "pairing",
      reason: "pairing-required",
      senderId: params.message.senderId,
      consentState,
      conversationKind: "direct",
      conversationId: String(params.message.senderId),
      wasMentioned: false,
      challenge: request,
    };
  }

  return {
    evaluateMessage,
    recordConsent(event: VkConsentEvent) {
      const accountState = getAccountState(stateByAccount, event.accountId);
      accountState.consent.set(event.senderId, event);

      if (event.consentState === "denied") {
        accountState.approvals.delete(event.senderId);
        accountState.pendingRequests.delete(event.senderId);
      }
    },
    approvePairing(params) {
      const accountState = getAccountState(stateByAccount, params.accountId);
      const approval: VkPairingApproval = {
        accountId: params.accountId,
        senderId: params.senderId,
        approvedAt: now(),
        source: params.source ?? "pairing",
      };

      accountState.approvals.set(params.senderId, approval);
      accountState.pendingRequests.delete(params.senderId);

      return approval;
    },
    revokePairing(params) {
      const accountState = getAccountState(stateByAccount, params.accountId);
      accountState.approvals.delete(params.senderId);
      accountState.pendingRequests.delete(params.senderId);
    },
    getPendingRequest(params) {
      return stateByAccount
        .get(params.accountId)
        ?.pendingRequests.get(params.senderId);
    },
    getConsentState(params) {
      return resolveConsentState(
        stateByAccount,
        params.accountId,
        params.senderId,
      );
    },
    listApprovedSenders(accountId) {
      return Array.from(
        stateByAccount.get(accountId)?.approvals.keys() ?? [],
      ).sort((left, right) => left - right);
    },
  };
}
