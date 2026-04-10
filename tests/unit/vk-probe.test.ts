import { describe, expect, it } from "vitest";
import { parseVkConfig, probeVkAccount, resolveVkAccount } from "../../api.js";

function createAccount(overrides?: {
  config?: unknown;
  accountId?: string;
  env?: NodeJS.ProcessEnv;
}) {
  return resolveVkAccount({
    config: parseVkConfig(
      overrides?.config ?? {
        groupId: 77,
        accessToken: "replace-me-probe-token",
      },
    ),
    accountId: overrides?.accountId,
    env: overrides?.env ?? {},
  });
}

describe("vk probe", () => {
  it("returns success for a long-poll account with required events enabled", async () => {
    const account = createAccount();
    const result = await probeVkAccount({
      account,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("groups.getLongPollSettings")) {
          return new Response(
            JSON.stringify({
              response: {
                is_enabled: true,
                events: {
                  message_new: 1,
                  message_allow: 1,
                  message_deny: 1,
                  message_event: 1,
                },
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: [
              {
                id: 77,
                name: "VK Bot",
                screen_name: "vk-bot",
              },
            ],
          }),
        );
      },
    });

    expect(result).toEqual({
      ok: true,
      accountId: "default",
      tokenSource: "config",
      group: {
        id: 77,
        name: "VK Bot",
        screenName: "vk-bot",
      },
    });
  });

  it("accepts nested groups response shape", async () => {
    const result = await probeVkAccount({
      account: createAccount(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("groups.getLongPollSettings")) {
          return new Response(
            JSON.stringify({
              response: {
                is_enabled: true,
                events: {
                  message_new: 1,
                  message_allow: 1,
                  message_deny: 1,
                  message_event: 1,
                },
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: {
              groups: [
                {
                  id: 77,
                  name: "VK Bot",
                  screen_name: "vk-bot",
                },
              ],
            },
          }),
        );
      },
    });

    expect(result.ok).toBe(true);
  });

  it("returns mismatch error when probed group differs from config", async () => {
    const account = createAccount();
    const result = await probeVkAccount({
      account,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            response: [
              {
                id: 88,
                name: "Different",
                screen_name: "different",
              },
            ],
          }),
        ),
    });

    expect(result).toEqual({
      ok: false,
      accountId: "default",
      tokenSource: "config",
      error: "Configured groupId 77 does not match probed group 88",
    });
  });

  it("fails fast when token is missing", async () => {
    const account = createAccount({
      config: {
        groupId: 77,
      },
      env: {},
    });

    const result = await probeVkAccount({ account });
    expect(result).toEqual({
      ok: false,
      accountId: "default",
      tokenSource: "none",
      error: "VK token is not configured",
    });
  });

  it("returns timeout error when fetch aborts", async () => {
    const account = createAccount();
    const result = await probeVkAccount({
      account,
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });

    expect(result).toEqual({
      ok: false,
      accountId: "default",
      tokenSource: "config",
      error: "VK probe timed out after 20ms",
    });
  });

  it("fails when Bots Long Poll is disabled for a long-poll account", async () => {
    const account = createAccount();
    const result = await probeVkAccount({
      account,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("groups.getLongPollSettings")) {
          return new Response(
            JSON.stringify({
              response: {
                is_enabled: false,
                events: {
                  message_new: 0,
                  message_allow: 0,
                  message_deny: 0,
                  message_event: 0,
                },
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: [
              {
                id: 77,
                name: "VK Bot",
                screen_name: "vk-bot",
              },
            ],
          }),
        );
      },
    });

    expect(result).toEqual({
      ok: false,
      accountId: "default",
      tokenSource: "config",
      error:
        "VK Bots Long Poll is disabled. Enable Bots Long Poll API and the required events in VK community settings.",
    });
  });

  it("fails when required Long Poll events are missing", async () => {
    const account = createAccount();
    const result = await probeVkAccount({
      account,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("groups.getLongPollSettings")) {
          return new Response(
            JSON.stringify({
              response: {
                is_enabled: true,
                events: {
                  message_new: 1,
                  message_allow: 0,
                  message_deny: 1,
                  message_event: 0,
                },
              },
            }),
          );
        }

        return new Response(
          JSON.stringify({
            response: [
              {
                id: 77,
                name: "VK Bot",
                screen_name: "vk-bot",
              },
            ],
          }),
        );
      },
    });

    expect(result).toEqual({
      ok: false,
      accountId: "default",
      tokenSource: "config",
      error: "VK Bots Long Poll is missing required events: message_allow, message_event.",
    });
  });
});
