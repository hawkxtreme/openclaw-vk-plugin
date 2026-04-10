import {
  normalizeInteractiveReply,
  reduceInteractiveReply,
  type InteractiveReplyButton,
} from "openclaw/plugin-sdk/interactive-runtime";

const OPENCLAW_COMMAND_KEY = "oc";
const MAX_KEYBOARD_ROWS = 10;
const MAX_BUTTONS_PER_ROW = 4;
const MAX_BUTTON_LABEL_CHARS = 40;
const MAX_PAYLOAD_BYTES = 255;

export type VkButtonStyle = "primary" | "secondary" | "success" | "danger";

export type VkReplyButton = {
  text: string;
  callback_data: string;
  style?: VkButtonStyle;
};

export type VkReplyButtons = ReadonlyArray<ReadonlyArray<VkReplyButton>>;

export type VkKeyboardSpec = {
  buttons: VkReplyButtons;
  inline?: boolean;
  oneTime?: boolean;
};

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function truncateLabel(value: string): string {
  const chars = Array.from(value.trim());
  if (chars.length <= MAX_BUTTON_LABEL_CHARS) {
    return value.trim();
  }
  return `${chars.slice(0, MAX_BUTTON_LABEL_CHARS - 3).join("")}...`;
}

function normalizeVkButtonStyle(value: unknown): VkButtonStyle | undefined {
  const normalized = readTrimmedString(value)?.toLowerCase();
  return normalized === "primary" ||
    normalized === "secondary" ||
    normalized === "success" ||
    normalized === "danger"
    ? normalized
    : undefined;
}

function serializeCommandPayload(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }
  const payload = JSON.stringify({ [OPENCLAW_COMMAND_KEY]: trimmed });
  return Buffer.byteLength(payload, "utf8") <= MAX_PAYLOAD_BYTES ? payload : null;
}

function normalizeVkButton(raw: unknown): VkReplyButton | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const text = readTrimmedString(record.text) ?? readTrimmedString(record.label);
  const callbackData =
    readTrimmedString(record.callback_data) ??
    readTrimmedString(record.callbackData) ??
    readTrimmedString(record.value);
  if (!text || !callbackData || !serializeCommandPayload(callbackData)) {
    return undefined;
  }

  return {
    text,
    callback_data: callbackData,
    style: normalizeVkButtonStyle(record.style),
  };
}

function toVkButtons(buttons: readonly InteractiveReplyButton[]): VkReplyButton[] {
  return buttons.flatMap((button) => {
    const callbackData = button.value.trim();
    if (!button.label.trim() || !callbackData || !serializeCommandPayload(callbackData)) {
      return [];
    }
    return [
      {
        text: button.label.trim(),
        callback_data: callbackData,
        style: button.style,
      } satisfies VkReplyButton,
    ];
  });
}

function pushButtonRows(rows: VkReplyButton[][], buttons: readonly VkReplyButton[]): void {
  for (
    let index = 0;
    index < buttons.length && rows.length < MAX_KEYBOARD_ROWS;
    index += MAX_BUTTONS_PER_ROW
  ) {
    const row = buttons.slice(index, index + MAX_BUTTONS_PER_ROW);
    if (row.length > 0) {
      rows.push(row);
    }
  }
}

export function normalizeVkButtons(raw: unknown): VkReplyButtons | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const rows = raw
    .map((row) => {
      if (!Array.isArray(row)) {
        return [];
      }
      return row
        .map((entry) => normalizeVkButton(entry))
        .filter((entry): entry is VkReplyButton => Boolean(entry))
        .slice(0, MAX_BUTTONS_PER_ROW);
    })
    .filter((row) => row.length > 0)
    .slice(0, MAX_KEYBOARD_ROWS);

  return rows.length > 0 ? rows : undefined;
}

export function buildVkButtonsFromInteractive(interactive: unknown): VkReplyButtons | undefined {
  const normalized = normalizeInteractiveReply(interactive);
  if (!normalized) {
    return undefined;
  }

  const rows = reduceInteractiveReply(normalized, [] as VkReplyButton[][], (state, block) => {
    if (block.type === "buttons") {
      pushButtonRows(state, toVkButtons(block.buttons));
      return state;
    }
    if (block.type === "select") {
      pushButtonRows(
        state,
        toVkButtons(
          block.options.map((option) => ({
            label: option.label,
            value: option.value,
          })),
        ),
      );
    }
    return state;
  });

  return rows.length > 0 ? rows.slice(0, MAX_KEYBOARD_ROWS) : undefined;
}

export function resolveVkKeyboardSpecFromPayload(payload: unknown): VkKeyboardSpec | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const channelData =
    record.channelData &&
    typeof record.channelData === "object" &&
    !Array.isArray(record.channelData)
      ? (record.channelData as Record<string, unknown>)
      : undefined;
  const vkData =
    channelData?.vk && typeof channelData.vk === "object" && !Array.isArray(channelData.vk)
      ? (channelData.vk as Record<string, unknown>)
      : undefined;

  const buttons =
    normalizeVkButtons(vkData?.buttons) ?? buildVkButtonsFromInteractive(record.interactive);
  if (!buttons) {
    return undefined;
  }

  return {
    buttons,
    inline: readBoolean(vkData?.inline),
    oneTime: readBoolean(vkData?.one_time) ?? readBoolean(vkData?.oneTime),
  };
}

function toVkColor(style?: VkButtonStyle): "primary" | "secondary" | "positive" | "negative" {
  if (style === "danger") {
    return "negative";
  }
  if (style === "success") {
    return "positive";
  }
  return style === "primary" ? "primary" : "secondary";
}

export function buildVkKeyboard(
  spec?: VkKeyboardSpec,
  transport: "callback-api" | "long-poll" = "long-poll",
): string | undefined {
  if (!spec?.buttons || spec.buttons.length === 0) {
    return undefined;
  }

  const useInlineCallback = spec.inline === true && transport === "callback-api";

  const rows = spec.buttons
    .slice(0, MAX_KEYBOARD_ROWS)
    .map((row) =>
      row.slice(0, MAX_BUTTONS_PER_ROW).flatMap((button) => {
        const payload = serializeCommandPayload(button.callback_data);
        if (!payload) {
          return [];
        }
        return [
          {
            action: {
              type: useInlineCallback ? ("callback" as const) : ("text" as const),
              label: truncateLabel(button.text),
              payload,
            },
            color: toVkColor(button.style),
          },
        ];
      }),
    )
    .filter((row) => row.length > 0);

  return rows.length > 0
    ? JSON.stringify({
        ...(useInlineCallback ? { inline: true } : {}),
        ...(!useInlineCallback ? { one_time: spec.oneTime ?? false } : {}),
        buttons: rows,
      })
    : undefined;
}

export function resolveVkCommandFromPayload(payload: unknown): string | undefined {
  const stringPayload = readTrimmedString(payload);
  if (stringPayload) {
    return stringPayload;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  return readTrimmedString((payload as Record<string, unknown>)[OPENCLAW_COMMAND_KEY]);
}
