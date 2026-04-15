#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun, runCommand } from "./lib/script-helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function printHelp() {
  console.log(`Usage:
  node scripts/release-check.mjs [options] [-- <live-smoke args>]

Options:
  --with-live-smoke    Run scripts/live-smoke.mjs after local checks
  --help               Show this help
`);
}

function parseArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  const ownArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const forwardedArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];
  const options = {
    forwardedArgs,
    help: false,
    withLiveSmoke: false,
  };

  for (const arg of ownArgs) {
    switch (arg) {
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

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  console.log("Preparing the standalone install bundle...");
  await runCommand("node", ["scripts/prepare-install-dir.mjs"], { cwd: repoRoot });

  console.log("Running the standalone test suite...");
  await runCommand("npm", ["run", "test"], { cwd: repoRoot });

  console.log("Running TypeScript checks...");
  await runCommand("npm", ["run", "typecheck"], { cwd: repoRoot });

  console.log("Checking the publish tarball...");
  await runCommand("npm", ["pack", "--dry-run"], { cwd: repoRoot });

  if (options.withLiveSmoke) {
    console.log("Running the Docker/VK live-smoke wrapper...");
    await runCommand("node", ["scripts/live-smoke.mjs", ...options.forwardedArgs], {
      cwd: repoRoot,
    });
  }
}

if (isDirectRun(import.meta)) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
