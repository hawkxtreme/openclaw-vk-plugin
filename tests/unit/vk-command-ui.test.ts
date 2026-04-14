import { describe, expect, it } from "vitest";
import {
  normalizeVkCommandShortcut,
  resolveVkSlashCommandSuggestionReply,
} from "../../src/command-ui.js";

describe("vk command ui", () => {
  it("marks the exact /commands menu as a long-poll inline callback surface", () => {
    const reply = resolveVkSlashCommandSuggestionReply("/commands");

    expect(reply?.text).toBe("VK uses buttons for command menus. Choose a command:");
    expect(reply?.channelData).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [
            { text: "Menu", callback_data: "/commands" },
            { text: "Help", callback_data: "/help" },
          ],
          [
            { text: "New", callback_data: "/new" },
            { text: "Reset", callback_data: "/reset" },
          ],
          [
            { text: "Model", callback_data: "/model" },
            { text: "Models", callback_data: "/models" },
          ],
          [
            { text: "Status", callback_data: "/status" },
            { text: "Tools", callback_data: "/tools" },
          ],
          [{ text: "Close", callback_data: "/vk-menu-close" }],
        ],
      },
    });
  });

  it("normalizes localized slash menu aliases before rendering the shared command menu", () => {
    const menuReply = resolveVkSlashCommandSuggestionReply("/меню");
    const commandsReply = resolveVkSlashCommandSuggestionReply("/команды");

    expect(menuReply).toEqual(commandsReply);
    expect(menuReply?.channelData).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [
            { text: "Menu", callback_data: "/commands" },
            { text: "Help", callback_data: "/help" },
          ],
          [
            { text: "New", callback_data: "/new" },
            { text: "Reset", callback_data: "/reset" },
          ],
          [
            { text: "Model", callback_data: "/model" },
            { text: "Models", callback_data: "/models" },
          ],
          [
            { text: "Status", callback_data: "/status" },
            { text: "Tools", callback_data: "/tools" },
          ],
          [{ text: "Close", callback_data: "/vk-menu-close" }],
        ],
      },
    });
  });

  it("marks narrowed slash-prefix suggestions as long-poll inline callback surfaces", () => {
    const reply = resolveVkSlashCommandSuggestionReply("/mo");

    expect(reply?.text).toBe("VK uses buttons for command menus. Matching commands:");
    expect(reply?.channelData).toEqual({
      vk: {
        inline: true,
        oneTime: false,
        longPollInlineCallback: true,
        buttons: [
          [
            { text: "Model", callback_data: "/model" },
            { text: "Models", callback_data: "/models" },
          ],
          [{ text: "Close", callback_data: "/vk-menu-close" }],
        ],
      },
    });
  });

  it("normalizes common start keywords to the shared command menu", () => {
    expect(normalizeVkCommandShortcut("start")).toBe("/commands");
    expect(normalizeVkCommandShortcut("/start")).toBe("/commands");
    expect(normalizeVkCommandShortcut("старт")).toBe("/commands");
    expect(normalizeVkCommandShortcut("/старт")).toBe("/commands");
    expect(normalizeVkCommandShortcut("начать")).toBe("/commands");
    expect(normalizeVkCommandShortcut("/начать")).toBe("/commands");
  });
});
