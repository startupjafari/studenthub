# StudentHub — План реализации

> Пошаговый план для реализации силами агента (Claude Code / Codex) с человеком-ревьюером.
> Версия: 1.0 · Последнее обновление: 2026-07
> Связанные документы: `docs/PROJECT.md`, `docs/BACKEND_RULES.md`, `docs/FRONTEND_RULES.md`

---

## 0. Как работать по этому плану

### 0.1 Формат работы с агентом

1. **Одна задача = одна сессия агента = один PR.** Задачи имеют номера (`4.3`) — на них можно ссылаться напрямую.
2. Промпт агенту всегда начинается так:

```
Прочитай docs/PROJECT.md, docs/BACKEND_RULES.md (или FRONTEND_RULES.md)
и docs/IMPLEMENTATION_PLAN.md.
Выполни задачу <номер> — <название>.
Соблюдай Definition of Done из соответствующего файла правил.
Не выходи за границы задачи: не рефактори чужие модули, не добавляй зависимости
без обоснования, не трогай применённые миграции.
Перед тем как заявить о готовности — запусти линтер, тесты и сборку и покажи вывод.
```

3. **Стоп-точки.** Агент обязан остановиться и спросить человека перед: применением миграции к непустой БД, добавлением новой зависимости, изменением схемы в `packages/shared-schemas` (ломает контракт), изменением guard'ов или формата ответа API.
4. **Не отдавать агенту фазу целиком.** Фаза — это 5–15 задач; в одной сессии агент теряет контекст и начинает «дорисовывать» архитектуру. Отдавать по задаче, максимум по 2–3 связанным.
5. Каждая фаза заканчивается ручной проверкой человеком по чеклисту «Приёмка фазы».

### 0.2 Порядок зависимостей

```
Ф0 Каркас
 └─ Ф1 Auth + Инвайты          ← критический путь, ничего не работает без него
     ├─ Ф2 Файлы (MinIO)
     ├─ Ф3 Уведомления + очереди + cron
     └─ Ф4 Профили
         └─ Ф5 Академическая иерархия
             ├─ Ф6 Расписание        (нужны Ф3, Ф5)
             ├─ Ф7 Заявки            (нужны Ф2, Ф3, Ф5)
             ├─ Ф8 Посты и лента     (нужны Ф2, Ф3, Ф5)
             ├─ Ф9 Чаты + WebSocket  (нужны Ф2, Ф3)
             └─ Ф10 События          (нужны Ф3, Ф5)
                 └─ Ф11 Жалобы и модерация
                     └─ Ф12 Админ-панели и дашборды
                         └─ Ф13 Полировка, PWA, i18n, E2E → релиз v1.0
                             └─ Ф14 v2.0 (сторисы, аналитика, интеграции)
```

Ф2, Ф3, Ф4 можно вести параллельно после Ф1. Ф6–Ф10 параллелизуются между разными агентами/людьми, если Ф5 закрыта.

### 0.3 Оценки

Оценки даны в «сессиях агента» (одна сессия ≈ одна задача с ревью и правками), а не в человеко-днях: реальная скорость зависит от качества ревью.

### 0.4 Состояние работ (обновлено 2026-08-20)

Легенда: ✅ закрыто · 🚧 частично, остаток указан · ⬜ не начато.

| Фаза | Состояние | Что осталось |
|---|---|---|
| Ф0–Ф12 | ✅ | Функционал в проде; точечные доработки идут вне плана |
| Ф13 Полировка и релиз | 🚧 | См. колонку «Статус» в таблице фазы |
| Ф14 v2.0 | ⬜ | Не начата целиком |
| Ф15 Документы | ✅ | Модуль `documents` + экраны; `document-types`, `document-access` на месте |
| Ф16 Помещения и QR | ✅ | Из «возможных продолжений» сделаны ручной ввод кода и печать 4 на лист |
| Academic Core (`docs/ACADEMIC_CORE.md`, удалён как устаревший) | 🚧 | Задачи 1–16, 20–30 закрыты; 17–19 (AI) выведены из объёма; остаётся сквозной mobile-аудит старых экранов |
| Эпик «Чаты» (§-нумерация брифа) | 🚧 | Закрыты: имена голосовавших §39, mute «только важные» §17, пользовательские папки §2. Остался богатый плеер голосовых в правой панели |

Вне таблиц плана, но открыто и требует человека:
- Throttler хранит счётчики в памяти процесса (`app.module.ts`) — в multi-instance лимиты считаются на инстанс. Переезд на Redis-хранилище = новая зависимость (стоп-точка §0.1.3).
- Realtime есть у чатов и QR-логина; заявки и оценки живого обновления не получают (отложено в перф-эпике).
- Сторисы (14.1): бакет `stories-media` с TTL 24 ч и место под cron готовы, модели `Story` нет — она требует миграции (стоп-точка).
- Ждут применения человеком (SQL сгенерирован и сверен, к рабочей БД не применялся): `20260820130000_chat_mute_important_only`, `20260820140000_chat_folders` → `pnpm db:deploy`.

| Фаза | Задач | Сессий (оценка) |
|---|---|---|
| Ф0 Каркас | 8 | 8–12 |
| Ф1 Auth + Инвайты | 10 | 12–16 |
| Ф2 Файлы | 5 | 5–7 |
| Ф3 Уведомления | 6 | 6–9 |
| Ф4 Профили | 5 | 5–7 |
| Ф5 Иерархия | 7 | 8–11 |
| Ф6 Расписание | 8 | 9–13 |
| Ф7 Заявки | 7 | 8–11 |
| Ф8 Посты | 9 | 10–14 |
| Ф9 Чаты | 9 | 12–17 |
| Ф10 События | 6 | 6–8 |
| Ф11 Жалобы | 6 | 6–9 |
| Ф12 Админ-панели | 8 | 10–14 |
| Ф13 Полировка | 9 | 10–15 |
| **Итого v1.0** | **103** | **115–163** |

---

## Фаза 0 — Каркас монорепо и инфраструктура

**Цель:** `pnpm dev` поднимает пустые, но рабочие `api` и `web`; БД, Redis и MinIO живы; CI зелёный.

