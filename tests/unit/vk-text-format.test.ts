import { describe, expect, it } from "vitest";

import {
  formatVkOutboundMessage,
  formatVkOutboundText,
  normalizeVkInboundBody,
} from "../../src/text-format.js";

describe("vk text format", () => {
  it("normalizes a bare slash to the commands list shortcut", () => {
    expect(normalizeVkInboundBody("/")).toBe("/commands");
    expect(normalizeVkInboundBody("  /  ")).toBe("/commands");
    expect(normalizeVkInboundBody("/models")).toBe("/models");
  });

  it("strips a leading VK bot mention before command normalization", () => {
    expect(normalizeVkInboundBody("[club77|test_openclaw] status")).toBe("status");
    expect(normalizeVkInboundBody("@club77, help please")).toBe("help please");
  });

  it("renders markdown as readable plain text for VK", () => {
    const rendered = formatVkOutboundText(`
## Heading

TEXT LIVE

*Italic*
**Bold**
***Bold+Italic***
> Quote

~~Gone~~

||Secret||

| Name | Value |
| --- | --- |
| Row1 | A |

\`inline code\`
\`\`\`txt
block code
\`\`\`

[OpenClaw](https://openclaw.ai)
`.trim());

    expect(rendered).toContain("Heading");
    expect(rendered).toContain("Italic");
    expect(rendered).toContain("Bold");
    expect(rendered).toContain("Bold+Italic");
    expect(rendered).toContain("[quote]Quote[/quote]");
    expect(rendered).toContain("[S]Gone[/S]");
    expect(rendered).toContain("[spoiler]Secret[/spoiler]");
    expect(rendered).toContain("• Name: Row1");
    expect(rendered).toContain("Value: A");
    expect(rendered).toContain("inline code");
    expect(rendered).toContain("[code]");
    expect(rendered).toContain("block code");
    expect(rendered).toContain("[/code]");
    expect(rendered).toContain("OpenClaw");
    expect(rendered).not.toContain("| --- | --- |");
    expect(rendered).not.toContain("***Bold+Italic***");
    expect(rendered).not.toContain("[I]Italic[/I]");
    expect(rendered).not.toContain("[B]Bold[/B]");
    expect(rendered).not.toContain("OpenClaw (https://openclaw.ai)");
  });

  it("returns native VK format_data for supported inline styles", () => {
    const formatted = formatVkOutboundMessage(`
## Heading

TEXT LIVE

*Italic*
**Bold**
***Bold+Italic***

> Quote

~~Gone~~

||Secret||

| Name | Value |
| --- | --- |
| Row1 | A |

\`inline code\`
\`\`\`txt
block code
\`\`\`

[OpenClaw](https://openclaw.ai)
`.trim());

    expect(formatted.text).toContain("Heading");
    expect(formatted.text).toContain("Italic");
    expect(formatted.text).toContain("Bold");
    expect(formatted.text).toContain("Bold+Italic");
    expect(formatted.text).toContain("[quote]Quote[/quote]");
    expect(formatted.text).toContain("[S]Gone[/S]");
    expect(formatted.text).toContain("[spoiler]Secret[/spoiler]");
    expect(formatted.text).toContain("• Name: Row1");
    expect(formatted.text).toContain("Value: A");
    expect(formatted.text).toContain("[code]");
    expect(formatted.text).toContain("OpenClaw");
    expect(formatted.text).not.toContain("[I]Italic[/I]");
    expect(formatted.text).not.toContain("[B]Bold[/B]");
    expect(formatted.text).not.toContain("OpenClaw (https://openclaw.ai)");

    expect(formatted.formatData).toEqual({
      version: "1",
      items: [
        {
          offset: formatted.text.indexOf("Heading"),
          length: "Heading".length,
          type: "bold",
        },
        {
          offset: formatted.text.indexOf("Italic"),
          length: "Italic".length,
          type: "italic",
        },
        {
          offset: formatted.text.indexOf("Bold"),
          length: "Bold".length,
          type: "bold",
        },
        {
          offset: formatted.text.indexOf("Bold+Italic"),
          length: "Bold+Italic".length,
          type: "bold",
        },
        {
          offset: formatted.text.indexOf("Bold+Italic"),
          length: "Bold+Italic".length,
          type: "italic",
        },
        {
          offset: formatted.text.indexOf("OpenClaw"),
          length: "OpenClaw".length,
          type: "url",
          url: "https://openclaw.ai",
        },
      ],
    });
  });

  it("renders markdown links as native VK url spans", () => {
    const formatted = formatVkOutboundMessage(
      "[OpenClaw Docs](https://docs.openclaw.ai/channels/vk)",
    );

    expect(formatted.text).toBe("OpenClaw Docs");
    expect(formatted.formatData).toEqual({
      version: "1",
      items: [
        {
          offset: 0,
          length: "OpenClaw Docs".length,
          type: "url",
          url: "https://docs.openclaw.ai/channels/vk",
        },
      ],
    });
  });

  it("supports native VK html emphasis and underline tags", () => {
    const formatted = formatVkOutboundMessage(
      "<strong>BoldHtml</strong> <em>ItalicHtml</em> <u>UnderlineHtml</u> <a href=\"https://openclaw.ai\">OpenClaw</a>",
    );

    expect(formatted.text).toBe("BoldHtml ItalicHtml UnderlineHtml OpenClaw");
    expect(formatted.formatData).toEqual({
      version: "1",
      items: [
        {
          offset: 0,
          length: "BoldHtml".length,
          type: "bold",
        },
        {
          offset: "BoldHtml ".length,
          length: "ItalicHtml".length,
          type: "italic",
        },
        {
          offset: "BoldHtml ItalicHtml ".length,
          length: "UnderlineHtml".length,
          type: "underline",
        },
        {
          offset: "BoldHtml ItalicHtml UnderlineHtml ".length,
          length: "OpenClaw".length,
          type: "url",
          url: "https://openclaw.ai",
        },
      ],
    });
  });

  it("formats headings, quotes, spoilers, and table rows with visible fallbacks", () => {
    const formatted = formatVkOutboundMessage(`
# Heading

> Quote

||Secret||

| Name | Value |
| --- | --- |
| Row1 | A |
`.trim());

    expect(formatted.text).toContain("[quote]Quote[/quote]");
    expect(formatted.text).toContain("[spoiler]Secret[/spoiler]");
    expect(formatted.text).toContain("• Name: Row1");
    expect(formatted.text).toContain("Value: A");
    expect(formatted.formatData).toEqual({
      version: "1",
      items: [
        {
          offset: 0,
          length: "Heading".length,
          type: "bold",
        },
      ],
    });
  });
});
