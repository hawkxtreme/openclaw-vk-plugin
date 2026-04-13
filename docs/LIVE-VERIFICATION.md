# Verification

## Latest live result: 2026-04-13

Latest standalone live verification on `main` used a Docker runtime with the
published standalone plugin installed into OpenClaw state and overriding the
bundled `vk` channel plugin.

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

Observed caveats during the same live run:

- Docker logs show an expected duplicate-plugin warning because the standalone
  plugin overrides the bundled `vk` plugin inside the OpenClaw image
- VK Web can attach unexpected UI decorations to user messages without breaking
  the actual bot reply path

Not re-verified in that latest pass:

- group-chat smoke
- inbound image understanding
- inbound voice understanding
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
- `corepack pnpm test`
- `corepack pnpm typecheck`

both locally and in a clean Docker container.

## Platform caveats

- VK does not provide Telegram-style slash autocomplete in the composer
- rich text is limited to what VK supports through `format_data`
- unsupported formatting should degrade to readable plain text instead of failing
