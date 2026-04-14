import { beforeEach, describe, expect, it, vi } from "vitest";

const beginWebhookRequestPipelineOrRejectMock = vi.hoisted(() =>
  vi.fn(() => ({
    ok: true as const,
    release: vi.fn(),
  })),
);
const createWebhookInFlightLimiterMock = vi.hoisted(() => vi.fn(() => ({ release: vi.fn() })));
const handleVkInboundMessageMock = vi.hoisted(() => vi.fn());
const readWebhookBodyOrRejectMock = vi.hoisted(() => vi.fn());
const registerPluginHttpRouteMock = vi.hoisted(() => vi.fn());
const interactiveEventAnswerMock = vi.hoisted(() => vi.fn());
const retireVkInteractiveMenuMock = vi.hoisted(() => vi.fn());
const resolveLatestVkInteractiveMenuIdMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/webhook-ingress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/webhook-ingress")>();
  return {
    ...actual,
    beginWebhookRequestPipelineOrReject: beginWebhookRequestPipelineOrRejectMock,
    createWebhookInFlightLimiter: createWebhookInFlightLimiterMock,
    readWebhookBodyOrReject: readWebhookBodyOrRejectMock,
    registerPluginHttpRoute: registerPluginHttpRouteMock,
  };
});

vi.mock("../../src/inbound.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/inbound.js")>();
  return {
    ...actual,
    handleVkInboundMessage: handleVkInboundMessageMock,
  };
});

vi.mock("../../src/interactive-menu.ts", () => ({
  retireVkInteractiveMenu: retireVkInteractiveMenuMock,
  resolveLatestVkInteractiveMenuId: resolveLatestVkInteractiveMenuIdMock,
}));

vi.mock("../../src/vk-core/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/vk-core/index.js")>();
  return {
    ...actual,
    createVkCallbackHandler: vi.fn(
      (options: {
        onInteractiveEvent?: (event: {
          accountId: string;
          groupId: number;
          transport: "callback-api";
          eventType: "message_event";
          eventId?: string;
          dedupeKey: string;
          callbackEventId: string;
          senderId: number;
          peerId: number;
          conversationMessageId?: string;
          payload?: unknown;
          rawUpdate: unknown;
        }) => unknown | Promise<unknown>;
      }) => {
        return async (request: { body?: string | unknown }) => {
          const envelope =
            typeof request.body === "string"
              ? (JSON.parse(request.body) as {
                  type?: string;
                  object?: {
                    peer_id?: number;
                    user_id?: number;
                    event_id?: string;
                    conversation_message_id?: number;
                    payload?: string;
                  };
                })
              : (request.body as {
                  type?: string;
                  object?: {
                    peer_id?: number;
                    user_id?: number;
                    event_id?: string;
                    conversation_message_id?: number;
                    payload?: string;
                  };
                });

          if (envelope?.type === "message_event") {
            const payload = envelope.object?.payload
              ? JSON.parse(envelope.object.payload)
              : undefined;
            const answer = await options.onInteractiveEvent?.({
              accountId: "default",
              groupId: 77,
              transport: "callback-api",
              eventType: "message_event",
              eventId: "evt-interactive-1",
              dedupeKey: "event:evt-interactive-1",
              callbackEventId: envelope.object?.event_id ?? "callback-event-1",
              senderId: envelope.object?.user_id ?? 42,
              peerId: envelope.object?.peer_id ?? -237442417,
              conversationMessageId: String(envelope.object?.conversation_message_id ?? 72),
              payload,
              rawUpdate: envelope,
            });
            interactiveEventAnswerMock(answer);
            return {
              statusCode: 200,
              body: "ok",
              eventType: "message_event",
              accountId: "default",
              duplicate: false,
            };
          }

          return {
            statusCode: 200,
            body: "ok",
            eventType: "rejected",
            accountId: "default",
            duplicate: false,
          };
        };
      },
    ),
  };
});

import { resolveVkAccount } from "../../src/accounts.js";
import { vkGatewayAdapter } from "../../src/gateway.js";
import {
  clearVkInteractiveMessageState,
  rememberVkInteractiveMessageId,
} from "../../src/interactive-state.js";
import type { OpenClawConfig } from "../../src/types.js";