| # | Задача | Результат |
|---|---|---|
| 0.1 | Инициализировать монорепо: pnpm workspaces, Turborepo, `turbo.json` (pipeline `shared-types → shared-schemas → api/web`), корневой `tsconfig.base.json` | `pnpm build` проходит на пустых пакетах |
| 0.2 | ESLint + Prettier + `husky` + `lint-staged` + `commitlint` (Conventional Commits) единые на репо | Коммит с неверным форматом отклоняется |
| 0.3 | Пакеты `shared-types`, `shared-schemas`, `shared-utils`, `shared-config` с `workspace:*`-связями и заглушками | Импорт `@studenthub/shared-types` работает из обоих приложений |
| 0.4 | `docker/docker-compose.yml`: postgres:16-alpine, redis:7-alpine, minio — с named volumes и healthcheck; `docker/.env.example` | `docker compose up -d` → все сервисы healthy |
| 0.5 | Prisma: multi-file схема `prisma/schema/` (`_base`, `_enums`, `01-users`, `02-academic`, …), все enum из `docs/PROJECT.md`, первая миграция | `prisma validate` + `migrate dev` успешно |
| 0.6 | `apps/api`: NestJS + Fastify, ConfigModule с **Zod-валидацией env**, PrismaModule/PrismaService, `GET /health` (terminus: Prisma+Redis+MinIO), Swagger на `/api/docs` только в dev | `curl /api/v1/health` → 200 |
| 0.7 | `apps/api/src/common`: `ResponseInterceptor`, `HttpExceptionFilter`, `ZodValidationPipe`, `LoggingInterceptor` (pino + requestId) — все глобальные; реестр кодов ошибок в `shared-types` | Тестовый эндпоинт отдаёт `{success, data}`, ошибка — `{success, error:{code}}` |
| 0.8 | `apps/web`: Next.js App Router, Tailwind, shadcn/ui init, `next-intl` (ru/kk/en), TanStack Query provider, Redux store, `shared/api/instance.ts`, каркас FSD-папок | `pnpm dev` → страница-заглушка на 3000 |
| 0.9 | CI (`.github/workflows/ci.yml`): lint → `tsc --noEmit` → test → build; postgres service container; кэш pnpm-store | Зелёный CI на PR |

**Приёмка фазы 0**
```
□ pnpm install / pnpm dev / pnpm build работают с чистого клона
□ docker compose: postgres, redis, minio — healthy
□ GET /api/v1/health возвращает status ok по всем трём зависимостям
□ Приложение НЕ стартует при отсутствии обязательной env-переменной
□ Формат успеха и ошибки соответствует контракту
□ Swagger открывается в dev и недоступен при NODE_ENV=production
□ CI зелёный, commitlint отклоняет неверный формат коммита
```

---

## Фаза 1 — Аутентификация и инвайты 🔴

**Цель:** единственный способ попасть в систему — инвайт. Три уровня guard работают.

| # | Задача | Результат |
|---|---|---|
| 1.1 | Prisma: `User`, `RefreshToken`, `Invite` + enum `Role`, `InviteStatus`; индексы; миграция | Модели в БД |
| 1.2 | `AuthModule`: `JwtModule`, `PassportModule`, `LocalStrategy`, `JwtStrategy`, `JwtRefreshStrategy`, bcrypt (cost ≥ 10) | — |
| 1.3 | `common/guards`: `JwtAuthGuard` (глобальный) + `@Public()`, `RolesGuard` + `@Roles()`, `ScopeGuard` + `@CurrentUser()` | — |
| 1.4 | **Unit-тесты guard'ов** — позитив и негатив по каждому уровню | 🔴 блокирует мёрж |
| 1.5 | `POST /auth/login`, `POST /auth/refresh` (с ротацией и инвалидацией цепочки при повторном использовании), `POST /auth/logout`, `GET /auth/me`; Throttler-лимиты | — |
| 1.6 | `InviteService`: create (проверка иерархии «роль строго ниже своей» + scope), preview, revoke, валидация в транзакции регистрации | — |
| 1.7 | **Unit-тесты `InviteService`** — вся матрица иерархии, истёкший/использованный/отозванный токен | 🔴 блокирует мёрж |
| 1.8 | `POST /auth/register-by-invite` — транзакция: создать User + пометить Invite USED; роль и scope только из инвайта | — |
| 1.9 | **E2E-тесты**: login, refresh-ротация, register-by-invite (успех + 410 на повторное использование) | 🔴 блокирует мёрж |
| 1.10 | Seed: единственный `PLATFORM_ADMIN`, демо-университет/факультет/группа, 3 аудитории, dev-инвайт для `UNIVERSITY_ADMIN`; идемпотентность через `upsert` | `prisma db seed` можно запускать многократно |
| 1.11 | Frontend: `/login`, `/register?token=`, `features/auth-invite`, Redux `auth`-slice, axios-interceptor с **дедупликацией refresh**, `middleware.ts` + `ROLE_HOME`, восстановление сессии при перезагрузке | Вход и регистрация по инвайту работают в браузере |
| 1.12 | Frontend: layout'ы route-групп с проверкой роли + 403-экран | Студент на `/dean` видит 403 |

**Приёмка фазы 1**
```
□ Публичной регистрации не существует; /register без токена → ошибка
□ Роль и scope нельзя подменить через body запроса регистрации (проверено вручную)
□ Инвайт одноразовый; race condition при двойном клике не создаёт двух пользователей
□ Иерархия выдачи соблюдена: DEAN не может выдать инвайт UNIVERSITY_ADMIN
□ Refresh ротируется; повторное использование старого токена рвёт всю цепочку
□ 10 параллельных 401 вызывают ровно один refresh
□ Перезагрузка страницы не показывает /login авторизованному пользователю
□ AuditLog содержит записи login/logout/создание/использование инвайта
□ Все тесты 🔴 зелёные (вывод приложен к PR)
```

> Это самая ответственная фаза. Ревью — человеком, построчно. Ошибка здесь = утечка данных всех университетов.

---

## Фаза 2 — Файлы и MinIO

**Цель:** любой модуль может безопасно принять и выдать файл.

