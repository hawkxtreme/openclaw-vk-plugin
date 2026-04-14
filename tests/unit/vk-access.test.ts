import { describe, expect, it } from "vitest";

import {
  createVkAccessController,
  normalizeVkConsentUpdate,
  normalizeVkMessageNewUpdate,
  parseVkConfig,
  resolveVkAccount,
} from "../../api.js";

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
        accessToken: "replace-me-access-token",
      },
    ),
    accountId: overrides?.accountId,
    env: overrides?.env ?? {},
  });
}

function createDirectMessage(params?: {
  senderId?: number;
  peerId?: number;
  eventId?: string;
  groupId?: number;
}) {
  return normalizeVkMessageNewUpdate({
    accountId: "default",
    groupId: params?.groupId ?? 77,
    update: {
      type: "message_new",
      group_id: params?.groupId ?? 77,
      event_id: params?.eventId ?? "evt-msg-1",
      object: {
        message: {
          id: 501,
          peer_id: params?.peerId ?? params?.senderId ?? 42,
          from_id: params?.senderId ?? 42,
          text: "Incoming message",
          date: 1_700_000_000,
        },
      },
    },
  });
}

describe("vk access controller", () => {
  it("normalizes photo attachments from message_new updates", () => {
    const message = normalizeVkMessageNewUpdate({
      accountId: "default",
      groupId: 77,
      update: {
        type: "message_new",
        group_id: 77,
        event_id: "evt-photo-1",
        object: {
          message: {
            id: 777,
            peer_id: 42,
            from_id: 42,
            text: "Что на фото?",
            date: 1_700_000_000,
            attachments: [
              {
                type: "photo",
                photo: {
                  sizes: [
                    {
                      width: 160,
                      height: 120,
                      url: "https://example.com/photo-small.jpg",
                    },
                    {
                      width: 1280,
                      height: 960,
                      url: "https://example.com/photo-large.jpg",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    expect(message).not.toBeNull();
    expect((message as { attachments?: unknown } | null)?.attachments).toEqual([
      {
        kind: "image",
        url: "https://example.com/photo-large.jpg",
        contentType: "image/jpeg",
      },
    ]);
  });

  it("allows open DM policy and allowlist entries", () => {
    const controller = createVkAccessController();
    const openAccount = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-open-token",
        dmPolicy: "open",
      },
    });
    const allowlistAccount = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-allow-token",
        dmPolicy: "allowlist",
        allowFrom: ["vk:42"],
      },
    });
    const wildcardAccount = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-wildcard-token",
        dmPolicy: "allowlist",
        allowFrom: ["*"],
      },
    });
    const message = createDirectMessage();

    expect(message).not.toBeNull();
    expect(
      controller.evaluateMessage({
        account: openAccount,
        message: message!,
      }),
    ).toMatchObject({
      decision: "allow",
      reason: "dm-open",
    });
    expect(
      controller.evaluateMessage({
        account: allowlistAccount,
        message: message!,
      }),
    ).toMatchObject({
      decision: "allow",
      reason: "allowlist",
    });
    expect(
      controller.evaluateMessage({
        account: wildcardAccount,
        message: createDirectMessage({ senderId: 99 })!,
      }),
    ).toMatchObject({
      decision: "allow",
      reason: "allowlist",
    });
  });

  it("creates pairing requests for unknown DM senders and allows them after approval", () => {
    const controller = createVkAccessController({
      now: () => 1_700_000_100_000,
    });
    const account = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-pair-token",
        dmPolicy: "pairing",
      },
    });
    const message = createDirectMessage({
      senderId: 42,
      eventId: "evt-pairing-1",
    });

    expect(message).not.toBeNull();

    const firstDecision = controller.evaluateMessage({
      account,
      message: message!,
    });
    expect(firstDecision).toMatchObject({
      decision: "pairing",
      reason: "pairing-required",
      challenge: {
        senderId: 42,
        accountId: "default",
        requestCount: 1,
      },
    });
    if (firstDecision.decision !== "pairing") {
      throw new Error("Expected pairing decision");
    }
    expect(firstDecision.challenge.text).toContain("VK user id: 42");
    expect(
      controller.getPendingRequest({
        accountId: "default",
        senderId: 42,
      }),
    ).toMatchObject({
      requestCount: 1,
    });

    controller.approvePairing({
      accountId: "default",
      senderId: 42,
    });
    expect(
      controller.evaluateMessage({
        account,
        message: message!,
      }),
    ).toMatchObject({
      decision: "allow",
      reason: "paired",
    });
    expect(controller.listApprovedSenders("default")).toEqual([42]);
  });

  it("blocks denied consent and revokes pairing approval", () => {
    const controller = createVkAccessController();
    const account = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-consent-token",
        dmPolicy: "pairing",
      },
    });
    const message = createDirectMessage({
      senderId: 42,
      eventId: "evt-deny-1",
    });

    controller.approvePairing({
      accountId: "default",
      senderId: 42,
    });
    const denyEvent = normalizeVkConsentUpdate({
      accountId: "default",
      groupId: 77,
      update: {
        type: "message_deny",
        group_id: 77,
        event_id: "evt-deny",
        object: {
          user_id: 42,
        },
      },
    });

    expect(denyEvent).not.toBeNull();
    controller.recordConsent(denyEvent!);

    expect(
      controller.evaluateMessage({
        account,
        message: message!,
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "consent-denied",
      consentState: "denied",
    });
    expect(controller.listApprovedSenders("default")).toEqual([]);
    expect(
      controller.getConsentState({
        accountId: "default",
        senderId: 42,
      }),
    ).toBe("denied");
  });

  it("blocks unsupported group messages and normalizes consent allow events", () => {
    const controller = createVkAccessController();
    const account = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-group-token",
        dmPolicy: "open",
      },
    });
    const groupMessage = createDirectMessage({
      senderId: 42,
      peerId: 2_000_000_123,
      eventId: "evt-group-1",
    });

    expect(groupMessage).not.toBeNull();
    expect(
      controller.evaluateMessage({
        account,
        message: groupMessage!,
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "group-disabled",
    });

    const allowEvent = normalizeVkConsentUpdate({
      accountId: "default",
      groupId: 77,
      update: {
        type: "message_allow",
        group_id: 77,
        event_id: "evt-allow",
        object: {
          user_id: 42,
        },
      },
    });

    expect(allowEvent).toEqual({
      accountId: "default",
      groupId: 77,
      eventType: "message_allow",
      eventId: "evt-allow",
      dedupeKey: "event:evt-allow",
      senderId: 42,
      consentState: "allowed",
      createdAt: undefined,
      rawUpdate: {
        type: "message_allow",
        group_id: 77,
        event_id: "evt-allow",
        object: {
          user_id: 42,
        },
      },
    });
  });

  it("allows group messages when groupPolicy=open and mention is not required", () => {
    const controller = createVkAccessController();
    const account = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-group-open-token",
        dmPolicy: "disabled",
        groupPolicy: "open",
      },
    });
    const groupMessage = createDirectMessage({
      senderId: 42,
      peerId: 2_000_000_123,
      eventId: "evt-group-open-1",
    });

    expect(groupMessage).not.toBeNull();
    expect(
      controller.evaluateMessage({
        account,
        message: groupMessage!,
      }),
    ).toMatchObject({
      decision: "allow",
      reason: "group-open",
      conversationKind: "group",
      conversationId: "2000000123",
    });
  });

  it("enforces group allowlist and per-group overrides", () => {
    const controller = createVkAccessController();
    const account = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-group-allow-token",
        groupPolicy: "allowlist",
        groupAllowFrom: ["vk:50"],
        groups: {
          "2000000456": {
            allowFrom: ["vk:42"],
          },
        },
      },
    });
    const allowedInOverride = createDirectMessage({
      senderId: 42,
      peerId: 2_000_000_456,
      eventId: "evt-group-override",
    });
    const deniedOutsideOverride = createDirectMessage({
      senderId: 42,
      peerId: 2_000_000_123,
      eventId: "evt-group-denied",
    });
    const allowedByGlobalGroupList = createDirectMessage({
      senderId: 50,
      peerId: 2_000_000_123,
      eventId: "evt-group-global",
    });

    expect(
      controller.evaluateMessage({
        account,
        message: allowedInOverride!,
      }),
    ).toMatchObject({
      decision: "allow",
      reason: "group-allowlist",
    });
    expect(
      controller.evaluateMessage({
        account,
        message: deniedOutsideOverride!,
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "group-not-allowlisted",
    });
    expect(
      controller.evaluateMessage({
        account,
        message: allowedByGlobalGroupList!,
      }),
    ).toMatchObject({
      decision: "allow",
      reason: "group-allowlist",
    });
  });

  it("requires a bot mention when configured for a group", () => {
    const controller = createVkAccessController();
    const account = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-group-mention-token",
        groupPolicy: "open",
        groups: {
          "*": {
            requireMention: true,
          },
        },
      },
    });
    const plainMessage = normalizeVkMessageNewUpdate({
      accountId: "default",
      groupId: 77,
      update: {
        type: "message_new",
        group_id: 77,
        event_id: "evt-group-plain",
        object: {
          message: {
            id: 701,
            peer_id: 2_000_000_789,
            from_id: 42,
            text: "hello team",
            date: 1_700_000_000,
          },
        },
      },
    });
    const mentionedMessage = normalizeVkMessageNewUpdate({
      accountId: "default",
      groupId: 77,
      update: {
        type: "message_new",
        group_id: 77,
        event_id: "evt-group-mentioned",
        object: {
          message: {
            id: 702,
            peer_id: 2_000_000_789,
            from_id: 42,
            text: "[club77|Bot], help please",
            date: 1_700_000_001,
          },
        },
      },
    });

    expect(
      controller.evaluateMessage({
        account,
        message: plainMessage!,
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "group-mention-required",
      wasMentioned: false,
    });
    expect(
      controller.evaluateMessage({
        account,
        message: mentionedMessage!,
      }),
    ).toMatchObject({
      decision: "allow",
      reason: "group-open",
      wasMentioned: true,
    });
  });

  it("allows slash commands in groups without a mention when mention is required", () => {
    const controller = createVkAccessController();
    const account = createAccount({
      config: {
        groupId: 77,
        accessToken: "replace-me-group-command-token",
        groupPolicy: "open",
        groups: {
          "*": {
            requireMention: true,
          },
        },
      },
    });
    const slashCommand = normalizeVkMessageNewUpdate({
      accountId: "default",
      groupId: 77,
      update: {
        type: "message_new",
        group_id: 77,
        event_id: "evt-group-command-1",
        object: {
          message: {
            id: 777,
            peer_id: 2_000_000_123,
            from_id: 42,
            text: "/models",
            date: 1_700_000_000,
          },
        },
      },
    });

    expect(slashCommand).not.toBeNull();
    expect(
      controller.evaluateMessage({
        account,
        message: slashCommand!,
      }),
    ).toMatchObject({
      decision: "allow",
      reason: "group-open",
      wasMentioned: false,
    });
  });
});
