import { beforeEach, describe, expect, it, vi } from "vitest";

const editVkMessageMock = vi.hoisted(() => vi.fn());
const listVkRecentInteractiveMessagesMock = vi.hoisted(() => vi.fn());
const resolveVkLatestInteractiveConversationMessageIdMock = vi.hoisted(() =>
  vi.fn(),
);

vi.mock("../../src/vk-core/core/api.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/vk-core/core/api.js")>();
  return {
    ...actual,
    editVkMessage: editVkMessageMock,
    listVkRecentInteractiveMessages: listVkRecentInteractiveMessagesMock,
    resolveVkLatestInteractiveConversationMessageId:
      resolveVkLatestInteractiveConversationMessageIdMock,
  };
});

import { parseVkConfig, resolveVkAccount } from "../../api.js";
import {
  resolveLatestVkInteractiveMenuId,
  retireOlderVkInteractiveMenus,
} from "../../src/interactive-menu.js";

function createAccount() {
  return resolveVkAccount({
    config: parseVkConfig({
      groupId: 77,
      transport: "long-poll",
      accessToken: "replace-me-menu-token",
    }),
    accountId: "default",
  });
}

describe("vk interactive menu helpers", () => {
  beforeEach(() => {
    editVkMessageMock.mockReset();
    listVkRecentInteractiveMessagesMock.mockReset();
    resolveVkLatestInteractiveConversationMessageIdMock.mockReset();
  });

  it("finds the newest interactive VK menu from history", async () => {
    const account = createAccount();
    resolveVkLatestInteractiveConversationMessageIdMock.mockResolvedValue("12");

    const result = await resolveLatestVkInteractiveMenuId({
      account,
      peerId: "42",
    });

    expect(result).toBe("12");
    expect(resolveVkLatestInteractiveConversationMessageIdMock).toHaveBeenCalledWith({
      token: account.token,
      peerId: 42,
      apiVersion: account.config.apiVersion,
      fetchImpl: undefined,
    });
  });

  it("retires older VK keyboards while keeping the current menu active", async () => {
    const account = createAccount();
    listVkRecentInteractiveMessagesMock.mockResolvedValue([
      { conversationMessageId: "15", text: "Keep" },
      { conversationMessageId: "14", text: "Old A" },
      { conversationMessageId: "13", text: "Old B" },
    ]);

    await retireOlderVkInteractiveMenus({
      account,
      peerId: "42",
      keepConversationMessageId: "15",
    });

    expect(listVkRecentInteractiveMessagesMock).toHaveBeenCalledWith({
      token: account.token,
      peerId: 42,
      apiVersion: account.config.apiVersion,
      fetchImpl: undefined,
    });
    expect(editVkMessageMock.mock.calls).toEqual([
      [
        {
          token: account.token,
          peerId: 42,
          conversationMessageId: "14",
          message: "Old A",
          keyboard: JSON.stringify({
            inline: true,
            buttons: [],
          }),
          apiVersion: account.config.apiVersion,
          fetchImpl: undefined,
        },
      ],
      [
        {
          token: account.token,
          peerId: 42,
          conversationMessageId: "13",
          message: "Old B",
          keyboard: JSON.stringify({
            inline: true,
            buttons: [],
          }),
          apiVersion: account.config.apiVersion,
          fetchImpl: undefined,
        },
      ],
    ]);
  });
});
