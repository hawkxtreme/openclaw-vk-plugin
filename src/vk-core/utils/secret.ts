import type { VkTokenSource } from "../types/config.js";

const ENV_REFERENCE_PATTERN = /^\$\{([A-Z0-9_]+)\}$/i;

export type SecretResolution = {
  value: string;
  source: VkTokenSource;
  error?: string;
};

export function resolveSecretValue(
  input: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): SecretResolution {
  const normalized = input?.trim();
  if (!normalized) {
    return { value: "", source: "none" };
  }

  const envMatch = ENV_REFERENCE_PATTERN.exec(normalized);
  if (!envMatch) {
    return { value: normalized, source: "config" };
  }

  const envName = envMatch[1];
  const envValue = env[envName]?.trim();
  if (envValue) {
    return { value: envValue, source: "env" };
  }

  return {
    value: "",
    source: "none",
    error: `Environment variable ${envName} is not set`,
  };
}
