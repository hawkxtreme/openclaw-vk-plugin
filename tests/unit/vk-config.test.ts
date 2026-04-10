import { mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createVkChannel,
  createVkRuntime,
  listVkAccountIds,
  parseVkConfig,
  resolveDefaultVkAccountId,
  resolveVkAccount,
  resolveVkToken,
  VkConfigError,
} from "../../api.js";

describe("vk config", () => {
  it("parses config and normalizes defaults", () => {
    const config = parseVkConfig({
      groupId: "42",
      callback: {
        path: "plugins/vk/webhook/default",
      },
    });

    expect(config).toMatchObject({
      groupId: 42,
      transport: "long-poll",
      apiVersion: "5.199",
      callback: {
        path: "/plugins/vk/webhook/default",
      },
    });
  });

  it("rejects callback-api transport on the active long-poll branch", () => {
    expect(() =>
      parseVkConfig({
        groupId: 42,
        transport: "callback-api",
      }),
    ).toThrow(VkConfigError);
  });

  it("throws for invalid account and defaultAccount mismatch", () => {
    expect(() =>
      parseVkConfig({
        defaultAccount: "secondary",
        accounts: {
          primary: {
            groupId: 1,
          },
        },
      }),
    ).toThrow(VkConfigError);
  });

  it("lists accounts and resolves default account", () => {
    const config = parseVkConfig({
      groupId: 11,
      accounts: {
        support: {
          groupId: 22,
        },
      },
      defaultAccount: "support",
    });

    expect(listVkAccountIds(config)).toEqual(["default", "support"]);
    expect(resolveDefaultVkAccountId(config)).toBe("support");
  });

  it("merges account overrides and resolves config token", () => {
    const config = parseVkConfig({
      name: "VK Base",
      groupId: 11,
      accessToken: "replace-me-root-token",
      groupPolicy: "allowlist",
      groupAllowFrom: ["vk:100"],
      groups: {
        "*": {
          requireMention: true,
        },
      },
      accounts: {
        support: {
          name: "Support",
          groupId: 22,
          groupAllowFrom: ["vk:200"],
          groups: {
            "2000000001": {
              enabled: true,
              requireMention: false,
              allowFrom: ["vk:300"],
            },
          },
        },
      },
    });

    const account = resolveVkAccount({
      config,
      accountId: "support",
      env: {},
    });

    expect(account).toMatchObject({
      accountId: "support",
      enabled: true,
      token: "replace-me-root-token",
      tokenSource: "config",
      config: {
        name: "Support",
        groupId: 22,
        groupPolicy: "allowlist",
        groupAllowFrom: ["vk:200"],
        groups: {
          "*": {
            requireMention: true,
          },
          "2000000001": {
            enabled: true,
            requireMention: false,
            allowFrom: ["vk:300"],
          },
        },
      },
    });
  });

  it("resolves token from env reference and default env fallback", () => {
    const envConfig = parseVkConfig({
      accessToken: "${VK_GROUP_TOKEN}",
    });
    const env = { VK_GROUP_TOKEN: "env-token" };

    expect(
      resolveVkToken({
        config: envConfig,
        accountId: "default",
        env,
      }),
    ).toEqual({
      token: "env-token",
      source: "env",
    });

    const fallbackConfig = parseVkConfig({});
    expect(
      resolveVkToken({
        config: fallbackConfig,
        accountId: "default",
        env,
      }),
    ).toEqual({
      token: "env-token",
      source: "env",
    });
  });

  it("resolves token from secret file and rejects symlinks", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "openclaw-vk-"));
    const tokenFile = join(tempDir, "token.txt");
    writeFileSync(tokenFile, "replace-me-file-token\n", "utf8");

    const config = parseVkConfig({
      tokenFile,
    });
    const fromFile = resolveVkAccount({
      config,
      env: {},
    });
    expect(fromFile.token).toBe("replace-me-file-token");
    expect(fromFile.tokenSource).toBe("configFile");

    const symlinkPath = join(tempDir, "token-link.txt");
    try {
      symlinkSync(tokenFile, symlinkPath);
      const symlinkConfig = parseVkConfig({
        tokenFile: symlinkPath,
      });
      const fromSymlink = resolveVkAccount({
        config: symlinkConfig,
        env: {},
      });

      expect(fromSymlink.token).toBe("");
      expect(fromSymlink.tokenError).toContain("symlink");

      unlinkSync(symlinkPath);
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toContain(
        "operation not permitted",
      );
    }
  });

  it("creates channel and runtime metadata from parsed config", () => {
    const config = {
      groupId: 11,
      accessToken: "replace-me-runtime-token",
      accounts: {
        support: {
          groupId: 22,
          transport: "long-poll",
          accessToken: "replace-me-support-token",
        },
      },
      defaultAccount: "support",
    };

    expect(createVkChannel(config)).toEqual({
      id: "vk",
      transport: "long-poll",
      defaultAccountId: "support",
      apiVersion: "5.199",
    });

    expect(
      createVkRuntime({
        config,
        accountId: "support",
        env: {},
      }),
    ).toEqual({
      healthy: true,
      enabled: true,
      accountId: "support",
      transport: "long-poll",
      tokenSource: "config",
      groupId: 22,
      issue: undefined,
    });
  });

  it("parses and validates group policy configuration", () => {
    const config = parseVkConfig({
      groupId: 11,
      groupPolicy: "open",
      groupAllowFrom: ["vk:42", "*"],
      groups: {
        "*": {
          requireMention: true,
        },
        "2000000001": {
          enabled: true,
          allowFrom: ["vk:99"],
          requireMention: false,
        },
      },
    });

    expect(config).toMatchObject({
      groupPolicy: "open",
      groupAllowFrom: ["vk:42", "*"],
      groups: {
        "*": {
          requireMention: true,
        },
        "2000000001": {
          enabled: true,
          allowFrom: ["vk:99"],
          requireMention: false,
        },
      },
    });

    expect(() =>
      parseVkConfig({
        groupPolicy: "pairing",
      }),
    ).toThrow(VkConfigError);
  });
});
