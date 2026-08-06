# StudentHub — Правила разработки Backend

> Обязательный регламент для `apps/api` (NestJS + Fastify + Prisma).
> Читается агентом (Claude Code / Codex) **до** написания любого кода в бэкенде.
> Версия: 1.0 · Последнее обновление: 2026-07

---

## 0. Приоритет источников правил

Когда правила противоречат друг другу, приоритет сверху вниз:

| # | Источник | Статус |
|---|---|---|
| 1 | Этот документ (`docs/BACKEND_RULES.md`) | Абсолютный приоритет |
| 2 | `docs/PROJECT.md` — архитектура и контракты | Источник истины по данным и API |
| 3 | Существующий код в `apps/api/src/modules/*` | Образец для нового кода |
| 4 | Плагин-скиллы `sevenhillskz:*` | Применять **только** там, где не противоречат п.1–2 |

### Явные отклонения от плагин-скиллов (не «исправлять»)

| Скилл говорит | В этом проекте | Причина |
|---|---|---|
| DTO через `class-validator` | **Zod** через `packages/shared-schemas` | Единая схема валидации для API и фронта |
| `npm run ...` | **`pnpm`** + Turborepo | Монорепо на pnpm workspaces |
| Express-адаптер по умолчанию | **Fastify** (`@nestjs/platform-fastify`) | Производительность |
| `postgres:17-alpine` | **`postgres:16-alpine`** | Зафиксировано в `docker-compose.yml` |
| Формат ошибки `{ statusCode, message, error }` | `{ success, error: { code, message, details } }` | Контракт фронтенда (`docs/PROJECT.md` §API) |
| Одиночный `schema.prisma` | Multi-file схема в `prisma/schema/` | Схема на ~35 моделей |

---

## 1. Стек: что разрешено

| Слой | Разрешено | Запрещено |
|---|---|---|
| HTTP | `@nestjs/platform-fastify` | Express-адаптер, `body-parser` |
| Валидация | `zod`, `nestjs-zod` | `class-validator`, `joi`, ручные `if (!body.x)` |
| ORM | `@prisma/client` | Raw SQL без причины, TypeORM, Knex |
| Auth | `@nestjs/jwt`, `passport-jwt`, `passport-local`, `bcrypt` | Самописный JWT, `crypto.createHmac` для токенов |
| Очереди | `@nestjs/bullmq` + Redis | `setTimeout`, `setInterval`, in-process очереди |
| Cron | `@nestjs/schedule` | `node-cron`, внешний crontab |
| Файлы | `minio` SDK + `@fastify/multipart` | `multer` (несовместим с Fastify), локальный диск |
| Безопасность | `@fastify/helmet`, `@nestjs/throttler` | Отключение helmet «чтобы заработало» |
| Логи | `pino` / `nestjs-pino` | `console.log`, `console.error` |
| WebSocket | `@nestjs/websockets` + `socket.io` | `ws` напрямую, SSE вместо WS |

> **Внимание:** в исходной документации указан `multer` и `helmet`. С Fastify-адаптером использовать `@fastify/multipart` и `@fastify/helmet`. Это не отклонение от архитектуры, а исправление технической ошибки.

Новая зависимость добавляется **только** отдельным коммитом `chore(deps): ...` с обоснованием в описании PR.

---

## 2. Структура кода

```
apps/api/src/
├── modules/<feature>/
│   ├── <feature>.module.ts
│   ├── <feature>.controller.ts
│   ├── <feature>.service.ts
│   ├── dto/                      # createZodDto-обёртки над shared-schemas
│   ├── <feature>.service.spec.ts
│   └── (gateway|processor|cron).ts   # если нужны
├── common/
│   ├── guards/                   # JwtAuthGuard, RolesGuard, ScopeGuard, JwtWsGuard
│   ├── decorators/               # @Roles, @CurrentUser, @Public, @Scope
│   ├── filters/                  # HttpExceptionFilter
│   ├── interceptors/             # ResponseInterceptor, LoggingInterceptor, AuditInterceptor
│   ├── pipes/                    # ZodValidationPipe
│   └── prisma/                   # PrismaModule, PrismaService
├── config/                       # ConfigModule + Zod-валидация env
└── main.ts
```