| # | Задача |
|---|---|
| 2.1 | Prisma-модель `File` (bucket, key, mime, size, ownerId, createdAt) + индексы; провайдер `MinioClient`; авто-создание бакетов и политик на старте (`avatars` публичный, остальные приватные, TTL 24ч на `stories-media`) |
| 2.2 | `FileService`: `upload` (через `@fastify/multipart`), `getPresignedUrl` (TTL 15 мин), `delete` (объект + запись), проверка MIME по magic bytes, лимиты из `shared-config` |
| 2.3 | `POST /files/upload`, `GET /files/:id/presigned`, `DELETE /files/:id` + Swagger (`@ApiConsumes('multipart/form-data')`) + scope-проверка владения |
| 2.4 | Integration-тест `FilesService` против реального MinIO из docker-compose |
| 2.5 | Frontend: `shared/ui/file-upload` — превью, прогресс, клиентская валидация размера/типа, presigned-загрузка для файлов > 10 МБ |

**Приёмка:** файл с подменённым расширением отклоняется; приватный объект недоступен по прямому URL; удаление сущности удаляет объект в MinIO.

---

## Фаза 3 — Уведомления, очереди, cron

**Цель:** асинхронная инфраструктура, от которой зависят Ф6–Ф10.

| # | Задача |
|---|---|
| 3.1 | Prisma: `Notification`, `NotificationSettings` + enum `NotificationType`, `NotificationChannel` |
| 3.2 | BullMQ + Redis: очереди `email`, `notifications`, `file-processing`, `cleanup`; базовая конфигурация job'ов (3 попытки, exponential backoff); прокидывание `requestId` в job |
| 3.3 | `EmailProcessor` (nodemailer) + шаблоны: `send-invite`, `send-welcome`, `send-application-status`, `send-schedule-change`, `send-event-reminder` |
| 3.4 | `NotificationsProcessor`: создать `Notification` → отправить WS `notification:new` онлайн-пользователям → офлайн + включён канал → задача в `email`. Идемпотентность обязательна |
| 3.5 | `NotificationsService` + эндпоинты `/notifications` (список, unread-count, read, read-all, delete, settings) с Redis-кэшем на `unread-count` |
| 3.6 | `CleanupService`: все cron-задачи из `docs/PROJECT.md`, батчами по 500, с логированием количества. **Исправить окно `scheduleEventReminders`** (см. BACKEND_RULES §9.3) |
| 3.7 | Frontend: `widgets/notifications-bell` — счётчик, список, отметка прочтения, живое обновление по WS; страница настроек уведомлений |

**Приёмка:** повторный запуск job'а не создаёт дубликат уведомления; cron не падает на 10 000 записей; отправка письма не блокирует HTTP-ответ.

---

## Фаза 4 — Профили пользователей

| # | Задача |
|---|---|
| 4.1 | `UsersModule`: `UserService` (findById, updateProfile, changePassword, softDelete), экспорт для `AuthModule` |
| 4.2 | Настройки приватности профиля + DTO-фильтрация: `GET /users/:id` возвращает разный набор полей в зависимости от роли смотрящего и настроек владельца. `passwordHash` исключается на уровне `select` |
| 4.3 | Аватар: `POST/DELETE /users/me/avatar` через `FileService`; job `generate-thumbnail` |
| 4.4 | `PATCH /users/me/password` (требует `currentPassword`, инвалидирует все refresh-токены), `DELETE /users/me` (soft delete + анонимизация), блокировка/разблокировка модератором |
| 4.5 | Frontend: `entities/user`, `widgets/user-profile`, страницы профиля и настроек для всех 8 ролей (общий компонент + ролевые секции) |

**Приёмка:** студент не видит персональных данных другого студента; смена пароля разлогинивает все устройства.

---

## Фаза 5 — Академическая иерархия

| # | Задача |
|---|---|
| 5.1 | Prisma: `University`, `Faculty`, `Group`, `Room` + связи с `onDelete`, индексы, миграция |
| 5.2 | `UniversitiesModule`: CRUD, `PATCH /:id/status` (только `PLATFORM_ADMIN`), `GET /:id/stats` с кэшем |
| 5.3 | `FacultiesModule`: CRUD, запрет удаления при наличии групп |
| 5.4 | `GroupsModule`: CRUD, `GET /:id/members`, назначение старосты, запрет удаления при наличии студентов |
| 5.5 | Сквозной `ScopeGuard` на все три модуля + дублирующая проверка принадлежности в сервисах; unit-тесты на кросс-университетский доступ |
| 5.6 | Frontend: `entities/university|faculty|group`, экраны `/university-admin/faculties|groups|students|teachers|deans` |
| 5.7 | Frontend: `features/create-invite` — выдача инвайтов с автоподстановкой scope и списком доступных ролей по иерархии; список и отзыв инвайтов |

**Приёмка:** админ университета A не получает и не изменяет ни одну сущность университета B ни одним из эндпоинтов (проверить руками по каждому маршруту).

---

## Фаза 6 — Расписание

| # | Задача |
|---|---|
| 6.1 | Prisma: `Schedule`, `Pair`, `Room`, `ScheduleChange` + enum `WeekType`, `ScheduleChangeType`; индексы `[groupId, dayOfWeek]`, `[teacherId, dayOfWeek]`. **Разграничить `Schedule` и `Pair`** (см. BACKEND_RULES §19) |
| 6.2 | Решить и реализовать вопрос часового пояса: поле таймзоны у `University`, хранение времени, отдача клиенту |
| 6.3 | `ScheduleService`: ролевая выборка (студент → своя группа, преподаватель → свои пары, декан → факультет, админ → университет) |
| 6.4 | CRUD пар и аудиторий + **проверка конфликтов**: аудитория/преподаватель/группа не могут быть заняты дважды в одном слоте |
| 6.5 | `ScheduleChange`: создание замены/отмены/переноса → job `schedule-changed` в `notifications` → WS `schedule:changed` в комнату `group:{id}` |
| 6.6 | Unit-тесты: ролевая выборка, детектор конфликтов, `weekType` (чётная/нечётная неделя) |
| 6.7 | Frontend: `widgets/schedule-grid` — сетка недели, мобильный вид «день», фильтры, выделение изменений |
| 6.8 | Frontend: `features/manage-schedule` — создание/редактирование пар для декана и админа с показом конфликтов |
| 6.9 | Frontend: живое обновление расписания по WS + тост «Расписание изменено» |

