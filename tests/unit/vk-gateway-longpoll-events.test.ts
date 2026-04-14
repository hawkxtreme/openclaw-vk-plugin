import { beforeEach, describe, expect, it, vi } from "vitest";

const handleVkInboundMessageMock = vi.hoisted(() => vi.fn());
const resolveLatestVkInteractiveMenuIdMock = vi.hoisted(() => vi.fn());
const retireVkInteractiveMenuMock = vi.hoisted(() => vi.fn());
const createVkLongPollMonitorMock = vi.hoisted(() => vi.fn());
const sendVkMessageEventAnswerMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../src/inbound.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/inbound.js")>();
  return {
    ...actual,
    handleVkInboundMessage: handleVkInboundMessageMock,
  };
});

vi.mock("../../src/interactive-menu.ts", () => ({
  resolveLatestVkInteractiveMenuId: resolveLatestVkInteractiveMenuIdMock,
  retireVkInteractiveMenu: retireVkInteractiveMenuMock,
}));

vi.mock("../../src/vk-core/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/vk-core/index.js")>();
  return {
    ...actual,
    createVkLongPollMonitor: createVkLongPollMonitorMock,
    sendVkMessageEventAnswer: sendVkMessageEventAnswerMock,
  };
});

import { resolveVkAccount } from "../../src/accounts.js";
import { vkGatewayAdapter } from "../../src/gateway.js";
import type { OpenClawConfig } from "../../src/types.js";

