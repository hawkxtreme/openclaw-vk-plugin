#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureCommand,
  isDirectRun,
  readJsonIfExists,
  runCommand,
} from "./lib/script-helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function printHelp() {
  console.log(`Usage:
  node scripts/release-publish.mjs [options] [-- <live-smoke args>]

Options:
  --dry-run           Run release checks and npm publish --dry-run
  --skip-check        Skip scripts/release-check.mjs
  --tag <dist-tag>    Publish with an explicit dist-tag
  --with-live-smoke   Forward live-smoke execution into release-check
  --help              Show this help
`);
}

function parseArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  const ownArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const forwardedArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];
  const options = {
    dryRun: false,
    forwardedArgs,
    help: false,
    skipCheck: false,
    tag: null,
    withLiveSmoke: false,
  };

  for (let index = 0; index < ownArgs.length; index += 1) {
    const arg = ownArgs[index];
    const next = ownArgs[index + 1];
    const requireValue = () => {
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return next;
    };

    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--skip-check":
        options.skipCheck = true;
        break;
      case "--tag":
        options.tag = requireValue();
        break;
      case "--with-live-smoke":
        options.withLiveSmoke = true;
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

export function filterIgnorableStatusLines(lines) {
  return lines
    .map((line) => line.trim())
    .filter((trimmed) => {
      if (!trimmed) {
        return false;
      }
      return !trimmed.endsWith("temp-live/") && !trimmed.includes(" temp-live/");
    });
}

async function assertGitState({ dryRun }) {
  const branch = await captureCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
  });
  const currentBranch = branch.stdout.trim();

  if (!dryRun && currentBranch !== "main") {
    throw new Error(`Refusing to publish from ${currentBranch}. Switch to main first.`);
  }

  const status = await captureCommand(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { cwd: repoRoot },
  );
  const dirtyLines = filterIgnorableStatusLines(status.stdout.split(/\r?\n/));
  if (dirtyLines.length > 0) {
    throw new Error(
      `Working tree must be clean before release.\n${dirtyLines.join("\n")}`.trim(),
    );
  }
}

async function assertVersionNotPublished(packageName, version) {
  const result = await captureCommand(
    "npm",
    ["view", `${packageName}@${version}`, "version", "--json"],
    { allowFailure: true, cwd: repoRoot },
  );
  if (result.code === 0 && result.stdout.trim().length > 0) {
    throw new Error(`${packageName}@${version} is already published on npm`);
  }
}

async function assertNpmAuth() {
  await runCommand("npm", ["whoami"], { cwd: repoRoot });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const manifest = await readJsonIfExists(path.join(repoRoot, "package.json"));
  if (!manifest?.name || !manifest?.version) {
    throw new Error("package.json is missing a valid name/version");
  }

  await assertGitState({ dryRun: options.dryRun });

  if (!options.skipCheck) {
    const releaseCheckArgs = [];
    if (options.withLiveSmoke) {
      releaseCheckArgs.push("--with-live-smoke");
    }
    if (options.forwardedArgs.length > 0) {
      releaseCheckArgs.push("--", ...options.forwardedArgs);
    }
    await runCommand("node", ["scripts/release-check.mjs", ...releaseCheckArgs], {
      cwd: repoRoot,
    });
  }

  if (!options.dryRun) {
    await assertNpmAuth();
    await assertVersionNotPublished(manifest.name, manifest.version);
  }

  const publishArgs = ["publish", "--access", "public"];
  if (options.tag) {
    publishArgs.push("--tag", options.tag);
  }
  if (options.dryRun) {
    publishArgs.push("--dry-run");
  }

  await runCommand("npm", publishArgs, { cwd: repoRoot });
}

if (isDirectRun(import.meta)) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
