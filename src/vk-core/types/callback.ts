import type { VkConsentEvent } from "./access.js";
import type { ResolvedVkAccount } from "./config.js";
import type { VkInboundMessage } from "./longpoll.js";

export type VkCallbackEnvelope = {
  type?: unknown;
  group_id?: unknown;
  event_id?: unknown;
  secret?: unknown;
  object?: unknown;
  v?: unknown;
};

export type VkMessageEvent = {
  accountId: string;
  groupId: number;
  transport: "callback-api" | "long-poll";
  eventType: "message_event";
  eventId?: string;
  dedupeKey: string;
  callbackEventId: string;
  senderId: number;
  peerId: number;
  conversationMessageId?: string;
  payload?: unknown;
  rawPayload?: string;
  createdAt?: number;
  rawUpdate: unknown;
};

export type VkCallbackEvent =
  | {
      kind: "confirmation";
      account: ResolvedVkAccount;
      accountId: string;
      eventType: "confirmation";
      groupId: number;
    }
  | {
      kind: "message_new";
      account: ResolvedVkAccount;
      accountId: string;
      eventType: "message_new";
      groupId: number;
      message: VkInboundMessage;
    }
  | {
      kind: "consent";
      account: ResolvedVkAccount;
      accountId: string;
      eventType: VkConsentEvent["eventType"];
      groupId: number;
      consent: VkConsentEvent;
    }
  | {
      kind: "message_event";
      account: ResolvedVkAccount;
      accountId: string;
      eventType: "message_event";
      groupId: number;
      interactive: VkMessageEvent;
    }
  | {
      kind: "ignored";
      account: ResolvedVkAccount;
      accountId: string;
      eventType: string;
      groupId: number;
    };

export type VkWebhookRequest = {
  method: string;
  body?: string | unknown;
};

export type VkWebhookResponse = {
  statusCode: number;
  body: string;
  eventType: string;
  accountId?: string;
  duplicate?: boolean;
};

export type VkInteractiveEventAnswer = {
  eventData?: unknown;
};