function createResponseHarness() {
  return {
    res: {
      statusCode: 0,
      headersSent: false,
      setHeader: vi.fn(),
      end: vi.fn(function (this: { headersSent: boolean }, _body?: string) {
        this.headersSent = true;
      }),
    },
  };
}

describe("vk gateway interactive callbacks", () => {
  beforeEach(() => {
    handleVkInboundMessageMock.mockReset();
    registerPluginHttpRouteMock.mockReset();
    readWebhookBodyOrRejectMock.mockReset();
    interactiveEventAnswerMock.mockReset();
    retireVkInteractiveMenuMock.mockReset();
    resolveLatestVkInteractiveMenuIdMock.mockReset();
    clearVkInteractiveMessageState();
  });

  it("returns a snackbar answer for inline callback command buttons", async () => {
    let registeredHandler:
      | ((req: unknown, res: unknown) => Promise<boolean | void> | boolean | void)
      | undefined;
    registerPluginHttpRouteMock.mockImplementation((params) => {
      registeredHandler = params.handler;
      return vi.fn();
    });
    readWebhookBodyOrRejectMock.mockResolvedValue({
      ok: true,
      value: JSON.stringify({
        type: "message_event",
        group_id: 77,
        event_id: "evt-interactive-1",
        secret: "replace-me-callback-secret",
        object: {
          user_id: 42,
          peer_id: -237442417,
          event_id: "callback-event-1",
          conversation_message_id: 72,
          payload: JSON.stringify({ oc: "/models" }),
        },
      }),
    });

    const abortController = new AbortController();
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          callback: {
            path: "/plugins/vk/webhook/default",
            secret: "replace-me-callback-secret",
            confirmationCode: "confirm-77",
          },
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    const started = vkGatewayAdapter.startAccount?.({
      cfg,
      accountId: "default",
      account,
      runtime: {} as never,
      abortSignal: abortController.signal,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getStatus: () => ({ accountId: "default" }),
      setStatus: vi.fn(),
    });

    expect(registeredHandler).toBeTypeOf("function");
    const { res } = createResponseHarness();
    await registeredHandler?.({ method: "POST" }, res);

    expect(handleVkInboundMessageMock).toHaveBeenCalledTimes(1);
    expect(handleVkInboundMessageMock.mock.calls[0]?.[0]).toMatchObject({
      message: {
        messageId: "callback-event-1",
        conversationMessageId: "72",
        editConversationMessageId: "72",
        text: "/models",
      },
    });
    expect(interactiveEventAnswerMock).toHaveBeenCalledWith({
      eventData: {
        type: "show_snackbar",
        text: "Opening models...",
      },
    });

    abortController.abort();
    await started;
  });

  it("does not block callback responses on interactive command execution", async () => {
    let registeredHandler:
      | ((req: unknown, res: unknown) => Promise<boolean | void> | boolean | void)
      | undefined;
    registerPluginHttpRouteMock.mockImplementation((params) => {
      registeredHandler = params.handler;
      return vi.fn();
    });
    readWebhookBodyOrRejectMock.mockResolvedValue({
      ok: true,
      value: JSON.stringify({
        type: "message_event",
        group_id: 77,
        event_id: "evt-interactive-2",
        secret: "replace-me-callback-secret",
        object: {
          user_id: 42,
          peer_id: -237442417,
          event_id: "callback-event-2",
          conversation_message_id: 73,
          payload: JSON.stringify({ oc: "/commands" }),
        },
      }),
    });

    let releaseInbound!: () => void;
    handleVkInboundMessageMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseInbound = resolve;
        }),
    );

    const abortController = new AbortController();
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          callback: {
            path: "/plugins/vk/webhook/default",
            secret: "replace-me-callback-secret",
            confirmationCode: "confirm-77",
          },
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    const started = vkGatewayAdapter.startAccount?.({
      cfg,
      accountId: "default",
      account,
      runtime: {} as never,
      abortSignal: abortController.signal,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getStatus: () => ({ accountId: "default" }),
      setStatus: vi.fn(),
    });

    expect(registeredHandler).toBeTypeOf("function");
    const { res } = createResponseHarness();
    let settled = false;
    const handled = Promise.resolve(registeredHandler?.({ method: "POST" }, res)).then(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handleVkInboundMessageMock).toHaveBeenCalledTimes(1);
    expect(interactiveEventAnswerMock).toHaveBeenCalledWith({
      eventData: {
        type: "show_snackbar",
        text: "Opening menu...",
      },
    });
    expect(settled).toBe(true);

    releaseInbound();
    await handled;
    abortController.abort();
    await started;
  });

  it("rejects stale interactive buttons from an older VK menu", async () => {
    let registeredHandler:
      | ((req: unknown, res: unknown) => Promise<boolean | void> | boolean | void)
      | undefined;
    registerPluginHttpRouteMock.mockImplementation((params) => {
      registeredHandler = params.handler;
      return vi.fn();
    });
    readWebhookBodyOrRejectMock.mockResolvedValue({
      ok: true,
      value: JSON.stringify({
        type: "message_event",
        group_id: 77,
        event_id: "evt-interactive-stale",
        secret: "replace-me-callback-secret",
        object: {
          user_id: 42,
          peer_id: -237442417,
          event_id: "callback-event-stale",
          conversation_message_id: 72,
          payload: JSON.stringify({ oc: "/models" }),
        },
      }),
    });

    rememberVkInteractiveMessageId({
      accountId: "default",
      peerId: "-237442417",
      conversationMessageId: "90",
    });

    const abortController = new AbortController();
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          callback: {
            path: "/plugins/vk/webhook/default",
            secret: "replace-me-callback-secret",
            confirmationCode: "confirm-77",
          },
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    const started = vkGatewayAdapter.startAccount?.({
      cfg,
      accountId: "default",
      account,
      runtime: {} as never,
      abortSignal: abortController.signal,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getStatus: () => ({ accountId: "default" }),
      setStatus: vi.fn(),
    });

    const { res } = createResponseHarness();
    await registeredHandler?.({ method: "POST" }, res);

    expect(handleVkInboundMessageMock).not.toHaveBeenCalled();
    expect(retireVkInteractiveMenuMock).toHaveBeenCalledWith({
      account,
      peerId: -237442417,
      conversationMessageId: "72",
      log: expect.any(Object),
    });
    expect(interactiveEventAnswerMock).toHaveBeenCalledWith({
      eventData: {
        type: "show_snackbar",
        text: "This menu is outdated. Open Menu again.",
      },
    });

    abortController.abort();
    await started;
  });

  it("restores the current menu id before rejecting stale callbacks after a restart", async () => {
    let registeredHandler:
      | ((req: unknown, res: unknown) => Promise<boolean | void> | boolean | void)
      | undefined;
    registerPluginHttpRouteMock.mockImplementation((params) => {
      registeredHandler = params.handler;
      return vi.fn();
    });
    readWebhookBodyOrRejectMock.mockResolvedValue({
      ok: true,
      value: JSON.stringify({
        type: "message_event",
        group_id: 77,
        event_id: "evt-interactive-restart",
        secret: "replace-me-callback-secret",
        object: {
          user_id: 42,
          peer_id: -237442417,
          event_id: "callback-event-restart",
          conversation_message_id: 72,
          payload: JSON.stringify({ oc: "/models" }),
        },
      }),
    });
    resolveLatestVkInteractiveMenuIdMock.mockResolvedValue("90");

    const abortController = new AbortController();
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          callback: {
            path: "/plugins/vk/webhook/default",
            secret: "replace-me-callback-secret",
            confirmationCode: "confirm-77",
          },
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    const started = vkGatewayAdapter.startAccount?.({
      cfg,
      accountId: "default",
      account,
      runtime: {} as never,
      abortSignal: abortController.signal,
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getStatus: () => ({ accountId: "default" }),
      setStatus: vi.fn(),
    });

    const { res } = createResponseHarness();
    await registeredHandler?.({ method: "POST" }, res);

    expect(resolveLatestVkInteractiveMenuIdMock).toHaveBeenCalledWith({
      account,
      peerId: "-237442417",
    });
    expect(handleVkInboundMessageMock).not.toHaveBeenCalled();
    expect(retireVkInteractiveMenuMock).toHaveBeenCalledWith({
      account,
      peerId: -237442417,
      conversationMessageId: "72",
      log: expect.any(Object),
    });
    expect(interactiveEventAnswerMock).toHaveBeenCalledWith({
      eventData: {
        type: "show_snackbar",
        text: "This menu is outdated. Open Menu again.",
      },
    });

    abortController.abort();
    await started;
  });
});
