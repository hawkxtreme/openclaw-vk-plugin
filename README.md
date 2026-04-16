Русский | [English](README.en.md)

# OpenClaw VK Plugin

Отдельный VK-плагин для OpenClaw. Рекомендуемый путь: VK Long Poll.

## Быстрый старт

Сначала подготовьте сообщество VK по короткой пошаговой инструкции:

- [Настройка сообщества VK](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/VK-COMMUNITY-SETUP.md)

Потом выполните:

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk

openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 123456789
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing

openclaw gateway restart
openclaw channels status --json --probe
```

Если `probe.ok=true`, канал уже поднят.

## Первый запуск в свежем Docker

- Если после `npm i -g openclaw@latest` команда `openclaw` не появилась в `PATH`, используйте `npx openclaw`
- Если это самый первый запуск OpenClaw, сначала задайте `npx openclaw config set gateway.mode local`
- Если `gateway restart` отвечает `Gateway service disabled`, просто запустите `npx openclaw gateway` в foreground

## Если нужны групповые чаты

Самый простой вариант:

```bash
openclaw config set channels.vk.groupPolicy open
openclaw config set channels.vk.groups.*.requireMention true
```

`requireMention=true` рекомендуется для шумных бесед. Если хотите общение без упоминания бота, выставьте `false`.

## Что обязательно включить в VK

- `Сообщения сообщества`
- `Возможности ботов`
- `Разрешать добавлять сообщество в чаты`, если нужны беседы
- `Long Poll API`
- Типы событий: `message_new`, `message_event`, `message_allow`, `message_deny`
- Права токена: `управление сообществом`, `сообщения сообщества`
- Для медиа еще `фотографии` и `файлы`

Точные URL и названия экранов собраны здесь:

- [Подробная настройка сообщества VK](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/VK-COMMUNITY-SETUP.md)

## Нормальные предупреждения

- duplicate warning для plugin id `vk` после `plugins install` ожидаем
- `openclaw config set plugins.allow.0 vk` убирает warning про доверие к внешнему плагину

## Документация

- [Настройка сообщества VK](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/VK-COMMUNITY-SETUP.md)
- [Установка](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/INSTALL.md)
- [Конфигурация](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/CONFIGURATION.md)
- [Проверка](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/LIVE-VERIFICATION.md)
- [Преимущества](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/ADVANTAGES.md)
- [Релизы и публикация](https://github.com/hawkxtreme/openclaw-vk-plugin/blob/main/docs/RELEASING.md)

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
