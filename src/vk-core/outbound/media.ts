import { realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVkConversationMessageId } from "../../reply-to.js";
import { formatVkOutboundMessage } from "../../text-format.js";
import {
  editVkMessage,
  getVkDocumentUploadServer,
  getVkPhotoUploadServer,
  resolveVkConversationMessageIdForMessage,
  saveVkDocument,
  saveVkMessagesPhoto,
  sendVkMessage,
  uploadVkMultipart,
  VkApiError,
} from "../core/api.js";
import type { ResolvedVkAccount } from "../types/config.js";
import { readVkLocalMediaFile } from "./local-file.js";
import { normalizeVkPeerId, resolveVkRandomId } from "./send.js";

const DEFAULT_MEDIA_TITLE = "attachment";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".aac": "audio/aac",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webp": "image/webp",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/json": ".json",
  "application/pdf": ".pdf",
  "audio/aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "text/markdown": ".md",
  "text/plain": ".txt",
};

export type VkResolvedOutboundMedia = {
  kind: "image" | "document" | "audio_message";
  source: Buffer;
  title: string;
  mediaUrl: string;
  mimeType?: string;
};

export type VkUploadedMedia = {
  kind: "image" | "document" | "audio_message";
  attachment: string;
  title: string;
  mediaUrl: string;
  mimeType?: string;
};

