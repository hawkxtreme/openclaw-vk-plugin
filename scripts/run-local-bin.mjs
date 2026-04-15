#!/usr/bin/env node

import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun, runCommand } from "./lib/script-helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function resolvePackageEntry(packageName, entryPath) {
  const pnpmRoot = path.join(repoRoot, "node_modules", ".pnpm");
  const candidates = (await readdir(pnpmRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${packageName}@`))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const candidate of candidates) {
    const packageRoot = path.join(pnpmRoot, candidate, "node_modules", packageName);
    const resolved = path.join(packageRoot, entryPath);
    try {
      await access(resolved);
      return {
        packageRoot,
        resolved,
      };
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Could not resolve ${packageName}/${entryPath} from node_modules/.pnpm`);
}

export async function main(argv = process.argv.slice(2)) {
  const [packageName, entryPath, ...args] = argv;
  if (!packageName || !entryPath) {
    throw new Error("Usage: node scripts/run-local-bin.mjs <package> <entry> [args...]");
  }

  const resolvedEntry = await resolvePackageEntry(packageName, entryPath);
  const packageNodeModules = path.join(resolvedEntry.packageRoot, "node_modules");
  const packageParentNodeModules = path.dirname(resolvedEntry.packageRoot);
  const pnpmNodeModules = path.join(repoRoot, "node_modules", ".pnpm", "node_modules");
  const nodePathEntries = [packageNodeModules, packageParentNodeModules, pnpmNodeModules];
  const existingNodePath = process.env.NODE_PATH ? [process.env.NODE_PATH] : [];

  await runCommand("node", [resolvedEntry.resolved, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_PATH: [...nodePathEntries, ...existingNodePath].join(path.delimiter),
    },
  });
}

if (isDirectRun(import.meta)) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
