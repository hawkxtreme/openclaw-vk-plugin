import type { VkConsentEvent } from "../types/access.js";

type VkConsentEnvelope = {
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

export function normalizeVkConsentUpdate(params: {
  accountId: string;
  groupId: number;
  update: unknown;
  now?: () => number;
}): VkConsentEvent | null {
  const envelope = asRecord(params.update) as VkConsentEnvelope | null;
  if (!envelope) {
    return null;
  }

  const eventType =
    envelope.type === "message_allow" || envelope.type === "message_deny"
      ? envelope.type
      : null;
  if (!eventType) {
    return null;
  }

  const updateGroupId = toFiniteInteger(envelope.group_id);
  if (updateGroupId !== null && updateGroupId !== params.groupId) {
    return null;
  }

  const consentObject = asRecord(envelope.object);
  if (!consentObject) {
    return null;
  }

  const senderId = toFiniteInteger(
    consentObject.user_id ?? consentObject.from_id ?? consentObject.peer_id,
  );
  if (!senderId) {
    return null;
  }

  const eventId = toOptionalString(envelope.event_id);
  const createdAtSeconds = toFiniteInteger(
    consentObject.date ?? consentObject.update_time,
  );

  return {
    accountId: params.accountId,
    groupId: params.groupId,
    eventType,
    eventId,
    dedupeKey: eventId
      ? `event:${eventId}`
      : `consent:${eventType}:${String(senderId)}`,
    senderId,
    consentState: eventType === "message_allow" ? "allowed" : "denied",
    createdAt: createdAtSeconds
      ? createdAtSeconds * 1000
      : params.now
        ? params.now()
        : undefined,
    rawUpdate: params.update,
  };
}
