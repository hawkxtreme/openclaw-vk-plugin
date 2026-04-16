# Installation

## Requirements

- Node 22+
- OpenClaw `>=2026.4.6`
- A VK community with messages enabled

## Recommended path: install from npm

1. Prepare the VK side first:
   - [VK community setup](./VK-COMMUNITY-SETUP.en.md)
2. Install and trust the plugin:

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk
```

3. Configure the channel:

```bash
openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 123456789
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
```

4. Start and probe:

```bash
openclaw gateway restart
openclaw channels status --json --probe
```

If `probe.ok=true`, the channel is up.

## First run in fresh Docker

Use `npx openclaw` instead of `openclaw` if the binary is not on `PATH` right
after `npm i -g openclaw@latest`.

On a brand-new OpenClaw config, set local mode first:

```bash
npx openclaw config set gateway.mode local
```

If `gateway restart` says `Gateway service disabled`, start the gateway in the
foreground instead:

```bash
npx openclaw gateway
```

Then run the probe from a second terminal:

```bash
npx openclaw channels status --json --probe
```

## Group chats

To enable the simplest group-chat path:

```bash
openclaw config set channels.vk.groupPolicy open
openclaw config set channels.vk.groups.*.requireMention true
```

Set `requireMention=false` if you do not want mention-gated group replies.

## Expected duplicate plugin warning

You may see a warning about duplicate plugin id `vk`. That is expected:

- bundled `vk` still exists in the host OpenClaw install
- `openclaw-vk-plugin` is installed as a global plugin
- the global plugin gets precedence and overrides the bundled one

This does not mean the standalone plugin failed to install.

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
