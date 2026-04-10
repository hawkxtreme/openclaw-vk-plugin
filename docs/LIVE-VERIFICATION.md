# Verification

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
