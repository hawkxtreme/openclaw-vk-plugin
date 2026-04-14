import {
  markdownToIRWithMeta,
  type MarkdownIR,
  type MarkdownLinkSpan,
  type MarkdownStyle,
  type MarkdownStyleSpan,
} from "openclaw/plugin-sdk/text-runtime";
import { normalizeVkCommandShortcut } from "./command-ui.js";
import { resolveVkCommandFromPayload } from "./keyboard.js";
import type {
  VkFormatData,
  VkFormatDataItem,
  VkFormatDataType,
  VkFormattedText,
} from "./vk-core/types/format.js";

type VkRenderableStyle = MarkdownStyle | "underline";
type VkRenderableStyleSpan = {
  start: number;
  end: number;
  style: VkRenderableStyle;
};
type VkRenderableLinkSpan = {
  start: number;
  end: number;
  href: string;
};

type VkInboundBodySource = {
  text: string;
  messagePayload?: unknown;
};

const MARKDOWN_TABLE_ROW_PATTERN = /^\s*\|(.+)\|\s*$/;
const MARKDOWN_TABLE_SEPARATOR_PATTERN = /^:?-{3,}:?$/;

const VK_FALLBACK_STYLE_MARKERS = {
  blockquote: { open: "[quote]", close: "[/quote]" },
  strikethrough: { open: "[S]", close: "[/S]" },
  code: { open: "`", close: "`" },
  code_block: { open: "[code]\n", close: "\n[/code]" },
  spoiler: { open: "[spoiler]", close: "[/spoiler]" },
} as const;

type VkFallbackMarkerStyle = keyof typeof VK_FALLBACK_STYLE_MARKERS;

const STYLE_ORDER: VkRenderableStyle[] = [
  "blockquote",
  "code_block",
  "code",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "spoiler",
];

const STYLE_RANK = new Map<VkRenderableStyle, number>(
  STYLE_ORDER.map((style, index) => [style, index]),
);

type VkOpeningItem =
  | {
      kind: "link";
      end: number;
      href: string;
      index: number;
    }
  | {
      kind: "style";
      end: number;
      style: VkRenderableStyle;
      marker?: { open: string; close: string };
      nativeType?: VkFormatDataType;
      index: number;
    };

type VkStackItem =
  | {
      kind: "output";
      end: number;
      close: string;
    }
  | {
      kind: "native";
      end: number;
      style: VkFormatDataType;
      startOffset: number;
      url?: string;
    };

function normalizeVkFormatItems(items: VkFormatDataItem[]): VkFormatData | undefined {
  if (items.length === 0) {
    return undefined;
  }

  return {
    version: "1",
    items: [...items].sort((left: VkFormatDataItem, right: VkFormatDataItem) => {
      if (left.offset !== right.offset) {
        return left.offset - right.offset;
      }
      if (left.length !== right.length) {
        return right.length - left.length;
      }
      return left.type.localeCompare(right.type);
    }),
  };
}

function resolveVkLinkFallback(
  link: VkRenderableLinkSpan,
  plainText: string,
): VkOpeningItem | null {
  const href = link.href.trim();
  if (!href) {
    return null;
  }

  const label = plainText.slice(link.start, link.end).trim();
  if (!label) {
    return null;
  }

  return {
    kind: "link",
    end: link.end,
    href,
    index: 0,
  };
}

function resolveVkNativeStyle(
  style: VkRenderableStyle,
): VkFormatDataType | undefined {
  if (style === "bold" || style === "italic" || style === "underline") {
    return style;
  }

  return undefined;
}

function resolveVkFallbackStyleMarker(
  style: VkRenderableStyle,
): (typeof VK_FALLBACK_STYLE_MARKERS)[VkFallbackMarkerStyle] | undefined {
  switch (style) {
    case "blockquote":
    case "strikethrough":
    case "code":
    case "code_block":
    case "spoiler":
      return VK_FALLBACK_STYLE_MARKERS[style];
    default:
      return undefined;
  }
}

function extractVkHtmlHref(attributes: string): string | undefined {
  const match = attributes.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/iu);
  const href = match?.[1] ?? match?.[2] ?? match?.[3];
  return href?.trim() || undefined;
}

function remapSpanBoundary(map: number[], index: number): number {
  return map[index] ?? map[map.length - 1] ?? 0;
}

