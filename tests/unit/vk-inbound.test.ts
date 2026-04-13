import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dispatchInboundDirectDmWithRuntimeMock = vi.hoisted(() => vi.fn());
const resolveInboundDirectDmAccessWithRuntimeMock = vi.hoisted(() => vi.fn());
const dispatchInboundReplyWithBaseMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/channel-inbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/channel-inbound")>();
  return {
    ...actual,
    dispatchInboundDirectDmWithRuntime: dispatchInboundDirectDmWithRuntimeMock,
  };
});

vi.mock("openclaw/plugin-sdk/direct-dm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/direct-dm")>();
  return {
    ...actual,
    resolveInboundDirectDmAccessWithRuntime: resolveInboundDirectDmAccessWithRuntimeMock,
  };
});

vi.mock("openclaw/plugin-sdk/inbound-reply-dispatch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("openclaw/plugin-sdk/inbound-reply-dispatch")>();
  return {
    ...actual,
    dispatchInboundReplyWithBase: dispatchInboundReplyWithBaseMock,
  };
});

import { resolveVkAccount } from "../../src/accounts.js";
import { handleVkInboundMessage } from "../../src/inbound.js";
import {
  clearVkInteractiveMessageState,
  rememberVkInteractiveMessageId,
} from "../../src/interactive-state.js";
import { clearVkRuntime, setVkRuntime } from "../../src/runtime.js";
import type { OpenClawConfig } from "../../src/types.js";
import { createVkAccessController } from "../../src/vk-core/inbound/access.js";

function createRuntimeMock() {
  return {
    channel: {
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "agent-1",
          sessionKey: "session-1",
          accountId: "default",
        })),
      },
      session: {
        resolveStorePath: vi.fn(() => ".openclaw/sessions"),
        readSessionUpdatedAt: vi.fn(() => undefined),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({})),
        formatAgentEnvelope: vi.fn(({ body }) => `ENV:${String(body)}`),
        finalizeInboundContext: vi.fn((payload) => payload),
      },
      commands: {
        shouldComputeCommandAuthorized: vi.fn(() => false),
        resolveCommandAuthorizedFromAuthorizers: vi.fn(() => true),
      },
    },
  };
}

