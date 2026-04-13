import { readFile } from "node:fs/promises";

export async function readVkLocalMediaFile(localPath: string): Promise<Buffer> {
  return await readFile(localPath);
}
