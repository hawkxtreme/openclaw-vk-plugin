[Русский](README.md) | English

# OpenClaw VK Plugin

Standalone VK channel plugin for OpenClaw with a long-poll-first setup,
button-first menus, group chats, and media support.

## Quick take

The simplest install path is now npm-first, not a git checkout:

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk
openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 237442417
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
openclaw gateway restart
openclaw channels status --json --probe
```

This path is already verified against the real CLI:

- `openclaw plugins install openclaw-vk-plugin` installs the plugin from npm
- the plugin lands as a global extension and overrides bundled `vk`
- no extra `plugins.load.paths` setup is needed for normal npm installs

If this is a fresh Docker container or the very first OpenClaw run, use the
short first-run block below. In minimal Node images you usually need to set
`gateway.mode=local` once, and `gateway restart` is often replaced by a simple
foreground `openclaw gateway`.

## What this repo is

This repository packages the VK channel as a separate plugin repo with a
`long-poll-first` delivery path:

- no public tunnel in the normal setup
- no webhook secret in the normal setup
- direct messages and group chats
- buttons, media, and pairing or allowlist policies

The active product path is Long Poll only. Callback transport work is archived
and is not part of the recommended setup.

## Why this path is better

- Easier first run:
  no git checkout, `plugins.load.paths`, tunnel, or callback secret
- Shorter user path:
  `plugins install` from npm, `plugins enable`, set VK config, run a probe
- Better VK coverage:
  direct messages, group chats, buttons, media, and mention-gated groups
- Better usability:
  command, model, and tool menus are button-first instead of relying on slash
  command memory

## Fresh Docker / first run

This exact path was verified in a clean `node:24-bookworm` container.

If `openclaw` is not on `PATH` right after `npm i -g openclaw@latest`, replace
it with `npx openclaw` in the commands below.

```bash
npm i -g openclaw@latest
npx openclaw config set gateway.mode local

npx openclaw plugins install openclaw-vk-plugin
npx openclaw plugins enable vk
npx openclaw config set plugins.allow.0 vk
npx openclaw config set channels.vk.enabled true
npx openclaw config set channels.vk.groupId 237442417
npx openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
npx openclaw config set channels.vk.transport long-poll
npx openclaw config set channels.vk.dmPolicy pairing
```

Then start the gateway in the foreground:

```bash
npx openclaw gateway
```

And verify from a second terminal:

```bash
npx openclaw channels status --json --probe
```

In minimal Docker images, avoid `--force` on the first run unless you really
need it. Those images often do not include `fuser` or `lsof`, which only adds
friction.

## Fastest setup

### Bash

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk

openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 237442417
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing

openclaw gateway restart
openclaw channels status --json --probe
```

### PowerShell

```powershell
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk

openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 237442417
openclaw config set channels.vk.accessToken "vk1.a.REPLACE_ME"
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing

openclaw gateway restart
openclaw channels status --json --probe
```

If `gateway restart` answers `Gateway service disabled`, that is not a plugin
install failure. In a fresh Docker or service-less environment, just run:

```bash
openclaw gateway
```

Then run `openclaw channels status --json --probe` from a second terminal.

Then send a DM to the VK community. If `dmPolicy` is `pairing`, approve the
first pairing code:

```bash
openclaw pairing approve vk <CODE>
```

## About the duplicate plugin warning

After `plugins install`, OpenClaw may warn about a duplicate `vk` plugin id.
That is expected for the npm install path:

- bundled `vk` still exists in the host OpenClaw install
- the npm package is installed as a global plugin
- the global plugin gets precedence and overrides the bundled one

That warning does not mean the install failed.

It is also recommended to run this once:

```bash
openclaw config set plugins.allow.0 vk
```

That explicitly trusts the installed global plugin and removes the host warning
about `plugins.allow is empty` for non-bundled plugins.

## Manual setup details

### 1. Prepare the VK community

In VK community settings:

1. Enable community messages.
2. Create a community access token.
3. Grant at least these scopes:
   - `messages`
   - `manage`
4. Grant these too if you want outbound media:
   - `photos`
   - `docs`
5. Enable **Bots Long Poll API**.
6. Enable these Long Poll event types:
   - `message_new`
   - `message_allow`
   - `message_deny`
   - `message_event`
7. If you want group chats, allow the community to be added to chats.

VK references:

- `https://dev.vk.com/ru/api/bots-long-poll/getting-started`
- `https://dev.vk.com/ru/method/groups.setLongPollSettings`
- `https://dev.vk.com/ru/method/messages.send`

### 2. Install and enable the plugin

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk
```

The plugin is installed into global OpenClaw extensions and recorded under
`plugins.installs.vk`.

### 3. Configure OpenClaw

Fastest non-interactive path:

```bash
openclaw config set gateway.mode local
openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 123456789
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
```

Equivalent JSON:

```json
{
  "plugins": {
    "entries": {
      "vk": {
        "enabled": true
      }
    }
  },
  "channels": {
    "vk": {
      "enabled": true,
      "groupId": 123456789,
      "accessToken": "vk1.a...",
      "transport": "long-poll",
      "dmPolicy": "pairing"
    }
  },
  "gateway": {
    "mode": "local"
  }
}
```

### 4. Start and verify

```bash
openclaw gateway restart
openclaw channels status --json --probe
```

If this is a fresh Docker or a service-less environment, use `openclaw gateway`
instead of `gateway restart`.

If `dmPolicy` is `pairing`, approve the first pairing code:

```bash
openclaw pairing approve vk <CODE>
```

## Local checkout is now for development

If you want to edit the plugin locally instead of just using it, then you want
the repo checkout path:

```bash
git clone https://github.com/hawkxtreme/openclaw-vk-plugin.git
cd openclaw-vk-plugin

node scripts/prepare-install-dir.mjs
openclaw config set plugins.load.paths.0 "$(pwd)/.artifacts/install/vk"
openclaw plugins enable vk
```

This path is useful for:

- local development
- validating changes before publishing a new npm version
- repo-owned Docker or VK live-smoke runs

For normal installation, it is no longer the primary path.

## Docker and live-smoke

For repeatable standalone Docker or VK smoke with an automatic image rebuild,
use the repo wrapper:

```bash
git clone https://github.com/hawkxtreme/openclaw-vk-plugin.git
cd openclaw-vk-plugin
npm run live-smoke -- --group https://vk.com/club123456789 --purge-conflicts
```

What the wrapper does:

- prepares `.artifacts/install/vk`
- rebuilds the host OpenClaw Docker image by default
- starts an isolated smoke stack
- can stop and remove old local OpenClaw containers so you do not end up with
  duplicate consumers on one VK token
- runs `channels status --json --probe` inside the fresh Docker runtime

## What the probe should catch

The Long Poll probe is expected to catch these common mistakes:

- invalid or revoked token
- wrong `groupId`
- Bots Long Poll API disabled in VK
- required Long Poll events not enabled

If outbound delivery fails later, the most common VK causes are:

- missing user permission to receive messages
- invalid keyboard payload
- disabled chat-bot settings for chats
- inaccessible or closed chat
- missing `photos` or `docs` scopes for media

## Product scope

Current scope:

- Long Poll as the default user path
- direct messages
- group chats
- model and tool command menus
- outbound text and media
- pairing and allowlist controls

Archived for later:

- Callback API transport
- webhook-specific deployment workflows

## Docs

- [Installation](./docs/INSTALL.md)
- [Configuration](./docs/CONFIGURATION.md)
- [Advantages](./docs/ADVANTAGES.md)
- [Verification](./docs/LIVE-VERIFICATION.md)
- [Releasing](./docs/RELEASING.md)

## Development

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
npm run release:check
```

The package expects a compatible `openclaw` version as a peer dependency.

## License

MIT
