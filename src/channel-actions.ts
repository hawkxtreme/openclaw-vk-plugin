import {
  createMessageToolButtonsSchema,
  jsonResult,
  readStringParam,
} from "openclaw/plugin-sdk/channel-actions";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageToolDiscovery,
} from "openclaw/plugin-sdk/channel-contract";
import { resolveSendableOutboundReplyParts } from "openclaw/plugin-sdk/reply-payload";
import { hasVkCredentials, resolveVkAccount } from "./accounts.js";
import { buildVkKeyboard, normalizeVkButtons, resolveVkKeyboardSpecFromPayload } from "./keyboard.js";
import { normalizeVkTarget } from "./outbound.js";
import { sendVkPayload } from "./vk-core/outbound/media.js";

function describeVkMessageTool({
  cfg,
  accountId,
}: Parameters<
  NonNullable<ChannelMessageActionAdapter["describeMessageTool"]>
>[0]): ChannelMessageToolDiscovery {
  const account = resolveVkAccount({ cfg, accountId });
  if (!account.enabled || !hasVkCredentials(account)) {
    return {
      actions: [],
      capabilities: [],
      schema: null,
    };
  }

  return {
    actions: ["send"],
    capabilities: ["interactive", "buttons"],
    schema: {
      properties: {
        buttons: createMessageToolButtonsSchema(),
      },
    },
  };
}

function buildVkActionPayload(params: Record<string, unknown>) {
  const message = readStringParam(params, "message", { allowEmpty: true }) ?? "";
  const media =
    readStringParam(params, "media", { trim: false }) ??
    readStringParam(params, "mediaUrl", { trim: false });
  const interactive =
    params.interactive && typeof params.interactive === "object" && !Array.isArray(params.interactive)
      ? params.interactive
      : undefined;
  const buttons = normalizeVkButtons(params.buttons);

  return {
    text: message,
    mediaUrl: media || undefined,
    interactive,
    channelData: buttons
      ? {
          vk: {
            buttons,
          },
        }
      : undefined,
  };
}

export const vkMessageActions: ChannelMessageActionAdapter = {
  describeMessageTool: describeVkMessageTool,
  supportsAction: ({ action }) => action === "send",
  handleAction: async ({ action, params, cfg, accountId, mediaLocalRoots }) => {
    if (action !== "send") {
      throw new Error(`Unsupported VK action: ${action}`);
    }

    const account = resolveVkAccount({ cfg, accountId });
    const to = normalizeVkTarget(readStringParam(params, "to", { required: true }) ?? "");
    if (!to) {
      throw new Error("VK send requires a target (to).");
    }

    const payload = buildVkActionPayload(params);
    const parts = resolveSendableOutboundReplyParts(payload);
    const keyboard = buildVkKeyboard(
      resolveVkKeyboardSpecFromPayload(payload),
      account.config.transport,
    );
    const replyTo =
      readStringParam(params, "replyTo") ?? readStringParam(params, "replyToId") ?? undefined;
    const result = await sendVkPayload({
      account,
      peerId: to,
      text: parts.hasText ? parts.trimmedText : undefined,
      keyboard,
      mediaUrls: parts.mediaUrls,
      replyTo,
      mediaLocalRoots,
      forceDocument: params.forceDocument === true,
    });

    return jsonResult({
      ok: true,
      channel: "vk",
      messageId: String(result.messageId),
      conversationId: String(result.peerId),
    });
  },
};
