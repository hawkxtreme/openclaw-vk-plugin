import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/channel-inbound";
import { createChannelPairingController } from "openclaw/plugin-sdk/channel-pairing";
import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-reply-pipeline";
import type { ChannelAccountSnapshot } from "openclaw/plugin-sdk/core";
import { resolveInboundDirectDmAccessWithRuntime } from "openclaw/plugin-sdk/direct-dm";
import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/inbound-reply-dispatch";
import type { ResolvedVkAccount } from "./accounts.js";
import {
  normalizeVkCommandShortcut,
  resolveVkSlashCommandSuggestionReply,
  type VkMenuBehavior,
  VK_CLOSE_MENU_COMMAND,
} from "./command-ui.js";
import { resolveRememberedVkInteractiveMessageId } from "./interactive-state.js";
import { resolveVkCommandFromPayload } from "./keyboard.js";
import { sendVkResolvedOutboundPayload } from "./outbound.js";
import { resolveVkInboundEditConversationMessageId } from "./reply-to.js";
import { getVkRuntime } from "./runtime.js";
import { resolveVkInboundBody } from "./text-format.js";
import type { OpenClawConfig } from "./types.js";
import { getVkMessageAttachmentsByConversationMessageId } from "./vk-core/core/api.js";
import { sendVkText, sendVkTyping } from "./vk-core/outbound/send.js";
import type { VkAccessController } from "./vk-core/types/access.js";
import type { VkInboundAttachment, VkInboundMessage } from "./vk-core/types/longpoll.js";

const CHANNEL_ID = "vk" as const;

type VkInboundLog = {
  debug?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type VkInboundStatusSink = (
  patch: Partial<
    Pick<
      ChannelAccountSnapshot,
      "lastInboundAt" | "lastOutboundAt" | "lastEventAt" | "lastMessageAt" | "lastError"
    >
  >,
) => void;

type VkTypingCallbacks = ReturnType<typeof createTypingCallbacks>;

const VK_ATTACHMENT_HYDRATION_RETRY_DELAYS_MS = [0, 250, 750] as const;

const dispatchInboundReplyWithBaseCompat = dispatchInboundReplyWithBase as unknown as (params: Parameters<
  typeof dispatchInboundReplyWithBase
>[0] & {
  typingCallbacks?: VkTypingCallbacks;
}) => Promise<void>;

const dispatchInboundDirectDmWithRuntimeCompat =
  dispatchInboundDirectDmWithRuntime as unknown as (params: Parameters<
    typeof dispatchInboundDirectDmWithRuntime
  >[0] & {
    typingCallbacks?: VkTypingCallbacks;
  }) => ReturnType<typeof dispatchInboundDirectDmWithRuntime>;

function resolveVkFlowDebugChannelData(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const channelData =
    record.channelData &&
    typeof record.channelData === "object" &&
    !Array.isArray(record.channelData)
      ? (record.channelData as Record<string, unknown>)
      : undefined;
  const vk =
    channelData?.vk && typeof channelData.vk === "object" && !Array.isArray(channelData.vk)
      ? (channelData.vk as Record<string, unknown>)
      : undefined;
  return vk;
}

function emitVkFlowDebug(event: string, data: Record<string, unknown>): void {
  if (process.env.OPENCLAW_VK_DEBUG_FLOW !== "1") {
    return;
  }
  console.warn(`[vk-flow] ${JSON.stringify({ event, ...data })}`);
}

function resolveVkCommandReplyMenuBehavior(params: {
  account: ResolvedVkAccount;
  rawBody: string;
}): VkMenuBehavior | undefined {
  if (params.account.config.transport !== "long-poll") {
    return undefined;
  }
  return params.rawBody.trim().startsWith("/") ? "root" : undefined;
}

function attachVkMenuBehavior(payload: unknown, menuBehavior: VkMenuBehavior): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  const channelData =
    record.channelData &&
    typeof record.channelData === "object" &&
    !Array.isArray(record.channelData)
      ? (record.channelData as Record<string, unknown>)
      : {};
  const vk =
    channelData.vk && typeof channelData.vk === "object" && !Array.isArray(channelData.vk)
      ? (channelData.vk as Record<string, unknown>)
      : {};

  return {
    ...record,
    channelData: {
      ...channelData,
      vk: {
        ...vk,
        menuBehavior,
      },
    },
  };
}

