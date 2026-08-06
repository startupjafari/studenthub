# StudentHub — описание проекта (контекст для нейросети)

> Этот файл — самодостаточное описание проекта. Скопируй его целиком и вставь в чат с ИИ,
> чтобы задавать вопросы по архитектуре, коду и возможностям StudentHub.

## 1. Что это

**StudentHub** — закрытая многоролевая образовательная веб‑платформа для университетов
(аналог «внутренней соцсети + LMS + мессенджера»). Регистрация только по инвайтам
(приглашениям), публичной саморегистрации нет.

- **8 ролей**: `PLATFORM_ADMIN`, `PLATFORM_MODERATOR`, `UNIVERSITY_ADMIN`,
  `UNIVERSITY_MODERATOR`, `DEAN` (декан), `TEACHER` (преподаватель), `STAROSTA` (староста),
  `STUDENT` (студент).
- **Академическая иерархия**: University → Faculty → Group → (Room для аудиторий).
  Пользователь привязан к вузу/факультету/группе (scope).
- **Зоны/дашборды** по ролям: у каждой роли свой раздел (`/`, `/teacher`, `/dean`,
  `/starosta`, `/university-admin`, `/platform-admin`, `/moderator/*`).

## 2. Технологический стек

**Монорепо**: Turborepo + pnpm workspaces.

- **Backend** (`apps/api`): NestJS 11 + Fastify 5, Prisma 6 (PostgreSQL), Zod + `nestjs-zod`
  для DTO/валидации, BullMQ 5 (очереди на Redis), socket.io 4 (WebSocket), MinIO 8
  (S3‑совместимое хранилище файлов), pino (логи с редактированием секретов), helmet,
  `@nestjs/throttler` (rate limiting), bcrypt (хэш паролей, cost 12), JWT (access) +
  opaque refresh‑токены.
- **Frontend** (`apps/web`): Next.js 15 (App Router) + React 19, архитектура **FSD**
  (Feature‑Sliced Design), Tailwind CSS + shadcn/ui, Redux Toolkit (auth/UI‑состояние),
  TanStack Query 5 (серверное состояние, cursor‑пагинация), React Hook Form + Zod,
  socket.io‑client, next-intl (i18n: ru/kk/en), next-themes (тёмная/светлая тема),
  chart.js + react-chartjs-2 (графики), react-markdown + KaTeX (Markdown/LaTeX в чате),
  PWA (`@ducanh2912/next-pwa`).
- **Общие пакеты** (`packages/`): `shared-types` (типы, enum Role), `shared-schemas`
  (Zod‑схемы — единый контракт API↔формы), `shared-config` (константы, лимиты, локали),
  `shared-utils`.

## 3. Структура монорепо

```
apps/
  api/    — NestJS backend (модули в src/modules)
  web/    — Next.js frontend (FSD: app/ shared/ entities/ features/ widgets/ views/)
packages/
  shared-types / shared-schemas / shared-config / shared-utils
prisma/
  schema/       — многофайловая Prisma‑схема (01-users … 12-materials)
  migrations/   — применённые миграции (не редактировать вручную)
docs/
  PROJECT.md, BACKEND_RULES.md, FRONTEND_RULES.md, IMPLEMENTATION_PLAN.md, RUNBOOK.md
```

**Backend‑модули** (`apps/api/src/modules`): auth, users, invites, universities, faculties,
groups, rooms, schedules, applications, posts, events, chats, complaints, materials,
notifications, files, email, cleanup, health.

**Frontend‑слои** (`apps/web/src`): `app` (роутинг App Router), `shared` (api‑инстанс,
ui‑kit, config, lib, realtime), `entities` (chat, user, …), `features`, `widgets`
(app-shell, chat-window, feed-list, …), `views` (экраны по разделам).

## 4. Модель данных (Prisma, PostgreSQL)

Основные сущности: **User, RefreshToken, Invite**; **University, Faculty, Group, Room**;
**Schedule, Pair, ScheduleChange** (расписание); **ApplicationRequest,
ApplicationStatusHistory** (заявки, конечный автомат статусов); **Post, Reaction, Comment**
(лента); **Event, EventParticipant** (события); **Chat, ChatMember, Message,
MessageReaction** (чаты); **Complaint** (жалобы/модерация); **Material** (учебные
материалы); **File** (метаданные объектов в MinIO); **Notification, NotificationSettings**;
**AuditLog** (аудит доступа к чатам по жалобам и т.п.).

Общие правила данных: soft‑delete (`deletedAt`) где применимо; FK‑индексы; scope‑поля
(universityId/facultyId/groupId) с `onDelete: Restrict` на пользователе.

## 5. Аутентификация и доступ

- **JWT access** (15 мин) в памяти (Redux, не в localStorage), **refresh** — opaque‑токен
  в httpOnly‑cookie; ротация с family‑цепочкой (повторное использование рвёт цепочку).
- 3 уровня guard'ов: глобальный `JwtAuthGuard` → `RolesGuard` (роль из JWT, не из тела) →
  `ScopeGuard` + сервис‑проверки scope.
- Формат ответа API — единый envelope `{ success, data, meta }`; ошибки —
  `{ success:false, error:{ code, message }, statusCode }`. Фронт‑axios разворачивает
  `data` и сохраняет `meta` (cursor/hasNext/total).
- `sh_role` — нечувствительная cookie для ролевого редиректа в middleware (реальная
  авторизация — на сервере).
- Rate limiting: login 5/15мин, register‑by‑invite 3/час и т.п. (in‑memory throttler).

## 6. Реалтайм, очереди, файлы

