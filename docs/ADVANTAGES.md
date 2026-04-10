# Advantages

## Compared with callback-first VK setups

This repo is designed for the fastest stable first run:

- no tunnel
- no webhook secret
- no callback confirmation code
- no callback URL drift

That makes it much closer to a "few clicks and it works" setup for ordinary
OpenClaw users.

## Compared with minimal VK long-poll plugins

This repo goes beyond simple DM-only delivery:

- direct messages and group chats
- pairing and allowlist controls
- mention-gated group behavior
- buttons and paginated menus
- model and tool browsing
- text, images, and voice support
- VK-aware formatting fallbacks

## Product strengths

- Easier onboarding:
  Long Poll is the active path and the probe checks the most common VK mistakes
- Better mobile UX:
  model, command, and tool menus are button-first
- Better group support:
  the same plugin supports DMs and group chats with separate policy controls
- Better operational reliability:
  there is no public ingress to keep alive for the main path

## Archived instead of deleted

Callback work is intentionally archived rather than removed, so the product can
return to a richer server-side transport later without contaminating the main
user path today.