function buildVkCloseMenuPayload(account: ResolvedVkAccount): {
  text: string;
  channelData: {
    vk: {
      menuBehavior: VkMenuBehavior;
    };
  };
} {
  if (account.config.transport === "long-poll") {
    return {
      text: "Menu collapsed. Tap Menu to reopen.",
      channelData: {
        vk: {
          menuBehavior: "collapse",
        },
      },
    };
  }

  return {
    text: "Menu hidden. Tap Menu to reopen.",
    channelData: {
      vk: {
        menuBehavior: "collapse",
      },
    },
  };
}

function normalizeVkAllowEntry(entry: string): string | "*" | null {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === "*") {
    return "*";
  }

  const normalized = trimmed.replace(/^vk:(?:user:)?/i, "");
  return /^\d+$/u.test(normalized) ? normalized : null;
}

function isVkSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  for (const entry of allowFrom) {
    const normalized = normalizeVkAllowEntry(entry);
    if (!normalized) {
      continue;
    }
    if (normalized === "*" || normalized === senderId) {
      return true;
    }
  }
  return false;
}

function resolveVkGroupConfig(account: ResolvedVkAccount, peerId: number) {
  const wildcard = account.config.groups?.["*"];
  const specific = account.config.groups?.[String(peerId)];

  if (!wildcard && !specific) {
    return undefined;
  }

  return {
    ...wildcard,
    ...specific,
  };
}

function buildVkConversationLabel(message: VkInboundMessage): string {
  return message.isGroupChat
    ? `VK chat ${String(message.peerId)}`
    : `VK user ${String(message.senderId)}`;
}

function summarizeVkRawUpdateForDebug(message: VkInboundMessage): Record<string, unknown> {
  const envelope =
    message.rawUpdate && typeof message.rawUpdate === "object" && !Array.isArray(message.rawUpdate)
      ? (message.rawUpdate as Record<string, unknown>)
      : null;
  const objectRecord =
    envelope?.object && typeof envelope.object === "object" && !Array.isArray(envelope.object)
      ? (envelope.object as Record<string, unknown>)
      : null;
  const nestedMessage =
    objectRecord?.message &&
    typeof objectRecord.message === "object" &&
    !Array.isArray(objectRecord.message)
      ? (objectRecord.message as Record<string, unknown>)
      : null;
  const candidateAttachments = [nestedMessage?.attachments, objectRecord?.attachments].find(
    Array.isArray,
  );

  return {
    eventType: envelope?.type,
    normalizedTextLength: message.text.length,
    normalizedAttachmentCount: message.attachments?.length ?? 0,
    objectKeys: objectRecord ? Object.keys(objectRecord).slice(0, 20) : [],
    messageKeys: nestedMessage ? Object.keys(nestedMessage).slice(0, 30) : [],
    rawAttachmentCount: Array.isArray(candidateAttachments) ? candidateAttachments.length : 0,
    rawAttachmentKinds: Array.isArray(candidateAttachments)
      ? candidateAttachments
          .map((entry) =>
            entry && typeof entry === "object" && !Array.isArray(entry)
              ? String((entry as Record<string, unknown>).type ?? "unknown")
              : typeof entry,
          )
          .slice(0, 10)
      : [],
  };
}

function listVkInboundAttachmentKinds(
  attachments: VkInboundAttachment[] | undefined,
): VkInboundAttachment["kind"][] {
  const uniqueKinds = new Set<VkInboundAttachment["kind"]>();
  for (const attachment of attachments ?? []) {
    uniqueKinds.add(attachment.kind);
  }
  return [...uniqueKinds];
}

function listVkInboundAttachmentTitles(
  attachments: VkInboundAttachment[] | undefined,
): string[] {
  const uniqueTitles = new Set<string>();
  for (const attachment of attachments ?? []) {
    const title = attachment.title?.trim();
    if (title) {
      uniqueTitles.add(title);
    }
  }
  return [...uniqueTitles];
}

function renderVkInboundAttachmentKinds(
  attachments: VkInboundAttachment[] | undefined,
): string {
  const kinds = listVkInboundAttachmentKinds(attachments);
  return kinds.length > 0 ? kinds.join(",") : "none";
}

