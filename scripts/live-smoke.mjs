#!/usr/bin/env node

import { existsSync } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureCommand,
  defaultOpenClawConfigPath,
  ensureDir,
  isDirectRun,
  readJsonIfExists,
  runCommand,
  toDockerMountPath,
  writeJson,
} from "./lib/script-helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectName = "vk-live-smoke";
const defaultImageTag = "openclaw:vk-live-smoke";
const defaultGatewayPort = "28789";
const defaultBridgePort = "28790";
const defaultDmPolicy = "pairing";
const defaultTokenEnvVar = "VK_GROUP_TOKEN";
const defaultOllamaBaseUrl = "http://host.docker.internal:11434";
const defaultOllamaModelId = "qwen3.5:9b";
const defaultOllamaModelName = "Qwen 3.5 9B";
const defaultContainerPluginPath = "/tmp/openclaw-vk-plugin-install";

function printHelp() {
  console.log(`Usage:
  node scripts/live-smoke.mjs [options]

Options:
  --group-id <id>           VK community id
  --group <value>           VK community URL, club handle, or public handle
  --token <token>           VK community token for this run
  --dm-policy <policy>      VK DM policy (default: ${defaultDmPolicy})
  --project-name <name>     Docker compose project name (default: ${defaultProjectName})
  --image-tag <tag>         Docker image tag (default: ${defaultImageTag})
  --gateway-port <port>     Host gateway port (default: ${defaultGatewayPort})
  --bridge-port <port>      Host bridge port (default: ${defaultBridgePort})
  --openclaw-repo <path>    Host OpenClaw repo to build from
  --host-config <path>      Host openclaw.json to seed from
  --token-env <name>        Env var name inside Docker (default: ${defaultTokenEnvVar})
  --ollama-base-url <url>   Ollama base URL inside Docker (default: ${defaultOllamaBaseUrl})
  --ollama-model-id <id>    Ollama model id (default: ${defaultOllamaModelId})
  --ollama-model-name <n>   Ollama model name (default: ${defaultOllamaModelName})
  --skip-build              Reuse the current image instead of rebuilding
  --purge-conflicts         Stop and remove other local OpenClaw containers first
  --down-on-success         Tear the smoke stack down after the probe
  --dry-run                 Render config and print the plan without Docker changes
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const options = {
    bridgePort: defaultBridgePort,
    dmPolicy: defaultDmPolicy,
    downOnSuccess: false,
    dryRun: false,
    gatewayPort: defaultGatewayPort,
    group: null,
    groupId: null,
    help: false,
    hostConfigPath: defaultOpenClawConfigPath(),
    imageTag: defaultImageTag,
    ollamaBaseUrl: defaultOllamaBaseUrl,
    ollamaModelId: defaultOllamaModelId,
    ollamaModelName: defaultOllamaModelName,
    openClawRepo: null,
    projectName: defaultProjectName,
    purgeConflicts: false,
    skipBuild: false,
    token: null,
    tokenEnvVar: defaultTokenEnvVar,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const requireValue = () => {
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return next;
    };

    switch (arg) {
      case "--group-id":
        options.groupId = requireValue();
        break;
      case "--group":
        options.group = requireValue();
        break;
      case "--token":
        options.token = requireValue();
        break;
      case "--dm-policy":
        options.dmPolicy = requireValue();
        break;
      case "--project-name":
        options.projectName = requireValue();
        break;
      case "--image-tag":
        options.imageTag = requireValue();
        break;
      case "--gateway-port":
        options.gatewayPort = requireValue();
        break;
      case "--bridge-port":
        options.bridgePort = requireValue();
        break;
      case "--openclaw-repo":
        options.openClawRepo = requireValue();
        break;
      case "--host-config":
        options.hostConfigPath = requireValue();
        break;
      case "--token-env":
        options.tokenEnvVar = requireValue();
        break;
      case "--ollama-base-url":
        options.ollamaBaseUrl = requireValue();
        break;
      case "--ollama-model-id":
        options.ollamaModelId = requireValue();
        break;
      case "--ollama-model-name":
        options.ollamaModelName = requireValue();
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--purge-conflicts":
        options.purgeConflicts = true;
        break;
      case "--down-on-success":
        options.downOnSuccess = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function normalizeVkGroupId(rawValue) {
  if (!rawValue) {
    return null;
  }
  const raw = String(rawValue).trim();

  if (/^[1-9][0-9]*$/.test(raw)) {
    return raw;
  }

  const handleMatch = /^(club|public)([1-9][0-9]*)$/i.exec(raw);
  if (handleMatch) {
    return handleMatch[2];
  }

  const urlMatch =
    /^(https?:\/\/)?(m\.)?vk\.com\/(club|public)([1-9][0-9]*)(\/)?([?#].*)?$/i.exec(raw);
  if (urlMatch) {
    return urlMatch[4];
  }

  return null;
}

function getPathValue(value, pathSegments) {
  let current = value;
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setPathValue(target, pathSegments, nextValue) {
  let current = target;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const segment = pathSegments[index];
    const child = current[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[pathSegments[pathSegments.length - 1]] = nextValue;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function prependUniquePath(existingValues, nextValue) {
  const entries = Array.isArray(existingValues)
    ? existingValues.filter((entry) => typeof entry === "string" && entry.length > 0)
    : [];
  return [nextValue, ...entries.filter((entry) => entry !== nextValue)];
}

function resolveTokenFromConfig(config, tokenEnvVar) {
  const rawToken = getPathValue(config, ["channels", "vk", "accessToken"]);
  if (typeof rawToken === "string" && rawToken.length > 0) {
    return rawToken;
  }
  if (!rawToken || typeof rawToken !== "object") {
    return null;
  }
  if (rawToken.source === "env" && typeof rawToken.id === "string" && rawToken.id.length > 0) {
    const envName = rawToken.id;
    const envValue = process.env[envName];
    if (envValue) {
      return envValue;
    }
    if (envName === tokenEnvVar && process.env[tokenEnvVar]) {
      return process.env[tokenEnvVar];
    }
  }
  return null;
}

function resolveGroupIdFromConfig(config) {
  const rawGroupId = getPathValue(config, ["channels", "vk", "groupId"]);
  if (typeof rawGroupId === "number" && Number.isInteger(rawGroupId) && rawGroupId > 0) {
    return String(rawGroupId);
  }
  if (typeof rawGroupId === "string") {
    return normalizeVkGroupId(rawGroupId);
  }
  return null;
}

function resolveOpenClawRepo(explicitPath) {
  const candidates = [
    explicitPath,
    path.resolve(repoRoot, "..", "openclaw-official-vk"),
    path.resolve(repoRoot, "..", "openclaw"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      candidate &&
      existsSync(path.join(candidate, "package.json")) &&
      existsSync(path.join(candidate, "docker-compose.yml")) &&
      existsSync(path.join(candidate, "Dockerfile"))
    ) {
      return path.resolve(candidate);
    }
  }

  throw new Error(
    "Could not find an OpenClaw host repo. Pass --openclaw-repo or clone one next to this repo.",
  );
}

async function ensureRepoLooksValid(repoPath) {
  const manifestPath = path.join(repoPath, "package.json");
  const composePath = path.join(repoPath, "docker-compose.yml");
  const dockerfilePath = path.join(repoPath, "Dockerfile");
  const manifest = await readJsonIfExists(manifestPath);
  if (!manifest || manifest.name !== "openclaw") {
    throw new Error(`Expected an OpenClaw repo at ${repoPath}`);
  }
  await Promise.all([access(composePath), access(dockerfilePath)]).catch(() => {
    throw new Error(`Expected docker-compose.yml and Dockerfile at ${repoPath}`);
  });
}

export function buildSmokeConfig(existingConfig, options) {
  const next = structuredClone(existingConfig ?? {});
  const pluginLoadPaths = prependUniquePath([], options.containerPluginPath);
  setPathValue(next, ["plugins", "load", "paths"], pluginLoadPaths);

  const pluginEntries = asObject(getPathValue(next, ["plugins", "entries"]));
  const vkEntry = asObject(pluginEntries.vk);
  setPathValue(next, ["plugins", "entries"], {
    ...pluginEntries,
    vk: {
      ...vkEntry,
      enabled: true,
    },
  });

  const existingVk = asObject(getPathValue(next, ["channels", "vk"]));
  setPathValue(next, ["channels", "vk"], {
    ...existingVk,
    enabled: true,
    groupId: Number(options.groupId),
    transport: "long-poll",
    accessToken: options.accessToken,
    dmPolicy: options.dmPolicy,
  });

  const modelKey = `ollama/${options.ollamaModelId}`;
  const existingDefaultsModels = asObject(getPathValue(next, ["agents", "defaults", "models"]));
  setPathValue(next, ["agents", "defaults", "model", "primary"], modelKey);
  setPathValue(next, ["agents", "defaults", "models"], {
    ...existingDefaultsModels,
    [modelKey]: asObject(existingDefaultsModels[modelKey]),
  });

  const existingProviders = asObject(getPathValue(next, ["models", "providers"]));
  setPathValue(next, ["models", "providers"], {
    ...existingProviders,
    ollama: {
      baseUrl: options.ollamaBaseUrl,
      apiKey: "ollama-local",
      api: "ollama",
      models: [
        {
          id: options.ollamaModelId,
          name: options.ollamaModelName,
          reasoning: false,
          input: ["text"],
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow: 32768,
          maxTokens: 131072,
        },
      ],
    },
  });

  return next;
}

export function renderComposeOverride() {
  return "services: {}\n";
}

function createComposeArgs(openClawRepo, overridePath, projectName, extraArgs) {
  return [
    "compose",
    "--project-name",
    projectName,
    "-f",
    path.join(openClawRepo, "docker-compose.yml"),
    "-f",
    overridePath,
    ...extraArgs,
  ];
}

async function waitForGatewayHealthy(openClawRepo, overridePath, projectName, env) {
  const containerId = await resolveGatewayContainerId(openClawRepo, overridePath, projectName, env);
  if (!containerId) {
    throw new Error("Could not resolve the openclaw-gateway container id");
  }

  for (let attempt = 0; attempt < 45; attempt += 1) {
    const inspect = await captureCommand(
      "docker",
      [
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        containerId,
      ],
      { env },
    );
    const status = inspect.stdout.trim();
    if (status === "healthy" || status === "running") {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });
  }

  throw new Error("Timed out waiting for the Docker smoke gateway to become healthy");
}

async function resolveGatewayContainerId(openClawRepo, overridePath, projectName, env) {
  const ps = await captureCommand(
    "docker",
    createComposeArgs(openClawRepo, overridePath, projectName, [
      "ps",
      "-a",
      "-q",
      "openclaw-gateway",
    ]),
    { env },
  );
  return ps.stdout.trim();
}

async function copyStandaloneBundleToContainer(containerId, installDir, env) {
  await runCommand("docker", ["cp", `${installDir}${path.sep}.`, `${containerId}:${defaultContainerPluginPath}`], {
    env,
  });
}

async function purgeOtherOpenClawContainers(projectName, env) {
  const ps = await captureCommand(
    "docker",
    ["ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}"],
    { env },
  );
  const currentPrefix = `${projectName}-`;
  const rows = ps.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name, image] = line.split("\t");
      return { id, image, name };
    })
    .filter(({ image, name }) => {
      if (!idOrNameLooksOpenClaw(name, image)) {
        return false;
      }
      return !name.startsWith(currentPrefix);
    });

  if (rows.length === 0) {
    console.log("No conflicting local OpenClaw containers found.");
    return;
  }

  console.log(`Stopping ${rows.length} conflicting OpenClaw container(s)...`);
  for (const row of rows) {
    await runCommand("docker", ["stop", row.id], { env });
    await runCommand("docker", ["rm", row.id], { env });
  }
}

function idOrNameLooksOpenClaw(name, image) {
  return /openclaw/i.test(name) || /^openclaw:/i.test(image);
}

function summarizePlan(options) {
  console.log("Live smoke plan:");
  console.log(`- host OpenClaw repo: ${options.openClawRepo}`);
  console.log(`- Docker project: ${options.projectName}`);
  console.log(`- Docker image: ${options.imageTag}`);
  console.log(`- gateway port: ${options.gatewayPort}`);
  console.log(`- bridge port: ${options.bridgePort}`);
  console.log(`- VK group id: ${options.groupId}`);
  console.log(`- host config seed: ${options.hostConfigPath}`);
  console.log(`- purge conflicts: ${options.purgeConflicts ? "yes" : "no"}`);
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    printHelp();
    return;
  }

  const hostConfig = (await readJsonIfExists(parsed.hostConfigPath)) ?? {};
  const explicitGroupId = parsed.groupId
    ? normalizeVkGroupId(parsed.groupId)
    : normalizeVkGroupId(parsed.group);
  const groupId = explicitGroupId ?? resolveGroupIdFromConfig(hostConfig);
  if (!groupId) {
    throw new Error("Provide --group-id/--group or configure channels.vk.groupId in ~/.openclaw");
  }

  const token =
    parsed.token ?? process.env[parsed.tokenEnvVar] ?? resolveTokenFromConfig(hostConfig, parsed.tokenEnvVar);
  if (!token) {
    throw new Error(
      `Provide --token, set ${parsed.tokenEnvVar}, or store channels.vk.accessToken in ${parsed.hostConfigPath}`,
    );
  }

  const openClawRepo = resolveOpenClawRepo(parsed.openClawRepo);
  await ensureRepoLooksValid(openClawRepo);

  const smokeRoot = path.join(repoRoot, ".artifacts", "live-smoke", parsed.projectName);
  const configDir = path.join(smokeRoot, "config");
  const installDir = path.join(repoRoot, ".artifacts", "install", "vk");
  const workspaceDir = path.join(smokeRoot, "workspace");
  const overridePath = path.join(smokeRoot, "docker-compose.override.yml");

  const smokeConfig = buildSmokeConfig(hostConfig, {
    accessToken: token,
    containerPluginPath: defaultContainerPluginPath,
    dmPolicy: parsed.dmPolicy,
    groupId,
    ollamaBaseUrl: parsed.ollamaBaseUrl,
    ollamaModelId: parsed.ollamaModelId,
    ollamaModelName: parsed.ollamaModelName,
  });

  await ensureDir(configDir);
  await ensureDir(workspaceDir);
  await writeJson(path.join(configDir, "openclaw.json"), smokeConfig);
  await writeFile(overridePath, renderComposeOverride(), "utf8");

  const gatewayToken = getPathValue(hostConfig, ["gateway", "auth", "token"]);
  const composeEnv = {
    ...process.env,
    OPENCLAW_BRIDGE_PORT: parsed.bridgePort,
    OPENCLAW_CONFIG_DIR: toDockerMountPath(configDir),
    OPENCLAW_GATEWAY_BIND: "lan",
    OPENCLAW_GATEWAY_PORT: parsed.gatewayPort,
    OPENCLAW_IMAGE: parsed.imageTag,
    OPENCLAW_GATEWAY_TOKEN: typeof gatewayToken === "string" ? gatewayToken : "",
    OPENCLAW_WORKSPACE_DIR: toDockerMountPath(workspaceDir),
  };

  summarizePlan({
    ...parsed,
    groupId,
    hostConfigPath: parsed.hostConfigPath,
    openClawRepo,
  });

  if (parsed.dryRun) {
    console.log(`- config file: ${path.join(configDir, "openclaw.json")}`);
    console.log(`- compose override: ${overridePath}`);
    console.log(`- manual chat URL: https://vk.com/im?sel=-${groupId}`);
    return;
  }

  console.log("Preparing the standalone install directory...");
  await runCommand("node", ["scripts/prepare-install-dir.mjs"], { cwd: repoRoot, env: composeEnv });

  if (parsed.purgeConflicts) {
    await purgeOtherOpenClawContainers(parsed.projectName, composeEnv);
  }

  if (!parsed.skipBuild) {
    console.log("Rebuilding the OpenClaw Docker image...");
    await runCommand("docker", ["build", "-t", parsed.imageTag, openClawRepo], { env: composeEnv });
  }

  console.log("Tearing down any previous smoke stack for this project...");
  await runCommand(
    "docker",
    createComposeArgs(openClawRepo, overridePath, parsed.projectName, [
      "down",
      "--remove-orphans",
    ]),
    { env: composeEnv },
  ).catch(() => undefined);

  console.log("Creating the smoke gateway container...");
  await runCommand(
    "docker",
    createComposeArgs(openClawRepo, overridePath, parsed.projectName, [
      "up",
      "-d",
      "--no-start",
      "openclaw-gateway",
    ]),
    { env: composeEnv },
  );

  const containerId = await resolveGatewayContainerId(
    openClawRepo,
    overridePath,
    parsed.projectName,
    composeEnv,
  );
  if (!containerId) {
    throw new Error("Could not create the openclaw-gateway container");
  }

  console.log("Copying the standalone plugin bundle into the container...");
  await copyStandaloneBundleToContainer(containerId, installDir, composeEnv);

  console.log("Starting the smoke gateway...");
  await runCommand(
    "docker",
    createComposeArgs(openClawRepo, overridePath, parsed.projectName, ["start", "openclaw-gateway"]),
    { env: composeEnv },
  );

  await waitForGatewayHealthy(openClawRepo, overridePath, parsed.projectName, composeEnv);

  console.log("Running the VK probe inside Docker...");
  const runningContainerId = await resolveGatewayContainerId(
    openClawRepo,
    overridePath,
    parsed.projectName,
    composeEnv,
  );
  if (!runningContainerId) {
    throw new Error("Could not resolve the running openclaw-gateway container");
  }
  await runCommand(
    "docker",
    [
      "exec",
      runningContainerId,
      "node",
      "dist/index.js",
      "channels",
      "status",
      "--json",
      "--probe",
    ],
    { env: composeEnv },
  );

  console.log(`Live smoke runtime is ready: http://127.0.0.1:${parsed.gatewayPort}/healthz`);
  console.log(`Manual VK browser target: https://vk.com/im?sel=-${groupId}`);
  console.log(
    `Cleanup: docker compose --project-name ${parsed.projectName} -f ` +
      `${path.join(openClawRepo, "docker-compose.yml")} -f ${overridePath} down --remove-orphans`,
  );

  if (parsed.downOnSuccess) {
    console.log("Stopping the smoke stack because --down-on-success was requested...");
    await runCommand(
      "docker",
      createComposeArgs(openClawRepo, overridePath, parsed.projectName, [
        "down",
        "--remove-orphans",
      ]),
      { env: composeEnv },
    );
  }
}

if (isDirectRun(import.meta)) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
