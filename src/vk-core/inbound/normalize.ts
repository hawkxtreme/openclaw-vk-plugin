import type { VkInboundAttachment, VkInboundMessage } from "../types/longpoll.js";
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

const MIME_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webp": "image/webp",
};

function inferMimeFromSuffix(value: string): string | undefined {
  const lower = value.trim().toLowerCase();
  for (const [suffix, mime] of Object.entries(MIME_BY_EXTENSION)) {
    if (lower.endsWith(suffix)) {
      return mime;
    }
  }
  return undefined;
}

function inferMimeType(params: {
  url?: string;
  ext?: string;
  fallback?: string;
}): string | undefined {
  const ext = params.ext?.trim().replace(/^\./u, "");
  if (ext) {
    const fromExt = inferMimeFromSuffix(`file.${ext}`);
    if (fromExt) {
      return fromExt;
    }
  }

  const url = params.url?.trim();
  if (url) {
    try {
      const fromUrl = inferMimeFromSuffix(new URL(url).pathname);
      if (fromUrl) {
        return fromUrl;
      }
    } catch {
      const fromUrl = inferMimeFromSuffix(url);
      if (fromUrl) {
        return fromUrl;
      }
    }
  }

  return params.fallback;
}

function resolveLargestPhotoUrl(photo: Record<string, unknown>): string | undefined {
  const original = asRecord(photo.orig_photo);
  const originalUrl = toOptionalString(original?.url);
  if (originalUrl) {
    return originalUrl;
  }

  const sizes = Array.isArray(photo.sizes) ? photo.sizes : [];
  let bestUrl: string | undefined;
  let bestScore = -1;

  for (const size of sizes) {
    const record = asRecord(size);
    if (!record) {
      continue;
    }
    const url = toOptionalString(record.url);
    if (!url) {
      continue;
    }
    const width = toFiniteInteger(record.width) ?? 0;
    const height = toFiniteInteger(record.height) ?? 0;
    const score = width * height;
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }

  return bestUrl;
}

export function normalizeVkAttachments(value: unknown): VkInboundAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const attachments: VkInboundAttachment[] = [];

  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }

    const type = toOptionalString(record.type);
    if (type === "photo") {
      const photo = asRecord(record.photo);
      const url = photo ? resolveLargestPhotoUrl(photo) : undefined;
      if (!url) {
        continue;
      }
      attachments.push({
        kind: "image",
        url,
        contentType: inferMimeType({
          url,
          fallback: "image/jpeg",
        }),
      });
      continue;
    }

    if (type === "audio_message") {
      const audio = asRecord(record.audio_message) ?? asRecord(record.doc);
      if (!audio) {
        continue;
      }
      const oggUrl = toOptionalString(audio.link_ogg);
      const mp3Url = toOptionalString(audio.link_mp3);
      const url = oggUrl ?? mp3Url ?? toOptionalString(audio.url);
      if (!url) {
        continue;
      }
      const title = toOptionalString(audio.title);
      attachments.push({
        kind: "audio_message",
        url,
        contentType:
          oggUrl
            ? "audio/ogg"
            : mp3Url
              ? "audio/mpeg"
              : inferMimeType({
                  url,
                  ext: toOptionalString(audio.ext),
                  fallback: "audio/ogg",
                }),
        ...(title ? { title } : {}),
      });
      continue;
    }

    if (type === "audio") {
      const audio = asRecord(record.audio);
      const url = toOptionalString(audio?.url);
      if (!audio || !url) {
        continue;
      }
      const title = toOptionalString(audio.title);
      const artist = toOptionalString(audio.artist);
      const displayTitle =
        artist && title ? `${artist} - ${title}` : (title ?? artist);
      attachments.push({
        kind: "audio_message",
        url,
        contentType: inferMimeType({
          url,
          ext: toOptionalString(audio.ext),
          fallback: "audio/mpeg",
        }),
        ...(displayTitle ? { title: displayTitle } : {}),
      });
      continue;
    }

    if (type === "doc") {
      const doc = asRecord(record.doc);
      const url = toOptionalString(doc?.url);
      if (!doc || !url) {
        continue;
      }
      const title = toOptionalString(doc.title);
      const kind = toFiniteInteger(doc.type) === 5 ? "audio_message" : "document";
      attachments.push({
        kind,
        url,
        contentType: inferMimeType({
          url,
          ext: toOptionalString(doc.ext),
          fallback: kind === "audio_message" ? "audio/ogg" : undefined,
        }),
        ...(title ? { title } : {}),
      });
    }
  }

  return attachments.length > 0 ? attachments : undefined;
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
    attachments: normalizeVkAttachments(message.attachments),
    formatData,
    messagePayload,
    createdAt,
    isGroupChat: peerId >= VK_GROUP_CHAT_PEER_ID_MIN,
    rawUpdate: params.update,
  };
}