function normalizeVkInlineHtml(ir: MarkdownIR): {
  text: string;
  styles: VkRenderableStyleSpan[];
  links: VkRenderableLinkSpan[];
} {
  const sourceText = ir.text ?? "";
  const tagPattern = /<(\/?)(strong|b|em|i|u|a)\b([^>]*)>/giu;
  if (!sourceText.includes("<")) {
    return {
      text: sourceText,
      styles: ir.styles.map((span) => ({ ...span })),
      links: ir.links.map((link) => ({ ...link })),
    };
  }

  const indexMap = new Array<number>(sourceText.length + 1).fill(0);
  const htmlStyles: VkRenderableStyleSpan[] = [];
  const htmlLinks: VkRenderableLinkSpan[] = [];
  const styleStack = new Map<VkFormatDataType, number[]>();
  const linkStack: Array<{ start: number; href: string }> = [];
  let renderedText = "";
  let cursor = 0;

  const appendText = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      indexMap[index] = renderedText.length;
      renderedText += sourceText[index] ?? "";
    }
    indexMap[end] = renderedText.length;
  };

  const skipTag = (start: number, end: number) => {
    for (let index = start; index <= end; index += 1) {
      indexMap[index] = renderedText.length;
    }
  };

  for (const match of sourceText.matchAll(tagPattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    const end = start + token.length;
    appendText(cursor, start);
    skipTag(start, end);

    const closing = match[1] === "/";
    const tag = (match[2] ?? "").toLowerCase();
    const attributes = match[3] ?? "";

    const resolvedStyle =
      tag === "strong" || tag === "b"
        ? ("bold" as const)
        : tag === "em" || tag === "i"
          ? ("italic" as const)
          : tag === "u"
            ? ("underline" as const)
            : undefined;

    if (tag === "a") {
      if (closing) {
        const openLink = linkStack.pop();
        if (openLink && renderedText.length > openLink.start) {
          htmlLinks.push({
            start: openLink.start,
            end: renderedText.length,
            href: openLink.href,
          });
        }
      } else {
        const href = extractVkHtmlHref(attributes);
        if (href) {
          linkStack.push({
            start: renderedText.length,
            href,
          });
        }
      }
    } else if (resolvedStyle) {
      const bucket = styleStack.get(resolvedStyle) ?? [];
      if (closing) {
        const openStart = bucket.pop();
        if (openStart !== undefined && renderedText.length > openStart) {
          htmlStyles.push({
            start: openStart,
            end: renderedText.length,
            style: resolvedStyle,
          });
        }
      } else {
        bucket.push(renderedText.length);
      }
      styleStack.set(resolvedStyle, bucket);
    }

    cursor = end;
  }

  appendText(cursor, sourceText.length);

  return {
    text: renderedText,
    styles: [
      ...ir.styles.map((span) => ({
        start: remapSpanBoundary(indexMap, span.start),
        end: remapSpanBoundary(indexMap, span.end),
        style: span.style,
      })),
      ...htmlStyles,
    ],
    links: [
      ...ir.links.map((link) => ({
        start: remapSpanBoundary(indexMap, link.start),
        end: remapSpanBoundary(indexMap, link.end),
        href: link.href,
      })),
      ...htmlLinks,
    ],
  };
}

