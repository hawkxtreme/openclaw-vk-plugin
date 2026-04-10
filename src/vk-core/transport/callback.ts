import { listEnabledVkAccounts } from "../config/accounts.js";
import { parseVkConfig } from "../config/schema.js";
import { normalizeVkConsentUpdate } from "../inbound/consent.js";
import { normalizeVkMessageEventUpdate } from "../inbound/message-event.js";
import { normalizeVkMessageNewUpdate } from "../inbound/normalize.js";
import { sendVkMessageEventAnswer } from "../core/api.js";
import type {
  VkInteractiveEventAnswer,
  VkWebhookRequest,
  VkWebhookResponse,
} from "../types/callback.js";
import type { VkConfig, ResolvedVkAccount } from "../types/config.js";
import { createVkReplayGuard, type VkReplayGuard } from "./replay.js";
import type { VkTraceCollector } from "../observability/tracing.js";

type VkCallbackHandlerOptions = {
  config?: unknown;
  env?: NodeJS.ProcessEnv;
  replayGuard?: VkReplayGuard;
  tracer?: VkTraceCollector;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onMessage?: (
    message: ReturnType<typeof normalizeVkMessageNewUpdate> extends infer T
      ? Exclude<T, null>
      : never,
  ) => void | Promise<void>;
  onConsent?: (
    event: ReturnType<typeof normalizeVkConsentUpdate> extends infer T
      ? Exclude<T, null>
      : never,
  ) => void | Promise<void>;
  onInteractiveEvent?: (
    event: ReturnType<typeof normalizeVkMessageEventUpdate> extends infer T
      ? Exclude<T, null>
      : never,
  ) =>
    | VkInteractiveEventAnswer
    | void
    | Promise<VkInteractiveEventAnswer | void>;
};

type VkCallbackEnvelope = {
  type?: unknown;
  group_id?: unknown;
  event_id?: unknown;
  secret?: unknown;
  object?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toFiniteInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized || undefined;
}

function parseBody(body: string | unknown): unknown {
  if (typeof body !== "string") {
    return body;
  }

  return JSON.parse(body) as unknown;
}

function resolveAccountsByGroupId(
  config: VkConfig,
  env: NodeJS.ProcessEnv,
): Map<number, ResolvedVkAccount> {
  const byGroupId = new Map<number, ResolvedVkAccount>();

  for (const account of listEnabledVkAccounts(config, env)) {
    if (!account.config.groupId) {
      continue;
    }
    byGroupId.set(account.config.groupId, account);
  }

  return byGroupId;
}

