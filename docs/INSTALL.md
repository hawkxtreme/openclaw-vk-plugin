# Installation

## Requirements

- Node 22+
- OpenClaw `>=2026.4.6`
- A VK community with messages enabled

## Option 1: install from a local checkout

```bash
openclaw plugins install .
openclaw plugins enable vk
```

This is the fastest way to test the plugin before publishing it anywhere.

## Option 2: install from npm

After publishing the package:

```bash
openclaw plugins install @openclaw/vk
openclaw plugins enable vk
```

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

1. Add VK config under `channels.vk`
2. Restart the gateway if it is already running
3. Probe the channel

```bash
openclaw channels status --probe
```

## Fastest non-interactive setup

```bash
openclaw plugins install .
openclaw plugins enable vk
openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 237442417
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
openclaw gateway restart
openclaw channels status --json --probe
```

## Minimal workflow

1. Install the plugin
2. Enable it
3. Configure `groupId` and `accessToken`
4. Keep `transport` as `long-poll`
5. Send a DM to the VK community
6. Test the button menu, models, and tools

## Why Long Poll first

- no public HTTPS callback URL
- no tunnel lifecycle problems
- no callback secret or confirmation code
- easier local and Docker verification

## Docker note

If OpenClaw already runs in Docker, mount this repo into the container and run
the same plugin install and `openclaw config set ...` commands inside that
container.