### 2.1 Правило самодостаточности модуля

- Модуль владеет своими таблицами. **Прямой вызов `prisma.<чужаяТаблица>` из другого модуля запрещён.**
- Межмодульное взаимодействие — только через экспортируемый сервис (`exports: [PostsService]`).
- Циклические зависимости решаются вынесением общей логики в третий модуль, **не** через `forwardRef()`. `forwardRef()` допускается только для `AuthModule ↔ UsersModule` и требует комментария с обоснованием.

### 2.2 Один класс — один файл

`kebab-case` для имён файлов, `PascalCase` для классов:
`create-invite.dto.ts` → `CreateInviteDto`, `jwt-auth.guard.ts` → `JwtAuthGuard`.

---

## 3. Валидация: единственный способ

Все входные данные валидируются Zod-схемой из `packages/shared-schemas`. Схема в `apps/api` **не объявляется**.

```ts
// packages/shared-schemas/src/invites.ts
export const CreateInviteSchema = z.object({
  role:         z.nativeEnum(Role),
  email:        z.string().email().optional(),
  universityId: z.string().uuid().optional(),
  facultyId:    z.string().uuid().optional(),
  groupId:      z.string().uuid().optional(),
})
export type CreateInviteInput = z.infer<typeof CreateInviteSchema>
```

```ts
// apps/api/src/modules/invites/dto/create-invite.dto.ts
import { createZodDto } from 'nestjs-zod'
import { CreateInviteSchema } from '@studenthub/shared-schemas'

export class CreateInviteDto extends createZodDto(CreateInviteSchema) {}
```

`createZodDto` даёт одновременно валидацию и Swagger-схему (`patchNestJsSwagger()` в `main.ts`).

### Правила

- `ZodValidationPipe` регистрируется **глобально** в `main.ts`. Локальные пайпы — только для нестандартных случаев.
- Query-параметры валидируются так же строго, как body. `?limit=99999` должен отклоняться.
- `.strict()` на схемах создания/обновления — лишние поля отклоняются, а не игнорируются.
- Пароли: минимум 8 символов, буква + цифра + спецсимвол. Правило живёт в `PasswordSchema` в shared-schemas, дублировать не нужно.
- Изменение схемы в `shared-schemas` = breaking change контракта. Обязательно проверить всех потребителей на фронте (`grep`).

---

## 4. Формат ответа и ошибок

### 4.1 Успех — оборачивает `ResponseInterceptor` (глобальный)

```jsonc
{ "success": true, "data": { }, "meta": { "cursor": "uuid", "hasNext": true, "total": 100 } }
```

Сервис и контроллер возвращают **чистые данные**. Ручное формирование `{ success: true, data }` в контроллере — ошибка.

### 4.2 Ошибка — формирует `HttpExceptionFilter` (глобальный)

```jsonc
{
  "success": false,
  "error": { "code": "WRONG_SCOPE", "message": "...", "details": [] },
  "statusCode": 403,
  "timestamp": "2026-01-15T10:30:00.000Z",
  "path": "/api/v1/faculties/uuid"
}
```

### 4.3 Реестр кодов ошибок

Коды — часть публичного контракта. Новый код добавляется в `packages/shared-types/src/error-codes.ts` **и** в `docs/PROJECT.md`.

| HTTP | code | Ситуация |
|---|---|---|
| 400 | `BAD_REQUEST` | Некорректный запрос |
| 401 | `UNAUTHORIZED` | Токен отсутствует или невалиден |
| 401 | `TOKEN_EXPIRED` | Access-токен истёк → фронт делает refresh |
| 403 | `FORBIDDEN` | Роль не подходит |
| 403 | `WRONG_SCOPE` | Ресурс не из своего университета/факультета/группы |
| 404 | `NOT_FOUND` | Ресурс не найден |
| 409 | `CONFLICT` | Нарушение уникальности |
| 410 | `INVITE_EXPIRED` / `INVITE_USED` / `INVITE_REVOKED` | Состояние инвайта |
| 422 | `VALIDATION_ERROR` | Ошибка Zod, с `details[]` |
| 429 | `RATE_LIMIT` | Throttler |
| 500 | `INTERNAL_ERROR` | Необработанная ошибка |

