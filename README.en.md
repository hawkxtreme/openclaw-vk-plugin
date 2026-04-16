[Русский](README.md) | English

# OpenClaw VK Plugin

Standalone VK plugin for OpenClaw. Recommended path: VK Long Poll.

## Quick start

First prepare the VK community with the step-by-step guide:

- [VK community setup](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/VK-COMMUNITY-SETUP.en.md)

Then run:

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk

openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 123456789
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing

openclaw gateway restart
openclaw channels status --json --probe
```

If `probe.ok=true`, the channel is up.

## First run in fresh Docker

- If `openclaw` is not on `PATH` after `npm i -g openclaw@latest`, use `npx openclaw`
- If this is the first OpenClaw run, set `npx openclaw config set gateway.mode local` first
- If `gateway restart` says `Gateway service disabled`, just run `npx openclaw gateway` in the foreground

## If you want group chats

The easiest path is:

```bash
openclaw config set channels.vk.groupPolicy open
openclaw config set channels.vk.groups.*.requireMention true
```

`requireMention=true` is recommended for noisy chats. Set it to `false` if you want the bot to respond without an explicit mention.

## What must be enabled in VK

- `Community messages`
- `Bot features`
- `Allow adding the community to chats`, if you want group chats
- `Long Poll API`
- Event types: `message_new`, `message_event`, `message_allow`, `message_deny`
- Token rights: `community management`, `community messages`
- For media, also `photos` and `files`

Exact URLs and current VK Web screen names are documented here:

- [Detailed VK community setup](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/VK-COMMUNITY-SETUP.en.md)

## Expected warnings

- the duplicate `vk` plugin warning after `plugins install` is expected
- `openclaw config set plugins.allow.0 vk` removes the non-bundled trust warning

## Docs

- [VK community setup](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/VK-COMMUNITY-SETUP.en.md)
- [Installation](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/INSTALL.md)
- [Configuration](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/CONFIGURATION.md)
- [Verification](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/LIVE-VERIFICATION.md)
- [Advantages](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/ADVANTAGES.md)
- [Releasing](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/RELEASING.md)

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
