[English](README.md) | Русский

# OpenClaw VK Plugin

Отдельный VK-плагин для OpenClaw.

## Что это за репозиторий

Этот репозиторий выносит VK-канал в отдельный плагин со сценарием
`long-poll-first`:

- без публичного туннеля в обычной установке
- без webhook secret в обычной установке
- с поддержкой личных сообщений и групповых чатов
- с кнопками, медиа и политиками pairing или allowlist

Сейчас активный продуктовый путь основан только на Long Poll. Работа по
Callback API вынесена в отдельную архивную ветку и не входит в рекомендуемую
схему запуска.

## Зачем его использовать

- Проще первый запуск:
  не нужны tunnel, webhook secret и callback confirmation code
- Лучше покрытие VK:
  личка, групповые чаты, кнопки, медиа и группы с обязательным mention
- Лучше интеграция с OpenClaw:
  метаданные плагина, setup, status, probe и security contract соответствуют
  модели OpenClaw plugin SDK
- Лучше UX:
  меню команд, моделей и tools сделаны через кнопки, а не через запоминание
  команд на телефоне

## Быстрый старт

### 1. Подготовьте сообщество VK

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
6. Включите события Long Poll:
   - `message_new`
   - `message_allow`
   - `message_deny`
   - `message_event`
7. Если нужны групповые чаты, разрешите добавлять сообщество в беседы.

Ссылки по VK API:

- `https://dev.vk.com/ru/api/bots-long-poll/getting-started`
- `https://dev.vk.com/ru/method/groups.setLongPollSettings`
- `https://dev.vk.com/ru/method/messages.send`

### 2. Установите плагин

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

### 3. Настройте OpenClaw

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

### 4. Запустите и проверьте

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

## Что должен ловить probe

Long Poll probe должен находить типовые ошибки:

- неверный или отозванный token
- неправильный `groupId`
- отключенный Bots Long Poll API в VK
- не включенные обязательные Long Poll events

Если потом не проходит outbound delivery, самые частые причины такие:

- пользователь не разрешил сообщения от сообщества
- невалидный keyboard payload
- отключены настройки чат-бота для бесед
- чат недоступен или закрыт
- нет `photos` или `docs` scope для медиа

## Границы продукта

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

## Документация

- [Installation](./docs/INSTALL.md)
- [Configuration](./docs/CONFIGURATION.md)
- [Advantages](./docs/ADVANTAGES.md)
- [Verification](./docs/LIVE-VERIFICATION.md)

## Разработка

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
```

Пакет ожидает совместимую версию `openclaw` как peer dependency.

## License

MIT
