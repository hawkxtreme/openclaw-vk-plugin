import type { VkMessageEvent } from "../types/callback.js";

type VkMessageEventEnvelope = {
  type?: unknown;
  group_id?: unknown;
  event_id?: unknown;
  object?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toFiniteInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized || undefined;
}

function parsePayload(value: unknown): {
  payload?: unknown;
  rawPayload?: string;
} {
  if (typeof value !== "string") {
    return {
      payload: value,
      rawPayload: value === undefined ? undefined : JSON.stringify(value),
    };
  }

  const rawPayload = value.trim();
  if (!rawPayload) {
    return {
      payload: undefined,
      rawPayload: "",
    };
  }

  try {
    return {
      payload: JSON.parse(rawPayload) as unknown,
      rawPayload,
    };
  } catch {
    return {
      payload: rawPayload,
      rawPayload,
    };
  }
}

export function normalizeVkMessageEventUpdate(params: {
  accountId: string;
  groupId: number;
  update: unknown;
  transport?: VkMessageEvent["transport"];
  now?: () => number;
}): VkMessageEvent | null {
  const envelope = asRecord(params.update) as VkMessageEventEnvelope | null;
  if (!envelope || envelope.type !== "message_event") {
    return null;
  }

  const updateGroupId = toFiniteInteger(envelope.group_id);
  if (updateGroupId !== null && updateGroupId !== params.groupId) {
    return null;
  }

  const eventObject = asRecord(envelope.object);
  if (!eventObject) {
    return null;
  }

  const senderId = toFiniteInteger(eventObject.user_id);
  const peerId = toFiniteInteger(eventObject.peer_id);
  const callbackEventId = toOptionalString(eventObject.event_id);
  if (!senderId || !peerId || !callbackEventId) {
    return null;
  }

  const eventId = toOptionalString(envelope.event_id);
  const { payload, rawPayload } = parsePayload(eventObject.payload);
  const createdAtSeconds = toFiniteInteger(eventObject.date ?? eventObject.update_time);

  return {
    accountId: params.accountId,
    groupId: params.groupId,
    transport: params.transport ?? "callback-api",
    eventType: "message_event",
    eventId,
    dedupeKey: eventId
      ? `event:${eventId}`
      : `interactive:${callbackEventId}:${String(senderId)}:${String(peerId)}`,
    callbackEventId,
    senderId,
    peerId,
    conversationMessageId: toOptionalString(eventObject.conversation_message_id),
    payload,
    rawPayload,
    createdAt: createdAtSeconds ? createdAtSeconds * 1000 : params.now ? params.now() : undefined,
    rawUpdate: params.update,
  };
}
