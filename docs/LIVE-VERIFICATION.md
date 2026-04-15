# Verification

## Latest live result: 2026-04-13

Latest standalone live verification on `main` used a Docker runtime with the
prepared standalone bundle loaded through `plugins.load.paths` so the repo copy
ran as a `config` plugin instead of relying on bundled-plugin override.

Confirmed in a real VK DM:

- `openclaw channels status --json --probe` reports `configured=true`,
  `running=true`, and `probe.ok=true`
- `Status` returns a fresh bot status message
- `Help` returns a fresh help message
- `Tools` opens the tool-group menu
- `Built-in` opens paginated tool results
- `Next >` and `< Back` work
- `Close` collapses the menu to the composer launcher state
- the collapsed launcher can reopen the full menu with `Menu`
- `Status` still works after `Close -> Menu -> reopen`
- plain text chat still works after menu interactions
- photo-only inbound DM works end to end on Long Poll:
  - VK Web sent a real photo-only message at `18:05`
  - the standalone runtime recorded a fresh `inbound` event in `vk-flow`
  - the bot delivered the attachment fallback reply at `18:06`
- audio file attachments in DM now normalize and dispatch on Long Poll:
  - VK Web sent an audio file at `19:33`
  - the runtime logged `attachments=1` with `rawAttachmentKinds=["audio"]`
  - the bot delivered the generic attachment fallback reply at `19:33`
- voice or audio attachments no longer get skipped after the config-load-path
  workaround:
  - VK Web sent a fresh audio attachment at `20:33`
  - the runtime normalized it to `attachmentKinds=["audio_message"]`
  - the bot completed attachment-only dispatch and delivered the fallback reply
    at `20:34`
- group-chat mention commands work end to end on Long Poll:
  - VK Web sent `[club237442417|test_openclaw] status` into the real
    `OpenClaw Group Smoke` chat at `18:44`
  - the standalone runtime normalized the inbound body to `/status` before
    dispatch
  - the bot delivered the normal multi-line status reply in the group chat at
    `18:44`

Observed caveats during the same live run:

- OpenClaw still emits a confusing duplicate-plugin warning for `vk`; the
  supported workaround is to use `plugins.load.paths` for this standalone repo
- duplicate local OpenClaw Docker stacks can both consume the same VK token and
  make live verification look broken; use
  `npm run live-smoke -- --group https://vk.com/club123456789 --purge-conflicts`
  when you want the wrapper to stop and remove old local OpenClaw containers
- VK Web can attach unexpected UI decorations to user messages without breaking
  the actual bot reply path
- attachment fallback text is still generic and does not yet distinguish image
  versus audio in the user-facing reply

Not re-verified in that latest pass:

- outbound media delivery

## What to verify locally

- probe succeeds
- DM reply works
- group reply works
- button menu opens
- models menu paginates
- tools menu paginates
- media delivery works when VK scopes allow it
- allowlist or pairing policy behaves as expected

## What the automated suite covers

- config and setup validation
- secret contract behavior
- Long Poll probe behavior
- inbound routing behavior
- outbound keyboard behavior
- command and model menu rendering
- release-smoke coverage for the long-poll path

## Recommended manual smoke

1. Run `openclaw channels status --json --probe`
2. Send a direct message to the VK bot
3. Approve pairing if `dmPolicy` is `pairing`
4. Open the command menu with `/` or `/commands`
5. Open the models menu and change the model
6. Open the tools menu
7. Send a message in a group chat with a mention if `requireMention` is enabled
8. Send an image or voice message if media is enabled

## Docker smoke goal

The intended pre-publish bar for this repo is:

- `corepack pnpm install`
- `npm run release:check`
- `npm run live-smoke -- --group https://vk.com/club123456789 --purge-conflicts`

That gives you both the local release gate and a rebuilt Docker runtime for VK
smoke.

## Platform caveats

- VK does not provide Telegram-style slash autocomplete in the composer
- rich text is limited to what VK supports through `format_data`
- unsupported formatting should degrade to readable plain text instead of failing
