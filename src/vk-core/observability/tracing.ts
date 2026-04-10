export type VkTraceEvent = {
  at: number;
  name: string;
  attributes?: Record<string, unknown>;
};

export type VkTraceCollectorOptions = {
  maxEntries?: number;
  now?: () => number;
};

export type VkTraceCollector = {
  record: (name: string, attributes?: Record<string, unknown>) => void;
  list: () => VkTraceEvent[];
  getCounters: () => Record<string, number>;
  getSummary: () => {
    totalEvents: number;
    storedEvents: number;
    lastEventName?: string;
  };
};

export function createVkTraceCollector(
  options: VkTraceCollectorOptions = {},
): VkTraceCollector {
  const maxEntries = Math.max(1, options.maxEntries ?? 200);
  const now = options.now ?? Date.now;
  const events: VkTraceEvent[] = [];
  const counters = new Map<string, number>();
  let totalEvents = 0;

  return {
    record(name, attributes) {
      const normalized = name.trim();
      if (!normalized) {
        return;
      }

      totalEvents += 1;
      counters.set(normalized, (counters.get(normalized) ?? 0) + 1);
      events.push({
        at: now(),
        name: normalized,
        attributes,
      });

      while (events.length > maxEntries) {
        events.shift();
      }
    },
    list() {
      return [...events];
    },
    getCounters() {
      return Object.fromEntries(counters.entries());
    },
    getSummary() {
      return {
        totalEvents,
        storedEvents: events.length,
        lastEventName: events.at(-1)?.name,
      };
    },
  };
}