describe("vk gateway long-poll events", () => {
  beforeEach(() => {
    handleVkInboundMessageMock.mockReset();
    resolveLatestVkInteractiveMenuIdMock.mockReset();
    retireVkInteractiveMenuMock.mockReset();
    createVkLongPollMonitorMock.mockReset();
    sendVkMessageEventAnswerMock.mockReset();
    resolveLatestVkInteractiveMenuIdMock.mockResolvedValue(undefined);
  });

  it("handles long-poll message_event callbacks and answers with a snackbar", async () => {
    createVkLongPollMonitorMock.mockImplementation(
      (options: {
        onConsent?: (event: unknown) => Promise<void> | void;
        onInteractiveEvent?: (event: {
          accountId: string;
          groupId: number;
          transport: "long-poll";
          eventType: "message_event";
          eventId?: string;
          dedupeKey: string;
          callbackEventId: string;
          senderId: number;
          peerId: number;
          conversationMessageId?: string;
          payload?: unknown;
          rawUpdate: unknown;
        }) => Promise<void> | void;
        onStatusChange?: (status: {
          state: "running";
          active: true;
          connected: true;
          accountId: string;
          transport: "long-poll";
          receivedEvents: number;
          deliveredEvents: number;
          dedupedEvents: number;
          reconnectAttempts: number;
        }) => void;
      }) => ({
        start: async () => {
          options.onStatusChange?.({
            state: "running",
            active: true,
            connected: true,
            accountId: "default",
            transport: "long-poll",
            receivedEvents: 2,
            deliveredEvents: 2,
            dedupedEvents: 0,
            reconnectAttempts: 0,
          });
          await options.onConsent?.({
            accountId: "default",
            groupId: 77,
            eventType: "message_allow",
            eventId: "evt-allow-1",
            dedupeKey: "event:evt-allow-1",
            senderId: 42,
            consentState: "allowed",
            createdAt: 1_700_000_200_000,
            rawUpdate: {},
          });
          await options.onInteractiveEvent?.({
            accountId: "default",
            groupId: 77,
            transport: "long-poll",
            eventType: "message_event",
            eventId: "evt-event-1",
            dedupeKey: "event:evt-event-1",
            callbackEventId: "callback-event-1",
            senderId: 42,
            peerId: 42,
            conversationMessageId: "18",
            payload: { oc: "/commands" },
            rawUpdate: {},
          });
        },
        stop: vi.fn(),
        getStatus: () => ({
          state: "running" as const,
          active: true,
          connected: true,
          accountId: "default",
          transport: "long-poll" as const,
          receivedEvents: 2,
          deliveredEvents: 2,
          dedupedEvents: 0,
          reconnectAttempts: 0,
        }),
      }),
    );

    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "long-poll",
          accessToken: "replace-me-longpoll-token",
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await vkGatewayAdapter.startAccount?.({
      cfg,
      accountId: "default",
      account,
      runtime: {} as never,
      abortSignal: new AbortController().signal,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getStatus: () => ({ accountId: "default" }),
      setStatus: vi.fn(),
    });

    expect(handleVkInboundMessageMock).toHaveBeenCalledTimes(1);
    expect(handleVkInboundMessageMock.mock.calls[0]?.[0]).toMatchObject({
      message: {
        transport: "long-poll",
        text: "/commands",
        messageId: "callback-event-1",
        conversationMessageId: "18",
        editConversationMessageId: "18",
        peerId: 42,
        senderId: 42,
      },
    });
    const firstAnswerCall = sendVkMessageEventAnswerMock.mock.calls[0] as unknown[] | undefined;
    const firstAnswer = firstAnswerCall?.[0] as Record<string, unknown> | undefined;
    expect(firstAnswer).toMatchObject({
      token: "replace-me-longpoll-token",
      eventId: "callback-event-1",
      userId: 42,
      peerId: 42,
      eventData: {
        type: "show_snackbar",
        text: "Opening menu...",
      },
      apiVersion: "5.199",
    });
  });

  it("normalizes localized long-poll interactive payload aliases before dispatch and snackbar reply", async () => {
    createVkLongPollMonitorMock.mockImplementation(
      (options: {
        onInteractiveEvent?: (event: {
          accountId: string;
          groupId: number;
          transport: "long-poll";
          eventType: "message_event";
          eventId?: string;
          dedupeKey: string;
          callbackEventId: string;
          senderId: number;
          peerId: number;
          conversationMessageId?: string;
          payload?: unknown;
          rawUpdate: unknown;
        }) => Promise<void> | void;
      }) => ({
        start: async () => {
          await options.onInteractiveEvent?.({
            accountId: "default",
            groupId: 77,
            transport: "long-poll",
            eventType: "message_event",
            eventId: "evt-event-localized-1",
            dedupeKey: "event:evt-event-localized-1",
            callbackEventId: "callback-event-localized-1",
            senderId: 42,
            peerId: 42,
            conversationMessageId: "19",
            payload: { oc: "/команды" },
            rawUpdate: {},
          });
        },
        stop: vi.fn(),
        getStatus: () => ({
          state: "running" as const,
          active: true,
          connected: true,
          accountId: "default",
          transport: "long-poll" as const,
          receivedEvents: 1,
          deliveredEvents: 1,
          dedupedEvents: 0,
          reconnectAttempts: 0,
        }),
      }),
    );

    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "long-poll",
          accessToken: "replace-me-longpoll-token",
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await vkGatewayAdapter.startAccount?.({
      cfg,
      accountId: "default",
      account,
      runtime: {} as never,
      abortSignal: new AbortController().signal,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getStatus: () => ({ accountId: "default" }),
      setStatus: vi.fn(),
    });

    expect(handleVkInboundMessageMock).toHaveBeenCalledTimes(1);
    expect(handleVkInboundMessageMock.mock.calls[0]?.[0]).toMatchObject({
      message: {
        transport: "long-poll",
        text: "/commands",
        messageId: "callback-event-localized-1",
        conversationMessageId: "19",
        editConversationMessageId: "19",
        peerId: 42,
        senderId: 42,
      },
    });
    const localizedAnswerCall = sendVkMessageEventAnswerMock.mock.calls[0] as
      | unknown[]
      | undefined;
    const localizedAnswer = localizedAnswerCall?.[0] as Record<string, unknown> | undefined;
    expect(localizedAnswer).toMatchObject({
      token: "replace-me-longpoll-token",
      eventId: "callback-event-localized-1",
      userId: 42,
      peerId: 42,
      eventData: {
        type: "show_snackbar",
        text: "Opening menu...",
      },
      apiVersion: "5.199",
    });
  });
});
