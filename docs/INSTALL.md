# Installation

## Requirements

- Node 22+
- OpenClaw `>=2026.4.6`
- A VK community with messages enabled

## Recommended path: install from npm

The shortest normal-user path is now:

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk
```

If this is a fresh Docker container or the first OpenClaw run, set local mode
first:

```bash
openclaw config set gateway.mode local
```

If `openclaw` is not on `PATH` right after `npm i -g openclaw@latest`, use
`npx openclaw` instead in the commands below.

Then configure VK:

```bash
openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 237442417
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
openclaw gateway restart
openclaw channels status --json --probe
```

If `gateway restart` says `Gateway service disabled`, that is expected in fresh
Docker or service-less environments. Run `openclaw gateway` in the foreground
instead, and execute `openclaw channels status --json --probe` from a second
terminal.

This npm install path is already verified on the real CLI. The standalone
plugin is installed as a global plugin and overrides bundled `vk`.

## Expected duplicate plugin warning

You may see a warning about duplicate plugin id `vk`. That is expected for this
install path:

- bundled `vk` still exists in the host OpenClaw install
- `openclaw-vk-plugin` is installed as a global extension
- the global plugin gets precedence and overrides the bundled one

This warning does not mean the standalone plugin failed to install.

It is also recommended to trust the installed global plugin explicitly:

```bash
openclaw config set plugins.allow.0 vk
```

That removes the host warning about `plugins.allow is empty` for non-bundled
plugins.

## VK-side setup

Before the first probe:

1. Enable community messages.
2. Create a community access token.
3. Grant `messages` and `manage`.
4. Grant `photos` and `docs` if you want outbound media.
5. Enable **Bots Long Poll API**.
6. Enable:
   - `message_new`
   - `message_allow`
   - `message_deny`
   - `message_event`

## After install

1. Install the npm package
2. Enable plugin `vk`
3. Add VK config under `channels.vk`
4. Set `gateway.mode=local` if this is a brand-new OpenClaw config
5. Restart the gateway if it is already running
6. Probe the channel

```bash
openclaw channels status --json --probe
```

## Local checkout path: development only

Use the repo checkout path only if you are developing the plugin locally:

```bash
git clone https://github.com/hawkxtreme/openclaw-vk-plugin.git
cd openclaw-vk-plugin

node scripts/prepare-install-dir.mjs
openclaw config set plugins.load.paths.0 "$(pwd)/.artifacts/install/vk"
openclaw plugins enable vk
```

This path is useful for:

- local code edits
- validating unpublished changes
- repo-owned Docker or VK live-smoke runs

## Why Long Poll first

- no public HTTPS callback URL
- no tunnel lifecycle problems
- no callback secret or confirmation code
- easier local and Docker verification

## Docker and live-smoke

If you want the repo to rebuild the Docker image and prepare a clean VK smoke
stack for you, use:

```bash
git clone https://github.com/hawkxtreme/openclaw-vk-plugin.git
cd openclaw-vk-plugin
npm run live-smoke -- --group https://vk.com/club123456789 --purge-conflicts
```
