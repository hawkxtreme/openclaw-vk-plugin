import { lstatSync, readFileSync } from "node:fs";

import { resolveSecretValue } from "./secret.js";

export type SecretFileResolution = {
  value: string;
  error?: string;
};

export function readSecretFile(
  filePath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): SecretFileResolution {
  const resolvedPath = resolveSecretValue(filePath, env);
  if (!resolvedPath.value) {
    return {
      value: "",
      error: resolvedPath.error,
    };
  }

  try {
    const stats = lstatSync(resolvedPath.value);
    if (stats.isSymbolicLink()) {
      return {
        value: "",
        error: `Secret file must not be a symlink: ${resolvedPath.value}`,
      };
    }

    return {
      value: readFileSync(resolvedPath.value, "utf8").trim(),
    };
  } catch (error) {
    return {
      value: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
