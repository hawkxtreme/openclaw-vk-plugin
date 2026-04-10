import { describe, expect, it } from "vitest";
import { vkSetupAdapter } from "../../src/setup-core.js";
import type { OpenClawConfig } from "../../src/types.js";

describe("vk setup adapter", () => {
  it("resets the default setup path back to long-poll and clears legacy callback config", () => {
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          enabled: true,
          groupId: 77,
          transport: "callback-api",
          accessToken: "replace-me-old-token",
          callback: {
            path: "/plugins/vk/webhook/default",
            secret: "replace-me-secret",
          },
        },
      },
    };

    const next = vkSetupAdapter.applyAccountConfig({
      cfg,
      accountId: "default",
      input: {
        accessToken: "replace-me-new-token",
      },
    }) as OpenClawConfig;

    expect(next.channels?.vk).toMatchObject({
      enabled: true,
      groupId: 77,
      transport: "long-poll",
      accessToken: "replace-me-new-token",
    });
    expect("callback" in ((next.channels?.vk ?? {}) as Record<string, unknown>)).toBe(false);
  });

  it("ignores webhookPath input and still keeps the account on long-poll", () => {
    const cfg: OpenClawConfig = {
      channels: {
        vk: {
          enabled: true,
          groupId: 77,
          accessToken: "replace-me-token",
        },
      },
    };

    const next = vkSetupAdapter.applyAccountConfig({
      cfg,
      accountId: "default",
      input: {
        accessToken: "replace-me-token",
        webhookPath: "plugins/vk/webhook/default",
      },
    }) as OpenClawConfig;

    expect(next.channels?.vk).toMatchObject({
      transport: "long-poll",
      accessToken: "replace-me-token",
    });
    expect("callback" in ((next.channels?.vk ?? {}) as Record<string, unknown>)).toBe(false);
  });
});
