import { randomInt } from "node:crypto";

import {
  normalizeVkConversationMessageId,
  resolveVkInboundReplyToId,
} from "../../reply-to.js";
import { formatVkOutboundMessage } from "../../text-format.js";
import { editVkMessage, sendVkMessage, setVkMessageActivity, VkApiError } from "../core/api.js";
import type { ResolvedVkAccount } from "../types/config.js";
import type { VkInboundMessage } from "../types/longpoll.js";

const MAX_VK_RANDOM_ID = 2_147_483_647;

export type VkSendTextOptions = {
  account: ResolvedVkAccount;
  peerId: string | number;
  text: string;
  keyboard?: string;
  replyTo?: string | number;
  editConversationMessageId?: string | number;
  randomId?: number;
  dedupeKey?: string;
  disableMentions?: boolean;
  dontParseLinks?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type VkSendReplyOptions = Omit<
  VkSendTextOptions,
  "peerId" | "replyTo"
> & {
  message: VkInboundMessage;
};

export type VkSendTextResult = {
  messageId: string;
  peerId: number;
  randomId: number;
  edited?: boolean;
};

function normalizePositiveInteger(
  value: string | number,
  errorPrefix: string,
): number {
  const normalized =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value).trim(), 10);

  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${errorPrefix} ${String(value)}`);
  }

  return normalized;
}

function normalizeVkIdentifier(value: string | number): string {
  return String(value)
    .trim()
    .replace(/^vk:(?:user:|chat:)?/i, "");
}

function hashVkDedupeKey(key: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
    hash >>>= 0;
  }

  return (hash % MAX_VK_RANDOM_ID) + 1;
}

function normalizeVkRandomId(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_VK_RANDOM_ID) {
    throw new Error(`Invalid VK random_id ${String(value)}`);
  }

  return value;
}

export function normalizeVkPeerId(value: string | number): number {
  const normalized = normalizeVkIdentifier(value);
  return normalizePositiveInteger(normalized, "Invalid VK peer id");
}

export function resolveVkRandomId(params?: {
  dedupeKey?: string;
  randomId?: number;
  rng?: () => number;
}): number {
  if (params?.randomId !== undefined) {
    return normalizeVkRandomId(params.randomId);
  }

  const dedupeKey = params?.dedupeKey?.trim();
  if (dedupeKey) {
    return hashVkDedupeKey(dedupeKey);
  }

  if (params?.rng) {
    return normalizeVkRandomId(
      Math.max(1, Math.floor(params.rng() * MAX_VK_RANDOM_ID)),
    );
  }

  return randomInt(1, MAX_VK_RANDOM_ID + 1);
}

function normalizeVkReplyTo(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizePositiveInteger(value, "Invalid VK reply_to");
}

const VK_EDIT_FALLBACK_CODES = new Set([909, 920]);

export async function sendVkText(
  options: VkSendTextOptions,
): Promise<VkSendTextResult> {
  if (!options.account.token) {
    throw new Error(options.account.tokenError ?? "VK token is not configured");
  }

  const formatted = formatVkOutboundMessage(options.text);
  if (!formatted.text) {
    throw new Error("VK text message must not be empty");
  }

  const peerId = normalizeVkPeerId(options.peerId);
  const replyTo = normalizeVkReplyTo(options.replyTo);
  const editConversationMessageId = normalizeVkConversationMessageId(
    options.editConversationMessageId,
  );
  const randomId = resolveVkRandomId({
    dedupeKey: options.dedupeKey,
    randomId: options.randomId,
  });
  if (editConversationMessageId) {
    try {
      await editVkMessage({
        token: options.account.token,
        peerId,
        conversationMessageId: editConversationMessageId,
        message: formatted.text,
        formatData: formatted.formatData,
        keyboard: options.keyboard,
        disableMentions: options.disableMentions,
        dontParseLinks: options.dontParseLinks,
        apiVersion: options.account.config.apiVersion,
        signal: options.signal,
        fetchImpl: options.fetchImpl,
      });
      return {
        messageId: editConversationMessageId,
        peerId,
        randomId,
        edited: true,
      };
    } catch (error) {
      if (
        !(error instanceof VkApiError) ||
        !VK_EDIT_FALLBACK_CODES.has(error.code)
      ) {
        throw error;
      }
    }
  }

  const messageId = await sendVkMessage({
    token: options.account.token,
    peerId,
    message: formatted.text,
    formatData: formatted.formatData,
    keyboard: options.keyboard,
    randomId,
    replyTo,
    disableMentions: options.disableMentions,
    dontParseLinks: options.dontParseLinks,
    apiVersion: options.account.config.apiVersion,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });

  return {
    messageId,
    peerId,
    randomId,
  };
}

export async function sendVkReply(
  options: VkSendReplyOptions,
): Promise<VkSendTextResult> {
  return await sendVkText({
    ...options,
    peerId: options.message.peerId,
    replyTo: resolveVkInboundReplyToId(options.message),
  });
}

export async function sendVkTyping(params: {
  account: ResolvedVkAccount;
  peerId: string | number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!params.account.token) {
    return;
  }

  await setVkMessageActivity({
    token: params.account.token,
    peerId: normalizeVkPeerId(params.peerId),
    groupId: params.account.config.groupId,
    apiVersion: params.account.config.apiVersion,
    signal: params.signal,
    fetchImpl: params.fetchImpl,
  });
}
