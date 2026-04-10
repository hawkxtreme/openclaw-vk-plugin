import type { VkConsentEvent } from "./access.js";
import type { VkMessageEvent } from "./callback.js";
import type { ResolvedVkAccount } from "./config.js";
import type { VkFormatData } from "./format.js";

export type VkLongPollServer = {
  key: string;
  server: string;
  ts: string;
};

export type VkLongPollResponse = {
  ts?: string;
  updates?: unknown[];
  failed?: number;
};

export type VkInboundMessage = {
  accountId: string;
  groupId: number;
  transport: "long-poll" | "callback-api";
  eventType: "message_new";
  eventId?: string;
  dedupeKey: string;
  messageId: string;
  conversationMessageId?: string;
  peerId: number;
  senderId: number;
  text: string;
  formatData?: VkFormatData;
  messagePayload?: unknown;
  editConversationMessageId?: string;
  createdAt: number;
  isGroupChat: boolean;
  rawUpdate: unknown;
};

export type VkLongPollMonitorState = "idle" | "starting" | "running" | "reconnecting" | "stopped";

export type VkLongPollMonitorStatus = {
  state: VkLongPollMonitorState;
  active: boolean;
  connected: boolean;
  accountId: string;
  groupId?: number;
  transport: "long-poll";
  server?: string;
  ts?: string;
  receivedEvents: number;
  deliveredEvents: number;
  dedupedEvents: number;
  reconnectAttempts: number;
  lastConnectedAt?: number;
  lastDisconnectAt?: number;
  lastInboundAt?: number;
  lastEventAt?: number;
  lastReconnectAt?: number;
  lastError?: string;
  stopReason?: string;
};

export type VkLongPollLogger = {
  debug?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type VkLongPollMonitorOptions = {
  account: ResolvedVkAccount;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
  waitSeconds?: number;
  reconnectDelayMs?: number;
  dedupeMaxEntries?: number;
  onMessage: (message: VkInboundMessage) => void | Promise<void>;
  onConsent?: (event: VkConsentEvent) => void | Promise<void>;
  onInteractiveEvent?: (event: VkMessageEvent) => void | Promise<void>;
  onStatusChange?: (status: VkLongPollMonitorStatus) => void;
  logger?: VkLongPollLogger;
  now?: () => number;
};

export type VkLongPollMonitor = {
  start: () => Promise<void>;
  stop: (reason?: string) => void;
  getStatus: () => VkLongPollMonitorStatus;
};
