import { createAttachedChannelResultAdapter } from "openclaw/plugin-sdk/channel-send-result";
import { buildChannelOutboundSessionRoute } from "openclaw/plugin-sdk/core";
import { resolveSendableOutboundReplyParts } from "openclaw/plugin-sdk/reply-payload";
import {
  normalizeInteractiveReply,
  resolveInteractiveTextFallback,
} from "openclaw/plugin-sdk/interactive-runtime";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import {
  resolveDefaultVkAccountId,
  resolveVkAccount,
  type ResolvedVkAccount,
} from "./accounts.js";
import type { OpenClawConfig } from "./types.js";
import {
  forgetVkInteractiveMessageId,
  rememberVkInteractiveMessageId,
  resolveRememberedVkInteractiveMessageId,
} from "./interactive-state.js";
import {
  resolveLatestVkInteractiveMenuId,
  retireOlderVkInteractiveMenus,
} from "./interactive-menu.js";
import { buildVkKeyboard, resolveVkKeyboardSpecFromPayload } from "./keyboard.js";
import {
  normalizeVkConversationMessageId,
  normalizeVkReplyToId,
} from "./reply-to.js";
import { sendVkPayload } from "./vk-core/outbound/media.js";
import { normalizeVkPeerId, sendVkText } from "./vk-core/outbound/send.js";

const VK_GROUP_CHAT_PEER_ID_MIN = 2_000_000_000;

function resolveVkChannelData(
  payload: ReplyPayload,
): Record<string, unknown> | undefined {
  const channelData = payload.channelData;
  if (!channelData || typeof channelData !== "object" || Array.isArray(channelData)) {
    return undefined;
  }
  const vk = (channelData as Record<string, unknown>).vk;
  return vk && typeof vk === "object" && !Array.isArray(vk)
    ? (vk as Record<string, unknown>)
    : undefined;
}

function resolveVkMenuBehavior(
  payload: ReplyPayload,
): "collapse" | undefined {
  const menuBehavior = resolveVkChannelData(payload)?.menuBehavior;
  return menuBehavior === "collapse" ? "collapse" : undefined;
}

function buildVkCollapsedMenuKeyboard(
  transport: ResolvedVkAccount["config"]["transport"],
): string | undefined {
  return buildVkKeyboard(
    {
      inline: transport === "callback-api",
      oneTime: false,
      buttons: [[{ text: "Menu", callback_data: "/commands" }]],
    },
    transport,
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

export async function sendVkResolvedOutboundPayload(params: {
  cfg: OpenClawConfig;
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
  const requestedKeyboard = buildVkKeyboard(
    resolveVkKeyboardSpecFromPayload(params.payload),
    account.config.transport,
  );
  const menuBehavior = resolveVkMenuBehavior(params.payload);
  const requestedEditConversationMessageId = normalizeVkConversationMessageId(
    params.editConversationMessageId ?? null,
  );
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
  const editConversationMessageId =
    requestedEditConversationMessageId ??
    rememberedInteractiveMessageId;
  const shouldClearRememberedMenu =
    Boolean(editConversationMessageId) && !requestedKeyboard && !parts.mediaUrls.length;
  const shouldAttachCollapsedLauncher =
    menuBehavior === "collapse" && !requestedKeyboard && !parts.mediaUrls.length;
  const keyboard =
    shouldClearRememberedMenu || shouldAttachCollapsedLauncher
      ? buildVkCollapsedMenuKeyboard(account.config.transport)
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
    await retireOlderVkInteractiveMenus({
      account,
      peerId: params.to,
      keepConversationMessageId: rememberedConversationMessageId,
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
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId, replyToId, mediaLocalRoots, forceDocument }) => {
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
