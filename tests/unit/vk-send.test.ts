import { describe, expect, it } from "vitest";
import {
  normalizeVkMessageNewUpdate,
  normalizeVkPeerId,
  parseVkConfig,
  resolveVkAccount,
  resolveVkRandomId,
  sendVkReply,
  sendVkText,
} from "../../api.js";
import { sendVkPayload } from "../../src/vk-core/outbound/media.js";

function createAccount(overrides?: {
  config?: unknown;
  accountId?: string;
  env?: NodeJS.ProcessEnv;
}) {
  return resolveVkAccount({
    config: parseVkConfig(
      overrides?.config ?? {
        groupId: 77,
        transport: "long-poll",
        accessToken: "replace-me-send-token",
      },
    ),
    accountId: overrides?.accountId,
    env: overrides?.env ?? {},
  });
}

describe("vk outbound text", () => {
  it("normalizes target ids and sends message text with reply_to", async () => {
    const account = createAccount();
    let requestedUrl: URL | undefined;

    const result = await sendVkText({
      account,
      peerId: "vk:user:42",
      text: "Hello from OpenClaw",
      replyTo: "501",
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 9001,
          }),
        );
      },
    });

    expect(result.messageId).toBe("9001");
    expect(result.peerId).toBe(42);
    expect(result.randomId).toBeGreaterThan(0);
    expect(requestedUrl?.pathname).toBe("/method/messages.send");
    expect(requestedUrl?.searchParams.get("peer_id")).toBe("42");
    expect(requestedUrl?.searchParams.get("message")).toBe("Hello from OpenClaw");
    expect(requestedUrl?.searchParams.get("reply_to")).toBe("501");
    expect(requestedUrl?.searchParams.get("random_id")).toBe(String(result.randomId));
  });

  it("uses stable random ids when dedupeKey is provided", async () => {
    const account = createAccount();
    const observedRandomIds: string[] = [];

    const fetchImpl = async (input: URL | RequestInfo) => {
      observedRandomIds.push(new URL(String(input)).searchParams.get("random_id") ?? "");
      return new Response(
        JSON.stringify({
          response: observedRandomIds.length,
        }),
      );
    };

    const first = await sendVkText({
      account,
      peerId: 42,
      text: "Same delivery key",
      dedupeKey: "thread:42:reply:1",
      fetchImpl,
    });
    const second = await sendVkText({
      account,
      peerId: 42,
      text: "Same delivery key",
      dedupeKey: "thread:42:reply:1",
      fetchImpl,
    });

    expect(first.randomId).toBe(second.randomId);
    expect(observedRandomIds).toEqual([String(first.randomId), String(second.randomId)]);
    expect(resolveVkRandomId({ dedupeKey: "thread:42:reply:1" })).toBe(first.randomId);
  });

  it("edits an existing VK callback message in place when cmid is provided", async () => {
    const account = createAccount();
    let requestedUrl: URL | undefined;

    const result = await sendVkText({
      account,
      peerId: 42,
      text: "Updated menu",
      keyboard: JSON.stringify({
        inline: true,
        buttons: [],
      }),
      editConversationMessageId: "72",
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 1,
          }),
        );
      },
    });

    expect(result).toMatchObject({
      messageId: "72",
      peerId: 42,
      edited: true,
    });
    expect(requestedUrl?.pathname).toBe("/method/messages.edit");
    expect(requestedUrl?.searchParams.get("peer_id")).toBe("42");
    expect(requestedUrl?.searchParams.get("cmid")).toBe("72");
    expect(requestedUrl?.searchParams.get("message")).toBe("Updated menu");
    expect(requestedUrl?.searchParams.get("random_id")).toBeNull();
    expect(requestedUrl?.searchParams.get("reply_to")).toBeNull();
  });

  it("can edit a VK message into a collapsed launcher menu", async () => {
    const account = createAccount({
      config: {
        groupId: 77,
        transport: "long-poll",
        accessToken: "replace-me-send-token",
      },
    });
    let requestedUrl: URL | undefined;

    const result = await sendVkText({
      account,
      peerId: 42,
      text: "Menu hidden. Tap Menu to reopen.",
      keyboard: JSON.stringify({
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
          ],
        ],
      }),
      editConversationMessageId: "72",
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 1,
          }),
        );
      },
    });

    expect(result).toMatchObject({
      messageId: "72",
      peerId: 42,
      edited: true,
    });
    expect(requestedUrl?.pathname).toBe("/method/messages.edit");
    expect(requestedUrl?.searchParams.get("message")).toBe("Menu hidden. Tap Menu to reopen.");
    expect(JSON.parse(requestedUrl?.searchParams.get("keyboard") ?? "{}")).toEqual({
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
        ],
      ],
    });
  });

  it("falls back to sending a new message when VK cannot edit the old menu", async () => {
    const account = createAccount();
    const requestedUrls: URL[] = [];

    const result = await sendVkText({
      account,
      peerId: 42,
      text: "Updated menu",
      editConversationMessageId: "72",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        if (url.pathname === "/method/messages.edit") {
          return new Response(
            JSON.stringify({
              error: {
                error_code: 909,
                error_msg: "too old",
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: 9107,
          }),
        );
      },
    });

    expect(result).toMatchObject({
      messageId: "9107",
      peerId: 42,
    });
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]?.pathname).toBe("/method/messages.edit");
    expect(requestedUrls[1]?.pathname).toBe("/method/messages.send");
  });

  it("falls back to sending a new message when VK returns invalid cmid for text edits", async () => {
    const account = createAccount();
    const requestedUrls: URL[] = [];

    const result = await sendVkText({
      account,
      peerId: 42,
      text: "Updated menu",
      editConversationMessageId: "72",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        if (url.pathname === "/method/messages.edit") {
          return new Response(
            JSON.stringify({
              error: {
                error_code: 100,
                error_msg: "invalid cmid",
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: 9108,
          }),
        );
      },
    });

    expect(result).toMatchObject({
      messageId: "9108",
      peerId: 42,
    });
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]?.pathname).toBe("/method/messages.edit");
    expect(requestedUrls[1]?.pathname).toBe("/method/messages.send");
  });

  it("retries conversation_message_id lookup after sending a long-poll keyboard", async () => {
    const account = createAccount();
    const requestedUrls: URL[] = [];

    const result = await sendVkPayload({
      account,
      peerId: 42,
      text: "VK uses buttons for command menus. Choose a command:",
      keyboard: JSON.stringify({
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
          ],
        ],
      }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requestedUrls.push(url);

        if (url.pathname === "/method/messages.send") {
          return new Response(
            JSON.stringify({
              response: 9201,
            }),
          );
        }

        if (url.pathname === "/method/messages.getHistory") {
          const historyAttempt = requestedUrls.filter(
            (entry) => entry.pathname === "/method/messages.getHistory",
          ).length;
          if (historyAttempt === 1) {
            return new Response(
              JSON.stringify({
                response: {
                  items: [],
                },
              }),
            );
          }

          return new Response(
            JSON.stringify({
              response: {
                items: [
                  {
                    id: 9201,
                    conversation_message_id: 88,
                  },
                ],
              },
            }),
          );
        }

        throw new Error(`Unexpected VK request ${url.pathname}`);
      },
    });

    expect(result).toMatchObject({
      messageId: "9201",
      peerId: 42,
      conversationMessageId: "88",
    });
    expect(
      requestedUrls.filter((url) => url.pathname === "/method/messages.getHistory"),
    ).toHaveLength(2);
  });

  it("falls back to sending a new message when VK returns invalid cmid for payload edits", async () => {
    const account = createAccount();
    const requestedUrls: URL[] = [];

    const result = await sendVkPayload({
      account,
      peerId: 42,
      text: "Updated menu",
      editConversationMessageId: "72",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        if (url.pathname === "/method/messages.edit") {
          return new Response(
            JSON.stringify({
              error: {
                error_code: 100,
                error_msg: "invalid cmid",
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: 9109,
          }),
        );
      },
    });

    expect(result).toMatchObject({
      messageId: "9109",
      peerId: 42,
    });
    expect(requestedUrls[0]?.pathname).toBe("/method/messages.edit");
    expect(requestedUrls[1]?.pathname).toBe("/method/messages.send");
    expect(
      requestedUrls.filter((url) => url.pathname === "/method/messages.getHistory").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders markdown text as readable plain VK text", async () => {
    const account = createAccount();
    let requestedUrl: URL | undefined;

    await sendVkText({
      account,
      peerId: 42,
      text: `## Heading

*Italic* **Bold**

> Quote

~~Gone~~

||Secret||

| Name | Value |
| --- | --- |
| Row1 | A |

[OpenClaw](https://openclaw.ai)`,
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 9105,
          }),
        );
      },
    });

    const message = requestedUrl?.searchParams.get("message") ?? "";
    expect(message).toContain("Heading");
    expect(message).toContain("Italic");
    expect(message).toContain("Bold");
    expect(message).toContain("[quote]Quote[/quote]");
    expect(message).toContain("[S]Gone[/S]");
    expect(message).toContain("[spoiler]Secret[/spoiler]");
    expect(message).toContain("• Name: Row1");
    expect(message).toContain("Value: A");
    expect(message).toContain("OpenClaw");
    expect(message).not.toContain("| --- | --- |");
    expect(message).not.toContain("[I]Italic[/I]");
    expect(message).not.toContain("[B]Bold[/B]");
    expect(message).not.toContain("OpenClaw (https://openclaw.ai)");
    expect(requestedUrl?.searchParams.get("format_data")).toBe(
      JSON.stringify({
        version: "1",
        items: [
          { offset: message.indexOf("Heading"), length: 7, type: "bold" },
          { offset: message.indexOf("Italic"), length: 6, type: "italic" },
          { offset: message.indexOf("Bold"), length: 4, type: "bold" },
          {
            offset: message.indexOf("OpenClaw"),
            length: "OpenClaw".length,
            type: "url",
            url: "https://openclaw.ai",
          },
        ],
      }),
    );
  });

  it("sends native VK underline and html emphasis metadata", async () => {
    const account = createAccount();
    let requestedUrl: URL | undefined;

    await sendVkText({
      account,
      peerId: 42,
      text: '<strong>BoldHtml</strong> <em>ItalicHtml</em> <u>UnderlineHtml</u> <a href="https://openclaw.ai">OpenClaw</a>',
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 9106,
          }),
        );
      },
    });

    expect(requestedUrl?.searchParams.get("message")).toBe(
      "BoldHtml ItalicHtml UnderlineHtml OpenClaw",
    );
    expect(requestedUrl?.searchParams.get("format_data")).toBe(
      JSON.stringify({
        version: "1",
        items: [
          { offset: 0, length: "BoldHtml".length, type: "bold" },
          {
            offset: "BoldHtml ".length,
            length: "ItalicHtml".length,
            type: "italic",
          },
          {
            offset: "BoldHtml ItalicHtml ".length,
            length: "UnderlineHtml".length,
            type: "underline",
          },
          {
            offset: "BoldHtml ItalicHtml UnderlineHtml ".length,
            length: "OpenClaw".length,
            type: "url",
            url: "https://openclaw.ai",
          },
        ],
      }),
    );
  });

  it("builds reply sends from normalized inbound VK messages", async () => {
    const account = createAccount();
    let requestedUrl: URL | undefined;
    const inbound = normalizeVkMessageNewUpdate({
      accountId: account.accountId,
      groupId: 77,
      update: {
        type: "message_new",
        group_id: 77,
        event_id: "evt-1",
        object: {
          message: {
            id: 501,
            peer_id: 42,
            from_id: 42,
            text: "Incoming",
            date: 1_700_000_000,
          },
        },
      },
    });

    expect(inbound).not.toBeNull();

    const result = await sendVkReply({
      account,
      message: inbound!,
      text: "Reply text",
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 9100,
          }),
        );
      },
    });

    expect(result.messageId).toBe("9100");
    expect(requestedUrl?.searchParams.get("peer_id")).toBe("42");
    expect(requestedUrl?.searchParams.get("reply_to")).toBe("501");
  });

  it("preserves inbound VK format_data when present on a message_new update", () => {
    const inbound = normalizeVkMessageNewUpdate({
      accountId: "default",
      groupId: 77,
      update: {
        type: "message_new",
        group_id: 77,
        event_id: "evt-format-1",
        object: {
          message: {
            id: 777,
            peer_id: 42,
            from_id: 42,
            text: "Italic Bold",
            format_data: {
              version: "1",
              items: [
                { offset: 0, length: 6, type: "italic" },
                { offset: 7, length: 4, type: "bold" },
                { offset: 0, length: 6, type: "underline" },
                {
                  offset: 7,
                  length: 4,
                  type: "url",
                  url: "https://openclaw.ai",
                },
              ],
            },
            date: 1_700_000_000,
          },
        },
      },
    });

    expect(inbound).toMatchObject({
      text: "Italic Bold",
      formatData: {
        version: "1",
        items: [
          { offset: 0, length: 6, type: "italic" },
          { offset: 7, length: 4, type: "bold" },
          { offset: 0, length: 6, type: "underline" },
          { offset: 7, length: 4, type: "url", url: "https://openclaw.ai" },
        ],
      },
    });
  });

  it("does not fall back to a group message global id for reply_to", async () => {
    const account = createAccount();
    let requestedUrl: URL | undefined;
    const inbound = {
      accountId: account.accountId,
      groupId: 77,
      transport: "long-poll",
      eventType: "message_new",
      dedupeKey: "event:group-1",
      messageId: "0",
      peerId: 2_000_000_001,
      senderId: 42,
      text: "Incoming group message",
      createdAt: 1_700_000_000_000,
      isGroupChat: true,
      rawUpdate: {},
    } as const;

    await sendVkReply({
      account,
      message: inbound,
      text: "Reply text",
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 9101,
          }),
        );
      },
    });

    expect(requestedUrl?.searchParams.get("peer_id")).toBe("2000000001");
    expect(requestedUrl?.searchParams.get("reply_to")).toBeNull();
  });

  it("omits group reply_to even when VK provides a conversation message id", async () => {
    const account = createAccount();
    let requestedUrl: URL | undefined;
    const inbound = {
      accountId: account.accountId,
      groupId: 77,
      transport: "long-poll",
      eventType: "message_new",
      dedupeKey: "event:group-2",
      messageId: "0",
      conversationMessageId: "17",
      peerId: 2_000_000_001,
      senderId: 42,
      text: "Incoming group message",
      createdAt: 1_700_000_000_000,
      isGroupChat: true,
      rawUpdate: {},
    } as const;

    await sendVkReply({
      account,
      message: inbound,
      text: "Reply text",
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 9102,
          }),
        );
      },
    });

    expect(requestedUrl?.searchParams.get("peer_id")).toBe("2000000001");
    expect(requestedUrl?.searchParams.get("reply_to")).toBeNull();
  });

  it("prefers the DM message id over conversation_message_id for reply_to", async () => {
    const account = createAccount();
    let requestedUrl: URL | undefined;
    const inbound = {
      accountId: account.accountId,
      groupId: 77,
      transport: "callback-api",
      eventType: "message_new",
      dedupeKey: "event:dm-callback-1",
      messageId: "93",
      conversationMessageId: "68",
      peerId: 42,
      senderId: 42,
      text: "/commands",
      createdAt: 1_700_000_000_000,
      isGroupChat: false,
      rawUpdate: {},
    } as const;

    await sendVkReply({
      account,
      message: inbound,
      text: "Reply text",
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(
          JSON.stringify({
            response: 9103,
          }),
        );
      },
    });

    expect(requestedUrl?.searchParams.get("peer_id")).toBe("42");
    expect(requestedUrl?.searchParams.get("reply_to")).toBe("93");
  });

  it("fails fast on missing token or invalid peer ids", async () => {
    const account = createAccount({
      config: {
        groupId: 77,
      },
    });

    await expect(
      sendVkText({
        account,
        peerId: "vk:user:42",
        text: "No token",
      }),
    ).rejects.toThrow("VK token is not configured");

    const goodAccount = createAccount();
    await expect(
      sendVkText({
        account: goodAccount,
        peerId: "vk:user:not-a-number",
        text: "Bad peer",
      }),
    ).rejects.toThrow("Invalid VK peer id");

    expect(normalizeVkPeerId("vk:chat:2000000001")).toBe(2_000_000_001);
  });
});