function buildVkFormattedText(ir: MarkdownIR): VkFormattedText {
  const normalized = normalizeVkInlineHtml(ir);
  const plainText = normalized.text;
  if (!plainText) {
    return { text: "" };
  }

  const relevantStyles = normalized.styles.filter((span) => {
    return (
      span.start !== span.end &&
      (resolveVkNativeStyle(span.style) !== undefined ||
        resolveVkFallbackStyleMarker(span.style) !== undefined)
    );
  });
  const startsAt = new Map<number, VkRenderableStyleSpan[]>();
  const linkStarts = new Map<number, VkOpeningItem[]>();
  const boundaries = new Set<number>([0, plainText.length]);

  for (const span of relevantStyles) {
    boundaries.add(span.start);
    boundaries.add(span.end);
    const bucket = startsAt.get(span.start);
    if (bucket) {
      bucket.push(span);
    } else {
      startsAt.set(span.start, [span]);
    }
  }

  for (const spans of startsAt.values()) {
    spans.sort((left, right) => {
      if (left.end !== right.end) {
        return right.end - left.end;
      }
      return (STYLE_RANK.get(left.style) ?? 0) - (STYLE_RANK.get(right.style) ?? 0);
    });
  }

  for (const [index, link] of normalized.links.entries()) {
    if (link.start === link.end) {
      continue;
    }

    const rendered = resolveVkLinkFallback(link, plainText);
    if (!rendered) {
      continue;
    }

    boundaries.add(link.start);
    boundaries.add(link.end);
    const bucket = linkStarts.get(link.start);
    const item = {
      ...rendered,
      index,
    } satisfies VkOpeningItem;
    if (bucket) {
      bucket.push(item);
    } else {
      linkStarts.set(link.start, [item]);
    }
  }

  const boundaryPoints = [...boundaries].sort((left: number, right: number) => left - right);
  const stack: VkStackItem[] = [];
  const formatItems: VkFormatDataItem[] = [];
  let renderedText = "";

  for (let index = 0; index < boundaryPoints.length; index += 1) {
    const position = boundaryPoints[index] ?? 0;

    while (stack.length > 0 && stack[stack.length - 1]?.end === position) {
      const item = stack.pop();
      if (!item) {
        continue;
      }

      if (item.kind === "output") {
        renderedText += item.close;
        continue;
      }

      const length = renderedText.length - item.startOffset;
      if (length > 0) {
        if (item.style === "url") {
          if (item.url) {
            formatItems.push({
              offset: item.startOffset,
              length,
              type: "url",
              url: item.url,
            });
          }
        } else {
          formatItems.push({
            offset: item.startOffset,
            length,
            type: item.style,
          });
        }
      }
    }

    const openingItems: VkOpeningItem[] = [];
    const openingLinks = linkStarts.get(position);
    if (openingLinks) {
      openingItems.push(...openingLinks);
    }

    const openingStyles = startsAt.get(position);
    if (openingStyles) {
      openingItems.push(
        ...openingStyles.map((span, itemIndex) => ({
          kind: "style" as const,
          end: span.end,
          style: span.style,
          marker: resolveVkFallbackStyleMarker(span.style),
          nativeType: resolveVkNativeStyle(span.style),
          index: itemIndex,
        })),
      );
    }

    openingItems.sort((left, right) => {
      if (left.end !== right.end) {
        return right.end - left.end;
      }
      if (left.kind !== right.kind) {
        return left.kind === "link" ? -1 : 1;
      }
      if (left.kind === "style" && right.kind === "style") {
        return (STYLE_RANK.get(left.style) ?? 0) - (STYLE_RANK.get(right.style) ?? 0);
      }
      return left.index - right.index;
    });

    for (const item of openingItems) {
      if (item.kind === "link") {
        stack.push({
          kind: "native",
          end: item.end,
          style: "url",
          startOffset: renderedText.length,
          url: item.href,
        });
        continue;
      }

      if (item.nativeType) {
        stack.push({
          kind: "native",
          end: item.end,
          style: item.nativeType,
          startOffset: renderedText.length,
        });
        continue;
      }

      if (item.marker) {
        renderedText += item.marker.open;
        stack.push({
          kind: "output",
          end: item.end,
          close: item.marker.close,
        });
      }
    }

    const nextPosition = boundaryPoints[index + 1];
    if (nextPosition !== undefined && nextPosition > position) {
      renderedText += plainText.slice(position, nextPosition);
    }
  }

  return trimVkMarkerInteriorWhitespace({
    text: renderedText,
    formatData: normalizeVkFormatItems(formatItems),
  });
}

function remapVkOffset(offset: number, removals: readonly { start: number; end: number }[]): number {
  let shifted = offset;
  for (const removal of removals) {
    const length = removal.end - removal.start;
    if (shifted >= removal.end) {
      shifted -= length;
      continue;
    }
    if (shifted > removal.start) {
      shifted = removal.start;
    }
    break;
  }
  return shifted;
}

