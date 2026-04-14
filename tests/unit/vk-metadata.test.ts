import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as Record<string, unknown>;
}

describe("vk package metadata", () => {
  it("keeps the package unofficial while preserving the vk plugin id", () => {
    const manifest = readJson("openclaw.plugin.json");
    const packageJson = readJson("package.json");
    const openclaw = packageJson.openclaw as Record<string, unknown>;
    const channel = openclaw.channel as Record<string, unknown>;
    const install = openclaw.install as Record<string, unknown>;

    expect(manifest.id).toBe("vk");
    expect(manifest.channels).toEqual(["vk"]);
    expect(packageJson.name).toBe("openclaw-vk-plugin");
    expect(channel.id).toBe("vk");
    expect(install.npmSpec).toBe(packageJson.name);
    expect(manifest.id).toBe(channel.id);
  });
});
