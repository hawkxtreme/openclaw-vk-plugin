export type VkDedupeCache = {
  has: (key: string) => boolean;
  add: (key: string) => void;
  size: () => number;
};

export function createVkDedupeCache(maxEntries = 1_000): VkDedupeCache {
  const limit = Math.max(1, Math.floor(maxEntries));
  const keys = new Set<string>();
  const order: string[] = [];

  return {
    has(key) {
      return keys.has(key);
    },
    add(key) {
      if (keys.has(key)) {
        return;
      }

      keys.add(key);
      order.push(key);

      while (order.length > limit) {
        const oldest = order.shift();
        if (!oldest) {
          continue;
        }
        keys.delete(oldest);
      }
    },
    size() {
      return keys.size;
    },
  };
}