function trimVkMarkerInteriorWhitespace(formatted: VkFormattedText): VkFormattedText {
  if (!formatted.text.includes("[quote]")) {
    return formatted;
  }

  const markerPattern = /\[quote\]([\s\S]*?)\[\/quote\]/gu;
  const removals: Array<{ start: number; end: number }> = [];

  for (const match of formatted.text.matchAll(markerPattern)) {
    const content = match[1] ?? "";
    if (!content) {
      continue;
    }

    const fullMatch = match[0] ?? "";
    const matchStart = match.index ?? 0;
    const contentStart = matchStart + fullMatch.indexOf(content);
    const leadingWhitespace = content.match(/^\s+/u)?.[0].length ?? 0;
    const trailingWhitespace = content.match(/\s+$/u)?.[0].length ?? 0;

    if (leadingWhitespace > 0) {
      removals.push({
        start: contentStart,
        end: contentStart + leadingWhitespace,
      });
    }

    if (trailingWhitespace > 0) {
      removals.push({
        start: contentStart + content.length - trailingWhitespace,
        end: contentStart + content.length,
      });
    }
  }

  if (removals.length === 0) {
    return formatted;
  }

  removals.sort((left, right) => left.start - right.start);
  let text = formatted.text;
  for (let index = removals.length - 1; index >= 0; index -= 1) {
    const removal = removals[index];
    text = `${text.slice(0, removal.start)}${text.slice(removal.end)}`;
  }

  const formatData = formatted.formatData
    ? normalizeVkFormatItems(
        formatted.formatData.items
          .map((item) => {
            const originalEnd = item.offset + item.length;
            const nextOffset = remapVkOffset(item.offset, removals);
            const nextEnd = remapVkOffset(originalEnd, removals);
            return {
              ...item,
              offset: nextOffset,
              length: Math.max(0, nextEnd - nextOffset),
            };
          })
          .filter((item) => item.length > 0),
      )
    : undefined;

  return {
    text,
    formatData,
  };
}

function parseMarkdownTableRow(line: string): string[] | null {
  const match = line.match(MARKDOWN_TABLE_ROW_PATTERN);
  if (!match) {
    return null;
  }

  return match[1]
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(row: string[]): boolean {
  return row.length > 0 && row.every((cell) => MARKDOWN_TABLE_SEPARATOR_PATTERN.test(cell));
}

function flattenMarkdownTables(text: string): string {
  const lines = text.split(/\r?\n/);
  const rendered: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = parseMarkdownTableRow(lines[index] ?? "");
    const separator = parseMarkdownTableRow(lines[index + 1] ?? "");

    if (
      !header ||
      !separator ||
      header.length === 0 ||
      header.length !== separator.length ||
      !isMarkdownTableSeparator(separator)
    ) {
      rendered.push(lines[index] ?? "");
      continue;
    }

    const tableRows: string[] = [];
    let rowIndex = index + 2;

    for (; rowIndex < lines.length; rowIndex += 1) {
      const row = parseMarkdownTableRow(lines[rowIndex] ?? "");
      if (!row) {
        break;
      }

      const pairs = header
        .map((label, cellIndex) => {
          const value = row[cellIndex]?.trim() ?? "";
          if (!label || !value) {
            return null;
          }

          return `${label}: ${value}`;
        })
        .filter((entry): entry is string => Boolean(entry));

      if (pairs.length > 0) {
        const [firstPair, ...restPairs] = pairs;
        tableRows.push(`- ${firstPair}`);
        for (const pair of restPairs) {
          tableRows.push(`  ${pair}`);
        }
      }
    }

    if (tableRows.length === 0) {
      rendered.push(lines[index] ?? "");
      continue;
    }

    rendered.push(...tableRows);
    index = rowIndex - 1;
  }

  return rendered.join("\n");
}

export function normalizeVkInboundBody(body: string): string {
  const trimmed = stripLeadingVkBotMentions(body.trim());
  return trimmed === "/" ? "/commands" : trimmed;
}

function stripLeadingVkBotMentions(body: string): string {
  let normalized = body;

  while (normalized.length > 0) {
    const next = normalized.replace(
      /^(?:\[(?:club|public)\d+\|[^\]]+\]|@(?:club|public)\d+)\s*[,!:.?;—-]?\s*/iu,
      "",
    );
    if (next === normalized) {
      break;
    }
    normalized = next.trimStart();
  }

  return normalized;
}

export function resolveVkInboundBody(source: VkInboundBodySource): string {
  const rawBody = resolveVkCommandFromPayload(source.messagePayload) ?? source.text;
  return normalizeVkInboundBody(String(rawBody));
}

export function isVkSlashCommandBody(body: string): boolean {
  return normalizeVkCommandShortcut(normalizeVkInboundBody(body)).startsWith("/");
}

export function isVkSlashCommandMessage(source: VkInboundBodySource): boolean {
  return isVkSlashCommandBody(resolveVkInboundBody(source));
}

export function formatVkOutboundMessage(text: string): VkFormattedText {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      text: "",
    };
  }

  const { ir } = markdownToIRWithMeta(flattenMarkdownTables(trimmed), {
    linkify: false,
    autolink: false,
    enableSpoilers: true,
    headingStyle: "bold",
    blockquotePrefix: "",
    tableMode: "off",
  });

  return buildVkFormattedText(ir);
}

export function formatVkOutboundText(text: string): string {
  return formatVkOutboundMessage(text).text;
}