export function createVkCallbackHandler(
  options: VkCallbackHandlerOptions = {},
) {
  const now = options.now ?? Date.now;
  const config = parseVkConfig(options.config);
  const accountsByGroupId = resolveAccountsByGroupId(config, options.env ?? {});
  const replayGuard = options.replayGuard ?? createVkReplayGuard({ now });
  const tracer = options.tracer;

  return async function handleVkCallback(
    request: VkWebhookRequest,
  ): Promise<VkWebhookResponse> {
    if (request.method !== "POST") {
      return {
        statusCode: 405,
        body: "method not allowed",
        eventType: "rejected",
      };
    }

    let payload: unknown;
    try {
      payload = parseBody(request.body);
    } catch {
      tracer?.record("webhook.rejected.payload");
      return {
        statusCode: 400,
        body: "invalid payload",
        eventType: "rejected",
      };
    }

    const envelope = asRecord(payload) as VkCallbackEnvelope | null;
    if (!envelope) {
      tracer?.record("webhook.rejected.payload");
      return {
        statusCode: 400,
        body: "invalid payload",
        eventType: "rejected",
      };
    }

    const groupId = toFiniteInteger(envelope.group_id);
    if (!groupId) {
      tracer?.record("webhook.rejected.group");
      return {
        statusCode: 400,
        body: "invalid group",
        eventType: "rejected",
      };
    }

    const account = accountsByGroupId.get(groupId);
    if (!account) {
      tracer?.record("webhook.rejected.group", { groupId });
      return {
        statusCode: 403,
        body: "unknown group",
        eventType: "rejected",
      };
    }

    const eventType = toOptionalString(envelope.type) ?? "unknown";
    if (eventType === "confirmation") {
      tracer?.record("webhook.confirmation", {
        accountId: account.accountId,
        groupId,
      });
      return {
        statusCode: 200,
        body: account.config.callback.confirmationCode ?? "",
        eventType: "confirmation",
        accountId: account.accountId,
      };
    }

    const providedSecret = toOptionalString(envelope.secret);
    const expectedSecret = account.config.callback.secret?.trim();
    if (expectedSecret && providedSecret !== expectedSecret) {
      tracer?.record("webhook.rejected.secret", {
        accountId: account.accountId,
        groupId,
      });
      return {
        statusCode: 401,
        body: "invalid secret",
        eventType: "rejected",
        accountId: account.accountId,
      };
    }

    const replayKey = toOptionalString(envelope.event_id);
    if (replayKey && !replayGuard.mark(replayKey)) {
      tracer?.record("webhook.duplicate", {
        accountId: account.accountId,
        groupId,
        eventType,
      });
      return {
        statusCode: 200,
        body: "ok",
        eventType: "duplicate",
        accountId: account.accountId,
        duplicate: true,
      };
    }

    if (eventType === "message_new") {
      const message = normalizeVkMessageNewUpdate({
        accountId: account.accountId,
        groupId,
        update: payload,
        transport: "callback-api",
        now,
      });
      if (!message) {
        tracer?.record("webhook.rejected.payload", {
          accountId: account.accountId,
          eventType,
        });
        return {
          statusCode: 400,
          body: "invalid payload",
          eventType: "rejected",
          accountId: account.accountId,
        };
      }

      await options.onMessage?.(message);
      tracer?.record("webhook.accepted", {
        accountId: account.accountId,
        eventType,
      });
      return {
        statusCode: 200,
        body: "ok",
        eventType: "message_new",
        accountId: account.accountId,
        duplicate: false,
      };
    }

    if (eventType === "message_allow" || eventType === "message_deny") {
      const consent = normalizeVkConsentUpdate({
        accountId: account.accountId,
        groupId,
        update: payload,
        now,
      });
      if (!consent) {
        tracer?.record("webhook.rejected.payload", {
          accountId: account.accountId,
          eventType,
        });
        return {
          statusCode: 400,
          body: "invalid payload",
          eventType: "rejected",
          accountId: account.accountId,
        };
      }

      await options.onConsent?.(consent);
      tracer?.record("webhook.accepted", {
        accountId: account.accountId,
        eventType,
      });
      return {
        statusCode: 200,
        body: "ok",
        eventType,
        accountId: account.accountId,
        duplicate: false,
      };
    }

    if (eventType === "message_event") {
      const interactive = normalizeVkMessageEventUpdate({
        accountId: account.accountId,
        groupId,
        update: payload,
        now,
      });
      if (!interactive) {
        tracer?.record("webhook.rejected.payload", {
          accountId: account.accountId,
          eventType,
        });
        return {
          statusCode: 400,
          body: "invalid payload",
          eventType: "rejected",
          accountId: account.accountId,
        };
      }

      const answer = await options.onInteractiveEvent?.(interactive);
      if (answer?.eventData !== undefined) {
        try {
          await sendVkMessageEventAnswer({
            token: account.token,
            // VK expects the nested message_event object.event_id here, not the
            // outer callback envelope event_id used for webhook dedupe.
            eventId: interactive.callbackEventId,
            userId: interactive.senderId,
            peerId: interactive.peerId,
            eventData: answer.eventData,
            apiVersion: account.config.apiVersion,
            fetchImpl: options.fetchImpl,
          });
          tracer?.record("interactive.answer.sent", {
            accountId: account.accountId,
          });
        } catch (error) {
          // The snackbar/modal ack is a best-effort UX hint. If VK rejects it,
          // keep the callback flow successful so the actual interactive action
          // does not get retried or surfaced as a failed webhook.
          tracer?.record("interactive.answer.failed", {
            accountId: account.accountId,
            error: String(error),
          });
        }
      }

      tracer?.record("webhook.accepted", {
        accountId: account.accountId,
        eventType,
      });
      return {
        statusCode: 200,
        body: "ok",
        eventType: "message_event",
        accountId: account.accountId,
        duplicate: false,
      };
    }

    tracer?.record("webhook.accepted", {
      accountId: account.accountId,
      eventType,
      ignored: true,
    });
    return {
      statusCode: 200,
      body: "ok",
      eventType,
      accountId: account.accountId,
      duplicate: false,
    };
  };
}
