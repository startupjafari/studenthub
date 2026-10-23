# StudentHub — План реализации

> Пошаговый план для реализации силами агента (Claude Code / Codex) с человеком-ревьюером.
> Версия: 1.0 · Последнее обновление: 2026-10-23
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

### 0.4 Состояние работ (обновлено 2026-10-23)

Легенда: ✅ закрыто · 🚧 частично, остаток указан · ⬜ не начато · ⏸ в очереди, не начинать без владельца.

| Фаза | Состояние | Что осталось |
|---|---|---|
| Ф0–Ф12 | ✅ | Функционал в проде; точечные доработки идут вне плана |
| Ф13 Полировка и релиз | ✅ | Все десять задач закрыты. Два пункта требуют разового действия оператора (завести проекты в Sentry и задать секреты хранилища бэкапов) — код, скрипты и прогоны для них готовы |
| Ф14 v2.0 | 🚧 | Закрыты 14.1 сторисы и 14.7 мобильное приложение. 14.2 (выгрузка отчётов по сводкам) и 14.6 (сроки хранения, удаление «надгробий») написаны в ветках `feat/analytics-reports`, `feat/pd-retention`, `feat/account-tombstone-purge`. 14.5 — в очереди. Умная лента и AI-модерация исключены из плана (решение владельца 23.10.2026) |
| Ф15 Документы | ✅ | Модуль `documents` + экраны; `document-types`, `document-access` на месте |
| Ф16 Помещения и QR | ✅ | Из «возможных продолжений» сделаны ручной ввод кода и печать 4 на лист |
| Ф17 Справочник КАТО | ✅ | Продолжения перечислены в фазе |
| Ф18 Карьера | ✅ | Бэкенд, экраны, сид и тесты на месте; поведение при отзыве допуска зафиксировано в 18.A6. Пробелы — в Ф21 (21.D) |
| Ф19 Крупные файлы | 🚧 | Многочастная загрузка с докачкой есть только в чатах (19.0). Материалы, документы и задания до 500 МБ уходят одним запросом, мобильные клиенты — тоже: перенос в 21.B1 и 21.A4 |
| Ф20 Библиотека | 🚧 | Все 12 задач слиты в `develop` (PR #378–#380). За человеком — миграции `20261022120000_add_librarian_role` и `20261022130000_add_library` на Railway, сборка iOS и Android, срок хранения выдач и журнала просмотров (PERSONAL_DATA §4). Пробелы — в Ф21 (21.C) |
| Ф21 Пробелы после аудита | ⬜ | Аудит 23.10.2026: мобильные клиенты, веб, библиотека, карьера, тесты, контракт `PROJECT.md` |
| Academic Core (`docs/ACADEMIC_CORE.md`, удалён как устаревший) | 🚧 | Задачи 1–16, 20–30 закрыты; 17–19 (AI) выведены из объёма; остаётся сквозной mobile-аудит старых экранов |
| Эпик «Чаты» (§-нумерация брифа) | 🚧 | Закрыты: имена голосовавших §39, mute «только важные» §17, пользовательские папки §2. Остался богатый плеер голосовых в правой панели |

Вне таблиц плана, но открыто и требует человека:
- Realtime у студента есть: статус заявки и опубликованная оценка приходят живым событием. Очереди заявок у декана и админа живого обновления не получают — 21.B3.
- Сторисы (14.1) сделаны и лежат за флагом раскатки; миграцию `20261010150000_add_stories` к рабочей БД применяет человек (`pnpm db:deploy`), на стенде нужна переменная `NEXT_PUBLIC_FEATURE_STORIES=1` ДО сборки веба.
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
| 0.4 | `docker/dev/compose.yml`: postgres:16-alpine, redis:7-alpine, minio — с named volumes и healthcheck; `docker/dev/.env.example` | `docker compose up -d` → все сервисы healthy |
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
□ Публичной регистрации пользователей вуза не существует; /register без токена → ошибка.
  Разрешённое исключение — саморегистрация работодателя (Ф18, 18.A2): созданный аккаунт
  не видит ни одного студента, пока вуз не одобрит допуск
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
| 3.2 | BullMQ + Redis: очереди `email`, `notifications`, `file-processing`; базовая конфигурация job'ов (3 попытки, exponential backoff; у почты попыток больше); прокидывание `requestId` в job. **Пересмотрено:** очереди `cleanup` нет — cron чистит сам под локом |
| 3.3 | `EmailProcessor` (nodemailer) + шаблоны: `send-invite` и обобщённое письмо-зеркало `send-notification` для офлайн-пользователей. **Пересмотрено:** отдельные шаблоны `send-welcome`, `send-application-status`, `send-schedule-change`, `send-event-reminder` убраны осознанно — job без продюсера и процессора считается обещанием, которое никто не выполняет (`queue.constants.ts`). Возвращать их не нужно |
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
| 11.6 | `GET /audit` со scope-фильтром. **Пересмотрено:** `AuditInterceptor` не делаем — аудит пишется явно в сервисе через `AuditService.log` в той же операции, что и действие. Перехватчик видит только маршрут и тело запроса, а записи нужны сведения, которые знает лишь сервис (что именно изменилось, чей документ, по какой жалобе), и запись не должна появляться, если операция откатилась |
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
| 13.6 | Производительность: `EXPLAIN ANALYZE` на запросах ленты, сообщений, расписания; добавить недостающие индексы; bundle-analyzer | ✅ второй прогон замеров 2026-10-12 (`docs/PERF_BASELINE.md`): планы снимает `scripts/perf-explain.mjs`, деканские агрегаты переехали в базу (266 → 14 мс и 195 → 22 мс), состав бандла разобран `@next/bundle-analyzer`. Недостающих индексов не нашлось: тяжёлым был не план, а чтение в память |
| 13.7 | Доступность и адаптивность: 375/768/1280, клавиатурная навигация, контраст | ✅ пороги контраста зафиксированы `shared/ui/theme-contrast.test.ts`; в тёмной теме `text-destructive` на `bg-destructive/10` = 3.65 — вопрос к дизайну |
| 13.8 | Мониторинг: Sentry (`@sentry/nestjs`, `@sentry/nextjs`) — HTTP-5xx, очереди, WS, cron, SSR, браузер; чистка персональных данных перед отправкой; `/health` (terminus) и request-логи были раньше | ✅ код на месте и покрыт тестами скраба; в `docs/RUNBOOK.md` — пошаговое включение (два проекта, DSN, окружение, source maps) и таблица алертов. Остаётся разовое действие оператора: завести проекты в Sentry и положить DSN |
| 13.9 | Production-инфраструктура: nginx + TLS, `docker/prod/compose.yml`, `restart: always`, бэкапы PostgreSQL и MinIO, ротация логов | ✅ бэкапы автоматизированы: `scripts/backup-db.sh` (дамп + проверка читаемости + выгрузка в отдельное хранилище + ротация), `scripts/restore-drill.sh` (восстановление в одноразовую базу и проверки) и ночной прогон `backup`, который делает и то, и другое. Остаётся разовое действие оператора: задать секреты хранилища снимков |
| 13.10 | Финальная документация: обновить `docs/PROJECT.md` под реальность, README со сценарием первого запуска, runbook (что делать при падении Redis/MinIO) | ✅ `docs/RUNBOOK.md`, `docs/RAILWAY.md` |

**Критерии готовности v1.0**
```
□ Все модули MVP из docs/PROJECT.md §MVP работают
□ Все тесты 🔴 и 🟡 зелёные; E2E-флоу проходят
□ Аудит безопасности пройден, замечания закрыты
□ Пароль seed-админа сменён; dev-инвайт отозван
□ Swagger недоступен в production
☑ Бэкапы БД и MinIO настроены и проверены восстановлением — ночной прогон `backup`
  снимает и тут же восстанавливает снимок в одноразовую базу (нужны секреты хранилища)
□ Sentry получает ошибки; health check в мониторинге
□ Три языка полные, без пропущенных ключей
□ Lighthouse: производительность и доступность ≥ 90 на мобильном
```

---

## Фаза 14 — v2.0 (после релиза)

| # | Направление | Заметка | Статус |
|---|---|---|---|
| 14.1 | Сторисы (24 ч, TTL, автоудаление, опросы, реакции) | Сделано: модель `Story` + опрос/просмотры/реакции, модуль `stories`, крон `deleteExpiredStories`, жалобы на сторис, кольца и просмотрщик в вебе за флагом `NEXT_PUBLIC_FEATURE_STORIES`. Миграция `20261010150000_add_stories` к рабочей БД применяется человеком | ✅ |
| 14.2 | Продвинутая аналитика и отчёты | Сводки модуля `analytics` — платформенная, вузовская, факультетская и преподавательская. Отчёты (решение владельца 23.10.2026) — выгрузка каждой сводки за месяц, квартал или учебный год в XLSX/CSV: `GET /analytics/report/export`, область по роли из токена, порог малых групп 5, запись в `AuditLog` и `DocumentExport`. Ветка `feat/analytics-reports`, ждёт слияния; кэш обзора факультета — `perf/analytics-faculty-cache` | 🚧 |
| 14.5 | Интеграции Zoom / Google Meet | Сделана ссылочная часть: поля встречи у события, провайдер по хосту ссылки, `GET /events/:id/meeting` только участникам, окно подключения, кнопка «Присоединиться» и поля в форме. Открыто: создание встречи через API Zoom/Google — нужны OAuth-приложения (client id/secret), новая зависимость и хранение токенов организатора (стоп-точки §0.1.3). **В очереди** (решение владельца 23.10.2026): не начинать, пока владелец не поднимет задачу | ⏸ |
| 14.6 | GDPR-инструменты: выгрузка своих данных, удаление аккаунта по запросу | Сделано: удаление аккаунта (`DELETE /users/me`) + машинная выгрузка `GET /me/export` с кнопкой в настройках приватности. Сроки хранения ПДн — год после достижения цели обработки, включая физическое удаление «надгробий» через год после удаления (`PERSONAL_DATA.md` §4–5), за флагом `PD_RETENTION_ENABLED`: ветки `feat/pd-retention`, `feat/account-tombstone-purge`, ждут слияния. Открыто: полный архив с вложениями через очередь; удаление «надгробий» сотрудников, на которых держатся журналы и материалы групп (нужен перевод 8 связей на `SetNull`, PERSONAL_DATA §5) | 🚧 |
| 14.7 | Мобильное приложение (React Native) или расширенный PWA | Закрыто вне плана: нативное приложение iOS (`apps/ios`) | ✅ |

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

Отметки ниже — сверка по коду (30.09.2026), не прогон по интерфейсу. Рядом с каждой указано,
чем именно она подтверждена, чтобы человек мог перепроверить спорное, а не всё подряд.

- [x] Полный номер документа не появляется ни в одном ответе API/логе — только маска.
      `DOCUMENT_SELECT` (`documents.service.ts`) содержит только `numberLast4`; поле `number`
      пишется при создании и правке и больше нигде не читается.
- [x] Чужой документ недоступен без активного `DocumentAccess`; отозванный/просроченный грант закрывает доступ.
      `hasActiveGrant`: `revokedAt: null` плюс `expiresAt` в будущем или пустой; без гранта
      ответ `NOT_FOUND`, а не `FORBIDDEN` — существование документа не подтверждается.
- [x] Деканат/офис видит только предоставленное их подразделению; админ вуза не видит содержимое; староста — без содержимого личных.
      Проверено по устройству, а не по экранам: доступ даёт только владение или активный
      грант (`USER` / `DEPARTMENT` по своему `facultyId` / `UNIVERSITY` в своём вузе), а в
      `documents.controller.ts` нет ни одного маршрута, который выдавал бы содержимое по роли.
      Исключение одно и явное — режим платформенного админа, и он пишет `VIEW` с пометкой.
- [x] Каждое действие (просмотр/скачивание/проверка/доступ/…) пишет `DocumentEvent`.
      `logEvent` вызывается на UPLOAD, REPLACE, EDIT, DELETE, VIEW, DOWNLOAD, GRANT, REVOKE,
      ARCHIVE, EXPIRE, SUBMIT, REVIEW, REQUEST_CREATE.
- [x] Отклонение требует причины; студент видит причину и статус.
      `ReviewSubmissionItemSchema.refine` не пропускает `REJECTED` без непустой причины;
      `rejectionReason` и `status` входят в выдачу документа владельцу.
- [x] Крон корректно двигает `EXPIRING`/`EXPIRED`; приходят уведомления.
      `sweepDocumentExpiry` (ежедневно, под Redis-локом) → `documents.sweepExpiry`: две стадии
      по `expiresAt` с окном 30 дней, каждая ставит задачу уведомления.
- [x] Presigned-URL приватного бакета; прямых публичных ссылок нет.
      Бакет `documents` заводится как `private` (`MinioBucketsService`), файл отдаётся только
      через `getPresignedUrl` с TTL и проверкой владения.
- [ ] `api lint/test/build` и `web lint/typecheck/build` зелёные; i18n-паритет ru/kk/en.
      Паритет проверен: ru / kk / en — по 3622 ключа. Прогон проверок остаётся за человеком
      (AGENTS.md: агент их сам не запускает).

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

## Фаза 17 — Справочник КАТО

> Город вуза вводился свободным текстом, из-за чего «Алматы», «Алма-Ата» и «almaty»
> оказывались разными значениями. Заменён справочником КАТО (классификатор
> административно-территориальных объектов РК, 16 205 записей). `University.city`
> хранит код, а не название: переименование города не протухает в старых записях,
> и казахская локаль берётся из самого справочника.
> Контракт и решения — `docs/PROJECT.md §API` («Справочник КАТО»).

| # | Задача | Статус |
|---|---|---|
| 17.1 | `scripts/gen-kato.mjs` — генератор из выгрузки stat.gov.kz: чинит гомоглифы, битые `Parent`, дубли кодов, восстанавливает иерархию из структуры кода | ✅ |
| 17.2 | Модель `KatoUnit` + enum `KatoKind`; **миграция `add_kato_reference` [стоп]** | ✅ |
| 17.3 | Идемпотентный сидер `pnpm db:seed:kato` (16 205 записей, `ON CONFLICT DO UPDATE`) | ✅ |
| 17.4 | `shared-schemas/kato.ts`: поиск, резолв кодов, вид объекта **[стоп]** | ✅ |
| 17.5 | `GET /kato` и `GET /kato/resolve` **[стоп: новые эндпоинты]** | ✅ |
| 17.6 | `shared/ui/AsyncSelect` — комбобокс с серверным поиском (справочник в бандл не влезает) | ✅ |
| 17.7 | `entities/kato`: `KatoSelect`, `useKatoNames` (резолв списка одним запросом), i18n ru/kk/en | ✅ |
| 17.8 | Перевод трёх экранов платформенного админа на код + бэкфилл `city` в сиде | ✅ |

**Продолжения:**

| Продолжение | Статус |
|---|---|
| Город в профиле студента (родной город / место рождения) | ⬜ справочник и комбобокс уже готовы, нужен только перевод поля |
| Фильтр «вузы по региону» на платформенном дашборде | ⬜ `regionCode` в модели есть, нужен агрегат |
| Индекс `pg_trgm` под поиск по названию | ⬜ не нужен: на 16 тыс. строк seq scan даёт единицы миллисекунд |

---

## Фаза 18 — Карьера

> Модуль связывает студентов с работодателями, не открывая работодателю вуз. Ключевое
> решение модели: у компании нет одного `universityId` — она подаёт заявку в каждый вуз
> отдельно, и видит студентов ровно тех вузов, где допуск активен прямо сейчас. Поэтому
> набор вузов НЕ кладётся в токен: отзыв допуска обязан действовать немедленно, а не через
> 15 минут (`CareerAccessService`).
> Саморегистрация работодателя — единственное исключение из «регистрации только по
> инвайтам» на всей платформе; граница в том, что созданный аккаунт не видит ни одного
> студента, пока вуз не одобрит заявку.
> Контракт и решения — `docs/PROJECT.md` («Карьера»), state-machine — `shared-schemas/career.ts`.

| # | Задача | Статус |
|---|---|---|
| 18.A1 | Модели `Company`, `CompanyMember`, `CompanyUniversityAccess`; **миграция [стоп]** | ✅ |
| 18.A2 | `POST /career/companies/signup` + `verify-email` **[стоп: публичные эндпоинты, регистрация вне инвайта]** | ✅ |
| 18.A3 | Профиль компании, справочник вузов, заявка на допуск (`career/companies/me/*`) | ✅ |
| 18.A4 | Очередь заявок вуза и решения по ним (`career/university/companies`); scope из токена, не из пути | ✅ |
| 18.A5 | `CareerAccessService`: единая точка ответа «видит ли компания студентов этого вуза», кэш в Redis со сбросом при решении | ✅ |
| 18.A6 | Отзыв допуска закрывает вакансии компании в этом вузе; отклики и контакт работодателя сохраняются | ✅ |
| 18.B1 | `CareerProfile` и `CareerConsent`; видимость `HIDDEN` по умолчанию | ✅ |
| 18.B2 | Согласия на `GPA`/`PHONE`/`EMAIL`; поля режутся на уровне `select`, а не скрытием в UI | ✅ |
| 18.B3 | Карточка кандидата для работодателя: допуск → видимость → согласия, три фильтра в одном месте | ✅ |
| 18.C1 | `Vacancy` и `VacancyUniversityReview`: решение на пару «вакансия ↔ вуз» | ✅ |
| 18.C2 | CRUD и жизненный цикл вакансии у работодателя (`DRAFT|PUBLISHED|PAUSED|CLOSED`) | ✅ |
| 18.C3 | Модерация вакансий вузом; студент видит только одобренное **его** вузом | ✅ |
| 18.C4 | Витрина и карточка вакансии с процентом совпадения по навыкам | ✅ |
| 18.D1 | `CareerApplication` + `CareerApplicationEvent`: статус на записи, полная история переходов | ✅ |
| 18.D2 | Отклик, отзыв, история у студента; воронка и смена статуса у компании | ✅ |
| 18.E1 | `Resume`: сборка на лету из профиля и портфолио, без снимка данных | ✅ |
| 18.E2 | Публичная ссылка `/r/resume/:slug` и PDF; контакты — по явному флагу | ✅ |
| 18.F1 | Карьерные мероприятия поверх `Event.careerKind` (своей сущности нет намеренно) | ✅ |
| 18.F2 | Сводка вуза `GET /career/analytics/university`, ряды считаются в SQL | ✅ |
| 18.F3 | Отчёт за период + выгрузка XLSX/CSV через `ExportBrandingService`, порог малых групп по факультетам | ✅ |
| 18.G1 | Зона `/employer`: вакансии, кандидаты, компания, допуски | ✅ |
| 18.G2 | Раздел `/career` для студента и сотрудников вуза, навигация по ролям | ✅ |
| 18.G3 | Сид: компании, вакансии, отклики (`prisma/seed/steps/15-companies.mjs`, `80-career.mjs`) | ✅ |
| 18.H1 | Unit-спеки сервисов модуля, включая ролевую матрицу и scope | ✅ |
| 18.H2 | E2E сквозного потока: регистрация → подтверждение → допуск → публикация → модерация → отклик → воронка (`apps/api/test/career.e2e-spec.ts`) | ✅ |

**Продолжения:**

| Продолжение | Статус |
|---|---|
| Web-e2e зоны работодателя | ⬜ упирается в стенд: демо-сид не создаёт аккаунт `EMPLOYER`, а бюджет входов в прогоне — 5 на IP (`e2e/support/sign-in.ts`). Нужен отдельный PR по инфраструктуре стенда |
| Несколько версий резюме под разные профессии | ⬜ снимается `@unique` на `Resume.userId` + поле `title` |
| Явка на карьерных мероприятиях | ⬜ `EventParticipant` фиксирует только запись; без явки строки по мероприятиям в отчёте нет намеренно |

**Отзыв допуска — принятое поведение (18.A6).** Вуз отзывает допуск → вакансии компании в
**этом** вузе закрываются: `decideAccess` одной транзакцией с отзывом гасит все решения
`VacancyUniversityReview` компании по этому вузу (и `APPROVED`, и `PENDING`) в `REJECTED`
с причиной «Университет отозвал допуск компании». Вакансия уходит с витрины, не открывается
по прямой ссылке и не принимает новых откликов; вузы, где допуск остался, не затрагиваются.

Отдельного статуса `REVOKED` у решения нет намеренно — это контракт с фронтом (стоп-точка
§0.1.3), а `REJECTED` с причиной читается так же и корректно переигрывается: вернут допуск,
компания опубликует заново, вуз рассмотрит с чистого листа.

**Уже поданные отклики при этом сохраняются полностью** — вместе со связью с работодателем
вне платформы: выборка откликов студента намеренно не фильтруется по решениям вуза, а в
карточке отклика остаются название компании, её сайт и вся история статусов. Человек мог
дойти до интервью, и обрывать ему контакт на середине решением вуза нельзя.

---

## Фаза 19 — Крупные файлы: многочастная загрузка с докачкой

> Цель — вложения до 500 МБ (видео). Буферный путь через API для этого не годится в принципе:
> файл целиком ложится в память процесса, и поднятие лимитов даёт OOM на втором одновременном
> отправителе, а не работающую загрузку. Значит только presigned напрямую в MinIO — он в проекте
> уже есть (`POST /files/presign` → PUT → `confirmDirectUpload`), но одним запросом: оборванная
> на 80 % заливка полумегабайтного ролика начинается заново.
>
> Отсюда многочастная загрузка: файл режется на части, каждая заливается по своей подписанной
> ссылке, сборка — на сервере. Ключевое ограничение, определившее схему докачки: в `minio@8.0.7`
> метод `listParts` объявлен `protected`, то есть сервер не может отдать список уже залитых
> частей. `ETag`'и хранит клиент — он их всё равно обязан иметь, без них не собрать `complete`.
>
> Порядок задач не совпадает с логикой рассказа: 19.1 не зависит от 19.0 и делается первым,
> потому что прямая загрузка уже используется материалами и документами. 19.5 (уборка) идёт
> раньше 19.4 (докачка): как только появятся многочастные загрузки, появится и мусор от
> прерванных, и подмести его должно быть кому.

| # | Задача | Статус |
|---|---|---|
| 19.1 | Маршруты `multipart/start|urls|complete|abort`, проверка владения ключом **[стоп: shared-schemas]** | ✅ |
| 19.2 | Константы: порог, размер части, `MAX_BYTES.VIDEO` → 500 МБ | ✅ |
| 19.3 | Клиент: нарезка, 3–4 части параллельно, ретрай части, агрегированный прогресс, отмена | ✅ |
| 19.5 | Уборка незавершённых загрузок: sweep в `CleanupService` + правило на бакете | ✅ |
| 19.4 | Докачка: состояние в IndexedDB по отпечатку файла, дозалив недостающих частей | ✅ |
| 19.6 | `docs/RAILWAY.md`: CORS бакета, размер тома, почему лимиты API здесь ни при чём | ✅ |
| 19.0 | Вложения чата на прямую загрузку: бакет `chat-media` в presign, отправка по ключам | ✅ |

**Решения, которые нельзя переоткрывать по ходу:**

- Сборку (`completeMultipartUpload`) делает сервер, а не подписанная ссылка. Иначе `confirmDirectUpload`
  не увидит объект и проверка типа по magic bytes (§14.9) исчезнет — а это единственное, что мешает
  положить SVG со скриптом под видом видео.
- Владение проверяется в каждом маршруте по префиксу `ownerId/` ключа. Без этого по чужому
  `uploadId` дописывается часть в чужой объект.
- Ссылки на части выдаются пачкой. 500 МБ частями по 10 МБ — это 50 частей, и по запросу на
  каждую упрётся в троттлер выдачи подписей (60/мин).
- Минимальный размер части у S3/MinIO — 5 МиБ (кроме последней). Меньше брать нельзя.
- Докачка переживает перезагрузку вкладки и обрыв сети, но не смену устройства и не очистку
  данных сайта. Это граница, а не недоделка.

**Грабли, на которые наступают все:** браузер не увидит `ETag` из ответа MinIO без `ExposeHeaders: ETag`
в CORS-политике бакета. Части зальются, а `complete` собрать будет нечем — и выглядит это как
случайный сбой в самом конце длинной загрузки.

## Фаза 20 — Библиотека

> Цель — бумажный формуляр библиотеки вуза в платформе: кто взял какой экземпляр и до
> какого срока, кто должник, что можно забронировать. Библиотекарь — отдельная роль с
> запретом по умолчанию, как у охраны: ему открыт только явный список маршрутов.
>
> Удостоверение читателя — уже существующий цифровой студенческий: разовый подписанный QR
> (`student-id`) подтверждает, что книгу берёт именно этот человек. Пока выдача открыта,
> библиотекарь видит карточку читателя без повторного QR — и каждый такой просмотр пишется
> в журнал.

### 20.0 Решения (владелец, 22.10.2026)

| Вопрос | Решение |
|---|---|
| Кто берёт книги | студенты и старосты своего вуза — у обоих есть цифровой студенческий |
| Учёт | по экземплярам: инвентарный номер и QR-наклейка на каждом |
| Просрочка | напоминания и запрет новых выдач и броней, пока книга не вернётся |
| Выпуск и отчисление | предупреждение и список долгов при смене статуса студента, без жёсткого запрета |
| Студенту | поиск по каталогу и бронь |
| Кто выдаёт книги | только библиотекарь; админ вуза настраивает модуль, но не выдаёт |

Значения по умолчанию (`LibrarySettings`, меняет админ вуза): срок выдачи 14 дней, максимум
120 (учебник на семестр), 5 книг на руках, 3 активные брони, готовая бронь держится 3 дня,
1 продление (делает библиотекарь). Удостоверение видно весь срок займа, при просрочке — до
возврата.

### 20.1 Модель данных (эскиз — НЕ применять до согласования)

- `LibrarySettings` — настройки вуза и выключатель модуля.
- `Book` — карточка каталога: название, авторы, ISBN, год, издательство, раздел, обложка.
- `BookCopy` — экземпляр: книга, инвентарный номер (уникален в вузе), код для QR (§13.2
  `BACKEND_RULES` — отдельная короткая величина, не `id`), статус, состояние, заметка.
- `Loan` — выдача: экземпляр, читатель, кто выдал, когда, срок, продления, кто принял,
  когда вернули, состояние при возврате + снимок читателя на момент выдачи (ФИО, группа,
  № билета): история не должна рассыпаться после отчисления.
- `Reservation` — бронь на книгу (не экземпляр): читатель, статус, назначенный экземпляр,
  до какого времени держится.
- `LibraryIdAccessLog` — просмотр удостоверения библиотекарем: кто, чьё, по какой выдаче,
  когда, IP. Устроен как журнал просмотров камер.

### 20.2 Ролевая матрица

| Действие | Студент / староста | Библиотекарь | Админ вуза |
|---|---|---|---|
| Поиск по каталогу | ✅ | ✅ | ✅ |
| Бронь, отмена своей брони | ✅ | — | — |
| «Мои книги», «Мои брони» | ✅ | — | — |
| Каталог и экземпляры (создать, править, списать) | ❌ | ✅ | ✅ |
| Выдача, возврат, продление | ❌ | ✅ | ❌ |
| Удостоверение читателя на время займа | ❌ | ✅ (журнал) | ❌ |
| Отчёты и просрочки | ❌ | ✅ | ✅ |
| Выключатель модуля, настройки | ❌ | ❌ | ✅ |
| Инвайт библиотекарю | — | — | ✅ |

### 20.3 Статусы

- Экземпляр: `AVAILABLE` → `RESERVED` → `ON_LOAN` → `AVAILABLE`; `LOST`, `WRITTEN_OFF`.
- Выдача: `OPEN` → `RETURNED` | `LOST`. «Просрочена» не хранится — считается по сроку.
- Бронь: `QUEUED` → `READY` → `FULFILLED`; выход — `CANCELLED` | `EXPIRED`.

### 20.4 Задачи (одна задача = один PR)

| # | Задача | Результат | Статус |
|---|---|---|---|
| 20.1 | Роль `LIBRARIAN`: enum, инвайт только от `UNIVERSITY_ADMIN`, 2FA обязательна. Запрет по умолчанию обобщён с охраны на реестр ограниченных ролей **[стоп: shared-types, guard]**. Раздел `/library`, навигация, i18n, сид | Библиотекарь входит и видит только свою зону; любой чужой эндпоинт — `403` | ✅ |
| 20.2 | Модель данных и миграция (20.1), `LibrarySettings`, выключатель модуля у админа вуза **[стоп: миграция]** | `prisma validate`; модуль выключен — ручки библиотеки отвечают `409` | ✅ |
| 20.3 | Каталог и экземпляры: CRUD, поиск (название, автор, ISBN), печать QR-наклеек (по образцу помещений), импорт CSV/XLSX | Фонд заводится таблицей, наклейки печатаются | ✅ |
| 20.4 | Выдача: скан студенческого (разовый QR) → проверки (статус «учится», лимит, нет просрочек) → скан экземпляра → срок. Уведомление читателю с кнопкой «Это не я» | Выдача из двух сканов; отказ объясняется кодом ошибки | ✅ |
| 20.5 | Возврат и продление: скан экземпляра, состояние, «утерян». Выдачу и возврат нельзя править — только отменять с записью в аудит | История экземпляра полная и непротиворечивая | ✅ |
| 20.6 | Удостоверение на время займа: карточка из открытой выдачи (урезанный набор, как у охраны), журнал просмотров **[стоп: PERSONAL_DATA §4]** | После возврата карточка — `403` | ✅ |
| 20.7 | Напоминания (за 2 дня, в день срока, просрочка; крон в поясе вуза) и запрет выдач и броней должнику | Должник получает уведомления, новую книгу ему не выдать | ✅ |
| 20.8 | Бронь: очередь по книге, возвращённый экземпляр откладывается первому, готовая бронь истекает | Бронь доходит до выдачи без ручного учёта | ✅ |
| 20.9 | Студенту в вебе: каталог с наличием, бронь, «Мои книги», «Мои брони» | Студент сам находит и бронирует книгу | ✅ |
| 20.10 | То же в iOS и Android | Экраны во всех трёх клиентах | ✅ iOS и Android — без сборки |
| 20.11 | Выпуск и отчисление: предупреждение о книгах на руках и список долгов при смене статуса; справка «задолженностей в библиотеке нет» | Книги не теряются при выпуске | ✅ |
| 20.12 | Отчёты (на руках, просрочки, популярное, история экземпляра) и инвентаризация сканом | Библиотекарь видит фонд и должников | ✅ |

Порядок: 20.1 → 20.2 → 20.3 → (20.4, 20.5, 20.6) → 20.7 → 20.8 → 20.9 → 20.10 → 20.11 → 20.12.
Минимальный рабочий вариант — 20.1–20.7: выдача, возврат и просрочки без брони.

### 20.5 Стоп-точки фазы

1. 20.1 — новая роль в `packages/shared-types` (контракт с фронтом и клиентами) и обобщение
   guard'а, через который работает охрана. Согласовано владельцем 22.10.2026.
2. 20.2 — миграцию показываем SQL'ем, применяет человек; на Railway — вручную.
3. 20.6, 20.11 — срок хранения истории выдач и журнала просмотров вписать в
   `docs/PERSONAL_DATA.md` §4. Решение человека, по праву РК — и юриста.

### 20.6 Приёмка фазы

```
□ Библиотекаря приглашает только админ вуза; без 2FA он не входит
□ Выдача — скан студенческого + скан экземпляра; должнику выдать нельзя
□ Удостоверение видно только по открытой выдаче, каждый просмотр — в журнале
□ Напоминания приходят в поясе вуза; просрочка блокирует выдачу и бронь
□ Бронь доходит до «готова» после возврата экземпляра и истекает сама
□ Студент видит каталог, свои книги и брони в вебе, iOS и Android
□ При выпуске или отчислении видно, что за студентом числятся книги
```

## Фаза 21 — Пробелы после аудита (23.10.2026)

> Аудит плана против кода после слияния библиотеки. Здесь собрано то, что фазы 13–20 не учли
> или оставили наполовину: клиенты отстают от веба, крупные файлы докачиваются только в чатах,
> у библиотеки и карьеры есть дыры по жизненному циклу пользователя, а запрет для ограниченных
> ролей держится на одном guard'е с unit-тестами на моках.
>
> Задачи с пометкой **[решение владельца]** не начинать, пока владелец не ответит на вопрос из
> 21.0. Остальные можно брать в любом порядке внутри зоны, приоритет указан в «Порядке».

### 21.0 Решения владельца (23.10.2026)

| Вопрос | Задача | Решение |
|---|---|---|
| Какие экраны охраны и библиотекаря нужны в приложении | 21.A2 | **Все.** Приложение повторяет веб-зоны охраны и библиотекаря целиком, включая каталог, отчёты и инвентаризацию |
| Какие данные видят охрана и библиотекарь | 21.A2, 21.C5 | **Только те, что нужны их работе.** У каждой роли свой урезанный набор полей: охрана — для проверки на входе, библиотекарь — для выдачи и долгов. Остальные данные профиля им не отдаются ни в вебе, ни в приложениях, причём режутся на уровне `select`, а не в интерфейсе |
| Как обслужить читателя без телефона | 21.C5 | **Библиотекарь обязан это отметить.** Без скана QR выдача проходит только с явной отметкой «читатель без телефона». Отметка хранится в выдаче и попадает в журнал удостоверения |
| Что с открытой выдачей при удалении аккаунта | 21.C1 | **Удалить аккаунт нельзя, пока есть выдача.** `DELETE /users/me` отвечает `409` со списком книг на руках. Сначала вернуть книги |
| Можно ли удалять вакансию | 21.D3 | **Да.** Черновик удаляется физически. Опубликованную и закрытую удалить нельзя, только закрыть: на ней история откликов |
| Что делать, если студент со скрытым профилем откликается на вакансию | 21.D1 | **Открыт.** Предложение: предупредить при отклике и одной галочкой открыть профиль только этой компании. Сам по себе отклик профиль не раскрывает |

### 21.A Мобильные клиенты (iOS, Android)

| # | Задача | Результат |
|---|---|---|
| 21.A1 | Цифровой студенческий: разовый подписанный QR (`student-id`) с обновлением по таймеру, яркость экрана на максимум, пока QR открыт | Студент берёт книгу и проходит охрану с телефона, без веба |
| 21.A2 | Роли `SECURITY_GUARD` и `LIBRARIAN` вместо экрана неподдерживаемой роли: все экраны их веб-зон (21.0), только маршруты из реестра ограниченных ролей, обязательная 2FA при входе. Данные — урезанный набор своей роли, без остального профиля. Объёмная задача: делить на PR по роли и клиенту | Охранник и библиотекарь работают с телефона так же, как в вебе; библиотекарь выдаёт и принимает книги камерой |
| 21.A3 | Раздел «Карьера» для студента: витрина, карточка вакансии с совпадением навыков, отклик и его отзыв, «Мои отклики», видимость профиля и согласия | Паритет с вебом (18.G2) |
| 21.A4 | Загрузка частями с докачкой по маршрутам Ф19 (`multipart/start`, `urls`, `complete`, `abort`). На iOS файл читается потоком с диска, а не целиком в `Data` | Ролик на 500 МБ не роняет приложение по памяти и переживает обрыв сети |
| 21.A5 | Английский язык в iOS и Android, казахский для 66 строк iOS без перевода. Страж в тестах на одинаковый набор ключей во всех языках, как `messages.test.ts` в вебе | Три языка в каждом клиенте, новая строка без перевода не проходит тесты |

Порядок: 21.A1 → 21.A2 → 21.A5 → 21.A4 → 21.A3. Без 21.A1 студенту с приложением всё равно
нужен веб, чтобы взять книгу.

### 21.B Веб

| # | Задача | Результат |
|---|---|---|
| 21.B1 | Многочастная загрузка с докачкой для материалов, документов и заданий: тот же загрузчик, что в чатах (19.3, 19.4), вместо одного PUT. Проверить, что бакеты этих модулей принимает `multipart/start` | Файл до 500 МБ в любом модуле докачивается после обрыва |
| 21.B2 | Тексты валидации пароля, логина и даты рождения в `shared-schemas`: коды-ключи вместо русских строк, перевод на фронте и в клиентах **[стоп: shared-schemas]** | Пользователь на kk и en видит ошибку на своём языке |
| 21.B3 | Живое обновление очередей декана, админа и модератора вуза: событие обработчикам при подаче, смене статуса и назначении заявки, на фронте инвалидация списка. Новое WS-событие вносится в `PROJECT.md` | Очередь меняется без перезагрузки страницы |

### 21.C Библиотека

| # | Задача | Результат |
|---|---|---|
| 21.C1 | Удаление аккаунта. При открытой выдаче `DELETE /users/me` отвечает `409` с новым кодом ошибки и списком книг на руках; в вебе и клиентах — понятное объяснение до подтверждения удаления. Без выдач — в той же транзакции обезличить снимок читателя в `Loan` и `LibraryIdAccessLog` и перевести активные брони в `CANCELLED` **[стоп: формат ответа API, PERSONAL_DATA §4–5]** | С книгой на руках аккаунт не удалить; после удаления ни ФИО, ни брони человека в библиотеке не остаётся |
| 21.C2 | Очередь брони: при отчислении, выпуске, блокировке и удалении брони читателя снимаются, а при откладывании возвращённого экземпляра такой читатель пропускается | Книга не лежит 3 дня отложенной для того, кто её уже не возьмёт |
| 21.C3 | Отчисление должника: уведомление библиотекарям вуза в момент смены статуса и пометка «отчислен» в отчёте о просрочках. Предупреждение декану в форме остаётся | Библиотекарь узнаёт о долге уходящего студента в тот же день |
| 21.C4 | Справка «задолженностей в библиотеке нет» с кодом проверки и QR через `DocumentExport`, по образцу справки об обучении, плюс её отзыв | Справку проверяют по коду, подделка не проходит |
| 21.C5 | Выдача без телефона: библиотекарь находит читателя по номеру студенческого билета, сверяет ФИО и фото и ставит обязательную отметку «читатель без телефона». Без отметки выдача только по скану QR. Отметка хранится в `Loan` и пишется в журнал удостоверения; в отчётах выдачи без скана видны отдельно **[стоп: миграция]** | Студенту без телефона можно выдать книгу, и каждая такая выдача видна |
| 21.C6 | Статусы, блокирующие выдачу: одна общая константа, из которой берут значения и справочник `ACADEMIC_STATUS_DICT` в вебе, и `BLOCKED_ACADEMIC_STATUSES` в `library-loans.service.ts`. Академический отпуск — явно в списке «не блокирует». Тест-страж на расхождение | Переименование статуса в справочнике не откроет выдачу отчисленному |

Порядок: 21.C6 → 21.C2 → 21.C3 → 21.C1 → 21.C4 → 21.C5. 21.C6 идёт первой: на ней держатся
21.C2 и 21.C3.

### 21.D Карьера

| # | Задача | Результат |
|---|---|---|
| 21.D1 | Скрытый профиль и отклик **[решение владельца]**. Минимум без решения — предупреждение на форме отклика, что работодатель не увидит профиль | Студент знает, что видит компания, до того как откликнуться |
| 21.D2 | Приглашение коллеги в компанию: `OWNER` приглашает по почте, приглашённый регистрируется по ссылке и становится `CompanyMember` с ролью `RECRUITER`; отзыв участника **[стоп: публичный эндпоинт, создание пользователя]** | В компании работает больше одного человека |
| 21.D3 | Удаление вакансии: `DELETE` только для `DRAFT`, для остальных статусов — `409` с подсказкой закрыть вакансию. Кнопка «Удалить» у черновика в зоне работодателя | Черновик можно удалить, история откликов не теряется |

### 21.E Тесты

| # | Задача | Результат |
|---|---|---|
| 21.E1 | API e2e охраны и библиотекаря на настоящей БД: разрешённые маршруты отвечают, а все остальные из `openapi.json` перебором — `403`. Список чужих маршрутов не пишется руками | Запрет по умолчанию проверен не на моках, а сквозным прогоном |
| 21.E2 | API e2e библиотеки (выдача → продление → возврат → бронь → «готова» → истечение, должник) и документов (загрузка, предоставление вузу, отзыв доступа) | Два модуля без e2e получают сквозной прогон |
| 21.E3 | Web-e2e для остальных ролей: админ вуза, преподаватель, староста, охрана, библиотекарь, работодатель. Упирается в бюджет входов 5 на IP (`e2e/support/sign-in.ts`) и в сид без `EMPLOYER` — то же, что продолжение Ф18 | Веб-e2e логинит каждую роль, а не только студента и декана |
| 21.E4 | Гонка двойной регистрации по одному инвайту (параллельные запросы → один пользователь, второй `410`). Подмена `role`, `universityId`, `facultyId`, `groupId` в теле регистрации и создания инвайта → игнорируется или `403` | Пункты приёмки Ф1, проверенные вручную, закреплены тестами |

### 21.F Контракт в `PROJECT.md`

| # | Задача | Результат |
|---|---|---|
| 21.F1 | `application:updated` и `story:new` описаны, но не отправляются. Студенту на деле уходит `application.status.changed` (`REALTIME_EVENTS`). Привести реестр к коду; если `story:new` не нужен — убрать | Реестр событий совпадает с тем, что шлёт сервер |
| 21.F2 | Описать `chat:block` и `chat:pinned`: когда отправляются, кому, полезная нагрузка | — |
| 21.F3 | Внести в реестр 6 недостающих эндпоинтов. Сверять с `apps/api/openapi.json`, а не по памяти | Реестр эндпоинтов полный |

### 21.1 Стоп-точки фазы

1. 21.B2 — меняется схема в `packages/shared-schemas`: контракт с вебом и обоими клиентами.
2. 21.C1 — обезличивание и сроки хранения вписать в `docs/PERSONAL_DATA.md` §4–5. Решение
   человека, по праву РК — и юриста.
3. 21.C1 — новый код ошибки в ответе `DELETE /users/me`: в реестр кодов `shared-types` и в
   `PROJECT.md`. 21.C5 — поле отметки в `Loan`: миграцию показываем SQL'ем, применяет человек.
4. 21.D2 — новый публичный эндпоинт, создающий пользователя вне инвайта вуза. Согласовать
   так же, как 18.A2.
5. 21.B3 — новое WS-событие: вносится в `PROJECT.md` в том же PR.

### 21.2 Приёмка фазы

```
□ Студент берёт книгу и проходит охрану только с приложением, без веба
□ Охранник и библиотекарь входят в iOS и Android и работают со своих экранов
□ Ролик на 500 МБ докачивается после обрыва в чатах, материалах, документах, заданиях
  и в обоих приложениях
□ Ошибки валидации — на языке пользователя; iOS и Android полные на ru/kk/en
□ Очередь заявок декана обновляется без перезагрузки
□ Удалённый или отчисленный читатель исчезает из очереди брони и из снимков ФИО
□ С книгой на руках аккаунт не удалить; выдача без телефона — только с отметкой
□ Охрана и библиотекарь видят только поля, нужные их работе
□ Справку «задолженностей нет» можно проверить по коду
□ Студент знает до отклика, увидит ли работодатель его профиль
□ e2e охраны, библиотекаря, библиотеки и документов зелёные; гонка регистрации покрыта
□ Реестры эндпоинтов и WS-событий в PROJECT.md совпадают с кодом
```

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
1. pnpm db:seed   (корневой скрипт; на Railway — только вручную, workflow Seed)
   → PLATFORM_ADMIN: admin@studenthub.app / Admin1234!  (локально; в проде — SEED_PASSWORD)
   → dev-инвайт для UNIVERSITY_ADMIN
2. Войти как PLATFORM_ADMIN → создать реальный университет;
   при необходимости выдать инвайт PLATFORM_MODERATOR
3. Выдать инвайт UNIVERSITY_ADMIN → зарегистрировать администратора вуза
4. Администратор вуза:
   - создать факультеты и группы;
   - выдать инвайты DEAN, TEACHER, UNIVERSITY_MODERATOR;
   - выдать инвайты SECURITY_GUARD и LIBRARIAN (обоим при первом входе нужна 2FA);
   - включить библиотеку: настройки библиотеки → выключатель модуля (по умолчанию
     выключен, ручки библиотеки до этого отвечают 409), проверить сроки и лимиты
5. Декан: выдать инвайты STAROSTA и STUDENT (староста тоже может приглашать студентов)
6. Работодатели инвайт не получают: компания регистрируется сама
   (/career/companies/signup), подтверждает почту и подаёт заявку на допуск;
   админ вуза одобряет её в очереди заявок компаний
7. Отозвать dev-инвайт из seed
```
