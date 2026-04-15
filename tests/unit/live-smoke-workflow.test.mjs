import { describe, expect, it } from "vitest";
import {
  buildSmokeConfig,
  normalizeVkGroupId,
  renderComposeOverride,
} from "../../scripts/live-smoke.mjs";
import { filterIgnorableStatusLines } from "../../scripts/release-publish.mjs";

describe("live-smoke workflow helpers", () => {
  it("normalizes VK group ids from handles and URLs", () => {
    expect(normalizeVkGroupId("237442417")).toBe("237442417");
    expect(normalizeVkGroupId("club237442417")).toBe("237442417");
    expect(normalizeVkGroupId("https://vk.com/public237442417")).toBe("237442417");
    expect(normalizeVkGroupId("not-a-group")).toBeNull();
  });

  it("builds a smoke config without dropping existing settings", () => {
    const next = buildSmokeConfig(
      {
        agents: {
          defaults: {
            models: {
              "openai/gpt-5.4": {},
            },
          },
        },
        channels: {
          vk: {
            requireMention: true,
          },
        },
        models: {
          providers: {
            openai: {
              api: "responses",
            },
          },
        },
        plugins: {
          load: {
            paths: ["/existing/plugin"],
          },
        },
      },
      {
        accessToken: "vk1.a.TEST_TOKEN",
        containerPluginPath: "/work/openclaw-vk-plugin/.artifacts/install/vk",
        dmPolicy: "pairing",
        groupId: "237442417",
        ollamaBaseUrl: "http://host.docker.internal:11434",
        ollamaModelId: "qwen3.5:9b",
        ollamaModelName: "Qwen 3.5 9B",
      },
    );

    expect(next.plugins.load.paths).toEqual(["/work/openclaw-vk-plugin/.artifacts/install/vk"]);
    expect(next.plugins.entries.vk.enabled).toBe(true);
    expect(next.channels.vk).toMatchObject({
      enabled: true,
      groupId: 237442417,
      requireMention: true,
      transport: "long-poll",
      dmPolicy: "pairing",
    });
    expect(next.channels.vk.accessToken).toBe("vk1.a.TEST_TOKEN");
    expect(next.agents.defaults.model.primary).toBe("ollama/qwen3.5:9b");
    expect(next.agents.defaults.models["openai/gpt-5.4"]).toEqual({});
    expect(next.models.providers.openai).toEqual({ api: "responses" });
    expect(next.models.providers.ollama.baseUrl).toBe("http://host.docker.internal:11434");
  });

  it("renders a minimal compose override because the bundle is copied into the container", () => {
    const override = renderComposeOverride("D:/project/openclaw-vk-plugin");

    expect(override).toContain("services: {}");
    expect(override).not.toContain("VK_GROUP_TOKEN");
  });

  it("ignores temp-live while keeping real release blockers", () => {
    expect(
      filterIgnorableStatusLines([
        "?? temp-live/",
        "?? docs/RELEASING.md",
        " M package.json",
      ]),
    ).toEqual(["?? docs/RELEASING.md", "M package.json"]);
  });
});
