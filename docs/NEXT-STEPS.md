# Next Steps

## Current status

The standalone long-poll-first repo is already in a strong state:

- published on `main`
- install flow works from a prepared local bundle through `plugins.load.paths`
- standalone Docker runtime was verified live in VK
- standalone Docker or VK smoke now has a repo-owned wrapper that rebuilds the
  image and can purge conflicting local OpenClaw containers
- release and publish now have dedicated repo scripts instead of an ad hoc
  manual checklist
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

## Priority 3: Media UX polish for ordinary users

Goal: make attachment handling feel more specific and less generic in real VK
chats.

Work:

- improve the user-facing fallback reply for image versus audio or voice
- confirm outbound media again after the latest Long Poll UX work
- keep the live-smoke wrapper aligned with the real VK verification steps

Done when:

- image versus audio replies are clearer to end users
- live verification still confirms the same attachment behavior after changes

## Priority 4: Release polish

Goal: make the repo ready for broader sharing without more hidden work.

Work:

- decide whether to publish the first public npm package now or hold for one
  more live media pass
- keep the version and release notes aligned with the actual published bar
- optionally add a small publish checklist to the GitHub release description

Done when:

- the package is published on npm or intentionally held with a clear reason
- release notes and the repo scripts point to the same verification bar

## Explicit non-goals for the next iteration

These should stay out of the main delivery path unless priorities change:

- callback transport revival
- tunnel-first onboarding
- wide feature refactors unrelated to standalone long poll
- broad OpenClaw core changes

## Recommended execution order

1. Media live verification
2. Security and code review pass
3. Media UX polish
4. Final publish decision