**Приёмка:** изменение расписания доходит до открытого экрана студента без перезагрузки; конфликт аудиторий не создаётся; чётность недели считается правильно.

---

## Фаза 7 — Заявки в деканат

| # | Задача |
|---|---|
| 7.1 | Prisma: `ApplicationRequest`, `ApplicationStatusHistory` + enum `ApplicationStatus`, `AppType` |
| 7.2 | `transitionStatus()` — конечный автомат с явной матрицей допустимых переходов и проверкой прав на каждый переход; запись в history в одной транзакции |
| 7.3 | **Unit-тесты автомата** — все допустимые переходы + все недопустимые (например `CLOSED → NEW`) | 🔴 |
| 7.4 | CRUD заявок: создание (только `STUDENT`), список по роли, вложения через `FileService`, отзыв заявки в статусе `NEW` |
| 7.5 | Scope: декан видит только свой факультет; студент — только свои; **староста не видит личные заявки одногруппников** |
| 7.6 | Уведомление + email студенту при каждом переходе статуса |
| 7.7 | Frontend: студент — создание заявки, список, таймлайн статусов, вложения |
| 7.8 | Frontend: декан — очередь заявок, фильтры, смена статуса с комментарием, запрос уточнения |

**Приёмка:** недопустимый переход отклоняется с 400; студент видит историю своей заявки; староста не имеет доступа к заявкам одногруппников ни через один эндпоинт.

---

## Фаза 8 — Посты и лента

| # | Задача |
|---|---|
| 8.1 | Prisma: `Post`, `Reaction`, `Comment` + enum `PostAudience`; индексы под audience-фильтр и cursor-пагинацию |
| 8.2 | `PostsService`: audience-фильтр — пользователь видит `ALL` + свой университет + свой факультет + свою группу + адресованное лично; учёт роли автора |
| 8.3 | Cursor-пагинация ленты (`take ≤ 50`) + сортировка по приоритету контента из `docs/PROJECT.md` |
| 8.4 | **Unit-тесты**: audience-матрица по всем 8 ролям, стабильность cursor-пагинации | 🟡 |
| 8.5 | Реакции и комментарии (thread-ответы), удаление своих и модератором |
| 8.6 | Закрепление поста — только роль выше автора; репост с `originalPostId` |
| 8.7 | Медиа в постах через `FileService` |
| 8.8 | Frontend: `entities/post`, `widgets/feed-list` с `useInfiniteQuery`, скелетоны, empty-состояние |
| 8.9 | Frontend: `features/create-post` — выбор аудитории (ограничен ролью), медиа, файлы, предпросмотр |
| 8.10 | Frontend: оптимистичные реакции с роллбэком, ветка комментариев |

**Приёмка:** студент группы A не видит пост группы B ни в ленте, ни по прямому `GET /posts/:id`; лента не дублирует и не пропускает записи при прокрутке.

---

## Фаза 9 — Чаты и WebSocket

| # | Задача |
|---|---|
| 9.1 | Prisma: `Chat`, `ChatMember`, `Message` + enum `ChatType`; индексы `[chatId, createdAt]` |
| 9.2 | `JwtWsGuard`: аутентификация в handshake, авто-вход в комнаты `user:`, `group:`, `university:`, обработка `auth:refresh` без разрыва соединения |
| 9.3 | `ChatGateway`: `chat:join`/`leave` (с проверкой членства в БД), `message:send|edit|delete|read`, `typing:start|stop`; Zod-валидация каждого payload |
| 9.4 | Серверные события: `message:new|updated|deleted|read`, `typing:started|stopped`, `chat:updated|member-added|member-removed` — только адресно по комнатам |
| 9.5 | REST: список чатов, создание, история сообщений (cursor), управление участниками |
| 9.6 | Автоматическое создание официальных чатов: чат группы, чат предмета, чат факультета, чат с деканатом, чат поддержки |
| 9.7 | Job `new-message` в `notifications` для офлайн-участников |
| 9.8 | **Unit-тесты**: WS-аутентификация, отказ на `chat:join` без членства, изоляция комнат | 🟡 |
| 9.9 | Frontend: единый socket-провайдер, `useSocketEvent`, синхронизация с кэшем React Query |
| 9.10 | Frontend: `widgets/chat-window` — список чатов, история с подгрузкой вверх, отправка, вложения, typing-индикатор, статусы прочтения, индикатор обрыва связи и рефетч при реконнекте |

**Приёмка:** нельзя войти в комнату чужого чата; сообщение приходит всем участникам, включая отправителя, ровно один раз; после реконнекта история корректна; сообщения не «пропадают» после рефетча.

---

## Фаза 10 — События

| # | Задача |
|---|---|
| 10.1 | Prisma: `Event`, `EventParticipant`; поле `reminderSentAt` для дедупликации напоминаний |
| 10.2 | CRUD событий с audience-фильтром (по аналогии с постами), запрет создания для `STUDENT` кроме ограниченного случая по матрице доступа |
| 10.3 | Регистрация/отмена участия, список участников (организатору и админу) |
| 10.4 | Напоминания за час: cron → очередь `email` + `notifications`, с учётом `reminderSentAt` |
| 10.5 | Frontend: `entities/event`, список (upcoming/past), карточка, регистрация |
| 10.6 | Frontend: `features/create-event` для декана, преподавателя, старосты, админов |

---

## Фаза 11 — Жалобы и модерация

| # | Задача |
|---|---|
| 11.1 | Prisma: `Complaint` + enum `ComplaintTargetType`, `ComplaintStatus`; `AuditLog` |
| 11.2 | `POST /complaints` на пост/комментарий/сообщение/сторис/пользователя + throttling 10/час |
| 11.3 | Очередь жалоб для модераторов со scope: модератор университета видит только свой вуз |
| 11.4 | Разрешение жалобы: удаление контента / блокировка пользователя / отклонение жалобы + уведомление автору жалобы |
| 11.5 | **Доступ модератора/админа к личным чатам — только при наличии жалобы, всегда с записью в `AuditLog`** |
| 11.6 | `AuditInterceptor` + `GET /audit` со scope-фильтром |
| 11.7 | Frontend: `/moderator/platform/*` и `/moderator/university/*` — очередь, фильтры, действия, журнал |

