import { describe, expect, it } from "vitest";
import { runVkReleaseReadinessChecks } from "../../api.js";

describe("vk release smoke", () => {
  it("requires the minimal long-poll account fields and ignores archived callback settings", () => {
    expect(
      runVkReleaseReadinessChecks({
        transport: "long-poll",
      }),
    ).toEqual([
      "channels.vk.accounts.default.groupId is required",
      "channels.vk.accounts.default.accessToken is required",
    ]);

    expect(
      runVkReleaseReadinessChecks({
        groupId: 77,
        transport: "long-poll",
        accessToken: "replace-me-long-poll-token",
        callback: {
          path: "/plugins/vk/webhook/default",
          secret: "replace-me-callback-secret",
          confirmationCode: "confirm-77",
        },
      }),
    ).toEqual([]);
  });
});
