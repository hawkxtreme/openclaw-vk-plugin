import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const isWindows = process.platform === "win32";

export function isDirectRun(importMeta) {
  return fileURLToPath(importMeta.url) === path.resolve(process.argv[1] ?? "");
}

export function resolveCommand(name) {
  if (!isWindows) {
    return name;
  }
  if (name === "npm") {
    return "npm.cmd";
  }
  return name;
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function readJsonIfExists(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function toDockerMountPath(rawPath) {
  return path.resolve(rawPath).replace(/\\/g, "/");
}

export function defaultOpenClawConfigPath() {
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

function createSpawn(command, args, options) {
  const resolvedCommand = resolveCommand(command);
  if (isWindows && /\.(cmd|bat)$/i.test(resolvedCommand)) {
    const quoted = [resolvedCommand, ...args]
      .map((value) => {
        if (!/[\s"]/u.test(value)) {
          return value;
        }
        return `"${value.replace(/"/g, '\\"')}"`;
      })
      .join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", quoted], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: options.stdio ?? "pipe",
    });
  }

  return spawn(resolvedCommand, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: options.stdio ?? "pipe",
  });
}

export async function runCommand(command, args, options = {}) {
  const child = createSpawn(command, args, { ...options, stdio: options.stdio ?? "inherit" });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ` +
            `${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}`,
        ),
      );
    });
  });
}

export async function captureCommand(command, args, options = {}) {
  const child = createSpawn(command, args, options);
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      resolve(exitCode ?? 1);
    });
  });

  if (code !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${code}\n${stderr || stdout}`.trim(),
    );
  }

  return {
    code,
    stdout,
    stderr,
  };
}
