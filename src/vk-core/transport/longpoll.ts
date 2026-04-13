import { getVkLongPollServer, pollVkLongPoll } from "../core/api.js";
import { normalizeVkConsentUpdate } from "../inbound/consent.js";
import { normalizeVkMessageEventUpdate } from "../inbound/message-event.js";
import { normalizeVkMessageNewUpdate } from "../inbound/normalize.js";
import type {
  VkLongPollMonitor,
  VkLongPollMonitorOptions,
  VkLongPollResponse,
  VkLongPollMonitorStatus,
  VkLongPollServer,
} from "../types/longpoll.js";
import { createVkDedupeCache } from "./dedupe.js";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function renderTransportError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause =
    error.cause && typeof error.cause === "object"
      ? (error.cause as Record<string, unknown>)
      : null;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  const causeMessage = typeof cause?.message === "string" ? cause.message : undefined;
  if (!code && !causeMessage) {
    return error.message;
  }

  const details = [code, causeMessage].filter(Boolean).join(": ");
  return `${error.message} (${details})`;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function createVkLongPollMonitor(options: VkLongPollMonitorOptions): VkLongPollMonitor {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const reconnectDelayMs = Math.max(0, options.reconnectDelayMs ?? 5_000);
  const controller = new AbortController();
  const dedupe = createVkDedupeCache(options.dedupeMaxEntries);

  let runPromise: Promise<void> | undefined;
  let status: VkLongPollMonitorStatus = {
    state: "idle",
    active: false,
    connected: false,
    accountId: options.account.accountId,
    groupId: options.account.config.groupId,
    transport: "long-poll",
    receivedEvents: 0,
    deliveredEvents: 0,
    dedupedEvents: 0,
    reconnectAttempts: 0,
  };

  function patchStatus(patch: Partial<VkLongPollMonitorStatus>): VkLongPollMonitorStatus {
    status = {
      ...status,
      ...patch,
    };
    options.onStatusChange?.({ ...status });
    return status;
  }

  function stop(reason = "stopped"): void {
    if (!status.stopReason) {
      patchStatus({ stopReason: reason });
    }

    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  }

  function onExternalAbort() {
    stop("external-abort");
  }

  options.abortSignal?.addEventListener("abort", onExternalAbort, {
    once: true,
  });

  async function connectServer(groupId: number): Promise<VkLongPollServer> {
    const server = await getVkLongPollServer({
      token: options.account.token,
      groupId,
      apiVersion: options.account.config.apiVersion,
      signal: controller.signal,
      fetchImpl,
    });

    patchStatus({
      state: "running",
      connected: true,
      groupId,
      server: server.server,
      ts: server.ts,
      lastConnectedAt: now(),
      lastError: undefined,
    });

    return server;
  }

  async function run(): Promise<void> {
    const groupId = options.account.config.groupId;
    if (!options.account.enabled) {
      patchStatus({
        state: "stopped",
        active: false,
        connected: false,
        stopReason: status.stopReason ?? "account-disabled",
      });
      return;
    }

    if (!options.account.token) {
      const message = options.account.tokenError ?? "VK token is not configured";
      patchStatus({
        state: "stopped",
        active: false,
        connected: false,
        lastError: message,
        stopReason: status.stopReason ?? "missing-token",
      });
      throw new Error(message);
    }

    if (!groupId) {
      const message = "VK long poll requires groupId in config";
      patchStatus({
        state: "stopped",
        active: false,
        connected: false,
        lastError: message,
        stopReason: status.stopReason ?? "missing-group-id",
      });
      throw new Error(message);
    }

    patchStatus({
      state: "starting",
      active: true,
      connected: false,
      groupId,
      lastError: undefined,
    });

    let server: VkLongPollServer | null = null;
    while (!controller.signal.aborted) {
      try {
        if (!server) {
          patchStatus({
            state:
              status.reconnectAttempts > 0 || status.lastDisconnectAt ? "reconnecting" : "starting",
            connected: false,
          });
          server = await connectServer(groupId);
        }

        let response: VkLongPollResponse;
        try {
          response = await pollVkLongPoll({
            server: server.server,
            key: server.key,
            ts: server.ts,
            waitSeconds: options.waitSeconds,
            signal: controller.signal,
            fetchImpl,
          });
        } catch (error) {
          if (controller.signal.aborted && isAbortError(error)) {
            break;
          }

          const message = renderTransportError(error);
          patchStatus({
            state: "reconnecting",
            connected: false,
            lastError: message,
            lastDisconnectAt: now(),
            lastReconnectAt: now(),
            reconnectAttempts: status.reconnectAttempts + 1,
          });
          options.logger?.warn?.(
            `[${options.account.accountId}] VK long poll transport error: ${message}; retrying current long poll server`,
          );
          await delay(reconnectDelayMs, controller.signal);
          continue;
        }

        if (response.failed) {
          if (response.failed === 1 && response.ts) {
            server = {
              ...server,
              ts: response.ts,
            };
            patchStatus({
              state: "running",
              connected: true,
              ts: server.ts,
            });
            continue;
          }

          const errorMessage = `VK long poll failed with code ${String(response.failed)}`;
          patchStatus({
            state: "reconnecting",
            connected: false,
            lastError: errorMessage,
            lastDisconnectAt: now(),
            lastReconnectAt: now(),
            reconnectAttempts: status.reconnectAttempts + 1,
          });
          options.logger?.warn?.(
            `[${options.account.accountId}] ${errorMessage}; refreshing long poll server`,
          );
          server = null;
          await delay(reconnectDelayMs, controller.signal);
          continue;
        }

        if (response.ts) {
          server = {
            ...server,
            ts: response.ts,
          };
        }

        patchStatus({
          state: "running",
          connected: true,
          ts: server.ts,
          lastError: undefined,
        });

        for (const update of response.updates ?? []) {
          patchStatus({
            receivedEvents: status.receivedEvents + 1,
            lastEventAt: now(),
          });

          const message = normalizeVkMessageNewUpdate({
            accountId: options.account.accountId,
            groupId,
            update,
            now,
          });
          if (message) {
            if (dedupe.has(message.dedupeKey)) {
              patchStatus({
                dedupedEvents: status.dedupedEvents + 1,
              });
              options.logger?.debug?.(
                `[${options.account.accountId}] deduped VK long poll event ${message.dedupeKey}`,
              );
              continue;
            }

            dedupe.add(message.dedupeKey);
            await options.onMessage(message);
            patchStatus({
              deliveredEvents: status.deliveredEvents + 1,
              lastInboundAt: message.createdAt,
            });

            if (controller.signal.aborted) {
              break;
            }
            continue;
          }

          const consent = normalizeVkConsentUpdate({
            accountId: options.account.accountId,
            groupId,
            update,
            now,
          });
          if (consent) {
            if (dedupe.has(consent.dedupeKey)) {
              patchStatus({
                dedupedEvents: status.dedupedEvents + 1,
              });
              options.logger?.debug?.(
                `[${options.account.accountId}] deduped VK long poll event ${consent.dedupeKey}`,
              );
              continue;
            }

            dedupe.add(consent.dedupeKey);
            await options.onConsent?.(consent);
            patchStatus({
              deliveredEvents: status.deliveredEvents + 1,
            });

            if (controller.signal.aborted) {
              break;
            }
            continue;
          }

          const interactive = normalizeVkMessageEventUpdate({
            accountId: options.account.accountId,
            groupId,
            update,
            transport: "long-poll",
            now,
          });
          if (!interactive) {
            continue;
          }

          if (dedupe.has(interactive.dedupeKey)) {
            patchStatus({
              dedupedEvents: status.dedupedEvents + 1,
            });
            options.logger?.debug?.(
              `[${options.account.accountId}] deduped VK long poll event ${interactive.dedupeKey}`,
            );
            continue;
          }

          dedupe.add(interactive.dedupeKey);
          await options.onInteractiveEvent?.(interactive);
          patchStatus({
            deliveredEvents: status.deliveredEvents + 1,
          });

          if (controller.signal.aborted) {
            break;
          }
        }
      } catch (error) {
        if (controller.signal.aborted && isAbortError(error)) {
          break;
        }

        const message = renderTransportError(error);
        patchStatus({
          state: "reconnecting",
          connected: false,
          lastError: message,
          lastDisconnectAt: now(),
          lastReconnectAt: now(),
          reconnectAttempts: status.reconnectAttempts + 1,
        });
        options.logger?.warn?.(
          `[${options.account.accountId}] VK long poll transport error: ${message}`,
        );
        server = null;
        await delay(reconnectDelayMs, controller.signal);
      }
    }
  }

  return {
    async start() {
      if (!runPromise) {
        runPromise = run().finally(() => {
          options.abortSignal?.removeEventListener("abort", onExternalAbort);
          patchStatus({
            state: "stopped",
            active: false,
            connected: false,
            stopReason:
              status.stopReason ??
              (controller.signal.aborted
                ? String(controller.signal.reason ?? "stopped")
                : "stopped"),
          });
        });
      }

      await runPromise;
    },
    stop,
    getStatus() {
      return { ...status };
    },
  };
}