describe("vk inbound handling", () => {
  beforeEach(() => {
    dispatchInboundDirectDmWithRuntimeMock.mockReset();
    resolveInboundDirectDmAccessWithRuntimeMock.mockReset();
    dispatchInboundReplyWithBaseMock.mockReset();
    setVkRuntime(createRuntimeMock() as never);
  });

  afterEach(() => {
    clearVkRuntime();
    clearVkInteractiveMessageState();
  });

  it("routes direct messages through the direct-DM dispatcher", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:1",
        messageId: "501",
        peerId: 42,
        senderId: 42,
        text: "hello from vk",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).toHaveBeenCalledTimes(1);
    expect(dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0]).toMatchObject({
      channel: "vk",
      channelLabel: "VK",
      accountId: "default",
      peer: {
        kind: "direct",
        id: "42",
      },
      senderId: "42",
      messageId: "501",
      commandAuthorized: true,
    });
  });

  it("sends standalone DM replies without VK reply_to threading", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    let requestedUrl: URL | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 9510,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:standalone-dm-1",
        messageId: "510",
        peerId: 42,
        senderId: 42,
        text: "show status",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    const params = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await params?.deliver?.({
      text: "Standalone VK reply",
    });

    expect(requestedUrl?.pathname).toBe("/method/messages.send");
    expect(requestedUrl?.searchParams.get("peer_id")).toBe("42");
    expect(requestedUrl?.searchParams.get("message")).toBe("Standalone VK reply");
    expect(requestedUrl?.searchParams.get("reply_to")).toBeNull();
  });

  it("prefers hidden VK payload commands over visible button labels in DMs", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:payload-1",
        messageId: "502",
        peerId: 42,
        senderId: 42,
        text: "OpenAI",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
        messagePayload: { oc: "/models openai" },
      } as never,
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).toHaveBeenCalledTimes(1);
    expect(dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0]).toMatchObject({
      rawBody: "/models openai",
    });
  });

  it("uses plain-string VK payload commands over visible button labels in DMs", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:payload-2",
        messageId: "504",
        peerId: 42,
        senderId: 42,
        text: "OpenAI",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
        messagePayload: "/models openai",
      } as never,
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).toHaveBeenCalledTimes(1);
    expect(dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0]).toMatchObject({
      rawBody: "/models openai",
    });
  });

  it("routes a bare slash to the command menu in DMs", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrls.push(new URL(String(input)));
        return new Response(
          JSON.stringify({
            response: 9501,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:slash-menu-1",
        messageId: "505",
        peerId: 42,
        senderId: 42,
        text: "/",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).not.toHaveBeenCalled();
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe(
      "VK uses buttons for command menus. Choose a command:",
    );
    const keyboard = JSON.parse(sendUrl?.searchParams.get("keyboard") ?? "{}");
    expect(Object.hasOwn(keyboard, "one_time")).toBe(true);
    expect(keyboard.one_time).toBe(false);
    expect(keyboard.buttons).toHaveLength(5);
    expect(keyboard.buttons[0][0].action.label).toBe("Menu");
    expect(keyboard.buttons[0][1].action.label).toBe("Help");
    expect(keyboard.buttons[4][0].action.label).toBe("Close");
  });

  it("keeps the long-poll bare-slash command menu pinned as a persistent keyboard", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrls.push(new URL(String(input)));
        return new Response(
          JSON.stringify({
            response: 95011,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "long-poll",
          accessToken: "replace-me-longpoll-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "long-poll",
        eventType: "message_new",
        dedupeKey: "event:slash-menu-longpoll-1",
        messageId: "5051",
        peerId: 42,
        senderId: 42,
        text: "/",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).not.toHaveBeenCalled();
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe(
      "VK uses buttons for command menus. Choose a command:",
    );
    const keyboard = JSON.parse(sendUrl?.searchParams.get("keyboard") ?? "{}");
    expect(keyboard.inline ?? false).toBe(false);
    expect(keyboard.one_time).toBe(false);
    expect(keyboard.buttons).toHaveLength(5);
    expect(keyboard.buttons[0][0].action.type).toBe("text");
    expect(keyboard.buttons[0][0].action.label).toBe("Menu");
    expect(keyboard.buttons[4][0].action.label).toBe("Close");
  });

  it("returns narrowed VK button suggestions for slash prefixes in DMs", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrls.push(new URL(String(input)));
        return new Response(
          JSON.stringify({
            response: 9502,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:slash-menu-2",
        messageId: "506",
        peerId: 42,
        senderId: 42,
        text: "/mo",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).not.toHaveBeenCalled();
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe(
      "VK uses buttons for command menus. Matching commands:",
    );
    const keyboard = JSON.parse(sendUrl?.searchParams.get("keyboard") ?? "{}");
    expect(Object.hasOwn(keyboard, "one_time")).toBe(true);
    expect(keyboard.one_time).toBe(false);
    expect(keyboard.buttons).toHaveLength(2);
    expect(keyboard.buttons[0][0].action.label).toBe("Model");
    expect(keyboard.buttons[0][1].action.label).toBe("Models");
    expect(keyboard.buttons[1][0].action.label).toBe("Close");
  });

  it("returns matching VK button suggestions for stop and status prefixes in DMs", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrls.push(new URL(String(input)));
        return new Response(
          JSON.stringify({
            response: 9503,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:slash-menu-3",
        messageId: "507",
        peerId: 42,
        senderId: 42,
        text: "/st",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).not.toHaveBeenCalled();
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe(
      "VK uses buttons for command menus. Matching commands:",
    );
    const keyboard = JSON.parse(sendUrl?.searchParams.get("keyboard") ?? "{}");
    expect(Object.hasOwn(keyboard, "one_time")).toBe(true);
    expect(keyboard.one_time).toBe(false);
    expect(keyboard.buttons).toHaveLength(2);
    expect(keyboard.buttons[0][0].action.label).toBe("Status");
    expect(keyboard.buttons[0][1].action.label).toBe("Stop");
    expect(keyboard.buttons[1][0].action.label).toBe("Close");
  });

  it("routes plain-text VK menu aliases without requiring a slash", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);

        if (url.pathname === "/method/messages.getHistory") {
          return new Response(
            JSON.stringify({
              response: {
                count: 0,
                items: [],
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: 9504,
          }),
        );
      }),
    );

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:text-menu-alias-1",
        messageId: "508",
        peerId: 42,
        senderId: 42,
        text: "меню",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).not.toHaveBeenCalled();
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe(
      "VK uses buttons for command menus. Choose a command:",
    );
    const keyboard = JSON.parse(sendUrl?.searchParams.get("keyboard") ?? "{}");
    expect(keyboard.buttons[0][0].action.label).toBe("Menu");
    expect(keyboard.buttons[0][1].action.label).toBe("Help");
    expect(keyboard.buttons[4][0].action.label).toBe("Close");
  });

  it("closes an active DM menu without dispatching to the shared command runtime", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrls.push(new URL(String(input)));
        return new Response(
          JSON.stringify({
            response: 1,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    rememberVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: "42",
      conversationMessageId: "200",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:close-menu-1",
        messageId: "509",
        peerId: 42,
        senderId: 42,
        text: "Close",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).not.toHaveBeenCalled();
    const editUrl = requestedUrls.find((url) => url.pathname === "/method/messages.edit");
    expect(editUrl?.searchParams.get("cmid")).toBe("200");
    expect(editUrl?.searchParams.get("message")).toBe("Menu hidden. Tap Menu to reopen.");
    expect(JSON.parse(editUrl?.searchParams.get("keyboard") ?? "{}")).toEqual({
      inline: true,
      buttons: [
        [
          {
            action: {
              type: "callback",
              label: "Menu",
              payload: JSON.stringify({ oc: "/commands" }),
            },
            color: "secondary",
          },
        ],
      ],
    });
  });

  it("restores the long-poll root keyboard when closing an active DM menu", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrls.push(new URL(String(input)));
        return new Response(
          JSON.stringify({
            response: 1,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "long-poll",
          accessToken: "replace-me-longpoll-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    rememberVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: "42",
      conversationMessageId: "200",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "long-poll",
        eventType: "message_new",
        dedupeKey: "event:close-menu-longpoll-1",
        messageId: "5091",
        peerId: 42,
        senderId: 42,
        text: "Close",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).not.toHaveBeenCalled();
    expect(requestedUrls.some((url) => url.pathname === "/method/messages.edit")).toBe(false);
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe(
      "Menu collapsed. Open the keyboard to continue.",
    );
    const keyboard = JSON.parse(sendUrl?.searchParams.get("keyboard") ?? "{}");
    expect(keyboard.inline ?? false).toBe(false);
    expect(keyboard.one_time).toBe(false);
    expect(keyboard.buttons).toHaveLength(5);
    expect(keyboard.buttons[0][0].action.label).toBe("Menu");
    expect(keyboard.buttons[0][1].action.label).toBe("Help");
    expect(keyboard.buttons[3][0].action.label).toBe("Status");
    expect(keyboard.buttons[3][1].action.label).toBe("Tools");
    expect(keyboard.buttons[4][0].action.label).toBe("Close");
  });

  it("routes allowed group messages through the shared reply dispatcher", async () => {
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          groupPolicy: "open",
          groups: {
            "2000000123": {
              requireMention: true,
            },
          },
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    const accessController = createVkAccessController();

    await handleVkInboundMessage({
      cfg,
      account,
      accessController,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:2",
        messageId: "777",
        peerId: 2000000123,
        senderId: 42,
        text: "@club77 hello group",
        createdAt: 1700000100000,
        isGroupChat: true,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundReplyWithBaseMock).toHaveBeenCalledTimes(1);
    expect(dispatchInboundReplyWithBaseMock.mock.calls[0]?.[0]).toMatchObject({
      channel: "vk",
      accountId: "default",
      route: {
        agentId: "agent-1",
        sessionKey: "session-1",
      },
    });

    const ctxPayload = dispatchInboundReplyWithBaseMock.mock.calls[0]?.[0]?.ctxPayload as Record<
      string,
      unknown
    >;
    expect(ctxPayload.ChatType).toBe("group");
    expect(ctxPayload.GroupChannel).toBe("2000000123");
    expect(ctxPayload.WasMentioned).toBe(true);
  });

  it("routes slash commands in groups without a mention", async () => {
    setVkRuntime({
      ...createRuntimeMock(),
      channel: {
        ...createRuntimeMock().channel,
        commands: {
          shouldComputeCommandAuthorized: vi.fn(() => true),
          resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
        },
      },
    } as never);
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          groupPolicy: "open",
          groups: {
            "2000000123": {
              requireMention: true,
            },
          },
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    const accessController = createVkAccessController();

    await handleVkInboundMessage({
      cfg,
      account,
      accessController,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:group-command-no-mention",
        messageId: "778",
        peerId: 2000000123,
        senderId: 42,
        text: "/models",
        createdAt: 1700000100000,
        isGroupChat: true,
        rawUpdate: {},
      },
    });

    expect(dispatchInboundReplyWithBaseMock).toHaveBeenCalledTimes(1);
    const params = dispatchInboundReplyWithBaseMock.mock.calls[0]?.[0] as
      | { ctxPayload?: Record<string, unknown> }
      | undefined;
    expect(params?.ctxPayload?.CommandBody).toBe("/models");
    expect(params?.ctxPayload?.RawBody).toBe("/models");
    const ctxPayload = dispatchInboundReplyWithBaseMock.mock.calls[0]?.[0]?.ctxPayload as Record<
      string,
      unknown
    >;
    expect(ctxPayload.WasMentioned).toBe(false);
  });

  it("omits VK group reply_to when only a global message id is available", async () => {
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          groupPolicy: "open",
          groups: {
            "2000000123": {
              requireMention: true,
            },
          },
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    const accessController = createVkAccessController();
    let requestedUrl: URL | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 9006,
          }),
        );
      }),
    );

    await handleVkInboundMessage({
      cfg,
      account,
      accessController,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "long-poll",
        eventType: "message_new",
        dedupeKey: "event:group-reply-fallback",
        messageId: "0",
        peerId: 2000000123,
        senderId: 42,
        text: "@club77 hello group",
        createdAt: 1700000100000,
        isGroupChat: true,
        rawUpdate: {},
      },
    });

    const params = dispatchInboundReplyWithBaseMock.mock.calls[0]?.[0] as
      | {
          ctxPayload?: Record<string, unknown>;
          deliver?: (payload: unknown) => Promise<void>;
        }
      | undefined;

    expect(params?.ctxPayload?.ReplyToId).toBeUndefined();
    await params?.deliver?.({
      text: "Reply text",
    });

    expect(requestedUrl?.searchParams.get("reply_to")).toBeNull();
  });

  it("passes typing callbacks into DM dispatch and starts VK typing activity", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("messages.setActivity");
      return new Response(
        JSON.stringify({
          response: 1,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:typing-1",
        messageId: "503",
        peerId: 42,
        senderId: 42,
        text: "hello from vk",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    const params = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { typingCallbacks?: { onReplyStart: () => Promise<void> } }
      | undefined;
    expect(params?.typingCallbacks?.onReplyStart).toBeTypeOf("function");
    await params?.typingCallbacks?.onReplyStart?.();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("edits callback-driven DM menus in place instead of sending a new reply", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrls.push(new URL(String(input)));
        return new Response(
          JSON.stringify({
            response: 1,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:interactive-edit-1",
        messageId: "callback-event-1",
        conversationMessageId: "72",
        editConversationMessageId: "72",
        peerId: 42,
        senderId: 42,
        text: "/models openai 2",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
        messagePayload: { oc: "/models openai 2" },
      },
    });

    const params = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await params?.deliver?.({
      text: "Models (openai) — 40 available (page 2/7)",
      channelData: {
        vk: {
          inline: true,
          oneTime: false,
          buttons: [[{ text: "< Prev", callback_data: "/models openai 1" }]],
        },
      },
    });

    expect(requestedUrls.map((url) => url.pathname)).toEqual([
      "/method/messages.edit",
      "/method/messages.getHistory",
    ]);
    expect(requestedUrls[0]?.searchParams.get("peer_id")).toBe("42");
    expect(requestedUrls[0]?.searchParams.get("cmid")).toBe("72");
    expect(requestedUrls[0]?.searchParams.get("reply_to")).toBeNull();
  });

  it("closes a remembered DM menu in place after a terminal command reply", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrls.push(new URL(String(input)));
        return new Response(
          JSON.stringify({
            response: 1,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    rememberVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: "42",
      conversationMessageId: "201",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:interactive-terminal-1",
        messageId: "603",
        peerId: 42,
        senderId: 42,
        text: "Status",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    const params = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await params?.deliver?.({
      text: "All systems nominal.",
    });

    const editUrl = requestedUrls.find((url) => url.pathname === "/method/messages.edit");
    expect(editUrl?.searchParams.get("cmid")).toBe("201");
    expect(editUrl?.searchParams.get("message")).toBe("All systems nominal.");
    expect(JSON.parse(editUrl?.searchParams.get("keyboard") ?? "{}")).toEqual({
      inline: true,
      buttons: [
        [
          {
            action: {
              type: "callback",
              label: "Menu",
              payload: JSON.stringify({ oc: "/commands" }),
            },
            color: "secondary",
          },
        ],
      ],
    });
  });

  it("reuses the last interactive DM menu for typed slash-command menus", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);

        if (url.pathname === "/method/messages.send") {
          return new Response(
            JSON.stringify({
              response: 9511,
            }),
          );
        }

        if (url.pathname === "/method/messages.getHistory") {
          return new Response(
            JSON.stringify({
              response: {
                count: 1,
                items: [
                  {
                    id: 9511,
                    conversation_message_id: 200,
                    out: 1,
                    text: "Select a provider (1/4):",
                  },
                ],
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: 1,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:typed-menu-1",
        messageId: "601",
        peerId: 42,
        senderId: 42,
        text: "/models",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    const firstParams = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await firstParams?.deliver?.({
      text: "Select a provider (1/4):",
      channelData: {
        vk: {
          inline: true,
          oneTime: false,
          buttons: [[{ text: "proxy (3)", callback_data: "/models proxy" }]],
        },
      },
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:typed-menu-2",
        messageId: "602",
        peerId: 42,
        senderId: 42,
        text: "/models proxy",
        createdAt: 1700000001000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    const secondParams = dispatchInboundDirectDmWithRuntimeMock.mock.calls[1]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await secondParams?.deliver?.({
      text: "Models (proxy) — 3 available",
      channelData: {
        vk: {
          inline: true,
          oneTime: false,
          longPollInlineCallback: true,
          buttons: [[{ text: "GPT-5.4 Proxy", callback_data: "/model proxy/gpt-5.4-proxy" }]],
        },
      },
    });

    expect(requestedUrls.map((url) => url.pathname)).toEqual([
      "/method/messages.getHistory",
      "/method/messages.send",
      "/method/messages.getHistory",
      "/method/messages.getHistory",
      "/method/messages.edit",
      "/method/messages.getHistory",
    ]);
    expect(requestedUrls[4]?.searchParams.get("cmid")).toBe("200");
    expect(requestedUrls[4]?.searchParams.get("message")).toBe("Models (proxy) — 3 available");
  });

  it("keeps the long-poll root command keyboard after a terminal command reply", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        if (url.pathname === "/method/messages.getHistory") {
          return new Response(
            JSON.stringify({
              response: {
                count: 1,
                items: [
                  {
                    id: 9513,
                    conversation_message_id: 202,
                    out: 1,
                    text: "All systems nominal.",
                    keyboard: {
                      one_time: false,
                      buttons: [[{ action: { label: "Menu", type: "text" } }]],
                    },
                  },
                ],
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: 9513,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "long-poll",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    rememberVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: "42",
      conversationMessageId: "201",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "long-poll",
        eventType: "message_new",
        dedupeKey: "event:interactive-terminal-longpoll-1",
        messageId: "703",
        peerId: 42,
        senderId: 42,
        text: "Status",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    const params = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await params?.deliver?.({
      text: "All systems nominal.",
    });

    expect(requestedUrls[0]?.pathname).toBe("/method/messages.send");
    expect(requestedUrls.some((url) => url.pathname === "/method/messages.edit")).toBe(false);
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe("All systems nominal.");
    expect(JSON.parse(sendUrl?.searchParams.get("keyboard") ?? "{}")).toEqual({
      one_time: false,
      buttons: [
        [
          {
            action: {
              type: "text",
              label: "Menu",
              payload: JSON.stringify({ oc: "/commands" }),
            },
            color: "secondary",
          },
          {
            action: {
              type: "text",
              label: "Help",
              payload: JSON.stringify({ oc: "/help" }),
            },
            color: "secondary",
          },
        ],
        [
          {
            action: {
              type: "text",
              label: "New",
              payload: JSON.stringify({ oc: "/new" }),
            },
            color: "secondary",
          },
          {
            action: {
              type: "text",
              label: "Reset",
              payload: JSON.stringify({ oc: "/reset" }),
            },
            color: "secondary",
          },
        ],
        [
          {
            action: {
              type: "text",
              label: "Model",
              payload: JSON.stringify({ oc: "/model" }),
            },
            color: "secondary",
          },
          {
            action: {
              type: "text",
              label: "Models",
              payload: JSON.stringify({ oc: "/models" }),
            },
            color: "secondary",
          },
        ],
        [
          {
            action: {
              type: "text",
              label: "Status",
              payload: JSON.stringify({ oc: "/status" }),
            },
            color: "secondary",
          },
          {
            action: {
              type: "text",
              label: "Tools",
              payload: JSON.stringify({ oc: "/tools" }),
            },
            color: "secondary",
          },
        ],
        [
          {
            action: {
              type: "text",
              label: "Close",
              payload: JSON.stringify({ oc: "/vk-menu-close" }),
            },
            color: "secondary",
          },
        ],
      ],
    });
  });

  it("sends long-poll reply-keyboard terminal commands as fresh messages instead of editing remembered menus", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        if (url.pathname === "/method/messages.getHistory") {
          return new Response(
            JSON.stringify({
              response: {
                count: 1,
                items: [
                  {
                    id: 95131,
                    conversation_message_id: 207,
                    out: 1,
                    text: "All systems nominal.",
                    keyboard: {
                      buttons: [[{ action: { label: "Menu", type: "text" } }]],
                    },
                  },
                ],
              },
            }),
          );
        }
        return new Response(
          JSON.stringify({
            response: 95131,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "long-poll",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    rememberVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: "42",
      conversationMessageId: "201",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "long-poll",
        eventType: "message_new",
        dedupeKey: "event:interactive-terminal-longpoll-payload-1",
        messageId: "705",
        conversationMessageId: "203",
        peerId: 42,
        senderId: 42,
        text: "Status",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
        messagePayload: { oc: "/status" },
      } as never,
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).toHaveBeenCalledTimes(1);
    expect(dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0]).toMatchObject({
      rawBody: "/status",
    });

    const params = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await params?.deliver?.({
      text: "All systems nominal.",
    });

    expect(requestedUrls.map((url) => url.pathname)).toEqual([
      "/method/messages.send",
      "/method/messages.getHistory",
      "/method/messages.getHistory",
    ]);
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe("All systems nominal.");
    expect(requestedUrls.some((url) => url.pathname === "/method/messages.edit")).toBe(false);
  });

  it("skips long-poll menu history lookup when the inbound callback already has an edit target", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        if (url.pathname === "/method/messages.getHistory") {
          return new Response(
            JSON.stringify({
              response: {
                count: 0,
                items: [],
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: 95132,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "long-poll",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "long-poll",
        eventType: "message_new",
        dedupeKey: "event:interactive-longpoll-callback-1",
        messageId: "callback-event-701",
        conversationMessageId: "203",
        editConversationMessageId: "203",
        peerId: 42,
        senderId: 42,
        text: "/status",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
        messagePayload: { oc: "/status" },
      } as never,
    });

    expect(dispatchInboundDirectDmWithRuntimeMock).toHaveBeenCalledTimes(1);
    expect(dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0]).toMatchObject({
      rawBody: "/status",
    });

    const params = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await params?.deliver?.({
      text: "All systems nominal.",
    });

    expect(requestedUrls.map((url) => url.pathname)).toEqual([
      "/method/messages.edit",
      "/method/messages.getHistory",
    ]);
    expect(requestedUrls[0]?.searchParams.get("cmid")).toBe("203");
    expect(requestedUrls[0]?.searchParams.get("message")).toBe("All systems nominal.");
    expect(requestedUrls.some((url) => url.pathname === "/method/messages.send")).toBe(false);
  });

  it("skips long-poll reply-keyboard history lookup and sends fresh replies even when memory is stale", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        if (url.pathname === "/method/messages.getHistory") {
          return new Response(
            JSON.stringify({
              response: {
                count: 1,
                items: [
                  {
                    id: 95141,
                    conversation_message_id: 207,
                    out: 1,
                    text: "All systems nominal.",
                    keyboard: {
                      buttons: [[{ action: { label: "Menu", type: "text" } }]],
                    },
                  },
                ],
              },
            }),
          );
        }
        return new Response(
          JSON.stringify({
            response: 95141,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "long-poll",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    rememberVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: "42",
      conversationMessageId: "200",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "long-poll",
        eventType: "message_new",
        dedupeKey: "event:interactive-terminal-longpoll-payload-stale-1",
        messageId: "706",
        conversationMessageId: "206",
        peerId: 42,
        senderId: 42,
        text: "Status",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
        messagePayload: { oc: "/status" },
      } as never,
    });

    const params = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await params?.deliver?.({
      text: "All systems nominal.",
    });

    expect(requestedUrls.map((url) => url.pathname)).toEqual([
      "/method/messages.send",
      "/method/messages.getHistory",
      "/method/messages.getHistory",
    ]);
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe("All systems nominal.");
    expect(requestedUrls.some((url) => url.pathname === "/method/messages.edit")).toBe(false);
  });

  it("sends long-poll typed slash-command menus as fresh messages instead of editing old menus", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);

        if (url.pathname === "/method/messages.getHistory") {
          return new Response(
            JSON.stringify({
              response: {
                count: 1,
                items: [
                  {
                    id: 9514,
                    conversation_message_id: 203,
                    out: 1,
                    text: "Models (proxy) - 3 available",
                    keyboard: {
                      buttons: [[{ action: { label: "GPT-5.4 Proxy", type: "text" } }]],
                    },
                  },
                ],
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: 9514,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "long-poll",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });
    rememberVkInteractiveMessageId({
      accountId: account.accountId,
      peerId: "42",
      conversationMessageId: "200",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "long-poll",
        eventType: "message_new",
        dedupeKey: "event:typed-menu-longpoll-1",
        messageId: "704",
        peerId: 42,
        senderId: 42,
        text: "/models proxy",
        createdAt: 1700000001000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    const params = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await params?.deliver?.({
      text: "Models (proxy) - 3 available",
      channelData: {
        vk: {
          inline: true,
          oneTime: false,
          longPollInlineCallback: true,
          buttons: [[{ text: "GPT-5.4 Proxy", callback_data: "/model proxy/gpt-5.4-proxy" }]],
        },
      },
    });

    expect(requestedUrls[0]?.pathname).toBe("/method/messages.send");
    expect(requestedUrls.some((url) => url.pathname === "/method/messages.edit")).toBe(false);
    const sendUrl = requestedUrls.find((url) => url.pathname === "/method/messages.send");
    expect(sendUrl?.searchParams.get("message")).toBe("Models (proxy) - 3 available");
    expect(JSON.parse(sendUrl?.searchParams.get("keyboard") ?? "{}")).toEqual({
      inline: true,
      buttons: [
        [
          {
            action: {
              type: "callback",
              label: "GPT-5.4 Proxy",
              payload: JSON.stringify({ oc: "/model proxy/gpt-5.4-proxy" }),
            },
            color: "secondary",
          },
        ],
      ],
    });
  });

  it("restores the latest interactive DM menu after state reset instead of sending a duplicate", async () => {
    resolveInboundDirectDmAccessWithRuntimeMock.mockResolvedValue({
      access: {
        decision: "allow",
        reason: "allowlist",
        reasonCode: "allowlist",
        effectiveAllowFrom: ["42"],
      },
      shouldComputeAuth: false,
      senderAllowedForCommands: true,
      commandAuthorized: true,
    });
    const requestedUrls: URL[] = [];
    let historyCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);

        if (url.pathname === "/method/messages.send") {
          return new Response(
            JSON.stringify({
              response: 9512,
            }),
          );
        }

        if (url.pathname === "/method/messages.getHistory") {
          historyCallCount += 1;
          return new Response(
            JSON.stringify({
              response: {
                count: historyCallCount >= 3 ? 2 : 0,
                items:
                  historyCallCount === 2
                    ? [
                        {
                          id: 9512,
                          conversation_message_id: 201,
                          out: 1,
                          text: "Select a provider (1/4):",
                          keyboard: {
                            inline: true,
                            one_time: false,
                            buttons: [[{ action: { label: "proxy (3)", type: "callback" } }]],
                          },
                        },
                      ]
                    : historyCallCount >= 3
                      ? [
                          {
                            id: 9512,
                            conversation_message_id: 201,
                            out: 1,
                            text: "Select a provider (1/4):",
                            keyboard: {
                              inline: true,
                              one_time: false,
                              buttons: [[{ action: { label: "proxy (3)", type: "callback" } }]],
                            },
                          },
                          {
                            id: 9500,
                            conversation_message_id: 199,
                            out: 0,
                            text: "/models",
                            keyboard: null,
                          },
                        ]
                      : [],
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: 1,
          }),
        );
      }),
    );
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-callback-token",
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
    };
    const account = resolveVkAccount({
      cfg,
      accountId: "default",
    });

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:typed-menu-reset-1",
        messageId: "701",
        peerId: 42,
        senderId: 42,
        text: "/models",
        createdAt: 1700000000000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    const firstParams = dispatchInboundDirectDmWithRuntimeMock.mock.calls[0]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await firstParams?.deliver?.({
      text: "Select a provider (1/4):",
      channelData: {
        vk: {
          inline: true,
          oneTime: false,
          buttons: [[{ text: "proxy (3)", callback_data: "/models proxy" }]],
        },
      },
    });

    clearVkInteractiveMessageState();

    await handleVkInboundMessage({
      cfg,
      account,
      message: {
        accountId: "default",
        groupId: 77,
        transport: "callback-api",
        eventType: "message_new",
        dedupeKey: "event:typed-menu-reset-2",
        messageId: "702",
        peerId: 42,
        senderId: 42,
        text: "/models proxy",
        createdAt: 1700000001000,
        isGroupChat: false,
        rawUpdate: {},
      },
    });

    const secondParams = dispatchInboundDirectDmWithRuntimeMock.mock.calls[1]?.[0] as
      | { deliver?: (payload: unknown) => Promise<void> }
      | undefined;
    await secondParams?.deliver?.({
      text: "Models (proxy) — 3 available",
      channelData: {
        vk: {
          inline: true,
          oneTime: false,
          buttons: [[{ text: "GPT-5.4 Proxy", callback_data: "/model proxy/gpt-5.4-proxy" }]],
        },
      },
    });

    expect(requestedUrls.map((url) => url.pathname)).toEqual([
      "/method/messages.getHistory",
      "/method/messages.send",
      "/method/messages.getHistory",
      "/method/messages.getHistory",
      "/method/messages.getHistory",
      "/method/messages.edit",
      "/method/messages.getHistory",
    ]);
    expect(requestedUrls[5]?.searchParams.get("cmid")).toBe("201");
    expect(requestedUrls[5]?.searchParams.get("message")).toBe("Models (proxy) — 3 available");
  });
});