### 4.4 Правила выброса ошибок

- Сервис бросает NestJS-исключения (`NotFoundException`, `ForbiddenException`, …), не возвращает `null` как признак ошибки.
- Prisma-ошибки перехватываются **в сервисе** и конвертируются: `P2002 → ConflictException`, `P2025 → NotFoundException`, `P2003 → BadRequestException`. Сырая Prisma-ошибка наружу не уходит никогда.
- `TOKEN_EXPIRED` отличается от `UNAUTHORIZED` — фронт различает их для авто-refresh. Не схлопывать.
- Различать 403 `FORBIDDEN` (нет прав по роли) и 403 `WRONG_SCOPE` (роль подходит, но чужой ресурс).
- Сообщения об ошибках — **на русском**, но клиент реагирует на `code`, не на `message`.
- Stack trace в ответе — запрещён при `NODE_ENV=production`.
- `catch (e) {}` без обработки — запрещено. Минимум: `this.logger.error(...)` с контекстом.

---

## 5. Prisma

### 5.1 Схема

- Multi-file: `prisma/schema/_base.prisma`, `_enums.prisma`, `NN-<domain>.prisma`.
- Модели `PascalCase`, поля `camelCase`, таблицы `@@map("snake_case")` — обязательно для каждой модели.
- Все связи объявляют `onDelete` и `onUpdate` явно. Отсутствие `onDelete` — блокирующее замечание на ревью.
- `@@index` обязателен на: все внешние ключи, поля частой фильтрации (`audience`, `status`, `expiresAt`, `createdAt`), составные лукапы (`[groupId, dayOfWeek]`, `[chatId, createdAt]`).
- Soft delete через `deletedAt` для `User`, `Post`, `Comment`, `Message`, `ApplicationRequest`. **Любой** запрос по этим моделям содержит `where: { deletedAt: null }`.
- `prisma validate` и `prisma format` — перед каждой генерацией миграции.

### 5.2 Миграции

- Существующие файлы в `prisma/migrations/` **никогда** не редактируются.
- `--accept-data-loss` и `prisma db push` на dev/staging/prod — запрещены. `db push` допустим только для тестовой БД в CI.
- SQL миграции читается глазами перед применением. Агент **обязан** показать SQL пользователю и дождаться подтверждения перед `migrate dev` на непустой БД.
- Одна миграция = одно логическое изменение. Имя: `add_invite_status`, `add_index_posts_audience`.

### 5.3 Запросы

- `findMany()` без `take` — запрещено. Максимум 100 записей на страницу.
- Ленты и списки сообщений — **cursor-пагинация** (`cursor` + `skip: 1` + `take`), не `offset`. Offset допустим только в админских таблицах с явным номером страницы.
- `include` вместо цикла запросов. N+1 — блокирующее замечание.
- `select` с перечислением полей на всех «тяжёлых» чтениях (лента, список пользователей). `passwordHash` не должен покидать сервис никогда — исключать через `select`, а не фильтровать после.
- Многошаговые записи — в `prisma.$transaction()`. Обязательно для: регистрации по инвайту (создание User + пометка Invite), смены статуса заявки (update + запись в history), ротации refresh-токена.
- Глубина вложенных relations — не более 2 уровней в ответе API.

---

## 6. Аутентификация и авторизация

### 6.1 Три уровня guard на каждый запрос

```
JwtAuthGuard   (глобальный, снимается @Public())
      ↓
RolesGuard     (@Roles(Role.DEAN, Role.UNIVERSITY_ADMIN))
      ↓
ScopeGuard     (universityId / facultyId / groupId из токена = scope ресурса)
```

