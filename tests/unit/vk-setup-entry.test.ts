import { describe, expect, it } from "vitest";

import { vkSetupPlugin } from "../../api.js";
import setupEntry from "../../setup-entry";

describe("vk setup entry", () => {
  it("exports the setup plugin directly for setup-runtime loaders", () => {
    expect(setupEntry).toBeTruthy();
    expect(typeof setupEntry).toBe("object");
    expect("plugin" in setupEntry).toBe(true);
    expect(setupEntry.plugin).toBe(vkSetupPlugin);
    expect(setupEntry.plugin.id).toBe("vk");
  });
});
