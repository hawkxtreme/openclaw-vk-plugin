import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendVkResolvedOutboundPayload,
  vkMessagingAdapter,
  vkOutboundAdapter,
  vkPlugin,
} from "../../api.js";

type VkCommandAdapterCompat = NonNullable<typeof vkPlugin.commands> & {
  buildModelsProviderChannelData?: (params: {
    providers: Array<{ id: string; count: number }>;
    currentPage?: number;
    totalPages?: number;
  }) => Record<string, unknown> | null;
  buildToolsGroupListChannelData?: (params: {
    groups: Array<{ id: string; label: string; count: number }>;
    currentPage: number;
    totalPages: number;
  }) => Record<string, unknown> | null;
  buildToolsListChannelData?: (params: {
    groupId: string;
    groupLabel: string;
    tools: Array<{ id: string; label: string }>;
    currentPage: number;
    totalPages: number;
  }) => Record<string, unknown> | null;
  buildToolDetailsChannelData?: (params: {
    groupId: string;
    currentPage: number;
  }) => Record<string, unknown> | null;
  buildModelBrowseChannelData?: () => Record<string, unknown> | null;
};

describe("vk plugin adapters", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createVkApiFetchMock(params: {
    sendResponse?: number;
    historyItems?: unknown[];
    onSend?: (url: URL) => void;
  }) {
    return vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/method/messages.getHistory") {
        return new Response(
          JSON.stringify({
            response: {
              items: params.historyItems ?? [],
            },
          }),
        );
      }

      params.onSend?.(url);
      return new Response(
        JSON.stringify({
          response: params.sendResponse ?? 9000,
        }),
      );
    });
  }

  it("normalizes vk targets and resolves outbound session routes", () => {
    expect(vkMessagingAdapter.normalizeTarget?.("vk:user:42")).toBe("42");
    expect(vkMessagingAdapter.normalizeTarget?.("conversation:2000000123")).toBe("2000000123");

    const route = vkMessagingAdapter.resolveOutboundSessionRoute?.({
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            accessToken: "replace-me-callback-token",
          },
        },
      },
      agentId: "agent-1",
      accountId: "default",
      target: "vk:2000000123",
      threadId: null,
    });

    expect(route).toMatchObject({
      chatType: "group",
      to: "2000000123",
      peer: {
        kind: "group",
        id: "2000000123",
      },
    });
  });

  it("sends text through the official outbound adapter", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain("messages.send");
      expect(String(input)).toContain("peer_id=42");
      return new Response(
        JSON.stringify({
          response: 9001,
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await vkOutboundAdapter.sendText?.({
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            accessToken: "replace-me-callback-token",
          },
        },
      },
      to: "vk:42",
      text: "hello from adapter",
      accountId: "default",
    });

    expect(result).toMatchObject({
      channel: "vk",
      messageId: "9001",
      conversationId: "42",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("omits VK reply_to when the upstream reply id is not numeric", async () => {
    let requestedUrl: URL | undefined;
    const fetchMock = vi.fn(async (input: string | URL) => {
      requestedUrl = new URL(String(input));
      return new Response(
        JSON.stringify({
          response: 9004,
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await vkOutboundAdapter.sendText?.({
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            accessToken: "replace-me-callback-token",
          },
        },
      },
      to: "vk:42",
      text: "reply without numeric id",
      accountId: "default",
      replyToId: "evt-non-numeric",
    });

    expect(result).toMatchObject({
      channel: "vk",
      messageId: "9004",
      conversationId: "42",
    });
    expect(requestedUrl?.searchParams.get("reply_to")).toBeNull();
  });

  it("renders VK keyboards from interactive outbound payloads", async () => {
    const fetchMock = createVkApiFetchMock({
      sendResponse: 9002,
      onSend: (url) => {
        if (url.pathname === "/method/messages.send") {
          expect(url.searchParams.get("keyboard")).toBeTruthy();
        }
      },
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await vkOutboundAdapter.sendPayload?.({
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            accessToken: "replace-me-callback-token",
          },
        },
      },
      to: "vk:42",
      payload: {
        text: "Choose a provider",
        interactive: {
          blocks: [
            {
              type: "buttons",
              buttons: [
                { label: "OpenAI", value: "/models openai", style: "primary" },
                { label: "Anthropic", value: "/models anthropic" },
              ],
            },
          ],
        },
      },
      accountId: "default",
      text: "",
    });

    expect(result).toMatchObject({
      channel: "vk",
      messageId: "9002",
      conversationId: "42",
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("builds VK command keyboards for model navigation", () => {
    const commands = vkPlugin.commands as VkCommandAdapterCompat;

    const commandsData = commands.buildCommandsListChannelData?.({
      currentPage: 1,
      totalPages: 1,
    });
    expect(commandsData).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [
            { text: "Models", callback_data: "/models" },
            { text: "Status", callback_data: "/status" },
          ],
          [
            { text: "Tools", callback_data: "/tools" },
            { text: "Help", callback_data: "/help" },
          ],
          [{ text: "Close", callback_data: "/vk-menu-close" }],
        ],
      },
    });

    const providerData = commands.buildModelsProviderChannelData?.({
      providers: [
        { id: "anthropic", count: 2 },
        { id: "openai", count: 5 },
      ],
      currentPage: 1,
      totalPages: 2,
    });
    expect(providerData).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [
            { text: "anthropic (2)", callback_data: "/models anthropic" },
            { text: "openai (5)", callback_data: "/models openai" },
          ],
          [{ text: "Next >", callback_data: "/models 2" }],
          [
            { text: "< Back", callback_data: "/commands" },
            { text: "Close", callback_data: "/vk-menu-close" },
          ],
        ],
      },
    });

    const midPageProviderData = commands.buildModelsProviderChannelData?.({
      providers: [
        { id: "google-antigravity", count: 9 },
        { id: "google-gemini-cli", count: 6 },
        { id: "google-vertex", count: 13 },
        { id: "groq", count: 18 },
        { id: "huggingface", count: 18 },
        { id: "kimi", count: 2 },
        { id: "minimax", count: 2 },
        { id: "minimax-cn", count: 2 },
      ],
      currentPage: 2,
      totalPages: 4,
    });
    const midPageProviderButtons = (
      midPageProviderData as { vk?: { buttons?: Array<Array<{ text: string }>> } }
    )?.vk?.buttons;
    expect(midPageProviderButtons?.flat().map((button) => button.text)).toEqual([
      "google-antigravity (9)",
      "google-gemini-cli (6)",
      "google-vertex (13)",
      "groq (18)",
      "huggingface (18)",
      "kimi (2)",
      "< Prev",
      "Next >",
      "< Back",
      "Close",
    ]);

    const listData = commands.buildModelsListChannelData?.({
      provider: "openai",
      models: ["gpt-5.4", "gpt-5.2-codex", "o3"],
      currentModel: "openai/gpt-5.4",
      currentPage: 1,
      totalPages: 2,
      pageSize: 2,
      modelNames: new Map([
        ["openai/gpt-5.4", "GPT-5.4"],
        ["openai/gpt-5.2-codex", "GPT-5.2 Codex"],
      ]),
    });
    expect(listData).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [
            { text: "GPT-5.4 ✓", callback_data: "/model openai/gpt-5.4" },
            { text: "GPT-5.2 Codex", callback_data: "/model openai/gpt-5.2-codex" },
          ],
          [{ text: "Next >", callback_data: "/models openai 2" }],
          [
            { text: "< Back", callback_data: "/models" },
            { text: "Close", callback_data: "/vk-menu-close" },
          ],
        ],
      },
    });

    const midPageListData = commands.buildModelsListChannelData?.({
      provider: "openai",
      models: [
        "gpt-5.4",
        "gpt-5.2-codex",
        "o3",
        "o4-mini",
        "o4",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4.1-nano",
        "gpt-4o",
      ],
      currentPage: 2,
      totalPages: 2,
      pageSize: 6,
    });
    const midPageListButtons = (
      midPageListData as { vk?: { buttons?: Array<Array<{ text: string }>> } }
    )?.vk?.buttons;
    expect(midPageListButtons?.flat().map((button) => button.text)).toEqual([
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "gpt-4o",
      "< Prev",
      "< Back",
      "Close",
    ]);

    expect(commands.buildModelBrowseChannelData?.()).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [{ text: "Browse providers", callback_data: "/models" }],
          [{ text: "Close", callback_data: "/vk-menu-close" }],
        ],
      },
    });

    expect(
      commands.buildToolsGroupListChannelData?.({
        groups: [
          { id: "core", label: "Built-in tools", count: 20 },
          { id: "plugin", label: "Connected tools", count: 2 },
        ],
        currentPage: 1,
        totalPages: 1,
      }),
    ).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [
            { text: "Built-in (20)", callback_data: "/tools core" },
            { text: "Connected (2)", callback_data: "/tools plugin" },
          ],
          [
            { text: "< Back", callback_data: "/commands" },
            { text: "Close", callback_data: "/vk-menu-close" },
          ],
        ],
      },
    });

    expect(
      commands.buildToolsListChannelData?.({
        groupId: "plugin",
        groupLabel: "Connected tools",
        tools: [
          { id: "browser", label: "Browser" },
          { id: "memory_search", label: "Memory Search" },
        ],
        currentPage: 1,
        totalPages: 2,
      }),
    ).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [
            { text: "Browser", callback_data: "/tools plugin browser" },
            { text: "Memory Search", callback_data: "/tools plugin memory_search" },
          ],
          [{ text: "Next >", callback_data: "/tools plugin 2" }],
          [
            { text: "< Back", callback_data: "/tools" },
            { text: "Close", callback_data: "/vk-menu-close" },
          ],
        ],
      },
    });

    expect(
      commands.buildToolDetailsChannelData?.({
        groupId: "plugin",
        currentPage: 2,
      }),
    ).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [
            { text: "< Back", callback_data: "/tools plugin 2" },
            { text: "Close", callback_data: "/vk-menu-close" },
          ],
        ],
      },
    });
  });

  it("sends command keyboards as inline callback buttons on callback-api accounts", async () => {
    const commands = vkPlugin.commands as VkCommandAdapterCompat;
    const fetchMock = createVkApiFetchMock({
      sendResponse: 9006,
      onSend: (url) => {
        if (url.pathname === "/method/messages.send") {
          const keyboard = JSON.parse(url.searchParams.get("keyboard") ?? "{}");
          expect(keyboard.inline).toBe(true);
          expect(Object.hasOwn(keyboard, "one_time")).toBe(false);
          expect(keyboard.buttons[0][0].action.type).toBe("callback");
          expect(keyboard.buttons[0][0].action.label).toBe("Browse providers");
        }
      },
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await vkOutboundAdapter.sendPayload?.({
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            transport: "callback-api",
            accessToken: "replace-me-callback-token",
          },
        },
      },
      to: "vk:42",
      payload: {
        text: "Choose a model",
        channelData: commands.buildModelBrowseChannelData?.() ?? undefined,
      },
      accountId: "default",
      text: "",
    });

    expect(result).toMatchObject({
      channel: "vk",
      messageId: "9006",
      conversationId: "42",
    });
  });

  it("sends command keyboards as inline callback buttons on long-poll accounts", async () => {
    const commands = vkPlugin.commands as VkCommandAdapterCompat;
    const fetchMock = createVkApiFetchMock({
      sendResponse: 9007,
      onSend: (url) => {
        if (url.pathname === "/method/messages.send") {
          const keyboard = JSON.parse(url.searchParams.get("keyboard") ?? "{}");
          expect(keyboard.inline).toBe(true);
          expect(Object.hasOwn(keyboard, "one_time")).toBe(false);
          expect(keyboard.buttons[0][0].action.type).toBe("callback");
          expect(keyboard.buttons[0][0].action.label).toBe("Browse providers");
        }
      },
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await vkOutboundAdapter.sendPayload?.({
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            transport: "long-poll",
            accessToken: "replace-me-callback-token",
          },
        },
      },
      to: "vk:42",
      payload: {
        text: "Choose a model",
        channelData: commands.buildModelBrowseChannelData?.() ?? undefined,
      },
      accountId: "default",
      text: "",
    });

    expect(result).toMatchObject({
      channel: "vk",
      messageId: "9007",
      conversationId: "42",
    });
  });

  it("re-roots the long-poll launcher keyboard when sending inline callback menus", async () => {
    const commands = vkPlugin.commands as VkCommandAdapterCompat;
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);

        if (url.pathname === "/method/messages.send") {
          return new Response(
            JSON.stringify({
              response: 9008,
            }),
          );
        }

        if (url.pathname === "/method/messages.getHistory") {
          return new Response(
            JSON.stringify({
              response: {
                items: [
                  {
                    id: 9008,
                    conversation_message_id: 210,
                    out: 1,
                    text: "Choose a model",
                    keyboard: {
                      inline: true,
                      buttons: [[{ action: { label: "Browse providers", type: "callback" } }]],
                    },
                  },
                  {
                    id: 8999,
                    conversation_message_id: 205,
                    out: 1,
                    text: "Legacy provider menu",
                    keyboard: {
                      buttons: [[{ action: { label: "proxy (3)", type: "text" } }]],
                    },
                  },
                ],
              },
            }),
          );
        }

        if (url.pathname === "/method/messages.edit") {
          return new Response(
            JSON.stringify({
              response: 1,
            }),
          );
        }

        throw new Error(`Unexpected VK request ${url.pathname}`);
      }),
    );

    const result = await vkOutboundAdapter.sendPayload?.({
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            transport: "long-poll",
            accessToken: "replace-me-callback-token",
          },
        },
      },
      to: "vk:42",
      payload: {
        text: "Choose a model",
        channelData: commands.buildModelBrowseChannelData?.() ?? undefined,
      },
      accountId: "default",
      text: "",
    });

    expect(result).toMatchObject({
      channel: "vk",
      messageId: "9008",
      conversationId: "42",
    });

    const launcherEdit = requestedUrls.find(
      (url) => url.pathname === "/method/messages.edit" && url.searchParams.get("cmid") === "205",
    );
    expect(launcherEdit).toBeDefined();
    expect(launcherEdit?.searchParams.get("message")).toBe(
      "VK uses buttons for command menus. Choose a command:",
    );
    const launcherKeyboard = JSON.parse(launcherEdit?.searchParams.get("keyboard") ?? "{}");
    expect(launcherKeyboard.inline ?? false).toBe(false);
    expect(launcherKeyboard.one_time).toBe(false);
    expect(launcherKeyboard.buttons[0][0].action.type).toBe("text");
    expect(launcherKeyboard.buttons[0][0].action.label).toBe("Menu");
    expect(launcherKeyboard.buttons.at(-1)?.[0]?.action?.label).toBe("Close");
  });

  it("sends a fresh long-poll inline menu instead of editing the reply-keyboard launcher", async () => {
    const commands = vkPlugin.commands as VkCommandAdapterCompat;
    const requestedUrls: URL[] = [];
    let historyCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        requestedUrls.push(url);

        if (url.pathname === "/method/messages.send") {
          return new Response(
            JSON.stringify({
              response: 9010,
            }),
          );
        }

        if (url.pathname === "/method/messages.getHistory") {
          historyCalls += 1;
          if (historyCalls === 1) {
            return new Response(
              JSON.stringify({
                response: {
                  items: [
                    {
                      id: 8999,
                      conversation_message_id: 205,
                      out: 1,
                      text: "Legacy provider menu",
                      keyboard: {
                        buttons: [[{ action: { label: "cerebras (4)", type: "text" } }]],
                      },
                    },
                  ],
                },
              }),
            );
          }

          return new Response(
            JSON.stringify({
              response: {
                items: [
                  {
                    id: 9010,
                    conversation_message_id: 211,
                    out: 1,
                    text: "Choose a model",
                    keyboard: {
                      inline: true,
                      buttons: [[{ action: { label: "Browse providers", type: "callback" } }]],
                    },
                  },
                  {
                    id: 8999,
                    conversation_message_id: 205,
                    out: 1,
                    text: "Legacy provider menu",
                    keyboard: {
                      buttons: [[{ action: { label: "cerebras (4)", type: "text" } }]],
                    },
                  },
                ],
              },
            }),
          );
        }

        if (url.pathname === "/method/messages.edit") {
          return new Response(
            JSON.stringify({
              response: 1,
            }),
          );
        }

        throw new Error(`Unexpected VK request ${url.pathname}`);
      }),
    );

    const result = await sendVkResolvedOutboundPayload({
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            transport: "long-poll",
            accessToken: "replace-me-callback-token",
          },
        },
      },
      to: "42",
      payload: {
        text: "Choose a model",
        channelData: commands.buildModelBrowseChannelData?.() ?? undefined,
      },
      accountId: "default",
      editConversationMessageId: "205",
    });

    expect(result).toMatchObject({
      channel: "vk",
      messageId: "9010",
      conversationId: "42",
    });

    const inlineEdit = requestedUrls.find(
      (url) =>
        url.pathname === "/method/messages.edit" &&
        url.searchParams.get("message") === "Choose a model",
    );
    expect(inlineEdit).toBeUndefined();

    const inlineSend = requestedUrls.find(
      (url) =>
        url.pathname === "/method/messages.send" &&
        url.searchParams.get("message") === "Choose a model",
    );
    expect(inlineSend).toBeDefined();
    expect(JSON.parse(inlineSend?.searchParams.get("keyboard") ?? "{}")).toEqual({
      inline: true,
      buttons: [
        [
          {
            action: {
              type: "callback",
              label: "Browse providers",
              payload: JSON.stringify({ oc: "/models" }),
            },
            color: "secondary",
          },
        ],
        [
          {
            action: {
              type: "callback",
              label: "Close",
              payload: JSON.stringify({ oc: "/vk-menu-close" }),
            },
            color: "secondary",
          },
        ],
      ],
    });

    const launcherEdit = requestedUrls.find(
      (url) => url.pathname === "/method/messages.edit" && url.searchParams.get("cmid") === "205",
    );
    expect(launcherEdit).toBeDefined();
    expect(launcherEdit?.searchParams.get("message")).toBe(
      "VK uses buttons for command menus. Choose a command:",
    );
  });

  it("advertises VK inline buttons to the agent prompt and message tool", () => {
    expect(
      vkPlugin.agentPrompt?.messageToolCapabilities?.({
        cfg: {
          channels: {
            vk: {
              groupId: 77,
              accessToken: "replace-me-callback-token",
            },
          },
        },
        accountId: "default",
      }),
    ).toEqual(["inlineButtons"]);

    const discovery = vkPlugin.actions?.describeMessageTool?.({
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            accessToken: "replace-me-callback-token",
          },
        },
      },
      accountId: "default",
      currentChannelProvider: "vk",
    });

    expect(discovery?.actions).toEqual(["send"]);
    expect(discovery?.capabilities).toEqual(["interactive", "buttons"]);
    expect(discovery?.schema).toBeTruthy();
  });

  it("sends VK message-tool buttons through the plugin action adapter", async () => {
    const fetchMock = createVkApiFetchMock({
      sendResponse: 9003,
      onSend: (url) => {
        if (url.pathname === "/method/messages.send") {
          expect(url.searchParams.get("peer_id")).toBe("42");
          expect(url.searchParams.get("keyboard")).toBeTruthy();
        }
      },
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await vkPlugin.actions?.handleAction?.({
      channel: "vk",
      action: "send",
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            accessToken: "replace-me-callback-token",
          },
        },
      },
      params: {
        to: "vk:42",
        message: "Choose a model",
        buttons: [[{ text: "Browse providers", callback_data: "/models" }]],
      },
      accountId: "default",
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const jsonText = result?.content.find((entry) => entry.type === "text")?.text;
    expect(jsonText).toBeTruthy();
    expect(JSON.parse(jsonText ?? "{}")).toMatchObject({
      channel: "vk",
      messageId: "9003",
      conversationId: "42",
    });
  });

  it("accepts replyToId on the VK message action surface", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("reply_to")).toBe("501");
      return new Response(
        JSON.stringify({
          response: 9005,
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await vkPlugin.actions?.handleAction?.({
      channel: "vk",
      action: "send",
      cfg: {
        channels: {
          vk: {
            groupId: 77,
            accessToken: "replace-me-callback-token",
          },
        },
      },
      params: {
        to: "vk:42",
        message: "Reply via alias",
        replyToId: "501",
      },
      accountId: "default",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const jsonText = result?.content.find((entry) => entry.type === "text")?.text;
    expect(jsonText).toBeTruthy();
    expect(JSON.parse(jsonText ?? "{}")).toMatchObject({
      channel: "vk",
      messageId: "9005",
      conversationId: "42",
    });
  });
});
