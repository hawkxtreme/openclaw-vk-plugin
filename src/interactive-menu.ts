import type { ResolvedVkAccount } from "./accounts.js";
import {
  editVkMessage,
  listVkRecentInteractiveMessages,
  resolveVkLatestInteractiveConversationMessageId,
} from "./vk-core/core/api.js";

const EMPTY_INLINE_KEYBOARD = JSON.stringify({
  inline: true,
  buttons: [],
});

type VkInteractiveMenuLog = {
  warn?: (message: string) => void;
};

export async function retireVkInteractiveMenu(params: {
  account: ResolvedVkAccount;
  peerId: number;
  conversationMessageId?: string;
  text?: string;
  log?: VkInteractiveMenuLog;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!params.conversationMessageId) {
    return;
  }

  try {
    let messageText = params.text;
    if (messageText === undefined) {
      const recentMenus = await listVkRecentInteractiveMessages({
        token: params.account.token,
        peerId: params.peerId,
        apiVersion: params.account.config.apiVersion,
        fetchImpl: params.fetchImpl,
      });
      messageText = recentMenus.find(
        (item) => item.conversationMessageId === params.conversationMessageId,
      )?.text;
    }
    if (!messageText) {
      return;
    }
    await editVkMessage({
      token: params.account.token,
      peerId: params.peerId,
      conversationMessageId: params.conversationMessageId,
      message: messageText,
      keyboard: EMPTY_INLINE_KEYBOARD,
      apiVersion: params.account.config.apiVersion,
      fetchImpl: params.fetchImpl,
    });
  } catch (error) {
    params.log?.warn?.(
      `[${params.account.accountId}] Failed to retire stale VK menu ${params.conversationMessageId}: ${String(error)}`,
    );
  }
}

export async function resolveLatestVkInteractiveMenuId(params: {
  account: ResolvedVkAccount;
  peerId: string;
  fetchImpl?: typeof fetch;
}): Promise<string | undefined> {
  return await resolveVkLatestInteractiveConversationMessageId({
    token: params.account.token,
    peerId: Number(params.peerId),
    apiVersion: params.account.config.apiVersion,
    fetchImpl: params.fetchImpl,
  });
}

export async function resolveLatestVkReplyKeyboardMenu(params: {
  account: ResolvedVkAccount;
  peerId: string;
  fetchImpl?: typeof fetch;
}) {
  const menus = await listVkRecentInteractiveMessages({
    token: params.account.token,
    peerId: Number(params.peerId),
    apiVersion: params.account.config.apiVersion,
    fetchImpl: params.fetchImpl,
  });

  return menus.find((menu) => menu.inline !== true);
}

export async function retireOlderVkInteractiveMenus(params: {
  account: ResolvedVkAccount;
  peerId: string;
  keepConversationMessageId: string;
  skipConversationMessageIds?: readonly string[];
  log?: VkInteractiveMenuLog;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const skippedConversationMessageIds = new Set(params.skipConversationMessageIds ?? []);
  const menus = await listVkRecentInteractiveMessages({
    token: params.account.token,
    peerId: Number(params.peerId),
    apiVersion: params.account.config.apiVersion,
    fetchImpl: params.fetchImpl,
  });

  for (const menu of menus) {
    if (
      menu.conversationMessageId === params.keepConversationMessageId ||
      skippedConversationMessageIds.has(menu.conversationMessageId)
    ) {
      continue;
    }
    await retireVkInteractiveMenu({
      account: params.account,
      peerId: Number(params.peerId),
      conversationMessageId: menu.conversationMessageId,
      text: menu.text,
      log: params.log,
      fetchImpl: params.fetchImpl,
    });
  }
}
