import { createAttachedChannelResultAdapter } from "openclaw/plugin-sdk/channel-send-result";
import { buildChannelOutboundSessionRoute } from "openclaw/plugin-sdk/core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import {
  normalizeInteractiveReply,
  resolveInteractiveTextFallback,
} from "openclaw/plugin-sdk/interactive-runtime";
import { resolveSendableOutboundReplyParts } from "openclaw/plugin-sdk/reply-payload";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { resolveDefaultVkAccountId, resolveVkAccount, type ResolvedVkAccount } from "./accounts.js";
import { buildVkRootCommandKeyboardSpec, type VkMenuBehavior } from "./command-ui.js";
import {
  resolveLatestVkInteractiveMenuId,
  resolveLatestVkReplyKeyboardMenu,
  retireOlderVkInteractiveMenus,
} from "./interactive-menu.js";
import {
  forgetVkInteractiveMessageId,
  rememberVkInteractiveMessageId,
  resolveRememberedVkInteractiveMessageId,
} from "./interactive-state.js";
import { buildVkKeyboard, resolveVkKeyboardSpecFromPayload } from "./keyboard.js";
import { normalizeVkConversationMessageId, normalizeVkReplyToId } from "./reply-to.js";
import { editVkMessage } from "./vk-core/core/api.js";
import { sendVkPayload } from "./vk-core/outbound/media.js";
import { normalizeVkPeerId, sendVkText } from "./vk-core/outbound/send.js";

const VK_GROUP_CHAT_PEER_ID_MIN = 2_000_000_000;
const VK_ROOT_COMMAND_MENU_TEXT = "VK uses buttons for command menus. Choose a command:";
type VkSendPayloadContext = Parameters<
  NonNullable<NonNullable<ChannelPlugin<ResolvedVkAccount>["outbound"]>["sendPayload"]>
>[0];

function resolveVkChannelData(payload: ReplyPayload): Record<string, unknown> | undefined {
  const channelData = payload.channelData;
  if (!channelData || typeof channelData !== "object" || Array.isArray(channelData)) {
    return undefined;
  }
  const vk = (channelData as Record<string, unknown>).vk;
  return vk && typeof vk === "object" && !Array.isArray(vk)
    ? (vk as Record<string, unknown>)
    : undefined;
}

function resolveVkMenuBehavior(payload: ReplyPayload): VkMenuBehavior | undefined {
  const menuBehavior = resolveVkChannelData(payload)?.menuBehavior;
  return menuBehavior === "collapse" || menuBehavior === "root" ? menuBehavior : undefined;
}

function buildVkMenuBehaviorKeyboard(params: {
  behavior: VkMenuBehavior;
  transport: ResolvedVkAccount["config"]["transport"];
}): string | undefined {
  if (params.behavior === "root") {
    return buildVkKeyboard(
      buildVkRootCommandKeyboardSpec({
        inline: params.transport === "callback-api",
      }),
      params.transport,
    );
  }

  return buildVkKeyboard(
    {
      inline: params.transport === "callback-api",
      oneTime: false,
      buttons: [[{ text: "Menu", callback_data: "/commands" }]],
    },
    params.transport,
  );
}

export function normalizeVkTarget(raw: string): string | undefined {
  const trimmed = raw
    .trim()
    .replace(/^vk:/i, "")
    .replace(/^(user|group|chat|conversation|dm):/i, "")
    .trim();
  return trimmed || undefined;
}

function inferVkChatType(target: string): "direct" | "group" | undefined {
  try {
    const peerId = normalizeVkPeerId(target);
    return peerId >= VK_GROUP_CHAT_PEER_ID_MIN ? "group" : "direct";
  } catch {
    return undefined;
  }
}

async function sendVkOutboundPayload(params: {
  account: ResolvedVkAccount;
  to: string;
  text?: string;
  mediaUrls?: string[];
  replyToId?: string | null;
  editConversationMessageId?: string | null;
  mediaLocalRoots?: readonly string[];
  forceDocument?: boolean;
  keyboard?: string;
}) {
  const result = await sendVkPayload({
    account: params.account,
    peerId: params.to,
    text: params.text,
    keyboard: params.keyboard,
    mediaUrls: params.mediaUrls,
    replyTo: normalizeVkReplyToId(params.replyToId),
    editConversationMessageId: params.editConversationMessageId ?? undefined,
    mediaLocalRoots: params.mediaLocalRoots,
    forceDocument: params.forceDocument,
  });

  return {
    messageId: result.messageId,
    conversationId: String(result.peerId),
    meta: {
      peerId: result.peerId,
      randomId: result.randomId,
      attachments: result.attachments,
      conversationMessageId: result.conversationMessageId,
    },
  };
}

