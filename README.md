# OpenClaw VK Plugin

Standalone VK channel plugin for OpenClaw.

## English

### What this repo is

This repository packages the VK channel as a separate plugin repo with a
`long-poll-first` delivery path:

- no public tunnel in the normal setup
- no webhook secret in the normal setup
- direct messages and group chats
- buttons, media, and pairing or allowlist policies

The active product path is Long Poll only. Callback transport work is archived
on a separate branch and is not part of the recommended setup.

### Why use it

- Easier first run:
  no tunnel, webhook secret, or callback confirmation code
- Better VK coverage:
  direct messages, group chats, buttons, media, and mention-gated groups
- Better OpenClaw fit:
  plugin metadata, setup, status, probe, and security contract follow the
  OpenClaw plugin SDK shape
- Better usability:
  command, model, and tool menus are button-first instead of relying on users
  to remember commands on mobile

### Quick start

#### 1. Prepare the VK community

In VK community settings:

1. Enable community messages.
2. Create a community access token.
3. Grant at least these scopes:
   - `messages`
   - `manage`
4. Grant these too if you want outbound media:
   - `photos`
   - `docs`
5. Enable **Bots Long Poll API**.
6. Enable these Long Poll event types:
   - `message_new`
   - `message_allow`
   - `message_deny`
   - `message_event`
7. If you want group chats, allow the community to be added to chats.

VK references:

- `https://dev.vk.com/ru/api/bots-long-poll/getting-started`
- `https://dev.vk.com/ru/method/groups.setLongPollSettings`
- `https://dev.vk.com/ru/method/messages.send`

#### 2. Install the plugin

From a local checkout:

```bash
openclaw plugins install ./path/to/openclaw-vk-plugin
openclaw plugins enable vk
```

After publishing to npm:

```bash
openclaw plugins install @openclaw/vk
openclaw plugins enable vk
```

#### 3. Configure OpenClaw

Add VK to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "vk": {
      "enabled": true,
      "groupId": 123456789,
      "accessToken": "vk1.a...",
      "transport": "long-poll",
      "dmPolicy": "pairing"
    }
  }
}
```

#### 4. Start and verify

Restart the gateway:

```bash
openclaw gateway restart
```

Run a probe:

```bash
openclaw channels status --json --probe
```

Then message the VK bot. If `dmPolicy` is `pairing`, approve the first pairing
request:

```bash
openclaw pairing approve vk <CODE>
```

### What the probe should catch

The Long Poll probe is expected to catch these common mistakes:

- invalid or revoked token
- wrong `groupId`
- Bots Long Poll API disabled in VK
- required Long Poll events not enabled

If outbound delivery fails later, the most common VK causes are:

- missing user permission to receive messages
- invalid keyboard payload
- disabled chat-bot settings for chats
- inaccessible or closed chat
- missing `photos` or `docs` scopes for media

### Product scope

Current scope:

- Long Poll as the default user path
- direct messages
- group chats
- model and tool command menus
- outbound text and media
- pairing and allowlist controls

Archived for later:

- Callback API transport
- webhook-specific deployment workflows

### Docs

- [Installation](./docs/INSTALL.md)
- [Configuration](./docs/CONFIGURATION.md)
- [Advantages](./docs/ADVANTAGES.md)
- [Verification](./docs/LIVE-VERIFICATION.md)

### Development

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
```

The package expects a compatible `openclaw` version as a peer dependency.

## Русский

### Что это за репозиторий

Это отдельный репозиторий VK-плагина для OpenClaw с основным сценарием
`long-poll-first`:

- без публичного туннеля в обычной настройке
- без webhook secret в обычной настройке
- с поддержкой личных сообщений и групповых чатов
- с кнопками, медиа и политиками pairing или allowlist

Основной продуктовый путь сейчас это только Long Poll. Работа по Callback
архивирована в отдельной ветке и не входит в рекомендуемый сценарий.

### Зачем использовать

- Проще первый запуск:
  не нужны tunnel, webhook secret и callback confirmation code
- Лучше покрытие VK:
  личка, групповые чаты, кнопки, медиа и mention-gated группы
- Лучше интеграция с OpenClaw:
  метаданные плагина, setup, status, probe и security contract соответствуют
  модели OpenClaw plugin SDK
- Лучше UX:
  меню команд, моделей и tools сделаны через кнопки, а не через запоминание
  команд вручную на телефоне

### Быстрый старт

#### 1. Подготовьте сообщество VK

В настройках сообщества VK:

1. Включите сообщения сообщества.
2. Создайте access token сообщества.
3. Дайте минимум такие scope:
   - `messages`
   - `manage`
4. Для отправки медиа добавьте:
   - `photos`
   - `docs`
5. Включите **Bots Long Poll API**.
6. Включите события:
   - `message_new`
   - `message_allow`
   - `message_deny`
   - `message_event`
7. Если нужны групповые чаты, разрешите добавлять сообщество в беседы.

Ссылки по VK API:

- `https://dev.vk.com/ru/api/bots-long-poll/getting-started`
- `https://dev.vk.com/ru/method/groups.setLongPollSettings`
- `https://dev.vk.com/ru/method/messages.send`

#### 2. Установите плагин

Из локального checkout:

```bash
openclaw plugins install ./path/to/openclaw-vk-plugin
openclaw plugins enable vk
```

После публикации в npm:

```bash
openclaw plugins install @openclaw/vk
openclaw plugins enable vk
```

#### 3. Настройте OpenClaw

Добавьте VK в `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "vk": {
      "enabled": true,
      "groupId": 123456789,
      "accessToken": "vk1.a...",
      "transport": "long-poll",
      "dmPolicy": "pairing"
    }
  }
}
```

#### 4. Запустите и проверьте

Перезапустите gateway:

```bash
openclaw gateway restart
```

Запустите probe:

```bash
openclaw channels status --json --probe
```

После этого напишите боту в VK. Если `dmPolicy` выставлен в `pairing`, сначала
подтвердите pairing:

```bash
openclaw pairing approve vk <CODE>
```

### Что должен ловить probe

Long Poll probe должен находить типовые ошибки:

- неверный или отозванный token
- неправильный `groupId`
- отключённый Bots Long Poll API в VK
- не включены обязательные Long Poll events

Если потом не проходит outbound delivery, самые частые причины такие:

- пользователь не разрешил сообщения от сообщества
- невалидный keyboard payload
- отключены настройки чат-бота для бесед
- чат недоступен или закрыт
- нет `photos` или `docs` scope для медиа

### Границы продукта

Текущий scope:

- Long Poll как основной пользовательский путь
- личные сообщения
- групповые чаты
- меню команд, моделей и tools
- исходящие текст и медиа
- pairing и allowlist

Отложено на потом:

- transport через Callback API
- deployment-сценарии, завязанные на webhook

### Документация

- [Installation](./docs/INSTALL.md)
- [Configuration](./docs/CONFIGURATION.md)
- [Advantages](./docs/ADVANTAGES.md)
- [Verification](./docs/LIVE-VERIFICATION.md)

### Разработка

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
```

Пакет ожидает совместимую версию `openclaw` как peer dependency.

## License

MIT
