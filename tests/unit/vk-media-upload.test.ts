import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  loadVkOutboundMedia,
  parseVkConfig,
  resolveVkAccount,
  resolveVkRandomId,
  sendVkPayload,
  uploadVkMedia,
} from "../../api.js";

function createAccount(overrides?: {
  config?: unknown;
  accountId?: string;
  env?: NodeJS.ProcessEnv;
}) {
  return resolveVkAccount({
    config: parseVkConfig(
      overrides?.config ?? {
        groupId: 77,
        transport: "long-poll",
        accessToken: "replace-me-media-token",
      },
    ),
    accountId: overrides?.accountId,
    env: overrides?.env ?? {},
  });
}

describe("vk media upload", () => {
  it("loads outbound media from data urls", async () => {
    const media = await loadVkOutboundMedia({
      mediaUrl: `data:image/png;base64,${Buffer.from("png-binary").toString("base64")}`,
    });

    expect(media.kind).toBe("image");
    expect(media.title).toBe("attachment.png");
    expect(media.mimeType).toBe("image/png");
    expect(Buffer.isBuffer(media.source)).toBe(true);
  });

  it("loads outbound media from local files inside allowed roots", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "openclaw-vk-media-"));
    const mediaPath = join(tempRoot, "voice.ogg");

    try {
      await writeFile(mediaPath, Buffer.from("voice-binary"));
      const media = await loadVkOutboundMedia({
        mediaUrl: mediaPath,
        mediaLocalRoots: [tempRoot],
      });

      expect(media.kind).toBe("audio_message");
      expect(media.title).toBe("voice.ogg");
      expect(media.mimeType).toBe("audio/ogg");
      expect(media.source.equals(Buffer.from("voice-binary"))).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uploads photos via photos.getMessagesUploadServer and photos.saveMessagesPhoto", async () => {
    const account = createAccount();
    const media = await loadVkOutboundMedia({
      mediaUrl: `data:image/png;base64,${Buffer.from("photo-binary").toString("base64")}`,
    });
    const requests: string[] = [];

    const result = await uploadVkMedia({
      account,
      peerId: 42,
      media,
      fetchImpl: async (input, init) => {
        const url = String(input);
        requests.push(url);

        if (url.includes("photos.getMessagesUploadServer")) {
          return new Response(
            JSON.stringify({
              response: {
                upload_url: "https://upload.vk.test/photo",
              },
            }),
          );
        }

        if (url === "https://upload.vk.test/photo") {
          expect(init?.method).toBe("POST");
          expect(init?.body instanceof FormData).toBe(true);
          return new Response(
            JSON.stringify({
              server: 11,
              photo: "replace-me-photo-token",
              hash: "replace-me-photo-hash",
            }),
          );
        }

        if (url.includes("photos.saveMessagesPhoto")) {
          const parsed = new URL(url);
          expect(parsed.searchParams.get("server")).toBe("11");
          expect(parsed.searchParams.get("photo")).toBe(
            "replace-me-photo-token",
          );
          expect(parsed.searchParams.get("hash")).toBe("replace-me-photo-hash");
          return new Response(
            JSON.stringify({
              response: [
                {
                  owner_id: 100,
                  id: 200,
                  access_key: "replace-me-photo-key",
                },
              ],
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result).toMatchObject({
      kind: "image",
      attachment: "photo100_200_replace-me-photo-key",
      title: "attachment.png",
    });
    expect(requests).toHaveLength(3);
  });

  it("uploads documents via docs.getMessagesUploadServer and docs.save", async () => {
    const account = createAccount();
    const media = await loadVkOutboundMedia({
      mediaUrl: `data:text/plain;base64,${Buffer.from("doc-binary").toString("base64")}`,
    });

    const result = await uploadVkMedia({
      account,
      peerId: 42,
      media,
      fetchImpl: async (input, init) => {
        const url = String(input);

        if (url.includes("docs.getMessagesUploadServer")) {
          const parsed = new URL(url);
          expect(parsed.searchParams.get("type")).toBe("doc");
          return new Response(
            JSON.stringify({
              response: {
                upload_url: "https://upload.vk.test/doc",
              },
            }),
          );
        }

        if (url === "https://upload.vk.test/doc") {
          expect(init?.method).toBe("POST");
          expect(init?.body instanceof FormData).toBe(true);
          return new Response(
            JSON.stringify({
              file: "replace-me-doc-file",
            }),
          );
        }

        if (url.includes("docs.save")) {
          const parsed = new URL(url);
          expect(parsed.searchParams.get("file")).toBe("replace-me-doc-file");
          expect(parsed.searchParams.get("title")).toBe("attachment.txt");
          return new Response(
            JSON.stringify({
              response: {
                type: "doc",
                doc: {
                  owner_id: 300,
                  id: 400,
                  access_key: "replace-me-doc-key",
                },
              },
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result).toMatchObject({
      kind: "document",
      attachment: "doc300_400_replace-me-doc-key",
      title: "attachment.txt",
    });
  });

  it("sends payloads with uploaded attachments and stable random ids", async () => {
    const account = createAccount();
    let messagesSendUrl: URL | undefined;

    const result = await sendVkPayload({
      account,
      peerId: 42,
      text: "Message with files",
      mediaUrls: [
        `data:image/png;base64,${Buffer.from("photo-binary").toString("base64")}`,
        `data:text/plain;base64,${Buffer.from("doc-binary").toString("base64")}`,
      ],
      dedupeKey: "thread:42:media:1",
      replyTo: 501,
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes("photos.getMessagesUploadServer")) {
          return new Response(
            JSON.stringify({
              response: {
                upload_url: "https://upload.vk.test/photo",
              },
            }),
          );
        }

        if (url === "https://upload.vk.test/photo") {
          return new Response(
            JSON.stringify({
              server: 11,
              photo: "replace-me-photo-token",
              hash: "replace-me-photo-hash",
            }),
          );
        }

        if (url.includes("photos.saveMessagesPhoto")) {
          return new Response(
            JSON.stringify({
              response: [
                {
                  owner_id: 100,
                  id: 200,
                  access_key: "replace-me-photo-key",
                },
              ],
            }),
          );
        }

        if (url.includes("docs.getMessagesUploadServer")) {
          return new Response(
            JSON.stringify({
              response: {
                upload_url: "https://upload.vk.test/doc",
              },
            }),
          );
        }

        if (url === "https://upload.vk.test/doc") {
          return new Response(
            JSON.stringify({
              file: "replace-me-doc-file",
            }),
          );
        }

        if (url.includes("docs.save")) {
          return new Response(
            JSON.stringify({
              response: {
                type: "doc",
                doc: {
                  owner_id: 300,
                  id: 400,
                  access_key: "replace-me-doc-key",
                },
              },
            }),
          );
        }

        if (url.includes("messages.send")) {
          messagesSendUrl = new URL(url);
          return new Response(
            JSON.stringify({
              response: 9001,
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    });

    expect(result.messageId).toBe("9001");
    expect(result.attachments).toEqual([
      "photo100_200_replace-me-photo-key",
      "doc300_400_replace-me-doc-key",
    ]);
    expect(result.randomId).toBe(
      resolveVkRandomId({ dedupeKey: "thread:42:media:1" }),
    );
    expect(messagesSendUrl?.searchParams.get("attachment")).toBe(
      "photo100_200_replace-me-photo-key,doc300_400_replace-me-doc-key",
    );
    expect(messagesSendUrl?.searchParams.get("reply_to")).toBe("501");
  });
});
