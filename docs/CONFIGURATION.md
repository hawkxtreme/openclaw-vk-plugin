# Configuration

## Minimal config

```json
{
  "channels": {
    "vk": {
      "enabled": true,
      "groupId": 237442417,
      "accessToken": "vk1.a....",
      "transport": "long-poll",
      "dmPolicy": "pairing"
    }
  }
}
```

Key fields:

- `groupId`: VK community id
- `accessToken`: VK community token
- `transport`: keep this as `long-poll`
- `dmPolicy`: `open`, `allowlist`, `pairing`, or `disabled`
- `groupPolicy`: `open`, `allowlist`, or `disabled`
- `allowFrom`: allowed DM senders when DM allowlist is used
- `groupAllowFrom`: allowed group-chat senders when group allowlist is used

## Group-chat controls

```json
{
  "channels": {
    "vk": {
      "enabled": true,
      "groupId": 237442417,
      "accessToken": "vk1.a....",
      "transport": "long-poll",
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist",
      "groupAllowFrom": [17965322],
      "groups": {
        "*": {
          "requireMention": true
        },
        "2000000123": {
          "enabled": true,
          "allowFrom": [17965322, 98765432],
          "requireMention": false
        }
      }
    }
  }
}
```

Use this when:

- the bot is present in multiple chats
- only some chats or users should be allowed
- you want mention-gated group replies by default

## Multi-account layout

```json
{
  "channels": {
    "vk": {
      "defaultAccount": "prod",
      "accounts": {
        "prod": {
          "enabled": true,
          "groupId": 237442417,
          "accessToken": "vk1.a....",
          "transport": "long-poll"
        },
        "staging": {
          "enabled": true,
          "groupId": 237442418,
          "accessToken": "vk1.a....",
          "transport": "long-poll",
          "dmPolicy": "open"
        }
      }
    }
  }
}
```

## VK-side requirements

- community messages enabled
- Bots Long Poll API enabled
- required Long Poll events enabled
- the community already added to group chats you want to use
- `photos` or `docs` scopes present when sending media

## Security notes

- Do not commit VK tokens to git
- Prefer a test community for live verification
- Rotate the token if it was ever pasted into chat or logs
- Treat `allowFrom` and `groupAllowFrom` as the first line of defense for high-risk chats

## Archived transport note

The active product path accepts only `long-poll`. Callback transport is kept on
an archive branch for later work and is not part of the supported public setup.
