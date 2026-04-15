English | [Русский](README.ru.md)

# OpenClaw VK Plugin

Standalone VK channel plugin for OpenClaw with a long-poll-first setup,
button-first menus, group chats, and media support.

## What this repo is

This repository packages the VK channel as a separate plugin repo with a
`long-poll-first` delivery path:

- no public tunnel in the normal setup
- no webhook secret in the normal setup
- direct messages and group chats
- buttons, media, and pairing or allowlist policies

The active product path is Long Poll only. Callback transport work is archived
on a separate branch and is not part of the recommended setup.

## Why use it

- Easier first run:
  no tunnel, webhook secret, or callback confirmation code
- Better VK coverage:
  direct messages, group chats, buttons, media, and mention-gated groups
- Better OpenClaw fit:
  plugin metadata, setup, status, probe, and security contract follow the
  OpenClaw plugin SDK shape
- Better usability:
  command, model, and tool menus are button-first instead of relying on users
  to remember commands on mobile

## Fastest setup

This is the shortest supported path today. It uses a prepared local bundle as a
`plugins.load.paths` config plugin so it wins over the bundled OpenClaw `vk`
plugin without any OpenClaw core changes.

### Bash

```bash
git clone https://github.com/hawkxtreme/openclaw-vk-plugin.git
cd openclaw-vk-plugin

node scripts/prepare-install-dir.mjs
openclaw config set plugins.load.paths.0 "$(pwd)/.artifacts/install/vk"
openclaw plugins enable vk

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
git clone https://github.com/hawkxtreme/openclaw-vk-plugin.git
Set-Location openclaw-vk-plugin

node scripts/prepare-install-dir.mjs
openclaw config set plugins.load.paths.0 ((Resolve-Path .artifacts/install/vk).Path)
openclaw plugins enable vk

openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 237442417
openclaw config set channels.vk.accessToken "vk1.a.REPLACE_ME"
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing

openclaw gateway restart
openclaw channels status --json --probe
```

Then send a DM to the VK community. If `dmPolicy` is `pairing`, approve the
first code:

```bash
openclaw pairing approve vk <CODE>
```

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

### 2. Prepare the standalone load path

From this local checkout, prepare the trimmed install directory and point
`plugins.load.paths` at it:

```bash
node scripts/prepare-install-dir.mjs
openclaw config set plugins.load.paths.0 "$(pwd)/.artifacts/install/vk"
openclaw plugins enable vk
```

If you want a development link instead of the trimmed bundle:

```bash
openclaw config set plugins.load.paths.0 "$(pwd)"
openclaw plugins enable vk
```

This repo keeps package metadata separate from the host-bundled `vk` plugin,
but the recommended runtime path stays `plugins.load.paths` until OpenClaw
ships a host-side duplicate-plugin precedence fix.

### 3. Configure OpenClaw

Fastest non-interactive path:

```bash
openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 123456789
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
```

Equivalent JSON:

```json
{
  "channels": {
    "vk": {
      "enabled": true,
      "groupId": 123456789,
      "accessToken": "vk1.a...",
      "transport": "long-poll",
      "dmPolicy": "pairing"
    }
  }
}
```

### 4. Start and verify

Restart the gateway:

```bash
openclaw gateway restart
```

Run a probe:

```bash
openclaw channels status --json --probe
```

Then message the VK bot. If `dmPolicy` is `pairing`, approve the first pairing
request:

```bash
openclaw pairing approve vk <CODE>
```

## Docker note

If OpenClaw already runs in Docker, mount this repo into the container, prepare
the trimmed install directory, and run the same commands inside the container:

```bash
node /work/openclaw-vk-plugin/scripts/prepare-install-dir.mjs
openclaw config set plugins.load.paths.0 /work/openclaw-vk-plugin/.artifacts/install/vk
openclaw plugins enable vk
openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 123456789
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
openclaw gateway restart
openclaw channels status --json --probe
```

For a repeatable standalone Docker or VK smoke with an automatic image rebuild,
use the repo wrapper:

```bash
npm run live-smoke -- --group https://vk.com/club123456789 --purge-conflicts
```

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
