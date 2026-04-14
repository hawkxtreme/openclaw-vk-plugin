# Next Steps

## Current status

The standalone long-poll-first repo is already in a strong state:

- published on `main`
- install flow works from a prepared local bundle through `plugins.load.paths`
- standalone Docker runtime was verified live in VK
- button-first menu flow works
- plain text chat still works after menu interactions
- mention-gated group chat commands now work live on Long Poll

The highest-value work left is product polish and final coverage, not broad
architecture changes.

## Priority 1: Finish media live verification

Goal: prove that the standalone plugin handles the most important real VK media
scenarios, not only text and menus.

Verify:

- inbound image message
- inbound voice message
- outbound image or file send when scopes allow it

Done when:

- a real VK DM image is understood end-to-end
- a real VK DM voice message is understood end-to-end
- at least one outbound media reply path is confirmed live

## Priority 2: Final security and review pass

Goal: make the repo easier to trust before wider use.

Work:

- targeted code review of the standalone repo diff from the last stable point
- targeted security review of VK token handling, local file/media paths, and
  install behavior
- verify docs do not encourage unsafe config shortcuts

Done when:

- review findings are either fixed or explicitly documented
- no new risky install or token-handling issues are open

## Priority 3: Docker polish for ordinary users

Goal: reduce surprise for users who just want the plugin to work quickly.

Work:

- document the `plugins.load.paths` install path clearly
- explain the misleading duplicate-plugin warning briefly
- decide whether a dedicated image path is worth adding later

Done when:

- a user can follow the load-path setup without guesswork
- Docker instructions are copy-paste-friendly and short

## Priority 4: Release polish

Goal: make the repo ready for broader sharing without more hidden work.

Work:

- final doc cleanup
- verify `corepack pnpm test`
- verify `corepack pnpm typecheck`
- verify prepared install flow again from a clean checkout

Done when:

- docs are internally consistent
- verification commands are green
- the repo can be handed to another user without extra tribal knowledge

## Explicit non-goals for the next iteration

These should stay out of the main delivery path unless priorities change:

- callback transport revival
- tunnel-first onboarding
- wide feature refactors unrelated to standalone long poll
- broad OpenClaw core changes

## Recommended execution order

1. Media live verification
2. Security and code review pass
3. Docker/docs polish
4. Final verification and release polish
