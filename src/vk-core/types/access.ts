import type { ResolvedVkAccount } from "./config.js";
import type { VkInboundMessage } from "./longpoll.js";

export type VkConsentState = "unknown" | "allowed" | "denied";
export type VkConsentEventType = "message_allow" | "message_deny";

export type VkConsentEvent = {
  accountId: string;
  groupId: number;
  eventType: VkConsentEventType;
  eventId?: string;
  dedupeKey: string;
  senderId: number;
  consentState: Exclude<VkConsentState, "unknown">;
  createdAt?: number;
  rawUpdate: unknown;
};

export type VkPairingRequest = {
  accountId: string;
  senderId: number;
  createdAt: number;
  lastRequestedAt: number;
  requestCount: number;
  text: string;
};

export type VkPairingApproval = {
  accountId: string;
  senderId: number;
  approvedAt: number;
  source: "pairing" | "manual";
};

export type VkAccessAllowDecision = {
  decision: "allow";
  reason: "dm-open" | "allowlist" | "paired" | "group-open" | "group-allowlist";
  senderId: number;
  consentState: VkConsentState;
  conversationKind: "direct" | "group";
  conversationId: string;
  wasMentioned: boolean;
};

export type VkAccessDenyDecision = {
  decision: "deny";
  reason:
    | "account-disabled"
    | "dm-disabled"
    | "not-allowlisted"
    | "consent-denied"
    | "group-not-supported"
    | "group-disabled"
    | "group-not-allowlisted"
    | "group-mention-required";
  senderId: number;
  consentState: VkConsentState;
  conversationKind: "direct" | "group";
  conversationId: string;
  wasMentioned: boolean;
};

export type VkAccessPairingDecision = {
  decision: "pairing";
  reason: "pairing-required";
  senderId: number;
  consentState: VkConsentState;
  conversationKind: "direct";
  conversationId: string;
  wasMentioned: false;
  challenge: VkPairingRequest;
};

export type VkAccessDecision =
  | VkAccessAllowDecision
  | VkAccessDenyDecision
  | VkAccessPairingDecision;

export type VkAccessControllerOptions = {
  now?: () => number;
  buildPairingChallengeText?: (params: {
    account: ResolvedVkAccount;
    senderId: number;
    requestCount: number;
  }) => string;
};

export type VkAccessController = {
  evaluateMessage: (params: {
    account: ResolvedVkAccount;
    message: VkInboundMessage;
  }) => VkAccessDecision;
  recordConsent: (event: VkConsentEvent) => void;
  approvePairing: (params: {
    accountId: string;
    senderId: number;
    source?: VkPairingApproval["source"];
  }) => VkPairingApproval;
  revokePairing: (params: { accountId: string; senderId: number }) => void;
  getPendingRequest: (params: {
    accountId: string;
    senderId: number;
  }) => VkPairingRequest | undefined;
  getConsentState: (params: {
    accountId: string;
    senderId: number;
  }) => VkConsentState;
  listApprovedSenders: (accountId: string) => number[];
};
