import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { ResolverContext } from "openclaw/plugin-sdk/security-runtime";
import {
  collectRuntimeConfigAssignments,
  secretTargetRegistryEntries,
} from "../../src/secret-contract.js";

function asConfig(value: unknown): OpenClawConfig {
  return value as OpenClawConfig;
}

function createResolverContext(sourceConfig: OpenClawConfig): ResolverContext {
  return {
    sourceConfig,
    env: {},
    cache: {},
    warnings: [],
    warningKeys: new Set(),
    assignments: [],
  };
}

function envRef(id: string) {
  return { source: "env" as const, provider: "default", id };
}

describe("vk secret contract", () => {
  it("registers only VK access token surfaces in the standalone long-poll path", () => {
    expect(secretTargetRegistryEntries.map((entry) => entry.pathPattern)).toEqual([
      "channels.vk.accounts.*.accessToken",
      "channels.vk.accessToken",
    ]);
  });

  it("collects the inherited top-level VK token for enabled long-poll accounts", () => {
    const config = asConfig({
      channels: {
        vk: {
          enabled: true,
          accessToken: envRef("VK_GROUP_TOKEN"),
          accounts: {
            support: {
              enabled: true,
              groupId: 77,
            },
          },
        },
      },
    });
    const context = createResolverContext(config);

    collectRuntimeConfigAssignments({
      config,
      defaults: undefined,
      context,
    });

    expect(context.assignments).toHaveLength(1);
    expect(context.assignments[0]?.path).toBe("channels.vk.accessToken");
  });

  it("collects account-local VK tokens when the account owns its token", () => {
    const config = asConfig({
      channels: {
        vk: {
          enabled: true,
          accounts: {
            support: {
              enabled: true,
              groupId: 77,
              accessToken: envRef("VK_SUPPORT_TOKEN"),
            },
          },
        },
      },
    });
    const context = createResolverContext(config);

    collectRuntimeConfigAssignments({
      config,
      defaults: undefined,
      context,
    });

    expect(context.assignments).toHaveLength(1);
    expect(context.assignments[0]?.path).toBe("channels.vk.accounts.support.accessToken");
  });
});
