# VK Community Setup

Verified against the current VK Web interface on April 16, 2026.

This guide is for the simplest OpenClaw setup: Long Poll only, with no Callback
API, webhook URL, or tunnel.

## Fast links

- Create a community: `https://vk.com/groups_create`
- Main settings: `https://vk.com/club<GROUP_ID>?act=edit`
- Community messages: `https://vk.com/club<GROUP_ID>?act=messages`
- Bot settings: `https://vk.com/club<GROUP_ID>?act=messages&tab=bots`
- Access tokens: `https://vk.com/club<GROUP_ID>?act=tokens`
- Long Poll API: `https://vk.com/club<GROUP_ID>?act=longpoll_api`
- Long Poll event types: `https://vk.com/club<GROUP_ID>?act=longpoll_api_types`
- Community chats: `https://vk.com/club<GROUP_ID>?act=chats`

VK may move menu items around over time, but these admin URLs are usually the
shortest path.

## 1. Create the community

1. Open `https://vk.com/groups_create`
2. Enter the name
3. Pick a category
4. Click `Create community`

You do not need a server, Mini App, or Callback API endpoint for OpenClaw.

## 2. Find the `groupId`

OpenClaw needs the numeric `groupId`.

The easiest way:

- open any admin URL for the community
- if it looks like `https://vk.com/club237442417?act=edit`, then the `groupId`
  is `237442417`

Even if the community also has a vanity short address, the numeric id still
appears in the admin URLs.

## 3. Enable community messages

Open:

- `https://vk.com/club<GROUP_ID>?act=messages`

Set:

- `Community messages`: `Enabled`
- `Greeting`: optional
- `Messages widget`: optional

Without community messages, the DM flow will not work correctly.

## 4. Enable bot settings

Open:

- `https://vk.com/club<GROUP_ID>?act=messages&tab=bots`

Set:

- `Bot features`: `Enabled`
- `Add the Start button`: recommended for an easier first DM
- `Allow adding the community to chats`: enable if you want group chats

If you do not need group chats, the last option can stay off.

## 5. Create the access token

Open:

- `https://vk.com/club<GROUP_ID>?act=tokens`

Click `Create key` and grant at least:

- `community management`
- `community messages`

If you want the bot to send media, also grant:

- `photos`
- `files`

Save the token right away. It will go into `channels.vk.accessToken`.

## 6. Enable Long Poll API

Open:

- `https://vk.com/club<GROUP_ID>?act=longpoll_api`

Set:

- `Long Poll API`: `Enabled`
- `API version`: current or latest available

On April 16, 2026, the working VK Web value we verified was `5.199`.

## 7. Enable the required event types

Open:

- `https://vk.com/club<GROUP_ID>?act=longpoll_api_types`

At minimum, enable:

- `Incoming message` (`message_new`)
- `Message action` (`message_event`)
- `Permission granted` (`message_allow`)
- `Permission denied` (`message_deny`)

Leaving extra event types enabled is fine. OpenClaw ignores the ones it does
not use.

## 8. If you want group chats

On the VK side:

- enable `Allow adding the community to chats`
- open the community page and use the `Add to chat` button
- or open `https://vk.com/club<GROUP_ID>?act=chats`

On the OpenClaw side, the easiest starting point is:

```bash
openclaw config set channels.vk.groupPolicy open
openclaw config set channels.vk.groups.*.requireMention true
```

`requireMention=true` is recommended for noisy chats. Set it to `false` if you
want replies without an explicit bot mention.

## 9. Minimal OpenClaw config

After the VK-side setup, run:

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk

openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 123456789
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
```

On a brand-new OpenClaw config, also add:

```bash
openclaw config set gateway.mode local
```

## 10. First verification

1. Start the gateway:

```bash
openclaw gateway restart
```

If this is a fresh Docker or service-less environment, use:

```bash
openclaw gateway
```

2. Run the probe:

```bash
openclaw channels status --json --probe
```

3. Send a DM to the bot
4. If `dmPolicy=pairing`, approve the first pairing code:

```bash
openclaw pairing approve vk <CODE>
```

## Most common setup failures

- `probe.ok=false`
  Usually a wrong token, wrong `groupId`, or disabled Long Poll API
- DMs do not work
  Usually `Community messages` is still off
- Buttons behave oddly
  Usually `Bot features` is still off
- The bot stays silent in group chats
  Usually `Allow adding the community to chats` or
  `channels.vk.groupPolicy` was forgotten
- Media delivery fails
  Usually the token is missing `photos` or `files`

## Useful references

- Bots Long Poll getting started:
  `https://dev.vk.com/ru/api/bots-long-poll/getting-started`
- `groups.getLongPollServer`:
  `https://dev.vk.com/ru/method/groups.getLongPollServer`
- `groups.setLongPollSettings`:
  `https://dev.vk.com/ru/method/groups.setLongPollSettings`
- `messages.send`:
  `https://dev.vk.com/ru/method/messages.send`
