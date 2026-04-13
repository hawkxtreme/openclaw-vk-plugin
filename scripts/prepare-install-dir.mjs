import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutDir = path.join(repoRoot, ".artifacts", "install", "vk");

const INSTALL_BUNDLE_ENTRIES = [
  "src",
  "api.ts",
  "contract-api.ts",
  "index.ts",
  "openclaw.plugin.json",
  "README.md",
  "README.ru.md",
  "runtime-api.ts",
  "setup-entry.ts",
  "LICENSE",
];

function resolveOutDir(argv) {
  const outIndex = argv.indexOf("--out");
  if (outIndex >= 0) {
    const raw = argv[outIndex + 1];
    if (!raw || raw.startsWith("--")) {
      throw new Error("Missing value for --out");
    }
    return path.resolve(repoRoot, raw);
  }
  return defaultOutDir;
}

function resolvePackageManifest(manifest) {
  const next = { ...manifest };
  delete next.devDependencies;
  delete next.scripts;
  return next;
}

async function main() {
  const outDir = resolveOutDir(process.argv.slice(2));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const entry of INSTALL_BUNDLE_ENTRIES) {
    await cp(path.join(repoRoot, entry), path.join(outDir, entry), { recursive: true });
  }

  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageManifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
  await writeFile(
    path.join(outDir, "package.json"),
    `${JSON.stringify(resolvePackageManifest(packageManifest), null, 2)}\n`,
    "utf8",
  );

  console.log(`Prepared install directory: ${outDir}`);
  console.log(`Install with: openclaw plugins install ${outDir}`);
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