function buildVkAttachmentOnlyPrompt(
  attachments: VkInboundAttachment[] | undefined,
): string | undefined {
  const kinds = listVkInboundAttachmentKinds(attachments);
  if (kinds.length === 0) {
    return undefined;
  }

  const titles = listVkInboundAttachmentTitles(attachments);
  const titleLine =
    titles.length > 0 ? `Attachment titles: ${titles.join("; ")}.` : undefined;

  if (kinds.length === 1 && kinds[0] === "image") {
    return [
      "[User sent an image without caption]",
      titleLine,
      "If you can inspect the image, describe it.",
      "If you cannot inspect it with the current model, explicitly say that an image was received but cannot be analyzed right now.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  if (kinds.length === 1 && kinds[0] === "audio_message") {
    return [
      "[User sent a voice or audio attachment without caption]",
      titleLine,
      "If you can inspect the audio, transcribe or describe it.",
      "If you cannot inspect it with the current model, explicitly say that a voice or audio attachment was received but cannot be analyzed right now.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  if (kinds.length === 1 && kinds[0] === "document") {
    return [
      "[User sent a document without caption]",
      titleLine,
      "If you can inspect the document, summarize or describe it.",
      "If you cannot inspect it with the current model, explicitly say that a document was received but cannot be analyzed right now.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  return [
    "[User sent media attachments without caption]",
    titleLine,
    "If you can inspect the attachments, describe each one.",
    "If you cannot inspect them with the current model, explicitly say that media attachments were received but cannot be analyzed right now.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

async function delayVkAttachmentHydration(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveVkInboundMediaContext(message: VkInboundMessage): Record<string, unknown> | undefined {
  const attachments = message.attachments?.filter(
    (attachment) => typeof attachment.url === "string" && attachment.url.trim().length > 0,
  );
  if (!attachments?.length) {
    return undefined;
  }

  const mediaUrls = attachments.map((attachment) => attachment.url.trim());
  const mediaTypes = attachments
    .map((attachment) => attachment.contentType?.trim())
    .filter((value): value is string => Boolean(value));
  const mediaKinds = listVkInboundAttachmentKinds(attachments);
  const mediaTitles = listVkInboundAttachmentTitles(attachments);

  const first = attachments[0];
  return {
    MediaUrl: first.url,
    MediaUrls: mediaUrls,
    ...(first.contentType ? { MediaType: first.contentType } : {}),
    ...(mediaTypes.length > 0 ? { MediaTypes: mediaTypes } : {}),
    ...(mediaKinds.length > 0 ? { MediaKind: mediaKinds[0], MediaKinds: mediaKinds } : {}),
    ...(mediaTitles.length > 0
      ? { MediaTitle: mediaTitles[0], MediaTitles: mediaTitles }
      : {}),
  };
}

async function hydrateVkInboundMessageAttachments(params: {
  account: ResolvedVkAccount;
  message: VkInboundMessage;
  log?: VkInboundLog;
}): Promise<VkInboundMessage> {
  if ((params.message.attachments?.length ?? 0) > 0) {
    return params.message;
  }

  if (
    params.message.transport !== "long-poll" ||
    params.message.isGroupChat ||
    params.message.text.trim().length > 0 ||
    !params.message.conversationMessageId
  ) {
    return params.message;
  }

  try {
    for (const [attemptIndex, delayMs] of VK_ATTACHMENT_HYDRATION_RETRY_DELAYS_MS.entries()) {
      await delayVkAttachmentHydration(delayMs);

      const attachments = await getVkMessageAttachmentsByConversationMessageId({
        token: params.account.token,
        peerId: params.message.peerId,
        conversationMessageId: params.message.conversationMessageId,
        apiVersion: params.account.config.apiVersion,
      });
      if (!attachments?.length) {
        if (attemptIndex < VK_ATTACHMENT_HYDRATION_RETRY_DELAYS_MS.length - 1) {
          params.log?.debug?.(
            `[${params.account.accountId}] VK inbound attachment hydration pending for ${params.message.messageId} via conversation message ${params.message.conversationMessageId} (attempt ${String(attemptIndex + 1)}/${String(VK_ATTACHMENT_HYDRATION_RETRY_DELAYS_MS.length)})`,
          );
          continue;
        }
        return params.message;
      }
      params.log?.debug?.(
        `[${params.account.accountId}] hydrated VK inbound attachments for ${params.message.messageId} via conversation message ${params.message.conversationMessageId} on attempt ${String(attemptIndex + 1)}`,
      );
      return {
        ...params.message,
        attachments,
      };
    }

    return params.message;
  } catch (error) {
    params.log?.warn?.(
      `[${params.account.accountId}] failed hydrating VK inbound attachments for ${params.message.messageId}: ${String(error)}`,
    );
    return params.message;
  }
}

function resolveVkEffectiveInboundBody(params: {
  message: VkInboundMessage;
  inboundMediaContext?: Record<string, unknown>;
}): string | undefined {
  const textBody = resolveVkInboundBody(params.message);
  if (textBody) {
    return textBody;
  }
  if (!params.inboundMediaContext) {
    return undefined;
  }
  // Keep attachment-only turns actionable for models that would otherwise see
  // only a bare placeholder and decide not to answer. Make the prompt specific
  // enough that image/audio/document fallbacks stay accurate.
  return buildVkAttachmentOnlyPrompt(params.message.attachments);
}

function isVkAttachmentOnlyMessage(params: {
  message: VkInboundMessage;
  inboundMediaContext?: Record<string, unknown>;
}): boolean {
  return !resolveVkInboundBody(params.message) && Boolean(params.inboundMediaContext);
}

function resolveVkGroupCommandAuthorization(params: {
  cfg: OpenClawConfig;
  account: ResolvedVkAccount;
  senderId: string;
  rawBody: string;
  groupAllowFrom: string[];
  runtime: ReturnType<typeof getVkRuntime>;
}): boolean | undefined {
  const shouldComputeAuth = params.runtime.channel.commands.shouldComputeCommandAuthorized(
    params.rawBody,
    params.cfg,
  );
  if (!shouldComputeAuth) {
    return undefined;
  }

  const ownerAllowFrom = params.account.config.allowFrom ?? [];
  if (ownerAllowFrom.length === 0 && params.groupAllowFrom.length === 0) {
    return true;
  }
  return params.runtime.channel.commands.resolveCommandAuthorizedFromAuthorizers({
    useAccessGroups: params.cfg.commands?.useAccessGroups !== false,
    authorizers: [
      {
        configured: ownerAllowFrom.length > 0,
        allowed: isVkSenderAllowed(params.senderId, ownerAllowFrom),
      },
      {
        configured: params.groupAllowFrom.length > 0,
        allowed: isVkSenderAllowed(params.senderId, params.groupAllowFrom),
      },
    ],
  });
}

async function deliverVkReply(params: {
  cfg: OpenClawConfig;
  accountId: string;
  to: string;
  replyToId?: string;
  editConversationMessageId?: string;
  payload: unknown;
  statusSink?: VkInboundStatusSink;
}) {
  const payloadText =
    params.payload && typeof params.payload === "object" && !Array.isArray(params.payload)
      ? ((params.payload as Record<string, unknown>).text as string | undefined)
      : undefined;
  emitVkFlowDebug("deliver", {
    accountId: params.accountId,
    to: params.to,
    replyToId: params.replyToId,
    editConversationMessageId: params.editConversationMessageId,
    payloadText: payloadText?.slice(0, 120),
    channelDataVk: resolveVkFlowDebugChannelData(params.payload),
  });

  await sendVkResolvedOutboundPayload({
    cfg: params.cfg,
    to: params.to,
    accountId: params.accountId,
    replyToId: params.replyToId,
    payload: params.payload as never,
    editConversationMessageId: params.editConversationMessageId ?? null,
  });

  params.statusSink?.({ lastOutboundAt: Date.now() });
}

function createVkTypingCallbacks(params: {
  account: ResolvedVkAccount;
  message: VkInboundMessage;
  log?: VkInboundLog;
}) {
  return createTypingCallbacks({
    start: async () => {
      await sendVkTyping({
        account: params.account,
        peerId: params.message.peerId,
      });
    },
    onStartError: (error) => {
      params.log?.warn?.(
        `[${params.account.accountId}] VK typing activity failed: ${String(error)}`,
      );
    },
  });
}

export async function handleVkInboundMessage(params: {
  cfg: OpenClawConfig;
  account: ResolvedVkAccount;
  message: VkInboundMessage;
  accessController?: VkAccessController;
  log?: VkInboundLog;
  statusSink?: VkInboundStatusSink;
}): Promise<void> {
  const { cfg, account, message, accessController, log, statusSink } = params;
  const ingressTimingEnabled = process.env.OPENCLAW_DEBUG_INGRESS_TIMING === "1";
  const inboundStartedAt = ingressTimingEnabled ? Date.now() : 0;
  const traceInbound = (step: string) => {
    if (!ingressTimingEnabled) {
      return;
    }
    log?.debug?.(
      `[${account.accountId}] VK inbound ${step} message=${message.messageId} elapsedMs=${Date.now() - inboundStartedAt}`,
    );
  };

  traceInbound("start");
  const effectiveMessage = await hydrateVkInboundMessageAttachments({
    account,
    message,
    log,
  });
  const inboundMediaContext = resolveVkInboundMediaContext(effectiveMessage);
  const isAttachmentOnlyMessage = isVkAttachmentOnlyMessage({
    message: effectiveMessage,
    inboundMediaContext,
  });
  const inboundBody = resolveVkEffectiveInboundBody({
    message: effectiveMessage,
    inboundMediaContext,
  });
  if (!inboundBody) {
    log?.debug?.(
      `[${account.accountId}] skipping VK message ${effectiveMessage.messageId} without text content`,
    );
    if (!effectiveMessage.isGroupChat) {
      log?.warn?.(
        `[${account.accountId}] VK empty DM skipped ${effectiveMessage.messageId}: ${JSON.stringify(
          summarizeVkRawUpdateForDebug(effectiveMessage),
        )}`,
      );
    }
    return;
  }
  const rawBody = normalizeVkCommandShortcut(inboundBody);
  const payloadCommand = resolveVkCommandFromPayload(message.messagePayload);
  const suggestionBody = payloadCommand ?? normalizeVkCommandShortcut(effectiveMessage.text);
  emitVkFlowDebug("inbound", {
    accountId: account.accountId,
    transport: account.config.transport,
    messageId: effectiveMessage.messageId,
    peerId: effectiveMessage.peerId,
    senderId: effectiveMessage.senderId,
    isGroupChat: effectiveMessage.isGroupChat,
    rawBody,
    payloadCommand,
    attachmentKinds: listVkInboundAttachmentKinds(effectiveMessage.attachments),
  });

  traceInbound("body-ready");
  const core = getVkRuntime();
  const replyToId = undefined;
  const rememberedInteractiveMessageId = rawBody.trim().startsWith("/")
    ? resolveRememberedVkInteractiveMessageId({
        accountId: account.accountId,
        peerId: String(effectiveMessage.peerId),
      })
    : undefined;
  const commandReplyMenuBehavior = resolveVkCommandReplyMenuBehavior({
    account,
    rawBody,
  });
  // Long-poll reply-keyboard commands arrive as fresh user messages. Only
  // synthetic callback events should edit an existing interactive menu.
  const editConversationMessageId =
    resolveVkInboundEditConversationMessageId(effectiveMessage) ??
    (account.config.transport === "callback-api" ? rememberedInteractiveMessageId : undefined);
  statusSink?.({
    lastInboundAt: effectiveMessage.createdAt,
    lastEventAt: effectiveMessage.createdAt,
    lastMessageAt: effectiveMessage.createdAt,
    lastError: null,
  });
  const typingCallbacks = createVkTypingCallbacks({
    account,
    message: effectiveMessage,
    log,
  });
  traceInbound("runtime-ready");

  if (effectiveMessage.isGroupChat) {
    const groupAccess = accessController?.evaluateMessage({ account, message: effectiveMessage });
    const allowNormalizedGroupShortcut =
      groupAccess?.decision === "deny" &&
      groupAccess.reason === "group-mention-required" &&
      rawBody.trim().startsWith("/");
    if (groupAccess && groupAccess.decision !== "allow" && !allowNormalizedGroupShortcut) {
      log?.debug?.(
        `[${account.accountId}] dropping VK group message ${effectiveMessage.messageId} (${groupAccess.reason})`,
      );
      return;
    }

    const groupConfig = resolveVkGroupConfig(account, effectiveMessage.peerId);
    const authorization = resolveVkGroupCommandAuthorization({
      cfg,
      account,
      senderId: String(effectiveMessage.senderId),
      rawBody,
      groupAllowFrom: groupConfig?.allowFrom ?? account.config.groupAllowFrom ?? [],
      runtime: core,
    });

    if (authorization === false) {
      log?.debug?.(
        `[${account.accountId}] dropping VK group control command from ${String(message.senderId)}`,
      );
      return;
    }

    if (rawBody === VK_CLOSE_MENU_COMMAND) {
      await deliverVkReply({
        cfg,
        accountId: account.accountId,
        to: String(effectiveMessage.peerId),
        replyToId,
        editConversationMessageId,
        payload: buildVkCloseMenuPayload(account),
        statusSink,
      });
      return;
    }

    const groupSuggestionReply = resolveVkSlashCommandSuggestionReply(suggestionBody);
    if (groupSuggestionReply) {
      await deliverVkReply({
        cfg,
        accountId: account.accountId,
        to: String(effectiveMessage.peerId),
        replyToId,
        editConversationMessageId,
        payload: commandReplyMenuBehavior
          ? attachVkMenuBehavior(groupSuggestionReply, commandReplyMenuBehavior)
          : groupSuggestionReply,
        statusSink,
      });
      return;
    }

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: CHANNEL_ID,
      accountId: account.accountId,
      peer: {
        kind: "group",
        id: String(effectiveMessage.peerId),
      },
    });
    const storePath = core.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    const previousTimestamp = core.channel.session.readSessionUpdatedAt({
      storePath,
      sessionKey: route.sessionKey,
    });
    const conversationLabel = buildVkConversationLabel(effectiveMessage);
    const body = core.channel.reply.formatAgentEnvelope({
      channel: "VK",
      from: conversationLabel,
      timestamp: effectiveMessage.createdAt,
      previousTimestamp,
      envelope: core.channel.reply.resolveEnvelopeFormatOptions(cfg),
      body: rawBody,
    });
    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: body,
      BodyForAgent: rawBody,
      RawBody: rawBody,
      CommandBody: rawBody,
      From: `vk:user:${String(message.senderId)}`,
      To: `vk:conversation:${String(message.peerId)}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId ?? account.accountId,
      ChatType: "group",
      ConversationLabel: conversationLabel,
      SenderId: String(effectiveMessage.senderId),
      GroupSubject: conversationLabel,
      GroupChannel: String(effectiveMessage.peerId),
      WasMentioned: groupAccess?.wasMentioned,
      Provider: CHANNEL_ID,
      Surface: CHANNEL_ID,
      MessageSid: effectiveMessage.messageId,
      MessageSidFull: effectiveMessage.messageId,
        ReplyToId: replyToId,
        Timestamp: effectiveMessage.createdAt,
        OriginatingChannel: CHANNEL_ID,
        OriginatingTo: `vk:${String(effectiveMessage.peerId)}`,
        CommandAuthorized: authorization,
        ...(inboundMediaContext ?? {}),
      });

      await dispatchInboundReplyWithBaseCompat({
      cfg,
      channel: CHANNEL_ID,
      accountId: account.accountId,
      route,
      storePath,
      ctxPayload,
      core,
      deliver: async (payload) =>
        await deliverVkReply({
          cfg,
          accountId: account.accountId,
          to: String(effectiveMessage.peerId),
          replyToId,
          editConversationMessageId,
          payload: commandReplyMenuBehavior
            ? attachVkMenuBehavior(payload, commandReplyMenuBehavior)
            : payload,
          statusSink,
        }),
      onRecordError: (error) => {
        const rendered = String(error);
        statusSink?.({ lastError: rendered });
        log?.warn?.(`[${account.accountId}] failed recording VK session: ${rendered}`);
      },
      onDispatchError: (error, info) => {
        const rendered = String(error);
        statusSink?.({ lastError: rendered });
        log?.error?.(`[${account.accountId}] VK ${info.kind} reply failed: ${rendered}`);
      },
      typingCallbacks,
    });
    return;
  }

  const consentState = accessController?.getConsentState({
    accountId: account.accountId,
    senderId: effectiveMessage.senderId,
  });
  if (consentState === "denied") {
    log?.debug?.(
      `[${account.accountId}] dropping VK DM ${effectiveMessage.messageId} because consent is denied`,
    );
    return;
  }

  const pairing = createChannelPairingController({
    core,
    channel: CHANNEL_ID,
      accountId: account.accountId,
    });
  traceInbound("before-dm-access");
  const dmAccess = await resolveInboundDirectDmAccessWithRuntime({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    dmPolicy: account.config.dmPolicy,
    allowFrom: account.config.allowFrom,
    senderId: String(effectiveMessage.senderId),
    rawBody,
    isSenderAllowed: isVkSenderAllowed,
    runtime: {
      shouldComputeCommandAuthorized: core.channel.commands.shouldComputeCommandAuthorized,
      resolveCommandAuthorizedFromAuthorizers:
        core.channel.commands.resolveCommandAuthorizedFromAuthorizers,
    },
    readStoreAllowFrom: pairing.readStoreForDmPolicy,
  });
  traceInbound("after-dm-access");

  if (dmAccess.access.decision === "pairing") {
    await pairing.issueChallenge({
      senderId: String(message.senderId),
      senderIdLine: `Your VK user id: ${String(message.senderId)}`,
      sendPairingReply: async (text) => {
        await sendVkText({
          account,
          peerId: message.peerId,
          text,
        });
        statusSink?.({ lastOutboundAt: Date.now() });
      },
      onReplyError: (error) => {
        log?.warn?.(`[${account.accountId}] failed sending VK pairing challenge: ${String(error)}`);
      },
    });
    log?.debug?.(
      `[${account.accountId}] dropping VK DM ${message.messageId} pending pairing approval`,
    );
    return;
  }

  if (dmAccess.access.decision !== "allow") {
    log?.debug?.(
      `[${account.accountId}] dropping VK DM ${message.messageId} (${dmAccess.access.reason})`,
    );
    return;
  }

  if (rawBody === VK_CLOSE_MENU_COMMAND) {
    await deliverVkReply({
      cfg,
      accountId: account.accountId,
      to: String(effectiveMessage.peerId),
      replyToId,
      editConversationMessageId,
      payload: buildVkCloseMenuPayload(account),
      statusSink,
    });
    return;
  }

  const dmSuggestionReply = resolveVkSlashCommandSuggestionReply(suggestionBody);
  if (dmSuggestionReply) {
    await deliverVkReply({
      cfg,
      accountId: account.accountId,
      to: String(effectiveMessage.peerId),
      replyToId,
      editConversationMessageId,
      payload: commandReplyMenuBehavior
        ? attachVkMenuBehavior(dmSuggestionReply, commandReplyMenuBehavior)
        : dmSuggestionReply,
      statusSink,
    });
    return;
  }

  traceInbound("before-dm-dispatch");
  const dmDispatchStartedAt = isAttachmentOnlyMessage ? Date.now() : 0;
  if (isAttachmentOnlyMessage) {
    log?.warn?.(
      `[${account.accountId}] VK attachment-only DM dispatch start message=${effectiveMessage.messageId} peer=${effectiveMessage.peerId} kinds=${renderVkInboundAttachmentKinds(
        effectiveMessage.attachments,
      )}`,
    );
  }
  await dispatchInboundDirectDmWithRuntimeCompat({
    cfg,
    runtime: core,
    channel: CHANNEL_ID,
    channelLabel: "VK",
    accountId: account.accountId,
    peer: {
      kind: "direct",
      id: String(effectiveMessage.senderId),
    },
    senderId: String(effectiveMessage.senderId),
    senderAddress: `vk:user:${String(effectiveMessage.senderId)}`,
    recipientAddress: `vk:${String(effectiveMessage.peerId)}`,
      conversationLabel: buildVkConversationLabel(effectiveMessage),
      rawBody,
      messageId: effectiveMessage.messageId,
      timestamp: effectiveMessage.createdAt,
      commandAuthorized: dmAccess.commandAuthorized,
      extraContext: inboundMediaContext,
      deliver: async (payload) =>
        await deliverVkReply({
          cfg,
        accountId: account.accountId,
        to: String(effectiveMessage.peerId),
        replyToId,
        editConversationMessageId,
        payload: commandReplyMenuBehavior
          ? attachVkMenuBehavior(payload, commandReplyMenuBehavior)
          : payload,
        statusSink,
      }),
    onRecordError: (error) => {
      const rendered = String(error);
      statusSink?.({ lastError: rendered });
      log?.warn?.(`[${account.accountId}] failed recording VK session: ${rendered}`);
    },
    onDispatchError: (error, info) => {
      const rendered = String(error);
      statusSink?.({ lastError: rendered });
      log?.error?.(`[${account.accountId}] VK ${info.kind} reply failed: ${rendered}`);
    },
    typingCallbacks,
  });
  if (isAttachmentOnlyMessage) {
    log?.warn?.(
      `[${account.accountId}] VK attachment-only DM dispatch done message=${effectiveMessage.messageId} elapsedMs=${Date.now() - dmDispatchStartedAt}`,
    );
  }
  traceInbound("after-dm-dispatch");
}
