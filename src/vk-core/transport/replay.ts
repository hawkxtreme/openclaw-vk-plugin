export type VkReplayGuardOptions = {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

export type VkReplayGuard = {
  mark: (key: string) => boolean;
  size: () => number;
};

export function createVkReplayGuard(
  options: VkReplayGuardOptions = {},
): VkReplayGuard {
  const ttlMs = Math.max(1, options.ttlMs ?? 5 * 60 * 1000);
  const maxEntries = Math.max(1, options.maxEntries ?? 10_000);
  const now = options.now ?? Date.now;
  const entries = new Map<string, number>();

  function prune(): void {
    const currentTime = now();

    for (const [key, expiresAt] of entries) {
      if (expiresAt <= currentTime) {
        entries.delete(key);
      }
    }

    while (entries.size > maxEntries) {
      const firstKey = entries.keys().next().value;
      if (!firstKey) {
        break;
      }
      entries.delete(firstKey);
    }
  }

  return {
    mark(key) {
      const normalized = key.trim();
      if (!normalized) {
        return true;
      }

      prune();
      if (entries.has(normalized)) {
        return false;
      }

      entries.set(normalized, now() + ttlMs);
      prune();
      return true;
    },
    size() {
      prune();
      return entries.size;
    },
  };
}
