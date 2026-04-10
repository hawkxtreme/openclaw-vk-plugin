import { describe, expect, it } from "vitest";

import {
  createVkReplayGuard,
  createVkTraceCollector,
} from "../../api.js";

describe("vk observability", () => {
  it("records bounded traces and event counters", () => {
    const tracer = createVkTraceCollector({
      maxEntries: 2,
      now: () => 1_700_000_000_000,
    });

    tracer.record("webhook.accepted", { accountId: "default" });
    tracer.record("interactive.answer.sent", { accountId: "default" });
    tracer.record("webhook.duplicate", { accountId: "default" });

    expect(tracer.list()).toHaveLength(2);
    expect(tracer.getCounters()).toEqual({
      "interactive.answer.sent": 1,
      "webhook.accepted": 1,
      "webhook.duplicate": 1,
    });
    expect(tracer.getSummary()).toMatchObject({
      totalEvents: 3,
      lastEventName: "webhook.duplicate",
    });
  });

  it("expires replay keys after ttl", () => {
    let now = 1_700_000_000_000;
    const replay = createVkReplayGuard({
      ttlMs: 100,
      now: () => now,
    });

    expect(replay.mark("evt-1")).toBe(true);
    expect(replay.mark("evt-1")).toBe(false);

    now += 101;
    expect(replay.mark("evt-1")).toBe(true);
  });
});