**Приёмка:** модератор университета A не видит жалоб университета B; каждый просмотр личного чата зафиксирован в аудите.

---

## Фаза 12 — Админ-панели и дашборды

| # | Задача |
|---|---|
| 12.1 | `GET /universities/:id/stats`, статистика факультета и группы, кэш в Redis |
| 12.2 | `GET /users` с фильтрами и пагинацией (только `Admin+`) |
| 12.3 | Frontend: `/platform-admin/*` — 12 экранов по карте маршрутов |
| 12.4 | Frontend: `/university-admin/*` — 16 экранов |
| 12.5 | Frontend: `/dean/*` — 14 экранов |
| 12.6 | Frontend: `/teacher/*` и `/starosta/*` |
| 12.7 | `widgets/stats-dashboard` — график через `next/dynamic` (полотно из `shared/ui/chart`) |
| 12.8 | Экспорт списков в CSV/XLSX (по запросу деканата) |

> Задачи 12.3–12.6 разбиваются на подзадачи по разделам, по 2–3 экрана на сессию агента. Отдавать целиком «сделай админ-панель платформы» — гарантированный низкокачественный результат.

---

## Фаза 13 — Полировка и релиз v1.0

| # | Задача | Статус |
|---|---|---|
| 13.1 | Полный проход i18n: ru/kk/en, идентичные наборы ключей, ICU-плюрализация, перевод всех кодов ошибок | ✅ страж `shared/i18n/messages.test.ts` |
| 13.2 | PWA: манифест, иконки, офлайн-страница, кэш-стратегии для расписания | ✅ `next-pwa` + `manifest.webmanifest` + `/offline` |
| 13.3 | Push-уведомления (FCM / Web Push) + настройки каналов | ✅ модуль `push` |
| 13.4 | Playwright E2E: логин, регистрация по инвайту, лента, отправка сообщения, создание и обработка заявки, изменение расписания | ✅ 23 теста (PR #73); `posts.e2e.ts` отключён — сотрудники в seed без 2FA, решение за командой |
| 13.5 | Аудит безопасности по чеклисту `BACKEND_RULES §14` — вручную по каждому эндпоинту из реестра | ✅ по всем 10 правилам (PR #73) |
| 13.6 | Производительность: `EXPLAIN ANALYZE` на запросах ленты, сообщений, расписания; добавить недостающие индексы; bundle-analyzer | 🚧 `findMany` без `take` больше нет ни одного; `EXPLAIN ANALYZE` на реальном объёме и bundle-analyzer (новая зависимость — стоп-точка) открыты |
| 13.7 | Доступность и адаптивность: 375/768/1280, клавиатурная навигация, контраст | ✅ пороги контраста зафиксированы `shared/ui/theme-contrast.test.ts`; в тёмной теме `text-destructive` на `bg-destructive/10` = 3.65 — вопрос к дизайну |
| 13.8 | Мониторинг: Sentry (`@sentry/nestjs`, `@sentry/nextjs`) — HTTP-5xx, очереди, WS, cron, SSR, браузер; чистка персональных данных перед отправкой; `/health` (terminus) и request-логи были раньше | 🚧 код на месте; организационное — создать проект, положить DSN, настроить алерты по error-rate |
| 13.9 | Production-инфраструктура: nginx + TLS, `docker-compose.prod.yml`, `restart: always`, бэкапы PostgreSQL и MinIO, ротация логов | 🚧 `docker-compose.prod.yml` + nginx есть, cron под Redis-локом (`CronLockService`); бэкапы и проверка восстановлением — за человеком |
| 13.10 | Финальная документация: обновить `docs/PROJECT.md` под реальность, README со сценарием первого запуска, runbook (что делать при падении Redis/MinIO) | ✅ `docs/RUNBOOK.md`, `docs/RAILWAY.md` |

**Критерии готовности v1.0**
```
□ Все модули MVP из docs/PROJECT.md §MVP работают
□ Все тесты 🔴 и 🟡 зелёные; E2E-флоу проходят
□ Аудит безопасности пройден, замечания закрыты
□ Пароль seed-админа сменён; dev-инвайт отозван
□ Swagger недоступен в production
□ Бэкапы БД и MinIO настроены и проверены восстановлением
□ Sentry получает ошибки; health check в мониторинге
□ Три языка полные, без пропущенных ключей
□ Lighthouse: производительность и доступность ≥ 90 на мобильном
```

---

## Фаза 14 — v2.0 (после релиза)

| # | Направление | Заметка | Статус |
|---|---|---|---|
| 14.1 | Сторисы (24 ч, TTL, автоудаление, опросы, реакции) | Бакет `stories-media` с TTL 24 ч и место под cron готовы; модели `Story` нет (нужна миграция — стоп-точка) | ⬜ |
| 14.2 | Продвинутая аналитика и отчёты | После накопления данных | ⬜ |
| 14.3 | Умная лента (ранжирование, рекомендации) | Требует метрик вовлечённости | ⬜ |
| 14.4 | AI-модерация контента | После ручной модерации и накопления размеченных кейсов | ⬜ |
| 14.5 | Интеграции Zoom / Google Meet | Для онлайн-событий; внешний сервис + новая зависимость | ⬜ |
| 14.6 | GDPR-инструменты: выгрузка своих данных, удаление аккаунта по запросу | Частично в Ф4; довести до полного цикла | ⬜ |
| 14.7 | Мобильное приложение (React Native) или расширенный PWA | Решение по результатам мобильного трафика v1.0 | ⬜ |

---

## Фаза 15 — Модуль «Документы»

> Защищённое хранилище документов пользователя: личные/учебные документы, предоставление вузу,
> запросы вуза, статусы проверки, управление доступом, история, уведомления об истечении.
> **Отдельный раздел приложения** (не вкладка публичного профиля). Полный ТЗ — в задаче.

### 15.0 Архитектура и ключевые решения

- **Файлы** — через существующую модель `File` (как `postId`/`materialId`): добавляется
  `File.documentId`. Объекты — в **новом приватном бакете `documents`**
  (env `MINIO_BUCKET_DOCUMENTS`, bootstrap в `MinioBucketsService`). Отдача — только presigned-URL
  по проверке прав в сервисе (шаблон — `PostsService.getMediaUrl`). Публичных URL нет.
- **Номер документа** — храним полный (`Document.number`) **плюс** денормализованные последние 4
  (`numberLast4`). API **никогда** не отдаёт `number`; наружу идёт только маска `******4821`
  (собирается из `numberLast4`). Полный номер не покидает БД (аналог `passwordHash`).
- **Права** — `JwtAuthGuard → RolesGuard → ScopeGuard` + обязательная перепроверка владения/scope
  в сервисе (§11.2). Доступ к чужому документу — только через активный `DocumentAccess`
  (грант) либо роль-проверяющий своего подразделения.
- **История** — отдельная модель `DocumentEvent` (пер-документ/пер-запрос журнал по ТЗ §10),
  дополнительно к глобальному `AuditLog`. Пишется на каждое действие.
- **Автоматизация** — уведомления через BullMQ (истечение, запросы, результат проверки);
  крон в `CleanupService` помечает `EXPIRING`/`EXPIRED` и шлёт напоминания.
- **Типы документов** — на MVP статический справочник в `packages/shared-config`
  (категория → список типов + какие поля показывать). Управление типами из БД — задача 15.4.
- **Спец-режим платформенного админа** — обычного доступа к содержимому нет; технический доступ
  только через отдельный флаг с обязательной причиной и записью `DocumentEvent`/`AuditLog` (15.4).

### 15.1 Модель данных (эскиз на ревью — НЕ применять до согласования)

Enum-поля — строками (стиль проекта, как `visibility`/`status`). Новый файл `prisma/schema/14-documents.prisma`:

```prisma
model Document {
  id                 String    @id @default(uuid())
  ownerId            String    @map("owner_id")
  universityId       String?   @map("university_id")     // scope владельца
  category           String    // PERSONAL | ACADEMIC | CERTIFICATE | ISSUED_BY_UNIVERSITY
  type               String    // ID_CARD | PASSPORT | DIPLOMA | TRANSCRIPT | ...
  title              String
  number             String?   // полный номер — НАРУЖУ НЕ ОТДАётся
  numberLast4        String?   @map("number_last4")      // для маски ******4821
  issuedBy           String?   @map("issued_by")
  issuedAt           DateTime? @map("issued_at")
  expiresAt          DateTime? @map("expires_at")
  comment            String?
  // DRAFT|UPLOADED|IN_REVIEW|VERIFIED|ACCEPTED|REJECTED|NEEDS_REPLACEMENT|EXPIRING|EXPIRED|ARCHIVED
  status             String    @default("DRAFT")
  rejectionReason    String?   @map("rejection_reason")
  issuedByUniversity Boolean   @default(false) @map("issued_by_university")
  archivedAt         DateTime? @map("archived_at")
  deletedAt          DateTime? @map("deleted_at")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  owner       User                 @relation("UserDocuments", fields: [ownerId], references: [id], onDelete: Cascade)
  university  University?          @relation(fields: [universityId], references: [id], onDelete: SetNull)
  files       File[]               // File.documentId (порядок страниц — File.order, добавить)
  access      DocumentAccess[]
  events      DocumentEvent[]
  submissionItems DocumentSubmissionItem[]

  @@index([ownerId, status])
  @@index([universityId])
  @@index([expiresAt])
  @@map("documents")
}

model DocumentAccess {
  id          String    @id @default(uuid())
  documentId  String    @map("document_id")
  granteeType String    @map("grantee_type")   // UNIVERSITY | DEPARTMENT | USER
  granteeId   String?   @map("grantee_id")      // facultyId/офис или userId; null для UNIVERSITY
  reason      String
  grantedById String    @map("granted_by_id")
  grantedAt   DateTime  @default(now()) @map("granted_at")
  expiresAt   DateTime? @map("expires_at")
  revokedAt   DateTime? @map("revoked_at")

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@index([granteeType, granteeId])
  @@map("document_access")
}

model DocumentRequest {
  id           String    @id @default(uuid())
  universityId String    @map("university_id")
  departmentId String?   @map("department_id")   // факультет/офис-подразделение
  createdById  String    @map("created_by_id")
  title        String
  description  String?
  dueAt        DateTime? @map("due_at")
  status       String    @default("OPEN")        // OPEN | CLOSED
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  items   DocumentRequestItem[]
  targets DocumentRequestTarget[]
  submissions DocumentSubmission[]

  @@index([universityId])
  @@index([departmentId])
  @@map("document_requests")
}

model DocumentRequestItem {
  id        String  @id @default(uuid())
  requestId String  @map("request_id")
  docType   String  @map("doc_type")
  required  Boolean @default(true)

  request DocumentRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)

  @@index([requestId])
  @@map("document_request_items")
}

model DocumentRequestTarget {   // адресаты запроса
  id        String  @id @default(uuid())
  requestId String  @map("request_id")
  userId    String? @map("user_id")
  groupId   String? @map("group_id")

  request DocumentRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)

  @@index([requestId])
  @@map("document_request_targets")
}

model DocumentSubmission {   // комплект ответа пользователя на запрос
  id           String    @id @default(uuid())
  requestId    String    @map("request_id")
  userId       String    @map("user_id")
  // NOT_STARTED|IN_PROGRESS|SUBMITTED|IN_REVIEW|NEEDS_FIX|ACCEPTED|OVERDUE|CLOSED
  status       String    @default("NOT_STARTED")
  reviewNote   String?   @map("review_note")
  reviewedById String?   @map("reviewed_by_id")
  submittedAt  DateTime? @map("submitted_at")
  reviewedAt   DateTime? @map("reviewed_at")

  request DocumentRequest          @relation(fields: [requestId], references: [id], onDelete: Cascade)
  items   DocumentSubmissionItem[]

  @@unique([requestId, userId])
  @@map("document_submissions")
}

model DocumentSubmissionItem {   // документ, приложенный к позиции запроса
  id            String  @id @default(uuid())
  submissionId  String  @map("submission_id")
  requestItemId String  @map("request_item_id")
  documentId    String? @map("document_id")
  status        String  @default("PENDING")   // PENDING | ACCEPTED | REJECTED
  note          String?

  submission DocumentSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  document   Document?          @relation(fields: [documentId], references: [id], onDelete: SetNull)

  @@index([submissionId])
  @@map("document_submission_items")
}

model DocumentEvent {   // пер-документ/пер-запрос журнал (ТЗ §10)
  id         String   @id @default(uuid())
  documentId String?  @map("document_id")
  requestId  String?  @map("request_id")
  actorId    String   @map("actor_id")
  // UPLOAD|VIEW|DOWNLOAD|EDIT|REPLACE|GRANT|REVOKE|REVIEW|ACCEPT|REJECT|ARCHIVE|DELETE
  action     String
  metadata   Json?
  createdAt  DateTime @default(now()) @map("created_at")

  document Document? @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, createdAt])
  @@index([requestId, createdAt])
  @@map("document_events")
}
```

Правки существующих моделей: `File` → `documentId String?` + `order Int?` (порядок страниц) + relation + `@@index`;
`User` → обратные связи (`documents`, `documentSubmissions`, …); `University`/`Group` — обратные связи для scope.

### 15.2 Ролевая матрица (кто что может)

| Роль | Свои документы | Чужие документы | Запросы | Проверка | Ограничения |
|---|---|---|---|---|---|
| **Студент/староста** | полный CRUD, доступ, история | — | отвечает на адресованные | — | староста: только прогресс группы и групповые списки, **без содержимого личных** |
| **Преподаватель** | свои | по гранту | создаёт **только разрешённые учебные** запросы | учебные | нет доступа к удостоверениям/мед. по умолчанию |
| **Деканат / студ. офис** | свои | **только предоставленные их подразделению** (по `DocumentAccess`) | создаёт | принимает/отклоняет (с причиной) | не видит документы вне своего подразделения |
| **Админ вуза** | свои | **не содержимое** | — | — | управляет типами/правами/сроками хранения, читает журнал |
| **Платформенный админ** | — | только **спец-режим** (причина + запись в журнал) | — | — | обычного доступа к содержимому нет |

### 15.3 Статусы

- **Документ:** `DRAFT · UPLOADED · IN_REVIEW · VERIFIED · ACCEPTED · REJECTED · NEEDS_REPLACEMENT · EXPIRING · EXPIRED · ARCHIVED`. При `REJECTED`/`NEEDS_REPLACEMENT` — обязательная `rejectionReason`.
- **Запрос (submission на пользователя):** `NOT_STARTED · IN_PROGRESS · SUBMITTED · IN_REVIEW · NEEDS_FIX · ACCEPTED · OVERDUE · CLOSED`.

### 15.4 Задачи (по под-фазам; одна задача = одна сессия/PR)

**A. Фундамент — «Мои документы» (студент)**

| # | Задача | Зона | Зависимости |
|---|---|---|---|
| 15.1 | Схема `14-documents.prisma` (Document/DocumentAccess/DocumentEvent) + `File.documentId/order`; **миграция [стоп]** | api/prisma | — |
| 15.2 | Бакет `documents` (env `MINIO_BUCKET_DOCUMENTS` + bootstrap) **[стоп: env]** | api | 15.1 |
| 15.3 | `shared-schemas`: create/update/replace document, upload-step схемы **[стоп]** | schemas | — |
| 15.4 | Справочник типов документов (`shared-config`: категории → типы → поля) | config | — |
| 15.5 | `DocumentsService`+controller: создать черновик, приложить файлы (порядок/стороны), список с фильтрами, `GET /:id`, presigned на файл, редактировать, заменить версию, архив, удалить; маска номера; запись `DocumentEvent` | api | 15.1–15.4 |
| 15.6 | `GET /documents/overview` (счётчики: всего / нужно загрузить / на проверке / скоро истекает / требует замены) | api | 15.5 |
| 15.7 | Нав-пункт **Документы** в `app-shell/model/nav.ts` + маршрут раздела + ссылка из настроек профиля | web | — |
| 15.8 | Экран **Обзор** (плитки-счётчики) + **Мои документы** (поиск/фильтры/сортировка/список карточек) | web | 15.5–15.7 |
| 15.9 | **Мастер загрузки** (4 шага: тип → файлы (PDF/JPG/PNG, много страниц, лицо/оборот, порядок, камера) → данные → доступ) | web | 15.5, 15.8 |
| 15.10 | Карточка документа + действия (открыть/скачать/заменить/изменить/доступ/история/архив/удалить) | web | 15.8 |

**B. Управление доступом + документы от вуза**

| # | Задача | Зона | Зависимости |
|---|---|---|---|
| 15.11 | Гранты `DocumentAccess` (я/подразделение/вуз, причина, срок, отзыв) + presigned-доступ грантополучателю + `GET /:id/events` | api | 15.5 |
| 15.12 | Экран **Управление доступом** (кому предоставлен, основание, срок, отозвать) + история просмотров | web | 15.11 |
| 15.13 | **Документы от университета** (`issuedByUniversity`): выдача сотрудником + просмотр студентом | api+web | 15.11 |

**C. Запросы университета**

| # | Задача | Зона | Зависимости |
|---|---|---|---|
| 15.14 | Модель запросов уже в 15.1; сервис создания запроса сотрудником (позиции, адресаты, срок, обязательность) **[shared-schemas стоп]** | api | 15.1, 15.3 |
| 15.15 | Ответ студента: выбрать загруженный/загрузить новый, отправить комплект; статусы submission | api+web | 15.14 |
| 15.16 | Проверка сотрудником: принять/отклонить позицию и комплект (с причиной); scope «только своё подразделение» | api | 15.14 |
| 15.17 | Экраны **Запросы университета** (студент: список+детали с чек-листом; сотрудник: создание+проверка) | web | 15.14–15.16 |

**D. Роли, автоматизация, админ, архив**

| # | Задача | Зона | Зависимости |
|---|---|---|---|
| 15.18 | Ролевая матрица §15.2 в `ScopeGuard`+сервисах: староста (прогресс группы без содержимого), препод (только учебные), деканат/офис (своё подразделение), админ вуза (без содержимого) **[guard стоп]** | api | вся B/C |
| 15.19 | Крон `CleanupService`: `EXPIRING`/`EXPIRED` по `expiresAt` + напоминания; уведомления BullMQ (запрос/результат/истечение) | api | 15.5, Ф3 |
| 15.20 | Управление типами документов из БД (админ вуза) + сроки хранения + журнал действий (экран) | api+web | 15.4 |
| 15.21 | **Архив** (экран) + спец-режим платформенного админа (причина + журнал) | api+web | 15.5, 15.18 |
| 15.22 | i18n ru/kk/en (namespace `Documents`), a11y, DoD-прогон | web | все |

### 15.5 Стоп-точки фазы

4 миграции к непустой БД (15.1 + при необходимости C); новый бакет + env (15.2); изменения `shared-schemas` (15.3, 15.14); правки `ScopeGuard`/прав (15.18); новый раздел эндпоинтов. Каждую — показать SQL/диф и дождаться ОК.

### 15.6 Приёмка фазы (чеклист человека)

- [ ] Полный номер документа не появляется ни в одном ответе API/логе — только маска.
- [ ] Чужой документ недоступен без активного `DocumentAccess`; отозванный/просроченный грант закрывает доступ.
- [ ] Деканат/офис видит только предоставленное их подразделению; админ вуза не видит содержимое; староста — без содержимого личных.
- [ ] Каждое действие (просмотр/скачивание/проверка/доступ/…) пишет `DocumentEvent`.
- [ ] Отклонение требует причины; студент видит причину и статус.
- [ ] Крон корректно двигает `EXPIRING`/`EXPIRED`; приходят уведомления.
- [ ] Presigned-URL приватного бакета; прямых публичных ссылок нет.
- [ ] `api lint/test/build` и `web lint/typecheck/build` зелёные; i18n-паритет ru/kk/en.

---

## Фаза 16 — Помещения и QR над дверью

> Печатный QR над каждым помещением: студент сканирует камерой и видит, свободно ли оно,
> какая пара идёт и какая группа в нём сейчас. Для библиотеки, актового зала, деканата,
> бухгалтерии — часы работы и контакт. Генерирует администратор вуза.
> Концепция и решения — `docs/PROJECT.md §3.9`.

| # | Задача | Статус |
|---|---|---|
| 16.1 | Модель: `RoomKind`, `building/floor/openHours/phone/info`, `qrCode`+`qrIssuedAt` (миграция `room_qr`) | ✅ |
| 16.2 | `RoomQrService`: выдача кодов пачкой (идемпотентно), перевыпуск с аудитом, статус по коду | ✅ |
| 16.3 | `GET /rooms/qr/:code` — пары дня в помещении с наложением `ScheduleChange` в обе стороны | ✅ |
| 16.4 | Экран администратора `/university-admin/rooms` — CRUD помещений (до этого экрана не было) | ✅ |
| 16.5 | Печатный шаблон наклейки (A4, крупный номер, QR 62 мм, код текстом) | ✅ |
| 16.6 | Страница студента `/r/[code]` — «свободно/занято», группа, остаток дня; телефон-first | ✅ |
| 16.7 | `?next=` в middleware и логине: сканирование без сессии больше не теряет цель | ✅ |
| 16.8 | Тесты: api 15, web 9 (занятость с отменами и переносами); i18n ru/kk/en | ✅ |

**Продолжения:**

| Продолжение | Статус |
|---|---|
| Ручной ввод кода, если QR повреждён | ✅ экран `/r` + кнопка с «помещение не найдено» |
| Наклейки с несколькими помещениями на одном листе A4 | ✅ режим «4 на лист» под разрезание |
| Статистика сканирований по помещениям | ⬜ нужна модель-счётчик → миграция (стоп-точка) |
| Привязка QR помещения к отметке посещаемости | ⬜ отдельный QR-поток посещаемости уже есть (`/attendance/qr`), объединение — продуктовое решение |

---

## Приложение А — Риски

| Риск | Вероятность | Влияние | Что делать |
|---|---|---|---|
| Ошибка в `ScopeGuard` → утечка данных между университетами | Средняя | Критическое | Ф1 ревьюит человек построчно; отдельные unit-тесты на кросс-scope; ручной прогон всех маршрутов в Ф5 |
| Агент «дорисовывает» архитектуру, расходясь с документацией | Высокая | Высокое | Одна задача за сессию; обязательное чтение файлов правил в промпте; ревью diff'а |
| Расхождения в исходной документации (§19 BACKEND_RULES) всплывают в середине разработки | Высокая | Среднее | Закрыть все 8 пунктов **до** Ф5 |
| Cursor-пагинация ленты с приоритетами контента даёт дубли/пропуски | Средняя | Среднее | Составной cursor `(priority, createdAt, id)`; тест на прокрутку 10 страниц |
| N+1 в ленте и чатах при росте данных | Высокая | Среднее | `include`/`select` обязательны; Ф13.6 с `EXPLAIN ANALYZE` на реальном объёме |
| Часовые пояса расписания | Средняя | Высокое | Решить в 6.2 до реализации расписания |
| Redis или MinIO падает → недоступность уведомлений/файлов | Средняя | Среднее | Health check, graceful degradation (job'ы копятся, а не теряются), runbook в 13.10 |

## Приложение Б — Порядок выдачи инвайтов при первом запуске

```
1. pnpm --filter api prisma db seed
   → PLATFORM_ADMIN: admin@studenthub.app / Admin1234!  (сменить сразу)
   → dev-инвайт для UNIVERSITY_ADMIN
2. Войти как PLATFORM_ADMIN → создать реальный университет
3. Выдать инвайт UNIVERSITY_ADMIN → зарегистрировать администратора вуза
4. Администратор вуза: создать факультеты и группы, выдать инвайты DEAN и TEACHER
5. Декан: выдать инвайты STAROSTA и STUDENT
6. Отозвать dev-инвайт из seed
```
