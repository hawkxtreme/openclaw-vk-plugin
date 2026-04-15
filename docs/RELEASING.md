# Releasing

This repo now has a single release path for local checks, Docker or VK smoke,
and npm publish.

## 1. Run the local release gate

```bash
npm run release:check
```

This runs:

- `node scripts/prepare-install-dir.mjs`
- `npm run test`
- `npm run typecheck`
- `npm pack --dry-run`

## 2. Run the Docker or VK smoke lane

Use the standalone wrapper when you want a rebuilt OpenClaw image plus a fresh
Docker runtime for VK verification:

```bash
npm run live-smoke -- --group https://vk.com/club123456789 --purge-conflicts
```

What it does:

- rebuilds the OpenClaw Docker image by default
- prepares `.artifacts/install/vk`
- writes an isolated smoke config under `.artifacts/live-smoke/<project>`
- mounts this standalone repo into Docker through `plugins.load.paths`
- probes VK with `channels status --json --probe`

Useful flags:

- `--token <token>` or `VK_GROUP_TOKEN=...`
- `--skip-build` to reuse the last image
- `--down-on-success` to stop the stack after the probe
- `--openclaw-repo <path>` if the host repo is not the default sibling clone

If you have duplicate replies or stale menu behavior, rerun with
`--purge-conflicts`. That stops and removes other local OpenClaw containers
before the smoke stack starts.

## 3. Dry-run the package publish

```bash
npm run release:publish:dry-run
```

This keeps the full release gate and then runs:

```bash
npm publish --access public --dry-run
```

## 4. Publish for real

Requirements:

- branch is `main`
- working tree is clean
- `npm whoami` succeeds
- target package version is not already published

Then run:

```bash
npm run release:publish
```

Optional:

```bash
npm run release:publish -- --tag next
```

## Notes

- `temp-live/` is ignored by the publish guard and can stay local.
- The live-smoke script can seed from `~/.openclaw/openclaw.json`, so it can
  reuse your saved VK group id or token if they are already configured.
- The live-smoke wrapper writes its isolated runtime config to
  `.artifacts/live-smoke/<project>/config/openclaw.json`. That file is
  gitignored, and the VK token is stored there as a plain string for the smoke
  container because the current host Docker lane expects `channels.vk.accessToken`
  to stay a string on that path.
- The publish wrapper intentionally keeps npm auth and version guards out of
  dry-run mode so you can validate the package shape before logging in.
