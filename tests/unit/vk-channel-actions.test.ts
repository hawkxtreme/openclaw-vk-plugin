import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendVkPayloadMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/vk-core/outbound/media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/vk-core/outbound/media.js")>();
  return {
    ...actual,
    sendVkPayload: sendVkPayloadMock,
  };
});

import { vkMessageActions } from "../../src/channel-actions.js";

describe("vk message actions", () => {
  beforeEach(() => {
    sendVkPayloadMock.mockReset();
    sendVkPayloadMock.mockResolvedValue({
      messageId: "9010",
      peerId: 42,
      randomId: 1001,
      attachments: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts mediaUrl and replyToId aliases on the message action surface", async () => {
    const result = await vkMessageActions.handleAction?.({
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
        message: "Look at this",
        mediaUrl: "https://example.com/demo.png",
        replyToId: "501",
      },
      accountId: "default",
      mediaLocalRoots: [],
    });

    expect(sendVkPayloadMock).toHaveBeenCalledTimes(1);
    expect(sendVkPayloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "42",
        text: "Look at this",
        mediaUrls: ["https://example.com/demo.png"],
        replyTo: "501",
      }),
    );
    const jsonText = result?.content.find((entry) => entry.type === "text")?.text;
    expect(JSON.parse(jsonText ?? "{}")).toMatchObject({
      channel: "vk",
      messageId: "9010",
      conversationId: "42",
    });
  });
});