async function syncVkLongPollRootLauncher(params: {
  account: ResolvedVkAccount;
  peerId: string;
  keepConversationMessageId: string;
}): Promise<string | undefined> {
  try {
    const launcherMenu = await resolveLatestVkReplyKeyboardMenu({
      account: params.account,
      peerId: params.peerId,
    });
    if (
      !launcherMenu?.conversationMessageId ||
      launcherMenu.conversationMessageId === params.keepConversationMessageId
    ) {
      return undefined;
    }

    const keyboard = buildVkMenuBehaviorKeyboard({
      behavior: "root",
      transport: params.account.config.transport,
    });
    if (!keyboard) {
      return undefined;
    }

    await editVkMessage({
      token: params.account.token,
      peerId: normalizeVkPeerId(params.peerId),
      conversationMessageId: launcherMenu.conversationMessageId,
      message: VK_ROOT_COMMAND_MENU_TEXT,
      keyboard,
      apiVersion: params.account.config.apiVersion,
    });

    return launcherMenu.conversationMessageId;
  } catch {
    return undefined;
  }
}

async function shouldSendFreshLongPollInlineMenu(params: {
  account: ResolvedVkAccount;
  peerId: string;
  requestedEditConversationMessageId?: string;
  requestedKeyboardSpec?: ReturnType<typeof resolveVkKeyboardSpecFromPayload>;
}): Promise<boolean> {
  if (
    params.account.config.transport !== "long-poll" ||
    !params.requestedEditConversationMessageId ||
    params.requestedKeyboardSpec?.inline !== true ||
    params.requestedKeyboardSpec.longPollInlineCallback !== true
  ) {
    return false;
  }

  try {
    const latestReplyKeyboardMenu = await resolveLatestVkReplyKeyboardMenu({
      account: params.account,
      peerId: params.peerId,
    });
    return (
      latestReplyKeyboardMenu?.conversationMessageId === params.requestedEditConversationMessageId
    );
  } catch {
    return false;
  }
}

export async function sendVkResolvedOutboundPayload(params: {
  cfg: VkSendPayloadContext["cfg"];
  to: string;
  payload: ReplyPayload;
  accountId?: string | null;
  replyToId?: string | null;
  editConversationMessageId?: string | null;
  mediaLocalRoots?: readonly string[];
  forceDocument?: boolean;
}) {
  const account = resolveVkAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const interactive = normalizeInteractiveReply(params.payload.interactive);
  const resolvedText =
    resolveInteractiveTextFallback({
      text: params.payload.text,
      interactive,
    }) ?? params.payload.text;
  const parts = resolveSendableOutboundReplyParts({
    ...params.payload,
    text: resolvedText,
  });
  const requestedKeyboardSpec = resolveVkKeyboardSpecFromPayload(params.payload);
  const requestedKeyboard = buildVkKeyboard(requestedKeyboardSpec, account.config.transport);
  if (process.env.OPENCLAW_VK_DEBUG_KEYBOARD === "1" && requestedKeyboardSpec) {
    console.warn(
      `[vk-keyboard] ${JSON.stringify({
        accountId: account.accountId,
        transport: account.config.transport,
        to: params.to,
        textPreview: parts.trimmedText.slice(0, 120),
        requestedKeyboardSpec,
        requestedKeyboard,
        channelDataVk:
          params.payload.channelData &&
          typeof params.payload.channelData === "object" &&
          !Array.isArray(params.payload.channelData) &&
          (params.payload.channelData as Record<string, unknown>).vk &&
          typeof (params.payload.channelData as Record<string, unknown>).vk === "object" &&
          !Array.isArray((params.payload.channelData as Record<string, unknown>).vk)
            ? ((params.payload.channelData as Record<string, unknown>).vk as Record<
                string,
                unknown
              >)
            : undefined,
      })}`,
    );
  }
  const menuBehavior = resolveVkMenuBehavior(params.payload);
  const requestedEditConversationMessageId = normalizeVkConversationMessageId(
    params.editConversationMessageId ?? null,
  );
  const sendFreshLongPollInlineMenu = await shouldSendFreshLongPollInlineMenu({
    account,
    peerId: params.to,
    requestedEditConversationMessageId,
    requestedKeyboardSpec,
  });
  let rememberedInteractiveMessageId: string | undefined;
  if (
    account.config.transport === "callback-api" &&
    requestedKeyboard &&
    !parts.mediaUrls.length &&
    !requestedEditConversationMessageId
  ) {
    rememberedInteractiveMessageId = resolveRememberedVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: params.to,
    });
    if (!rememberedInteractiveMessageId) {
      rememberedInteractiveMessageId = await resolveLatestVkInteractiveMenuId({
        account,
        peerId: params.to,
      });
      if (rememberedInteractiveMessageId) {
        rememberVkInteractiveMessageId({
          accountId: account.accountId,
          peerId: params.to,
          conversationMessageId: rememberedInteractiveMessageId,
        });
      }
    }
  }
  const editConversationMessageId = sendFreshLongPollInlineMenu
    ? undefined
    : (requestedEditConversationMessageId ?? rememberedInteractiveMessageId);
  const shouldClearRememberedMenu =
    Boolean(editConversationMessageId) && !requestedKeyboard && !parts.mediaUrls.length;
  const shouldAttachMenuBehaviorKeyboard =
    Boolean(menuBehavior) && !requestedKeyboard && !parts.mediaUrls.length;
  const keyboard = shouldClearRememberedMenu
    ? buildVkMenuBehaviorKeyboard({
        behavior: "collapse",
        transport: account.config.transport,
      })
    : shouldAttachMenuBehaviorKeyboard && menuBehavior
      ? buildVkMenuBehaviorKeyboard({
          behavior: menuBehavior,
          transport: account.config.transport,
        })
      : requestedKeyboard;

  const result = await sendVkOutboundPayload({
    account,
    to: params.to,
    text: parts.hasText ? parts.trimmedText : undefined,
    keyboard,
    mediaUrls: parts.mediaUrls,
    replyToId: params.replyToId ?? null,
    editConversationMessageId: editConversationMessageId ?? null,
    mediaLocalRoots: params.mediaLocalRoots,
    forceDocument: params.forceDocument,
  });
  const rememberedConversationMessageId = normalizeVkConversationMessageId(
    result.meta?.conversationMessageId,
  );
  if (shouldClearRememberedMenu) {
    forgetVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: params.to,
    });
  }
  if (rememberedConversationMessageId) {
    rememberVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: params.to,
      conversationMessageId: rememberedConversationMessageId,
    });
    const shouldSyncLongPollRootLauncher =
      account.config.transport === "long-poll" &&
      requestedKeyboardSpec?.inline === true &&
      requestedKeyboardSpec.longPollInlineCallback === true &&
      !parts.mediaUrls.length;
    const preservedLongPollLauncherMessageId = shouldSyncLongPollRootLauncher
      ? await syncVkLongPollRootLauncher({
          account,
          peerId: params.to,
          keepConversationMessageId: rememberedConversationMessageId,
        })
      : undefined;
    await retireOlderVkInteractiveMenus({
      account,
      peerId: params.to,
      keepConversationMessageId: rememberedConversationMessageId,
      ...(preservedLongPollLauncherMessageId
        ? { skipConversationMessageIds: [preservedLongPollLauncherMessageId] }
        : {}),
    });
  }

  return {
    channel: "vk" as const,
    ...result,
  };
}

