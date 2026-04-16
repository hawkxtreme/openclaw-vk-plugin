# Настройка сообщества VK

Проверено на актуальном VK Web 16 апреля 2026.

Цель этой инструкции: быстро подготовить сообщество VK для OpenClaw без
Callback API, webhook URL и туннелей. Рекомендуемый путь только один: Long
Poll.

## Быстрые ссылки

- Создать сообщество: `https://vk.com/groups_create`
- Основные настройки: `https://vk.com/club<GROUP_ID>?act=edit`
- Сообщения сообщества: `https://vk.com/club<GROUP_ID>?act=messages`
- Настройки для бота: `https://vk.com/club<GROUP_ID>?act=messages&tab=bots`
- Ключи доступа: `https://vk.com/club<GROUP_ID>?act=tokens`
- Long Poll API: `https://vk.com/club<GROUP_ID>?act=longpoll_api`
- Типы событий Long Poll: `https://vk.com/club<GROUP_ID>?act=longpoll_api_types`
- Чаты сообщества: `https://vk.com/club<GROUP_ID>?act=chats`

VK периодически переставляет пункты меню, но эти admin URL обычно остаются
самым коротким путем.

## 1. Создайте сообщество

1. Откройте `https://vk.com/groups_create`
2. Укажите название
3. Выберите тематику
4. Нажмите `Создать сообщество`

Для OpenClaw не нужен отдельный сервер, Mini App или Callback URL.

## 2. Найдите `groupId`

OpenClaw нужен числовой `groupId`.

Самый простой способ:

- откройте любую admin-ссылку сообщества
- если URL выглядит как `https://vk.com/club237442417?act=edit`, то `groupId`
  равен `237442417`

Даже если у сообщества уже есть красивый короткий адрес, числовой id все равно
виден в admin URL.

## 3. Включите сообщения сообщества

Откройте:

- `https://vk.com/club<GROUP_ID>?act=messages`

Что выставить:

- `Сообщения сообщества`: `Включены`
- `Приветствие`: по желанию
- `Виджет сообщений`: не обязателен

Без включенных сообщений OpenClaw не сможет нормально работать в личке.

## 4. Включите настройки для бота

Откройте:

- `https://vk.com/club<GROUP_ID>?act=messages&tab=bots`

Что выставить:

- `Возможности ботов`: `Включены`
- `Добавить кнопку "Начать"`: рекомендуется для более простого первого входа
- `Разрешать добавлять сообщество в чаты`: включить, если нужны групповые чаты

Если групповые чаты не нужны, последний пункт можно не включать.

## 5. Создайте access token

Откройте:

- `https://vk.com/club<GROUP_ID>?act=tokens`

Нажмите `Создать ключ` и дайте минимум такие права:

- `управление сообществом`
- `сообщения сообщества`

Если хотите, чтобы бот отправлял медиа, добавьте еще:

- `фотографии`
- `файлы`

После создания сохраните токен сразу. В OpenClaw он пойдет в
`channels.vk.accessToken`.

## 6. Включите Long Poll API

Откройте:

- `https://vk.com/club<GROUP_ID>?act=longpoll_api`

Что выставить:

- `Long Poll API`: `Включено`
- `Версия API`: текущая или последняя доступная

На 16 апреля 2026 в интерфейсе VK Web у нас была рабочая версия `5.199`.

## 7. Включите нужные типы событий

Откройте:

- `https://vk.com/club<GROUP_ID>?act=longpoll_api_types`

Минимально для OpenClaw включите:

- `Входящее сообщение` (`message_new`)
- `Действие с сообщением` (`message_event`)
- `Разрешение на получение` (`message_allow`)
- `Запрет на получение` (`message_deny`)

Можно оставить включенными и другие события. OpenClaw просто проигнорирует
лишнее.

## 8. Если нужны групповые чаты

На стороне VK:

- включите `Разрешать добавлять сообщество в чаты`
- откройте страницу сообщества и используйте кнопку `Добавить в чат`
- либо откройте `https://vk.com/club<GROUP_ID>?act=chats`

На стороне OpenClaw самый простой старт такой:

```bash
openclaw config set channels.vk.groupPolicy open
openclaw config set channels.vk.groups.*.requireMention true
```

`requireMention=true` рекомендуется для шумных бесед. Если хотите общение без
упоминания бота, выставьте `false`.

## 9. Минимальная настройка OpenClaw

После подготовки сообщества выполните:

```bash
openclaw plugins install openclaw-vk-plugin
openclaw plugins enable vk
openclaw config set plugins.allow.0 vk

openclaw config set channels.vk.enabled true
openclaw config set channels.vk.groupId 123456789
openclaw config set channels.vk.accessToken 'vk1.a.REPLACE_ME'
openclaw config set channels.vk.transport long-poll
openclaw config set channels.vk.dmPolicy pairing
```

Для первого запуска на чистом OpenClaw еще добавьте:

```bash
openclaw config set gateway.mode local
```

## 10. Первая проверка

1. Запустите gateway:

```bash
openclaw gateway restart
```

Если это свежий Docker или service-less окружение, используйте:

```bash
openclaw gateway
```

2. Выполните probe:

```bash
openclaw channels status --json --probe
```

3. Напишите боту в личку
4. Если `dmPolicy=pairing`, подтвердите первый pairing-код:

```bash
openclaw pairing approve vk <CODE>
```

## Что ломается чаще всего

- `probe.ok=false`
  Обычно это неверный токен, неверный `groupId` или выключенный Long Poll API
- Личка молчит
  Обычно выключены `Сообщения сообщества`
- Кнопки в личке не работают как надо
  Обычно выключены `Возможности ботов`
- Бот не отвечает в беседе
  Обычно забыли `Разрешать добавлять сообщество в чаты` или не включили
  `channels.vk.groupPolicy`
- Медиа не уходит
  Обычно у токена нет прав `фотографии` или `файлы`

## Полезные ссылки

- Bots Long Poll getting started:
  `https://dev.vk.com/ru/api/bots-long-poll/getting-started`
- `groups.getLongPollServer`:
  `https://dev.vk.com/ru/method/groups.getLongPollServer`
- `groups.setLongPollSettings`:
  `https://dev.vk.com/ru/method/groups.setLongPollSettings`
- `messages.send`:
  `https://dev.vk.com/ru/method/messages.send`
