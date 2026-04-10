import type { VkInboundMessage } from "./vk-core/types/longpoll.js";

export function normalizeVkReplyToId(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const normalized = String(value).trim();
  return /^\d+$/u.test(normalized) ? normalized : undefined;
}

export function normalizeVkConversationMessageId(
  value: string | number | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const normalized = String(value).trim();
  return /^\d+$/u.test(normalized) ? normalized : undefined;
}

export function resolveVkInboundReplyToId(
  message: Pick<VkInboundMessage, "conversationMessageId" | "messageId" | "isGroupChat">,
): string | undefined {
  if (message.isGroupChat) {
    return undefined;
  }

  const messageId = normalizeVkReplyToId(message.messageId);
  if (messageId) {
    return messageId;
  }

  const conversationMessageId = normalizeVkReplyToId(message.conversationMessageId);
  if (conversationMessageId) {
    return conversationMessageId;
  }

  return undefined;
}

export function resolveVkInboundEditConversationMessageId(
  message: Pick<VkInboundMessage, "editConversationMessageId">,
): string | undefined {
  return normalizeVkConversationMessageId(message.editConversationMessageId);
}