export const vkOutboundAdapter: NonNullable<ChannelPlugin<ResolvedVkAccount>["outbound"]> = {
  deliveryMode: "direct",
  resolveTarget: ({ to }) => {
    const normalized = to ? normalizeVkTarget(to) : undefined;
    if (!normalized) {
      return {
        ok: false,
        error: new Error("VK target is required"),
      };
    }
    return {
      ok: true,
      to: normalized,
    };
  },
  sendPayload: async ({ cfg, to, payload, accountId, replyToId, mediaLocalRoots, forceDocument }) =>
    await sendVkResolvedOutboundPayload({
      cfg,
      to,
      payload,
      accountId,
      replyToId: replyToId ?? null,
      mediaLocalRoots,
      forceDocument,
    }),
  ...createAttachedChannelResultAdapter({
    channel: "vk",
    sendText: async ({ cfg, to, text, accountId, replyToId }) => {
      const account = resolveVkAccount({
        cfg,
        accountId,
      });
      const result = await sendVkText({
        account,
        peerId: to,
        text,
        replyTo: normalizeVkReplyToId(replyToId),
      });

      return {
        messageId: result.messageId,
        conversationId: String(result.peerId),
        meta: {
          peerId: result.peerId,
          randomId: result.randomId,
        },
      };
    },
    sendMedia: async ({
      cfg,
      to,
      text,
      mediaUrl,
      accountId,
      replyToId,
      mediaLocalRoots,
      forceDocument,
    }) => {
      const account = resolveVkAccount({
        cfg,
        accountId,
      });
      return await sendVkOutboundPayload({
        account,
        to,
        text: text?.trim() || undefined,
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        replyToId: replyToId ?? null,
        mediaLocalRoots,
        forceDocument,
      });
    },
  }),
};

export const vkMessagingAdapter: NonNullable<ChannelPlugin<ResolvedVkAccount>["messaging"]> = {
  normalizeTarget: normalizeVkTarget,
  inferTargetChatType: ({ to }) => inferVkChatType(to),
  targetResolver: {
    looksLikeId: (raw, normalized) => {
      const candidate = normalized?.trim() || normalizeVkTarget(raw);
      return Boolean(candidate && /^\d+$/u.test(candidate));
    },
    hint: "<peerId>",
  },
  resolveOutboundSessionRoute: ({ cfg, agentId, accountId, target, threadId }) => {
    const normalized = normalizeVkTarget(target);
    if (!normalized) {
      return null;
    }

    const chatType = inferVkChatType(normalized) ?? "direct";
    const resolvedAccountId = accountId ?? resolveDefaultVkAccountId(cfg);

    return buildChannelOutboundSessionRoute({
      cfg,
      agentId,
      channel: "vk",
      accountId: resolvedAccountId,
      peer: {
        kind: chatType,
        id: normalized,
      },
      chatType,
      from: resolvedAccountId,
      to: normalized,
      ...(threadId !== undefined && threadId !== null ? { threadId } : {}),
    });
  },
};
