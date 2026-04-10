import type { VkInboundMessage } from "../types/longpoll.js";
import { parseVkFormatData } from "../types/format.js";

const VK_GROUP_CHAT_PEER_ID_MIN = 2_000_000_000;

type VkUpdateEnvelope = {
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

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const raw = value.trim();
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function resolveMessageRecord(
  update: VkUpdateEnvelope,
): Record<string, unknown> | null {
  const updateObject = asRecord(update.object);
  if (!updateObject) {
    return null;
  }

  return asRecord(updateObject.message) ?? updateObject;
}

function resolveMessageId(message: Record<string, unknown>): string | null {
  return (
    toOptionalString(message.id) ??
    toOptionalString(message.conversation_message_id) ??
    toOptionalString(message.date) ??
    null
  );
}

function resolveDedupeKey(params: {
  eventId?: string;
  peerId: number;
  senderId: number;
  messageId: string;
  createdAt: number;
  text: string;
}): string {
  if (params.eventId) {
    return `event:${params.eventId}`;
  }

  return `message:${String(params.peerId)}:${String(params.senderId)}:${params.messageId}:${String(params.createdAt)}:${params.text}`;
}

export function normalizeVkMessageNewUpdate(params: {
  accountId: string;
  groupId: number;
  update: unknown;
  transport?: VkInboundMessage["transport"];
  now?: () => number;
}): VkInboundMessage | null {
  const envelope = asRecord(params.update) as VkUpdateEnvelope | null;
  if (!envelope || envelope.type !== "message_new") {
    return null;
  }

  const updateGroupId = toFiniteInteger(envelope.group_id);
  if (updateGroupId !== null && updateGroupId !== params.groupId) {
    return null;
  }

  const message = resolveMessageRecord(envelope);
  if (!message) {
    return null;
  }

  const peerId = toFiniteInteger(message.peer_id ?? message.from_id);
  const senderId = toFiniteInteger(message.from_id ?? message.peer_id);
  const messageId = resolveMessageId(message);
  const isOutgoing = Number(message.out ?? 0) === 1;

  if (!peerId || !senderId || !messageId || isOutgoing) {
    return null;
  }

  const eventId = toOptionalString(envelope.event_id);
  const text = String(message.text ?? "");
  const createdAtSeconds = toFiniteInteger(message.date);
  const createdAt = createdAtSeconds
    ? createdAtSeconds * 1000
    : (params.now ?? Date.now)();
  const conversationMessageId = toOptionalString(
    message.conversation_message_id,
  );
  const formatData = parseVkFormatData(message.format_data);
  const messagePayload = parsePayload(message.payload ?? message.message_payload);

  return {
    accountId: params.accountId,
    groupId: params.groupId,
    transport: params.transport ?? "long-poll",
    eventType: "message_new",
    eventId,
    dedupeKey: resolveDedupeKey({
      eventId,
      peerId,
      senderId,
      messageId,
      createdAt,
      text,
    }),
    messageId,
    conversationMessageId,
    peerId,
    senderId,
    text,
    formatData,
    messagePayload,
    createdAt,
    isGroupChat: peerId >= VK_GROUP_CHAT_PEER_ID_MIN,
    rawUpdate: params.update,
  };
}
