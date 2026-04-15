Русский | [English](README.en.md)

# OpenClaw VK Plugin

Отдельный VK-плагин для OpenClaw с long-poll-first запуском, кнопочными меню,
групповыми чатами и поддержкой медиа.

## Главное

Сейчас самый простой путь установки уже не через git checkout, а через npm:

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 237442417
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
openclaw gateway restart
openclaw channels status --json --probe
```

Это уже проверено на реальном CLI:

- `openclaw plugins install openclaw-vk-plugin` ставит standalone plugin из npm
- plugin ставится как глобальный extension и override-ит bundled `vk`
- отдельный `plugins.load.paths` для обычной npm-установки больше не нужен

## Что это за репозиторий

Этот репозиторий выносит VK-канал в отдельный standalone-плагин со сценарием
`long-poll-first`:

- без публичного туннеля в обычной установке
- без webhook secret в обычной установке
- с поддержкой личных сообщений и групповых чатов
- с кнопками, медиа и политиками pairing или allowlist

Активный продуктовый путь сейчас только один: VK Long Poll. Callback API
считается архивной веткой и не входит в рекомендуемый сценарий запуска.

## Почему этот путь лучше

- Проще первый запуск:
  не нужны git checkout, `plugins.load.paths`, tunnel и callback secret
- Короче путь для обычного пользователя:
  `plugins install` из npm, `plugins enable`, задать VK config и сделать probe
- Лучше покрытие VK:
  личка, групповые чаты, кнопки, медиа и группы с обязательным mention
- Лучше UX:
  меню команд, моделей и tools построены вокруг кнопок, а не памяти о slash-командах

## Быстрый запуск

### Bash

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk

openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 237442417
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing

openclaw gateway restart
openclaw channels status --json --probe
```

### PowerShell

```powershell
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk

openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 237442417
openclaw config set channels.vk.accessToken "vk1.a.REPLACE_ME"
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing

openclaw gateway restart
openclaw channels status --json --probe
```

Потом напишите боту в VK. Если `dmPolicy` выставлен в `pairing`, подтвердите
первый pairing-код:

```bash
openclaw pairing approve vk <CODE>
```

## Важная заметка про duplicate plugin warning

После `plugins install` OpenClaw может показать предупреждение про duplicate
plugin id для `vk`. Для npm-установки это ожидаемо:

- bundled `vk` остается в host OpenClaw
- установленный npm plugin регистрируется как global plugin
- global plugin получает приоритет и override-ит bundled `vk`

Это не ошибка установки, а нормальное поведение текущего host precedence path.

## Подробности ручной настройки

### 1. Подготовьте сообщество VK

В настройках сообщества VK:

1. Включите сообщения сообщества.
2. Создайте access token сообщества.
3. Дайте минимум такие scope:
   - `messages`
   - `manage`
4. Для исходящей отправки медиа добавьте:
   - `photos`
   - `docs`
5. Включите **Bots Long Poll API**.
6. Включите Long Poll events:
   - `message_new`
   - `message_allow`
   - `message_deny`
   - `message_event`
7. Если нужны групповые чаты, разрешите добавлять сообщество в беседы.

Ссылки по VK API:

- `https://dev.vk.com/ru/api/bots-long-poll/getting-started`
- `https://dev.vk.com/ru/method/groups.setLongPollSettings`
- `https://dev.vk.com/ru/method/messages.send`

### 2. Установите и включите плагин

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
```

Плагин ставится в глобальные OpenClaw extensions и записывается в
`plugins.installs.vk`.

### 3. Настройте OpenClaw

Самый быстрый non-interactive путь:

```bash
openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 123456789
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
```

Эквивалент через `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "vk": {
        "enabled": true
      }
    }
  },
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

```bash
openclaw gateway restart
openclaw channels status --json --probe
```

Если `dmPolicy` выставлен в `pairing`, подтвердите первый pairing-код:

```bash
openclaw pairing approve vk <CODE>
```

## Локальный checkout нужен только для разработки

Если вы хотите править код плагина локально, а не просто использовать его,
тогда уже нужен git checkout:

```bash
git clone https://github.com/hawkxtreme/openclaw-vk-plugin.git
cd openclaw-vk-plugin

node scripts/prepare-install-dir.mjs
openclaw config set plugins.load.paths.0 "$(pwd)/.artifacts/install/vk"
openclaw plugins enable vk
```

Этот путь полезен для:

- локальной разработки
- отладки до публикации новой версии в npm
- live-smoke через repo wrapper

Для обычной установки он уже не основной.

## Docker и live-smoke

Для повторяемого standalone Docker или VK smoke с автоматическим rebuild image
используйте wrapper из репозитория:

```bash
git clone https://github.com/hawkxtreme/openclaw-vk-plugin.git
cd openclaw-vk-plugin
npm run live-smoke -- --group https://vk.com/club123456789 --purge-conflicts
```

Что делает wrapper:

- готовит `.artifacts/install/vk`
- по умолчанию rebuild-ит host OpenClaw Docker image
- поднимает isolated smoke stack
- умеет остановить и удалить старые локальные OpenClaw контейнеры, чтобы не
  было duplicate consumers на одном VK token
- выполняет `channels status --json --probe` внутри свежего Docker runtime

## Что должен ловить probe

Long Poll probe должен находить типовые ошибки:

- неверный или отозванный token
- неправильный `groupId`
- отключенный Bots Long Poll API в VK
- не включенные обязательные Long Poll events

Если потом ломается outbound delivery, самые частые причины такие:

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
- исходящий текст и медиа
- pairing и allowlist

Отложено на потом:

- transport через Callback API
- deployment-сценарии, завязанные на webhook

## Документация

- [Установка](./docs/INSTALL.md)
- [Конфигурация](./docs/CONFIGURATION.md)
- [Преимущества](./docs/ADVANTAGES.md)
- [Проверка](./docs/LIVE-VERIFICATION.md)
- [Релизы и публикация](./docs/RELEASING.md)

## Разработка

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
npm run release:check
```

Пакет ожидает совместимую версию `openclaw` как peer dependency.

## License

MIT