- `JwtAuthGuard` регистрируется глобально. Публичные эндпоинты помечаются `@Public()` — их полный список: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/register-by-invite`, `POST /auth/logout`, `GET /invites/:token/preview`, `GET /health`, `GET /` (корневой пинг). Расширение списка требует явного согласования.
  - `POST /auth/logout` публичный намеренно: выход должен работать при истёкшем access-токене (иначе пользователь не сможет разлогиниться и очистить cookie). Безопасен — инвалидирует ТОЛЬКО сессию из refresh-cookie самого вызывающего; CSRF гасится `SameSite=Lax` (cookie не уходит на cross-site POST). Проверено аудитом §13.5.
  - `GET /` — статический пинг `{ name, version }`, без данных.
- Эндпоинт без `@Roles()` доступен всем аутентифицированным. Если это не так — `@Roles()` обязателен.
- **`ScopeGuard` не заменяет проверку в сервисе.** Guard проверяет заявленный scope; сервис дополнительно проверяет фактическую принадлежность ресурса (`post.groupId === user.groupId`). Проверка только в guard — уязвимость.
- Роль **никогда** не берётся из body/query/header. Только из валидированного JWT-payload через `@CurrentUser()`.

### 6.2 Токены

| | Access | Refresh |
|---|---|---|
| Срок | 15 мин | 30 дней |
| Передача | `Authorization: Bearer` | httpOnly + Secure + SameSite=Lax cookie |
| Payload | `{ sub, role, universityId, facultyId, groupId }` | UUID, в БД хранится только bcrypt-хэш |
| Ротация | — | Новый при каждом refresh, предыдущий инвалидируется |

- Refresh-токен в открытом виде в БД не хранится.
- Повторное использование уже инвалидированного refresh-токена → инвалидация **всей** сессионной цепочки пользователя + запись в `AuditLog` уровня `warn`.
- Access-токен не пишется в cookie, refresh — не отдаётся в JSON body.
- Секреты — минимум 32 символа, только из env. Значения по умолчанию в коде запрещены: отсутствующий `JWT_ACCESS_SECRET` должен ронять приложение на старте (Zod-валидация env).

### 6.3 Rate limiting (`@nestjs/throttler`)

| Эндпоинт | Лимит |
|---|---|
| `POST /auth/login` | 5 / 15 мин с IP |
| `POST /auth/register-by-invite` | 3 / час с IP |
| `GET /invites/:token/preview` | 10 / час с IP |
| `POST /complaints` | 10 / час с пользователя |
| Остальные | 100 / мин с пользователя |

---

## 7. Инвайты — критичный модуль

Публичной регистрации не существует. `POST /users` для создания пользователя извне — не реализуется.

- Роль, `universityId`, `facultyId`, `groupId` берутся **из инвайта**, никогда из тела запроса регистрации. Форма регистрации принимает только имя, пароль, фото.
- Иерархия выдачи проверяется в `InviteService`: выдать можно только роль **строго ниже** своей и только в своём scope. Матрица — в `docs/PROJECT.md`.
- Токен одноразовый. Проверка статуса и срока — внутри той же транзакции, что и создание пользователя (защита от race condition при двойном клике).
- `preview` не раскрывает email получателя и `createdBy`.
- Каждое создание / использование / отзыв / истечение инвайта → `AuditLog`.
- Тесты на этот модуль обязательны и блокируют мёрж (см. §11).

---

## 8. Файлы и MinIO

- Никакой файл не пишется на локальный диск контейнера. Только MinIO.
- Бакеты и политики: `avatars` (публичный), `posts-media`, `stories-media` (TTL 24ч), `applications` (приватный, доступ только владельцу и деканату его факультета).
- Метаданные каждого файла — в таблице `File`. Файл без записи в БД считается мусором и удаляется cron-задачей.
- MIME-тип проверяется по **содержимому** (magic bytes), не по расширению и не по заголовку `Content-Type`.
- Лимиты: изображения 10 МБ, видео 100 МБ, документы 25 МБ. Значения — в `shared-config`, не хардкодом в модуле.
- Файлы > 10 МБ — только через presigned URL (прямая загрузка в MinIO), не через API-процесс.
- Ссылки на приватные бакеты выдаются presigned с TTL 15 минут. Постоянный публичный URL для приватного бакета — запрещён.
- Удаление сущности удаляет и объект в MinIO (в той же операции или через очередь `cleanup`). Осиротевшие объекты — баг.

---

## 9. Очереди (BullMQ) и cron

### 9.1 Что обязано уйти в очередь

Отправка email, push-уведомления, генерация превью, сжатие видео, массовая рассылка уведомлений по аудитории. HTTP-запрос **не ждёт** этих операций.

Очереди: `email`, `notifications`, `file-processing`, `cleanup`.

### 9.2 Правила job'ов

- Job идемпотентен: повторный запуск не создаёт дубликат уведомления или письма.
- Payload — только идентификаторы и минимум данных. Передавать целые объекты `User`/`Post` в job запрещено (данные устаревают, payload раздувается).
- `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`, `removeOnComplete: true`, `removeOnFail: false` — базовая конфигурация для всех job'ов.
- Ошибка в процессоре логируется с `jobId` и payload-идентификаторами и **пробрасывается** (иначе BullMQ считает job успешным).
- Отдельный процесс-воркер для очередей в production. В dev допустим встроенный.

### 9.3 Cron (`CleanupService`)

| Задача | Расписание |
|---|---|
| `expireInvites` | `0 * * * *` |
| `deleteExpiredStories` | `*/30 * * * *` |
| `scheduleEventReminders` | `*/15 * * * *` (см. замечание ниже) |
| `cleanOldNotifications` | `0 2 * * 0` |
| `cleanAuditLogs` | `0 1 1 * *` |

- Все cron-задачи — только в `CleanupService`. Разбрасывать `@Cron` по модулям запрещено.
- Каждая задача логирует количество обработанных записей.
- Задача обрабатывает записи **батчами** (`take: 500`) в цикле. `findMany()` без лимита в cron положит процесс, когда данных станет много.
- В multi-instance деплое cron выполняется только на одном инстансе (Redis-лок или отдельный worker-контейнер).

> **Исправление исходной документации:** в §24 `scheduleEventReminders` запускается в `0 3 * * *`, но ищет события через 1–2 часа — то есть напоминания придут только для событий в 04:00–05:00. Задача должна выполняться каждые 15 минут с окном `[now+55min, now+70min]` и дедупликацией отправленных напоминаний (флаг `reminderSentAt` в `Event`).

---

## 10. WebSocket (`ChatGateway`)

- Аутентификация в `handleConnection` через `JwtWsGuard` (токен в `socket.handshake.auth.token`). Невалидный токен → `client.disconnect()` немедленно.
- При подключении пользователь автоматически входит в комнаты `user:{id}`, `group:{groupId}`, `university:{universityId}`.
- В комнату `chat:{chatId}` — только по событию `chat:join` **после** проверки членства в чате в БД.
- Каждый входящий payload валидируется той же Zod-схемой, что и REST. WS — не «доверенный» канал.
- `server.emit()` на всех подключённых — запрещено. Только адресная рассылка по комнатам.
- Сообщение сначала сохраняется в БД, затем транслируется. Обратный порядок недопустим.
- Access-токен живёт 15 минут: gateway обрабатывает событие `auth:refresh` для обновления токена в живом соединении, не разрывая его.
- Реестр событий — в `docs/PROJECT.md`. Новое событие добавляется в реестр в том же PR.

---

## 11. Тестирование

100% покрытие не требуется. Требуется покрытие рисков.

| Приоритет | Что | Тип | Блокирует мёрж |
|---|---|---|---|
| 🔴 | `RolesGuard`, `ScopeGuard`, `JwtWsGuard` | unit | Да |
| 🔴 | `InviteService` (создание, иерархия, валидация, отзыв) | unit | Да |
| 🔴 | `ApplicationService.transitionStatus()` — матрица переходов | unit | Да |
| 🔴 | `POST /auth/register-by-invite`, `POST /auth/login`, `POST /auth/refresh` | e2e | Да |
| 🟡 | `PostsService` — audience-фильтр и cursor-пагинация | unit | Да |
| 🟡 | `ChatsGateway` — auth и комнаты | unit | Нет |
| 🟡 | `FilesService` — upload / presigned | integration | Нет |
| 🟢 | `NotificationsService` | unit | Нет |

- Именование: `*.spec.ts` (unit), `*.integration.spec.ts`, `*.e2e-spec.ts` (в `apps/api/test/`).
- Unit: `PrismaService` мокается через `jest.fn()` по каждому используемому методу.
- Integration/e2e: реальный PostgreSQL из отдельного `DATABASE_URL_TEST`, схема через `prisma db push --skip-generate`, чистка данных между тестами.
- Негативные кейсы обязательны: неверная роль, чужой scope, истёкший токен, использованный инвайт.
- **Агент не заявляет о завершении задачи, не запустив `pnpm --filter api test` и не показав результат.** Формулировки «тесты должны проходить» без запуска — недопустимы.

---

## 12. Swagger

- `@ApiTags()` на каждом контроллере, `@ApiBearerAuth()` на защищённых.
- `@ApiOperation({ summary })` + `@ApiResponse()` для всех реальных статусов, включая 401/403/422.
- Описания — на русском.
- Схемы тел запросов подтягиваются из `createZodDto` автоматически, дублировать `@ApiProperty` не нужно.
- Swagger доступен **только** при `NODE_ENV=development`, по пути `/api/docs`.
- Эндпоинт без Swagger-декораторов не проходит ревью.

---

## 13. Логирование, аудит, наблюдаемость

- `pino` через `nestjs-pino`. `console.log` в коде — ошибка линтера.
- В каждом сервисе: `private readonly logger = new Logger(MyService.name)`.
- Обязательный контекст в логах: `requestId`, `userId`, `path`, `action`. `requestId` генерируется в middleware и прокидывается в job'ы очередей.
- **Никогда не логируются:** пароли, `passwordHash`, access/refresh-токены, токены инвайтов, содержимое личных сообщений, вложения заявок.
- Уровни: `error` — сбой; `warn` — деградация, retry, подозрительная активность; `log` — бизнес-события (логин, создание инвайта, смена статуса заявки); `debug`/`verbose` — только dev.
- `AuditLog` пишется через `AuditInterceptor` или явно в сервисе для: login, logout, всех операций с инвайтами, смены роли, смены статуса университета, блокировки пользователя, решений модератора, доступа администратора к личным чатам по жалобе.
- `GET /health` (`@nestjs/terminus`, публичный): проверки Prisma, Redis, MinIO.

---

## 14. Безопасность — жёсткие правила

1. Секретов в коде и в git нет. Только `.env` + `ConfigService`. `.env.example` обновляется в том же PR.
2. Env валидируется Zod-схемой на старте приложения. Нет переменной → приложение не стартует.
3. `bcrypt`, cost factor ≥ 10. Другие алгоритмы для паролей запрещены.
4. Raw SQL — только `prisma.$queryRaw` с параметрами. Конкатенация строк в SQL — запрещена.
5. CORS: whitelist из `CORS_ORIGIN`, `credentials: true`. `origin: '*'` в production — запрещено.
6. `@fastify/helmet` включён всегда.
7. Студент не получает персональные данные других студентов. Староста не видит заявки, оценки и документы одногруппников. Это проверяется на уровне `select`/DTO, а не скрытием в UI.
8. Администратор не имеет доступа к личным чатам без жалобы; такой доступ всегда пишется в `AuditLog`.
9. Ответ API не содержит `passwordHash`, `refreshTokenHash`, `invite.token` (кроме момента выдачи создателю), внутренние `id` чужих сущностей.
10. IDOR: любой `:id` в маршруте проверяется на принадлежность scope пользователя. Отсутствие проверки — блокирующее замечание.

---

## 15. Производительность

- Пагинация на **всех** списочных эндпоинтах.
- Индексы под каждый реально используемый фильтр (см. §5.1).
- Redis-кэш для дорогих read-only агрегатов: `/universities/:id/stats`, `/notifications/unread-count`. Ключи `entity:id`, инвалидация при записи.
- gzip/brotli — на уровне nginx.
- Тяжёлые операции — в очередь, не в HTTP-цикл.
- Лента и сообщения — cursor-пагинация, `take ≤ 50`.

---

## 16. Код-стиль и Git

- `kebab-case` для файлов, `camelCase` для переменных и функций, `PascalCase` для классов/типов/enum, `UPPER_SNAKE_CASE` для константы.
- `any` запрещён (`@typescript-eslint/no-explicit-any: error`). В `catch` — `unknown` + проверка `instanceof`.
- Prettier: без точек с запятой, одинарные кавычки, `trailingComma: all`, `printWidth: 100`.
- Ветки: `feat/<scope>-<описание>`, `fix/...`, `refactor/...`, `chore/...`, `hotfix/...`. Прямые коммиты в `main` и `develop` запрещены.
- Conventional Commits, scope обязателен для `feat` и `fix`: `feat(auth): регистрация по инвайту`.
- PR ≤ ~400 строк изменений, минимум 1 approve, зелёный CI.

---

## 17. Definition of Done для backend-задачи

Задача считается выполненной, только если все пункты закрыты:

```
□ Zod-схема добавлена в packages/shared-schemas и переиспользована в DTO
□ Guard'ы (@Roles / scope) навешаны и проверка scope дублирована в сервисе
□ Prisma-ошибки сконвертированы в HTTP-исключения
□ Пагинация и take-лимит есть на всех списках
□ Индексы добавлены под новые фильтры
□ Миграция сгенерирована, SQL прочитан, показан пользователю
□ Swagger-декораторы на всех новых эндпоинтах
□ Тесты приоритета 🔴/🟡 написаны
□ pnpm --filter api lint — без ошибок (вывод показан)
□ pnpm --filter api test — зелёный (вывод показан)
□ pnpm --filter api build — успешно
□ .env.example обновлён, если добавлены переменные
□ docs/PROJECT.md обновлён, если менялся API-контракт, WS-событие или код ошибки
□ Нет console.log, нет закомментированного кода, нет any
```

---

## 18. Абсолютные запреты

Нарушение любого пункта — откат изменений, а не обсуждение:

1. Секрет, пароль, токен в коде или в git.
2. Отключение guard'а, helmet, throttler или валидации «чтобы заработало».
3. `--accept-data-loss`, `db push` или `migrate reset` на не-тестовой БД.
4. Редактирование применённой миграции.
5. Роль или scope, прочитанные из тела запроса вместо JWT.
6. `passwordHash` или refresh-токен в ответе API либо в логах.
7. Публичный эндпоинт, создающий пользователя в обход инвайта.
8. `findMany()` без `take`.
9. Прямой доступ к таблицам чужого модуля.
10. Заявление о выполненной задаче без запуска тестов и линтера.

---

## 19. Расхождения исходной документации — РЕШЕНО

Все 8 пунктов закрыты (решения зафиксированы 2026-07-27, до старта Фазы 5). Колонка «Статус»:
✅ — уже реализовано в коде; 📌 — решение зафиксировано, применяется при реализации указанной фазы.

| # | Расхождение | Принятое решение | Статус |
|---|---|---|---|
| 1 | `Story.mediaUrl` (§5) vs `Story.fileId` + relation `file` (§17, §24) | `fileId` + relation `file`, `mediaUrl` не вводить | 📌 Модель `Story` — Ф14 (v2.0) |
| 2 | Срок инвайта: 48 ч (§13) vs 1 год в seed (§21) | Seed-инвайт dev-only, срок 30 дней | ✅ `prisma/seed.mjs` |
| 3 | `createdBy` (§13.3) vs `createdById` (§21.2, §26.5) | `createdById` + relation `createdBy` | ✅ `prisma/schema/01-users.prisma` |
| 4 | `Invite.status` строкой `'PENDING'` вместо enum | Использовать `InviteStatus.*` из `@prisma/client` в коде и тестах | ✅ `invites.service.ts` + spec |
| 5 | `multer` + Fastify | `@fastify/multipart` | ✅ Ф2 (`main.ts`, `FileService`) |
| 6 | `@nestjs/bull` (Bull, legacy) | `@nestjs/bullmq` | 📌 Ставится в Ф3 (legacy Bull запрещён) |
| 7 | `scheduleEventReminders` — нерабочее окно | Каждые 15 мин, окно `[now+55, now+70]`, флаг `Event.reminderSentAt` (см. §9.3) | 📌 Ф3/Ф10 (`CleanupService`) |
| 8 | `Schedule` (§5) хранит пару, `Pair` (§17) — отдельная модель | `Schedule` = контейнер группы/семестра, `Pair` = занятие | 📌 Ф6 (задача 6.1) |