export type VkLoadOutboundMediaOptions = {
  mediaUrl: string;
  mediaLocalRoots?: readonly string[];
  forceDocument?: boolean;
  preferredName?: string;
  preferredMimeType?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type VkUploadMediaOptions = {
  account: ResolvedVkAccount;
  peerId: string | number;
  media: VkResolvedOutboundMedia;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type VkSendPayloadOptions = {
  account: ResolvedVkAccount;
  peerId: string | number;
  text?: string;
  keyboard?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  replyTo?: string | number;
  editConversationMessageId?: string | number;
  randomId?: number;
  dedupeKey?: string;
  disableMentions?: boolean;
  dontParseLinks?: boolean;
  mediaLocalRoots?: readonly string[];
  forceDocument?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type VkSendPayloadResult = {
  messageId: string;
  peerId: number;
  randomId: number;
  attachments: string[];
  conversationMessageId?: string;
  edited?: boolean;
};

const VK_EDIT_FALLBACK_CODES = new Set([100, 909, 920]);
const VK_CONVERSATION_MESSAGE_ID_RETRY_DELAYS_MS = [0, 150, 400] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveVkConversationMessageIdWithRetry(params: {
  token: string;
  peerId: number;
  messageId: string;
  apiVersion?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string | undefined> {
  for (const delayMs of VK_CONVERSATION_MESSAGE_ID_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    const conversationMessageId = await resolveVkConversationMessageIdForMessage(params);
    if (conversationMessageId) {
      return conversationMessageId;
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeFileNameCandidate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return basename(trimmed.replaceAll("\\", "/")).trim() || undefined;
}

function mimeFromExtension(value?: string): string | undefined {
  const extension = value?.trim().toLowerCase();
  if (!extension) {
    return undefined;
  }

  return MIME_BY_EXTENSION[extension.startsWith(".") ? extension : `.${extension}`];
}

function extensionFromMimeType(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase().split(";")[0];
  if (!normalized) {
    return undefined;
  }

  return EXTENSION_BY_MIME[normalized];
}

function normalizeTitle(params: { title?: string; mediaUrl?: string; mimeType?: string }): string {
  const fromTitle = normalizeFileNameCandidate(params.title);
  const fromUrl = params.mediaUrl
    ? normalizeFileNameCandidate(
        params.mediaUrl.startsWith("http://") || params.mediaUrl.startsWith("https://")
          ? new URL(params.mediaUrl).pathname
          : params.mediaUrl,
      )
    : undefined;
  const base = fromTitle ?? fromUrl ?? DEFAULT_MEDIA_TITLE;
  const extension = extname(base).trim().toLowerCase();
  const preferredExtension = extensionFromMimeType(params.mimeType);

  if (!preferredExtension || extension) {
    return base;
  }

  return `${base}${preferredExtension}`;
}

function inferMediaKind(params: {
  title: string;
  mimeType?: string;
  forceDocument?: boolean;
}): "image" | "document" | "audio_message" {
  if (params.forceDocument) {
    return "document";
  }

  const mimeType = params.mimeType?.trim().toLowerCase();
  if (mimeType?.startsWith("image/")) {
    return "image";
  }
  if (mimeType?.startsWith("audio/")) {
    return "audio_message";
  }

  const extension = extname(params.title).trim().toLowerCase();
  if (
    extension === ".png" ||
    extension === ".jpg" ||
    extension === ".jpeg" ||
    extension === ".gif" ||
    extension === ".webp" ||
    extension === ".svg"
  ) {
    return "image";
  }
  if (
    extension === ".mp3" ||
    extension === ".ogg" ||
    extension === ".opus" ||
    extension === ".wav" ||
    extension === ".aac"
  ) {
    return "audio_message";
  }

  return "document";
}

function decodeDataUrl(dataUrl: string): {
  buffer: Buffer;
  mimeType?: string;
  title: string;
} {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
  if (!match) {
    throw new Error("Invalid data URL");
  }

  const mimeType = match[1]?.trim().toLowerCase() || undefined;
  const encoded = match[3] ?? "";
  const buffer = match[2]
    ? Buffer.from(encoded, "base64")
    : Buffer.from(decodeURIComponent(encoded), "utf8");
  const title = normalizeTitle({
    mimeType,
  });

  return { buffer, mimeType, title };
}

async function resolveAllowedLocalPath(
  input: string,
  mediaLocalRoots?: readonly string[],
): Promise<string> {
  const normalizedInput = input.startsWith("file://") ? fileURLToPath(input) : input;
  const absoluteCandidate = isAbsolute(normalizedInput)
    ? normalizedInput
    : resolvePath(normalizedInput);
  const resolvedCandidate = await realpath(absoluteCandidate);

  if (!mediaLocalRoots?.length) {
    return resolvedCandidate;
  }

  const resolvedRoots = (
    await Promise.all(
      mediaLocalRoots.map(async (root) => {
        const trimmed = root.trim();
        if (!trimmed) {
          return null;
        }
        try {
          return await realpath(trimmed);
        } catch {
          return null;
        }
      }),
    )
  ).filter((root): root is string => Boolean(root));

  const isAllowed = resolvedRoots.some(
    (root) => resolvedCandidate === root || resolvedCandidate.startsWith(`${root}${sep}`),
  );
  if (!isAllowed) {
    throw new Error(`Local media path is outside allowed roots: ${input}`);
  }

  return resolvedCandidate;
}

async function loadRemoteMedia(params: {
  mediaUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{
  buffer: Buffer;
  mimeType?: string;
  title: string;
}> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(params.mediaUrl, {
    signal: params.signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch media: HTTP ${String(response.status)}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const title = normalizeTitle({
    title: basename(new URL(params.mediaUrl).pathname),
    mediaUrl: params.mediaUrl,
    mimeType,
  });

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType,
    title,
  };
}

function formatAttachment(params: {
  prefix: "photo" | "doc";
  ownerId: number;
  id: number;
  accessKey?: string;
}): string {
  return `${params.prefix}${String(params.ownerId)}_${String(params.id)}${params.accessKey ? `_${params.accessKey}` : ""}`;
}

function normalizeUploadedPhoto(response: unknown): {
  server: number;
  photo: string;
  hash: string;
} {
  const record = asRecord(response);
  const server = Number(record?.server);
  const photo = typeof record?.photo === "string" ? record.photo : undefined;
  const hash = typeof record?.hash === "string" ? record.hash : undefined;

  if (!Number.isInteger(server) || !photo || !hash) {
    throw new Error("VK photo upload response is missing server/photo/hash");
  }

  return {
    server,
    photo,
    hash,
  };
}

function normalizeSavedPhoto(response: unknown): {
  ownerId: number;
  id: number;
  accessKey?: string;
} {
  const first = Array.isArray(response) ? response[0] : undefined;
  const record = asRecord(first);
  const ownerId = Number(record?.owner_id ?? record?.ownerId);
  const id = Number(record?.id);
  const accessKey =
    typeof record?.access_key === "string"
      ? record.access_key
      : typeof record?.accessKey === "string"
        ? record.accessKey
        : undefined;

  if (!Number.isInteger(ownerId) || !Number.isInteger(id)) {
    throw new Error("VK saved photo response is missing owner_id/id");
  }

  return {
    ownerId,
    id,
    accessKey,
  };
}

function normalizeUploadedDocument(response: unknown): string {
  const record = asRecord(response);
  const file = typeof record?.file === "string" ? record.file : undefined;
  if (!file) {
    throw new Error("VK document upload response is missing file");
  }
  return file;
}

function normalizeSavedDocument(response: unknown): {
  ownerId: number;
  id: number;
  accessKey?: string;
} {
  const record = asRecord(response);
  const attachment =
    asRecord(record?.doc) ?? asRecord(record?.audio_message) ?? asRecord(record?.graffiti);
  const ownerId = Number(attachment?.owner_id ?? attachment?.ownerId);
  const id = Number(attachment?.id);
  const accessKey =
    typeof attachment?.access_key === "string"
      ? attachment.access_key
      : typeof attachment?.accessKey === "string"
        ? attachment.accessKey
        : undefined;

  if (!Number.isInteger(ownerId) || !Number.isInteger(id)) {
    throw new Error("VK saved document response is missing owner_id/id");
  }

  return {
    ownerId,
    id,
    accessKey,
  };
}

function listMediaUrls(options: VkSendPayloadOptions): string[] {
  const raw = options.mediaUrls?.length
    ? options.mediaUrls
    : options.mediaUrl
      ? [options.mediaUrl]
      : [];

  return Array.from(new Set(raw.map((entry) => entry.trim()).filter(Boolean)));
}

export async function loadVkOutboundMedia(
  options: VkLoadOutboundMediaOptions,
): Promise<VkResolvedOutboundMedia> {
  const mediaUrl = options.mediaUrl.trim();
  if (!mediaUrl) {
    throw new Error("Missing media URL");
  }

  if (mediaUrl.startsWith("data:")) {
    const decoded = decodeDataUrl(mediaUrl);
    const title = normalizeTitle({
      title: options.preferredName ?? decoded.title,
      mimeType: options.preferredMimeType ?? decoded.mimeType,
    });
    const mimeType =
      options.preferredMimeType?.trim().toLowerCase() ??
      decoded.mimeType ??
      mimeFromExtension(extname(title));

    return {
      kind: inferMediaKind({
        title,
        mimeType,
        forceDocument: options.forceDocument,
      }),
      source: decoded.buffer,
      title,
      mediaUrl,
      mimeType,
    };
  }

  if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
    const remote = await loadRemoteMedia({
      mediaUrl,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    });
    const title = normalizeTitle({
      title: options.preferredName ?? remote.title,
      mediaUrl,
      mimeType: options.preferredMimeType ?? remote.mimeType,
    });
    const mimeType =
      options.preferredMimeType?.trim().toLowerCase() ??
      remote.mimeType ??
      mimeFromExtension(extname(title));

    return {
      kind: inferMediaKind({
        title,
        mimeType,
        forceDocument: options.forceDocument,
      }),
      source: remote.buffer,
      title,
      mediaUrl,
      mimeType,
    };
  }

  const localPath = await resolveAllowedLocalPath(mediaUrl, options.mediaLocalRoots);
  const source = await readVkLocalMediaFile(localPath);
  const title = normalizeTitle({
    title: options.preferredName ?? basename(localPath),
    mediaUrl: localPath,
    mimeType: options.preferredMimeType,
  });
  const mimeType =
    options.preferredMimeType?.trim().toLowerCase() ??
    mimeFromExtension(extname(localPath)) ??
    mimeFromExtension(extname(title));

  return {
    kind: inferMediaKind({
      title,
      mimeType,
      forceDocument: options.forceDocument,
    }),
    source,
    title,
    mediaUrl: localPath,
    mimeType,
  };
}

export async function uploadVkMedia(options: VkUploadMediaOptions): Promise<VkUploadedMedia> {
  if (!options.account.token) {
    throw new Error(options.account.tokenError ?? "VK token is not configured");
  }

  const peerId = normalizeVkPeerId(options.peerId);
  const fetchImpl = options.fetchImpl ?? fetch;

  if (options.media.kind === "image") {
    const uploadUrl = await getVkPhotoUploadServer({
      token: options.account.token,
      peerId,
      apiVersion: options.account.config.apiVersion,
      signal: options.signal,
      fetchImpl,
    });
    const uploaded = normalizeUploadedPhoto(
      await uploadVkMultipart({
        url: uploadUrl,
        fieldName: "photo",
        filename: options.media.title,
        contentType: options.media.mimeType,
        data: options.media.source,
        signal: options.signal,
        fetchImpl,
      }),
    );
    const saved = normalizeSavedPhoto(
      await saveVkMessagesPhoto({
        token: options.account.token,
        photo: uploaded.photo,
        server: uploaded.server,
        hash: uploaded.hash,
        apiVersion: options.account.config.apiVersion,
        signal: options.signal,
        fetchImpl,
      }),
    );

    return {
      kind: "image",
      attachment: formatAttachment({
        prefix: "photo",
        ownerId: saved.ownerId,
        id: saved.id,
        accessKey: saved.accessKey,
      }),
      title: options.media.title,
      mediaUrl: options.media.mediaUrl,
      mimeType: options.media.mimeType,
    };
  }

  const uploadUrl = await getVkDocumentUploadServer({
    token: options.account.token,
    peerId,
    type: options.media.kind === "audio_message" ? "audio_message" : "doc",
    apiVersion: options.account.config.apiVersion,
    signal: options.signal,
    fetchImpl,
  });
  const file = normalizeUploadedDocument(
    await uploadVkMultipart({
      url: uploadUrl,
      fieldName: "file",
      filename: options.media.title,
      contentType: options.media.mimeType,
      data: options.media.source,
      signal: options.signal,
      fetchImpl,
    }),
  );
  const saved = normalizeSavedDocument(
    await saveVkDocument({
      token: options.account.token,
      file,
      title: options.media.title,
      apiVersion: options.account.config.apiVersion,
      signal: options.signal,
      fetchImpl,
    }),
  );

  return {
    kind: options.media.kind,
    attachment: formatAttachment({
      prefix: "doc",
      ownerId: saved.ownerId,
      id: saved.id,
      accessKey: saved.accessKey,
    }),
    title: options.media.title,
    mediaUrl: options.media.mediaUrl,
    mimeType: options.media.mimeType,
  };
}

export async function sendVkPayload(options: VkSendPayloadOptions): Promise<VkSendPayloadResult> {
  if (!options.account.token) {
    throw new Error(options.account.tokenError ?? "VK token is not configured");
  }

  const peerId = normalizeVkPeerId(options.peerId);
  const attachments: string[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;

  for (const mediaUrl of listMediaUrls(options)) {
    const media = await loadVkOutboundMedia({
      mediaUrl,
      mediaLocalRoots: options.mediaLocalRoots,
      forceDocument: options.forceDocument,
      fetchImpl,
      signal: options.signal,
    });
    const uploaded = await uploadVkMedia({
      account: options.account,
      peerId,
      media,
      fetchImpl,
      signal: options.signal,
    });
    attachments.push(uploaded.attachment);
  }

  const formatted = options.text ? formatVkOutboundMessage(options.text) : undefined;
  if (!formatted?.text && attachments.length === 0) {
    throw new Error("VK payload requires text or media");
  }

  const randomId = resolveVkRandomId({
    dedupeKey: options.dedupeKey,
    randomId: options.randomId,
  });
  const editConversationMessageId = normalizeVkConversationMessageId(
    options.editConversationMessageId,
  );
  if (editConversationMessageId && attachments.length === 0) {
    try {
      await editVkMessage({
        token: options.account.token,
        peerId,
        conversationMessageId: editConversationMessageId,
        message: formatted?.text,
        formatData: formatted?.formatData,
        keyboard: options.keyboard,
        disableMentions: options.disableMentions,
        dontParseLinks: options.dontParseLinks,
        apiVersion: options.account.config.apiVersion,
        signal: options.signal,
        fetchImpl,
      });

      return {
        messageId: editConversationMessageId,
        peerId,
        randomId,
        attachments,
        conversationMessageId: editConversationMessageId,
        edited: true,
      };
    } catch (error) {
      if (!(error instanceof VkApiError) || !VK_EDIT_FALLBACK_CODES.has(error.code)) {
        throw error;
      }
    }
  }

  const messageId = await sendVkMessage({
    token: options.account.token,
    peerId,
    message: formatted?.text,
    formatData: formatted?.formatData,
    attachment: attachments.length > 0 ? attachments.join(",") : undefined,
    keyboard: options.keyboard,
    randomId,
    replyTo:
      options.replyTo !== undefined
        ? Number.parseInt(String(options.replyTo).trim(), 10)
        : undefined,
    disableMentions: options.disableMentions,
    dontParseLinks: options.dontParseLinks,
    apiVersion: options.account.config.apiVersion,
    signal: options.signal,
    fetchImpl,
  });

  return {
    messageId,
    peerId,
    randomId,
    attachments,
    conversationMessageId:
      options.keyboard || editConversationMessageId
        ? await resolveVkConversationMessageIdWithRetry({
            token: options.account.token,
            peerId,
            messageId,
            apiVersion: options.account.config.apiVersion,
            signal: options.signal,
            fetchImpl,
          })
        : undefined,
  };
}