- **WebSocket** (socket.io, один сервер): `RealtimeGateway` — handshake‑аутентификация по
  JWT, авто‑вход в комнаты `user:{id}`, `group:{id}`, `university:{id}`, presence
  (онлайн/оффлайн по счётчику соединений, событие `presence:changed`). `ChatGateway` —
  чат‑события на том же соединении.
- **Очереди** (BullMQ/Redis): `notifications` и `email`. Уведомления создаются джобой,
  рассылаются по WS + email (в dev письма только логируются). `CleanupService` (cron):
  протухшие инвайты, напоминания о событиях, чистка осиротевших файлов.
- **Файлы** (MinIO): буферная загрузка через API (лимит 10 МБ; больше — прямой presigned),
  тип по magic‑bytes, приватные бакеты, presigned‑GET (TTL 15 мин). Бакеты: avatars,
  posts‑media, applications, materials, `chat-media` и др.

## 7. Возможности чата (проработаны детально)

Модуль `chats` (REST + WebSocket) в стиле Telegram:

- **Сообщения**: текст по WS (`message:send/edit/delete/read`, typing), история —
  cursor‑пагинация; редактирование доступно 10 минут после отправки (лимит
  `MESSAGE_EDIT_WINDOW_MS`).
- **Вложения**: отправка через REST multipart `POST /chats/:id/messages` (бакет
  `chat-media`), presigned‑доступ по членству. Картинки/видео — полноэкранный просмотрщик
  (лайтбокс) с поворотом, навигацией, скачиванием, подписью. Файлы — карточка (иконка +
  имя + размер). Голосовые — запись через `MediaRecorder`, плеер с волной и прогрессом
  (одновременно играет только одно).
- **Ответы (reply)**: цитата в пузыре, клик — переход к оригиналу с подсветкой.
- **Реакции**: эмодзи‑набор `CHAT_REACTION_EMOJIS`; один пользователь — одна реакция на
  сообщение (новая заменяет прежнюю).
- **Пересылка**: `POST /chats/:id/forward` — копирует текст и вложения (объект в MinIO
  копируется на новый ключ).
- **Закрепление**: бар закреплённых с навигацией ◀▶ и переходом к сообщению.
- **Поиск**: `GET /chats/search?q=&chatId=` (в чате или по всем чатам участника).
- **Уведомления чата (mute)**: `POST|DELETE /chats/:id/mute` — заглушённые исключаются из
  рассылки уведомлений.
- **Статусы своих сообщений**: ✓ отправлено, ✓✓ доставлено, ✓✓ (синие) прочитано
  (watermark по `lastReadAt` других участников + WS `message:read`).
- **Группы**: создание своей группы (название + мультивыбор участников), окно управления
  группой (участники с ролью и онлайн‑статусом, добавление, выход), приглашение по ссылке
  `POST /chats/:id/join` + страница `/join-chat/[id]`.
- **@‑упоминания**: автодополнение участников по `@` в поле ввода.
- **Список чатов**: аватары с цветом, превью с отправителем, время, бейдж непрочитанного,
  иконка mute.

WS‑события сервер→клиент: `message:new/updated/deleted/pinned/unpinned/reaction`,
`message:read`, `typing:*`, `presence:changed`.

## 8. Инфраструктура и запуск (dev)

- Общие контейнеры: PostgreSQL, Redis, MinIO (docker compose в `docker/`).
- Порты: API `http://localhost:3001` (глобальный префикс `/api/v1`), web
  `http://localhost:3000`. Swagger — `/api/docs` (только dev).
- CORS: whitelist origin + credentials, методы GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS.
- Команды:
  ```bash
  pnpm install
  pnpm dev                         # api:3001 + web:3000
  pnpm --filter api build && node apps/api/dist/main.js
  pnpm --filter web build && pnpm --filter web start
  pnpm --filter api test           # unit (jest)
  pnpm --filter api test:e2e
  pnpm --filter api prisma migrate deploy
  ```
- Миграции: генерируются через `prisma migrate diff` c отдельной shadow‑БД
  (`studenthub_shadow`), затем `migrate deploy`. `prisma.config.ts` отключает авто‑загрузку
  `.env` (переменные подставляются явно).

## 9. Конвенции и «стоп‑точки»

Правила в `docs/BACKEND_RULES.md` / `docs/FRONTEND_RULES.md` приоритетнее общих скиллов.
Definition of Done: перед «готово» запускаются lint/test/build (+e2e) с показом вывода.

**Стоп‑точки (требуют явного подтверждения)**: применение миграции к непустой БД (сначала
показать SQL); добавление зависимости; изменение схем в `packages/shared-schemas`
(ломает контракт); изменение guard'ов / формата ответа / списка публичных эндпоинтов;
любое действие с риском потери данных.

**Абсолютные запреты**: секреты в коде/гите; отключение guard'ов/валидации/helmet/throttler;
роль или scope из тела запроса вместо JWT; `passwordHash`/токены в ответах и логах; токены в
localStorage; `findMany()` без `take`; публичный эндпоинт, создающий пользователя в обход
инвайта; `db push`/`migrate reset`/`--accept-data-loss` на не‑тестовой БД; хардкод строк
вместо i18n‑ключей.

## 10. Статус

Функционально закрыты фазы Ф0–Ф13: каркас, auth+инвайты, файлы/MinIO, уведомления/очереди/WS,
профили, академическая иерархия, расписание, заявки, посты/лента, чаты, события,
жалобы/модерация, админ‑панели (GET /users, все nav‑экраны, materials, графики) и
релиз‑полировка (i18n‑аудит, security, FK‑индексы, a11y, prod‑инфра Docker/nginx, PWA).
Отложено на deploy‑time: Playwright E2E, Push‑уведомления, Sentry (нужны ключи/браузеры).
Поверх этого — расширенный Telegram‑подобный чат (см. §7).
