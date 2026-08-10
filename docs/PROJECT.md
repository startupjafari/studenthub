# StudentHub — Документация проекта

> Единый источник истины по продукту, данным и контрактам.
> Версия: 1.0 · Последнее обновление: 2026-07
> Регламенты разработки: `docs/BACKEND_RULES.md`, `docs/FRONTEND_RULES.md`
> План работ: `docs/IMPLEMENTATION_PLAN.md`

**Правило поддержки документа:** изменение API-контракта, кода ошибки, WebSocket-события или модели данных фиксируется в этом файле **в том же PR**, что и код. Расхождение кода с этим документом считается багом.

---

## 1. Что это за продукт

Многоролевая образовательная платформа для университетов. Объединяет академическую жизнь (расписание, заявки в деканат, документы) и социальную активность (лента, чаты, события) в одном приложении.

**Ключевое архитектурное решение:** платформа полностью закрыта. Публичной регистрации не существует — попасть внутрь можно только по персональной ссылке-приглашению от вышестоящей роли. Это защита на уровне архитектуры, а не на уровне проверок.

### Четыре зоны

| Зона | Роли | Ответственность |
|---|---|---|
| Платформенная | Администратор платформы, Модератор платформы | Все университеты, пользователи, глобальная модерация |
| Университетская | Администратор университета, Модератор университета | Факультеты, группы, преподаватели, структура вуза |
| Учебная | Декан, Преподаватель, Староста | Расписание, заявки, материалы, объявления |
| Социальная | Все роли | Посты, сторисы, чаты, события, профили |

### Терминология

| Термин | Значение |
|---|---|
| **Университет** | Организация (entity), **не** роль. Управляется пользователем с ролью `UNIVERSITY_ADMIN` |
| **Scope** | Область данных пользователя: `universityId` / `facultyId` / `groupId` из JWT |
| **Инвайт** | Одноразовая ссылка регистрации с зашитой ролью и scope |
| **Аудитория (audience)** | Кому адресован контент: `ALL / UNIVERSITY / FACULTY / GROUP / SUBJECT / TEACHERS / PERSONAL` |
| **Пара** | Учебное занятие в расписании (`Pair`) |
| **Староста** | Координатор группы. Расширенные права по организации, но **не** доступ к персональным данным одногруппников |

---

## 2. Роли и иерархия

```
PLATFORM_ADMIN            управляет всей платформой
└── PLATFORM_MODERATOR    модерация контента всей платформы

UNIVERSITY_ADMIN          управляет своим вузом
└── UNIVERSITY_MODERATOR  модерация контента одного вуза

DEAN                      управляет факультетом
TEACHER                   работает со своими группами
STAROSTA                  координирует свою группу
STUDENT                   базовый пользователь
```

### 2.1 Иерархия выдачи инвайтов

Выдать инвайт можно только на роль **строго ниже** своей и только в пределах своего scope.

| Роль нового пользователя | Кто выдаёт | Scope инвайта |
|---|---|---|
| `PLATFORM_ADMIN` | Seed-скрипт (единственный способ) | Глобальный |
| `PLATFORM_MODERATOR` | `PLATFORM_ADMIN` | Глобальный |
| `UNIVERSITY_ADMIN` | `PLATFORM_ADMIN` | `universityId` |
| `UNIVERSITY_MODERATOR` | `UNIVERSITY_ADMIN` | `universityId` |
| `DEAN` | `UNIVERSITY_ADMIN` | `facultyId` |
| `TEACHER` | `UNIVERSITY_ADMIN` / `DEAN` | `universityId` |
| `STAROSTA` | `DEAN` | `groupId` |
| `STUDENT` | `DEAN` / `STAROSTA` | `groupId` |

### 2.2 Матрица доступа

Легенда: ✅ полный · 👁 только чтение · ⚠️ ограниченно · ❌ нет доступа

| Функция | Адм. платф. | Мод. платф. | Адм. вуза | Мод. вуза | Декан | Препод. | Староста | Студент |
|---|---|---|---|---|---|---|---|---|
| Управление университетами | ✅ | 👁 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Управление пользователями | ✅ все | ⚠️ | ✅ свои | ⚠️ | ⚠️ факультет | 👁 свои группы | 👁 группа | только себя |
| Расписание — чтение | ✅ | ❌ | ✅ | 👁 | ✅ факультет | ✅ свои | 👁 группа | 👁 своё |
| Расписание — запись | ✅ | ❌ | ✅ | ❌ | ✅ факультет | ⚠️ свои пары | ❌ | ❌ |
| Заявки — создание | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Заявки — чтение | 👁 все | ❌ | ✅ свои | ⚠️ | ✅ факультет | ❌ | ⚠️ только групповые обращения | ✅ свои |
| Заявки — обработка | ❌ | ❌ | ✅ | ⚠️ | ✅ | ❌ | ❌ | ❌ |
| Посты — создание | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Посты — модерация | ✅ | ✅ все | ✅ свои | ✅ свои | ⚠️ факультет | ❌ | ❌ | ❌ |
| Сторисы — создание | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Сторисы — удаление чужих | ✅ | ✅ все | ✅ свои | ✅ свои | ⚠️ | ❌ | ❌ | ❌ |
| События — создание | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ⚠️ |
| Личные чаты | ⚠️ по жалобе | ⚠️ по жалобе | ⚠️ официальные | ⚠️ по жалобе | ✅ факультет | ✅ свои | ✅ группа | ✅ |
| Жалобы — создание | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ | ✅ |
| Жалобы — обработка | ✅ все | ✅ все | ✅ свои | ✅ свои | ✅ факультет | ❌ | ❌ | ❌ |
| Настройки платформы | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Журнал действий | ✅ все | ⚠️ свои | ✅ свои | ⚠️ свои | ⚠️ | ❌ | ❌ | ❌ |
| Аналитика | ✅ все | ❌ | ✅ свои | ❌ | ⚠️ факультет | ❌ | ❌ | ❌ |

> Эта матрица — источник истины и для бэкенда (guard'ы), и для фронтенда (что рендерится). Расхождение реализации с матрицей — баг.

---

## 3. Модули продукта

### 3.1 Расписание
Просмотр и управление парами, аудиториями, заменами. Ролевая выборка: студент видит группу, преподаватель — свои занятия, декан — факультет. Изменения (перенос, замена аудитории, отмена) генерируют уведомление и WS-событие. Фильтры: группа, преподаватель, аудитория, предмет, дата. Особые события: экзамены, консультации, дедлайны.
Сущности: `Schedule`, `Pair`, `Room`, `ScheduleChange`.

### 3.2 Заявки в деканат
Цифровое взаимодействие студента с деканатом. Типы: справка об обучении, справка для военкомата, справка по месту требования, академический вопрос, финансовый вопрос, технический вопрос, другое.

Конечный автомат статусов:
```
NEW → PROCESSING → CLARIFICATION → PROCESSING
                 ↓
           APPROVED → READY → CLOSED
                 ↓
           REJECTED → CLOSED
```
Переходы реализуются одним методом `transitionStatus()` с явной матрицей допустимых переходов и проверкой прав. Каждый переход пишется в `ApplicationStatusHistory` и уведомляет студента.

### 3.3 Посты и лента
Главная лента платформы. Тип поста определяется ролью автора (пост платформы / университета / факультета / преподавателя / группы / личный). Аудитория задаётся при публикации и ограничена ролью автора. Функции: текст, медиа, файлы, реакции, комментарии (thread), репост, закрепление (только роль выше автора), жалоба. Пагинация — cursor.

**Приоритет контента в ленте (сверху вниз):**
1. Срочные уведомления
2. Изменения в расписании
3. Ответы по заявкам
4. Объявления университета
5. Объявления факультета
6. Объявления группы
7. События
8. Посты преподавателей
9. Посты студентов

### 3.4 Сторисы (v2.0)
Короткий формат на 24 часа: фото/видео, текст, ссылка, опрос, реакции. Видимость по аудитории. Автоудаление через cron + TTL-политика бакета MinIO.

### 3.5 События
Типы: университетское, факультетское, групповое, учебное, социальное, онлайн. Регистрация участников, напоминание за час, комментарии.

### 3.6 Чаты
Типы: `PRIVATE`, `GROUP`, `GROUP_OFFICIAL` (чат учебной группы), `SUBJECT`, `FACULTY`, `DEAN` (чат с деканатом), `SUPPORT`, `EVENT`. Функции: текст, медиа, файлы, thread-ответы, реакции, закрепление, push, жалоба, модерация. Транспорт — socket.io, REST используется для истории и управления участниками.

### 3.7 Профили
Единый профиль с ролевыми секциями (стиль ВК). Настройки приватности (`showEmail`, `showPhone`)
определяют, какие поля видны другим; email/телефон/номера/адрес чужим не отдаются.

**Закрытый профиль (`profileVisibility`).** Поле `User.profileVisibility` (строка
`PUBLIC | UNIVERSITY | FACULTY | GROUP | PRIVATE`, дефолт по роли: сотрудники/руководство —
`PUBLIC`, студенты/старосты/модераторы — `UNIVERSITY`) задаёт, кто видит полную анкету.
`GET /users/:id` возвращает поле `access`: `full` — карточка целиком (по правам), `limited` —
только «визитка» (id, имя, аватар, роль, вуз/факультет, headline, `profileVisibility`), детали
скрыты. Надзорные роли своего scope (платформа — глобально, админ/модератор вуза — свой вуз,
декан — свой факультет) видят `full` даже при `PRIVATE`; такой доступ пишется в `AuditLog`
(`action=PROFILE_VIEW_PRIVATE`). Преподаватель (свой вуз) и староста (своя группа, только
студенты/старосты) видят `full` в пределах scope, но `PRIVATE` не пробивают. Оценки (`gpa`)
видны только владельцу и надзорным ролям — не одногруппникам/старосте.
Поля `User`: общие (middleName, phone, bio, birthDate, gender, languages, telegram, website,
headline, timezone), студент/староста (course, enrollmentYear, graduationYear, educationLevel,
studyForm, fundingType, specialty, studentCardNumber, academicStatus, gpa, interests, skills,
dormitory, address, starostaSince, duties), сотрудники (position, jobTitle, academicDegree,
academicTitle, department, subjects, officeRoom, officeHours, employeeNumber, researchInterests,
publicationsUrl, appointmentDate, workPhone, responsibilities, moderationAreas). Редактирование —
`PATCH /users/me` (роль/scope не меняются); форма показывает поля релевантные роли.

**Контент профиля (вкладки).** Профиль разбит на вкладки: Профиль / Фото / Видео / Статьи /
Опросы. Просмотр — любой аутентифицированный с учётом `visibility` (ALL/UNIVERSITY/FACULTY/GROUP);
черновики (`status=DRAFT`) видит только автор; загрузка/редактирование — только владелец.
Модели: `ProfileArticle` (title, description, content markdown, coverUrl/coverGradient, category,
tags[], visibility, allowComments, status, readingMinutes — считается на бэке), `Poll` + `PollOption`
+ `PollVote` (question, options, multiple, anonymous, allowRevote, resultsVisibility, visibility,
closesAt, status). Фото/видео — `File` в публичном бакете `profile-media`; обложки статей — `profile-covers`.

Эндпоинты (`ProfileContentController`, база `/profile`):
- `POST /profile/media` (multipart, ≤ порога) и `POST /profile/media/presign` → `POST /profile/media/confirm`
  (крупные видео, прямой presigned-PUT в MinIO); `GET /profile/:userId/media`; `DELETE /profile/media/:fileId`.
- `POST|GET(:userId)|PATCH|DELETE /profile/articles[...]`; `POST /profile/articles/cover` (обложка → URL).

Опросы (`PollsController`, база `/polls`): `POST /polls`, `GET /polls/by-user/:userId`, `GET /polls/:id`
(с результатами по правам смотрящего), `POST|DELETE /polls/:id/vote` (голос/отмена), `PATCH /polls/:id`
(до появления голосов), `DELETE /polls/:id`. Результаты гейтятся `resultsVisibility` (AFTER_VOTE /
AFTER_END / HIDDEN); один голос на пользователя (`@@unique([optionId,userId])`), несколько — при `multiple`.

Мутации проверяют владение (`actor.sub`), просмотр — по `visibility`/scope. Медиа фильтруются по MIME
(image/video); presigned-confirm валидирует объект через `statObject` и лимит 100 МБ.
(Прежняя модель `ProfileQa` удалена миграцией `articles_polls` — заменена опросами.)

**Присутствие.** `GET /users/:id/presence` → `{ online }` (снапшот по активным WS-соединениям,
`RealtimeGateway`). Живые изменения — глобальное WS-событие `presence:changed { userId, online }`.
Аватар профиля показывает статус в сети/не в сети (свой профиль — всегда в сети).

### 3.8 Документы (Ф15)

Защищённое личное хранилище документов + запросы вуза. Отдельный раздел `/documents`
(под-навигация: Обзор, Мои документы, Запросы университета, Документы от университета,
Управление доступом, Архив).

**Приватность номера.** Полный `Document.number` наружу НЕ отдаётся (как `passwordHash`) —
API возвращает только маску `******4821` (`numberMasked`) из `numberLast4`. Файлы — в приватном
бакете MinIO `documents`, доступны только через presigned-URL после проверки владения/гранта.

**Модели.** `Document` (owner, category, type, title, number/numberLast4, issuedAt/expiresAt,
status `DRAFT|UPLOADED|IN_REVIEW|VERIFIED|ACCEPTED|REJECTED|NEEDS_REPLACEMENT|EXPIRING|EXPIRED|ARCHIVED`),
`DocumentAccess` (грант: `UNIVERSITY|DEPARTMENT|USER`, причина, срок, отзыв), `DocumentEvent`
(журнал: UPLOAD/VIEW/DOWNLOAD/EDIT/GRANT/REVOKE/EXPIRE/ARCHIVE/…). Запросы вуза: `DocumentRequest`
(+`Item`/`Target` — адресат `UNIVERSITY|FACULTY|GROUP|USER`), `DocumentSubmission` (+`Item` —
привязка документа студента к позиции, вердикт `PENDING|ACCEPTED|REJECTED`). Типы: гибридный каталог —
статические 25 типов в `@studenthub/shared-config` + правки вуза в `DocumentType`
(вкл/выкл, `retentionDays`, custom-типы).

**Ролевая матрица (§15.2).** Создают/проверяют запросы деканат/студ.офис (`DEAN`,
`UNIVERSITY_MODERATOR`) и преподаватель (только учебные типы); админ вуза управляет типами/сроками
(не участвует в запросах); студент/староста — отвечают. Сотрудник видит только СВОИ запросы.
Платформенный админ обычного доступа к содержимому не имеет — только спец-режим с обязательной
причиной (пишется в `AuditLog` + `DocumentEvent`).

**Автоматизация.** Cron `sweepDocumentExpiry` (ежедневно): `expiresAt` → `EXPIRING`/`EXPIRED`,
затем архив по `retentionDays`. Уведомления BullMQ (`SYSTEM`): новый запрос → адресатам, результат
проверки → студенту, истечение → владельцу.

**Эндпоинты** (база `/documents`, `/document-requests`, `/document-types`): CRUD документов,
`/upload`+`/files`(+`/order`), `GET :id/files/:fileId/url` (presigned), `access` (grant/revoke),
`overview`, `events`; запросы — создание/список/`manage`, submission (save/submit), review
(`submission-items/:id/review`, `submissions/:id/finalize`); типы — `GET/POST/PATCH/DELETE`
(админ вуза); спец-режим — `GET :id/platform`, `POST :id/platform-access` (платформенный админ).

---

## 4. MVP и порядок

### v1.0 — Ядро

| Модуль | Приоритет | Обоснование |
|---|---|---|
| Авторизация + роли + инвайты | 🔴 Критично | Без этого не работает ничего |
| Профили | 🔴 Критично | Основа идентификации |
| Университет / Факультет / Группа | 🔴 Критично | Академическая база |
| Расписание | 🔴 Критично | Ежедневная потребность |
| Заявки в деканат | 🟠 Высокий | Главная боль офлайн-бюрократии |
| Посты | 🟠 Высокий | Коммуникация и новости |
| Чаты | 🟠 Высокий | Общение |
| Уведомления | 🟠 Высокий | Удержание |
| Админ-панели | 🟠 Высокий | Управление платформой |
| События | 🟡 Средний | Активность |

### v2.0 — Расширение
Сторисы · продвинутая аналитика · умная лента · AI-модерация · расширенные отчёты · интеграции Zoom/Meet.

---

## 5. Технологический стек

### 5.1 Монорепо (Turborepo + pnpm workspaces)

```
studenthub/
├── apps/
│   ├── web/                # Next.js frontend
│   └── api/                # NestJS backend
├── packages/
│   ├── shared-types/       # Role, DTO-интерфейсы, коды ошибок
│   ├── shared-schemas/     # Zod-схемы — единый источник валидации
│   ├── shared-utils/       # date-fns-хелперы, uuid
│   └── shared-config/      # константы, лимиты, env-контракт
├── prisma/                 # multi-file схема, миграции, seed
├── docker/                 # compose, nginx, minio
├── docs/                   # эта документация
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

Принципы:
- `shared-schemas` — единственное место, где живут правила валидации. Используется и `ZodValidationPipe` на бэкенде, и `zodResolver` в формах на фронте.
- `Role` и общие типы — только в `shared-types`. Локальное переобъявление запрещено.
- Build pipeline: `shared-types → shared-schemas → api / web`.
- Связи через `workspace:*`, без публикации в npm.

### 5.2 Backend

`@nestjs/core` · `@nestjs/platform-fastify` · `@prisma/client` · `zod` + `nestjs-zod` · `@nestjs/passport` + `@nestjs/jwt` + `passport-jwt` + `passport-local` · `bcrypt` · `@fastify/helmet` · `@nestjs/throttler` · `@nestjs/bullmq` + Redis · `@nestjs/schedule` · `@nestjs/websockets` + `socket.io` · `@nestjs/swagger` · `@nestjs/terminus` · `minio` + `@fastify/multipart` · `pino` · `nodemailer` · `date-fns`

### 5.3 Frontend

`next` (App Router) · `typescript` · `tailwindcss` (v4) + `shadcn/ui` (style `radix-nova`: `radix-ui`, `sonner` + `next-themes`, `tw-animate-css`, `class-variance-authority`) · `@reduxjs/toolkit` (auth + UI) · `@tanstack/react-query` (серверное состояние) · `react-hook-form` + `zod` · `axios` · `socket.io-client` · `chart.js` + `react-chartjs-2` · `lucide-react` · `date-fns` · `next-intl` · `@ducanh2912/next-pwa`

### 5.4 Инфраструктура

| Сервис | Образ | Назначение |
|---|---|---|
| postgres | `postgres:16-alpine` | Основная БД |
| redis | `redis:7-alpine` | Брокер BullMQ + кэш |
| minio | `minio/minio` | Медиафайлы |
| api | `apps/api/Dockerfile` | NestJS |
| web | `apps/web/Dockerfile` | Next.js |
| nginx | `nginx:alpine` | Reverse proxy, TLS, WS-upgrade |

Redis обязателен: без него не работают очереди.

### 5.5 Бакеты MinIO

| Бакет | Политика |
|---|---|
| `avatars` | Публичный, прямой доступ по URL |
| `posts-media` | Приватный, presigned URL (TTL 15 мин) |
| `stories-media` | Приватный, TTL-политика 24 ч |
| `applications` | Приватный, доступ только студенту-владельцу и деканату его факультета |
| `materials` | Приватный, presigned; доступ участникам группы и автору-преподавателю |
| `chat-media` | Приватный, presigned; вложения сообщений чата |
| `profile-media` | Публичный, прямой URL; фото/видео профиля (вкладки Фото/Видео) |
| `profile-covers` | Публичный, прямой URL; обложки статей профиля |

---

## 6. Модель данных

Схема — multi-file в `prisma/schema/`. Полный перечень моделей:

**Пользователи и доступ:** `User`, `RefreshToken`, `Invite`
**Академическая структура:** `University`, `Faculty`, `Group`, `Room`
**Расписание:** `Schedule`, `Pair`, `ScheduleChange`
**Заявки:** `ApplicationRequest`, `ApplicationStatusHistory`
**Контент:** `Post`, `Reaction`, `Comment`, `Story`
**События:** `Event`, `EventParticipant`
**Общение:** `Chat`, `ChatMember`, `Message`
**Инфраструктура:** `File`, `Notification`, `NotificationSettings`, `Complaint`, `AuditLog`

### 6.1 Enum'ы

```prisma
enum Role { PLATFORM_ADMIN PLATFORM_MODERATOR UNIVERSITY_ADMIN UNIVERSITY_MODERATOR DEAN TEACHER STAROSTA STUDENT }
enum UniversityStatus { PENDING ACTIVE BLOCKED }
enum InviteStatus { PENDING USED EXPIRED REVOKED }
enum ApplicationStatus { NEW PROCESSING CLARIFICATION APPROVED REJECTED READY CLOSED }
enum AppType { CERTIFICATE MILITARY UNIVERSAL ACADEMIC FINANCIAL TECHNICAL OTHER }
enum PostAudience { ALL UNIVERSITY FACULTY GROUP SUBJECT TEACHERS PERSONAL }
enum ChatType { PRIVATE GROUP GROUP_OFFICIAL SUBJECT FACULTY DEAN SUPPORT EVENT }
enum WeekType { ODD EVEN BOTH }
enum NotificationType { SCHEDULE_CHANGE APP_UPDATE MESSAGE POST EVENT SYSTEM }
enum NotificationChannel { IN_APP EMAIL PUSH }
enum ScheduleChangeType { MOVED ROOM_CHANGED CANCELLED SUBSTITUTED }
enum ComplaintTargetType { POST STORY COMMENT MESSAGE USER }
enum ComplaintStatus { PENDING REVIEWING RESOLVED DISMISSED }
```

### 6.2 Обязательные правила модели

- Таблицы — `@@map("snake_case")`, поля — `camelCase` с `@map` при расхождении.
- `onDelete` и `onUpdate` объявлены явно во всех связях.
- Soft delete (`deletedAt`) для `User`, `Post`, `Comment`, `Message`, `ApplicationRequest`.
- Индексы: все внешние ключи; `[groupId, dayOfWeek]`, `[teacherId, dayOfWeek]` (расписание); `[chatId, createdAt]` (сообщения); `audience`, `createdAt` (посты); `status`, `expiresAt` (инвайты, сторисы).

### 6.3 Открытые вопросы к схеме

Требуют решения до Фазы 5 (см. `BACKEND_RULES §19`):
`Story.mediaUrl` vs `Story.fileId` · `Invite.createdBy` vs `createdById` · разграничение `Schedule` и `Pair` · срок seed-инвайта · поле таймзоны у `University`.

---

## 7. Аутентификация

### 7.1 Токены

| | Access | Refresh |
|---|---|---|
| Срок | 15 минут | 30 дней |
| Хранение | Redux (память клиента) | httpOnly + Secure + SameSite cookie |
| Payload | `{ sub, role, universityId, facultyId, groupId }` | UUID; в БД только bcrypt-хэш |
| Ротация | — | Новый при каждом refresh, предыдущий инвалидируется |

### 7.2 Жизненный цикл

```
1. Логин / регистрация по инвайту
   → access_token в JSON body → Redux
   → refresh_token в httpOnly cookie

2. Каждый запрос: Authorization: Bearer <access>
   → 401 + code=TOKEN_EXPIRED → POST /auth/refresh (cookie отправляется браузером)
   → новый access → прозрачный повтор исходного запроса (один раз)

3. Logout
   → POST /auth/logout → хэш refresh инвалидируется, cookie очищается
   → clearAuth() + queryClient.clear() + disconnect(socket) → /login

4. WebSocket
   → handshake { auth: { token: accessToken } } → JwtWsGuard → client.data.user
   → авто-вход в комнаты user:{id}, group:{id}, university:{id}
```

### 7.3 Поток регистрации по инвайту

```
1. Администратор: POST /invites  → токен, роль, scope, expiresAt = now + 48ч, статус PENDING
2. Очередь email: письмо со ссылкой https://app/register?token=UUID
3. Пользователь открывает: GET /invites/:token/preview
   → { role, universityName, facultyName, groupName, expiresAt }
   → истёк / использован / отозван → страница ошибки с конкретным кодом
4. Форма: только имя, пароль, фото. Роль и scope показываются read-only
5. POST /auth/register-by-invite  → транзакция: создать User + Invite.status = USED
6. Редирект на ROLE_HOME[role]
```

Защита: срок 48 ч (cron помечает `EXPIRED` раз в час), одноразовость (проверка внутри транзакции), отзыв через `PATCH /invites/:id/revoke`, throttling 3 попытки/час с IP, полный аудит.

### 7.4 Rate limiting

`POST /auth/login` — 5 / 15 мин с IP · `POST /auth/register-by-invite` — 3 / час с IP · `GET /invites/:token/preview` — 10 / час с IP · `POST /complaints` — 10 / час с пользователя · прочее — 100 / мин с пользователя.

---

## 8. Контракт API

Префикс: `/api/v1`. Аутентификация: `Authorization: Bearer <access_token>`, если не указано «публичный».

### 8.1 Формат ответа

```jsonc
// Успех
{ "success": true, "data": { }, "meta": { "total": 100, "cursor": "uuid", "hasNext": true } }

// Успех без данных (DELETE, logout)
{ "success": true, "data": null }

// Ошибка
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ { "field": "email", "message": "..." } ] },
  "statusCode": 422,
  "timestamp": "2026-01-15T10:30:00.000Z",
  "path": "/api/v1/auth/login"
}
```

### 8.2 Коды ошибок

| HTTP | code | Ситуация |
|---|---|---|
| 400 | `BAD_REQUEST` | Некорректный запрос |
| 401 | `UNAUTHORIZED` | Токен отсутствует или невалиден |
| 401 | `TOKEN_EXPIRED` | Access истёк → клиент делает refresh |
| 403 | `FORBIDDEN` | Недостаточно прав по роли |
| 403 | `WRONG_SCOPE` | Ресурс другого университета/факультета/группы |
| 404 | `NOT_FOUND` | Ресурс не найден |
| 409 | `CONFLICT` | Нарушение уникальности |
| 410 | `INVITE_EXPIRED` · `INVITE_USED` · `INVITE_REVOKED` | Состояние инвайта |
| 413 | `FILE_TOO_LARGE` | Размер файла больше лимита категории |
| 413 | `FILE_DIRECT_UPLOAD_REQUIRED` | Файл больше порога буферной загрузки — нужен presigned-upload в MinIO |
| 415 | `FILE_TYPE_NOT_ALLOWED` | Тип файла (по magic bytes) не в белом списке |
| 422 | `VALIDATION_ERROR` | Ошибка Zod, с `details[]` |
| 429 | `RATE_LIMIT` | Превышен лимит |
| 500 | `INTERNAL_ERROR` | Внутренняя ошибка |

Коды — публичный контракт: клиент реагирует на `code`, не на `message`. Тексты для пользователя формирует фронтенд через i18n.

### 8.3 Реестр эндпоинтов

**Auth** — `POST /auth/login` (публ.) · `POST /auth/refresh` (cookie) · `POST /auth/logout` · `GET /auth/me`

**Инвайты** — `GET /invites/:token/preview` (публ.) · `POST /auth/register-by-invite` (публ.) · `POST /invites` · `GET /invites` · `PATCH /invites/:id/revoke`

**Пользователи** — `GET|PATCH /users/me` · `POST|DELETE /users/me/avatar` · `POST|DELETE /users/me/cover` (обложка профиля, multipart-изображение ≤ 10 МБ, бакет `profile-covers`) · `PATCH /users/me/password` · `DELETE /users/me` · `GET /users/:id` · `GET /users` (Admin+) · `PATCH /users/:id/block|unblock` (Moderator+). Профиль отдаёт `avatarUrl`, `avatarThumbUrl` (квадратное превью ≈128px, генерируется джобой `generate-thumbnail` в очереди `file-processing`; асинхронно, до готовности `null`) и `coverUrl` (публичные URL; `coverUrl` виден и в «визитке» закрытого профиля).

**Университеты** — `GET|POST /universities` · `GET|PATCH /universities/:id` · `PATCH /universities/:id/status` (Platform Admin) · `GET /universities/:id/stats`

**Факультеты** — `GET|POST /faculties` · `GET|PATCH|DELETE /faculties/:id` (удаление только без групп)

**Группы** — `GET|POST /groups` · `GET|PATCH|DELETE /groups/:id` · `GET /groups/:id/members`

**Расписание** — `GET /schedule` (по роли; фильтры `groupId/teacherId/roomId/dayOfWeek/weekType/subject`, отдаёт таймзону вуза) · `GET /schedule/changes` (`?from=&to=`) · `POST /schedule/changes` (Dean/Admin) · `GET|POST /schedules` · `GET|PATCH|DELETE /schedules/:id` · `POST /pairs` · `PATCH|DELETE /pairs/:id` · `GET|POST /rooms` · `GET|PATCH|DELETE /rooms/:id`

**Заявки** — `GET|POST /applications` · `GET /applications/:id` · `PATCH /applications/:id/status` (Dean/Admin, scope; конечный автомат, недопустимый переход → 400) · `POST /applications/:id/attachments` (владелец, статусы NEW/CLARIFICATION) · `GET /applications/:id/attachments/:fileId/presigned` (владелец или деканат) · `DELETE /applications/:id` (владелец, статус NEW)

**Посты** — `GET|POST /posts` (лента — cursor по видимости; таб `filter=ALL|GROUP|UNIVERSITY|TEACHERS|IMPORTANT` сужает поверх видимости: GROUP/UNIVERSITY — по audience, TEACHERS — посты от преподавателей, IMPORTANT — закреплённые) · `GET|DELETE /posts/:id` (удаление — автор/модератор scope) · `PATCH /posts/:id/pin` (роль строго выше автора) · `POST /posts/:id/reactions` · `DELETE /posts/:id/reactions/:emoji` · `GET|POST /posts/:id/comments` · `DELETE /posts/:id/comments/:commentId` · `POST /posts/:id/repost`

**Материалы** — `GET|POST /materials` · `POST /materials/:id/files` (multipart) · `GET /materials/:id/files/:fileId/presigned` · `DELETE /materials/:id` (автор/админ)

**Сторисы (v2.0)** — `GET|POST /stories` · `GET|DELETE /stories/:id` · `POST /stories/:id/reactions`

**События** — `GET|POST /events` · `GET|PATCH|DELETE /events/:id` · `POST|DELETE /events/:id/register` · `GET /events/:id/participants`

**Чаты** — `GET|POST /chats` (список: последнее сообщение + флаги непрочитанного/`muted`; официальные чаты авто-создаются) · `GET /chats/:id/messages` (cursor) · `POST /chats/:id/messages` (multipart: текст + вложения, `message:new` эмитится сервером один раз) · `GET /chats/search?q=&chatId=` (в чате при `chatId`, иначе по всем чатам участника; cursor) · `GET /chats/:id/pinned` · `POST|DELETE /chats/messages/:messageId/pin` · `POST /chats/messages/:messageId/reactions` (тоггл эмодзи) · `POST /chats/:id/forward {messageId}` (пересылка в этот чат, участник обоих) · `GET /chats/:id/export` (история хронологически, cap 5000) · `POST|DELETE /chats/:id/mute` (откл./вкл. уведомления) · `GET /chats/:id/presence` (онлайн-статусы участников) · `GET /chats/:id/members` (участники с ролью, онлайн и флагом `banned` — окно управления группой) · `GET /chats/attachments/:fileId/url` (presigned, доступ по членству) · `POST /chats/:id/members` · `DELETE /chats/:id/members/:userId` · `POST|DELETE /chats/:id/members/:userId/ban` (бан/разбан участника группы — только создатель) · `POST|DELETE /chats/:id/avatar` (аватар группы, multipart; только создатель) · `POST|DELETE /chats/blocks/:userId` (личная блокировка — запрет переписки в PRIVATE в любую сторону) · `GET /chats/blocks` (список заблокированных мной) · `PATCH /chats/:id {title}` (переименовать группу — админ) · `DELETE /chats/:id` (владелец GROUP удаляет группу; иначе выход/удаление у себя) · `POST /chats/:id/clear` (очистка истории «для меня» через `ChatMember.clearedAt`) · `POST|DELETE /chats/:id/members/:userId/admin` (назначить/снять админа — только создатель) · `POST /chats/:id/transfer/:userId` (передать владение — только создатель). Отправка сообщений троттлится (20/10с на пользователя, RATE_LIMIT). Список чатов отдаёт `avatarUrl` (для PRIVATE — аватар собеседника), `unreadCount`, `isOwner`, `isAdmin`, `blocked`/`blockedBy`; `GET /chats/:id/members` — `banned` и `isAdmin`. Модель: `Chat.avatarUrl/createdById`, `ChatMember.bannedAt/isAdmin/clearedAt`, модель `UserBlock`. Текстовые сообщения/typing/статусы/ответы (`replyToId`) — через WS (`ChatGateway`). Вложения — только REST (multipart, бакет `chat-media`, приватный).

**Уведомления** — `GET /notifications` · `GET /notifications/unread-count` · `PATCH /notifications/:id/read` · `PATCH /notifications/read-all` · `DELETE /notifications/:id` · `GET|PATCH /notifications/settings`

**Файлы** — `POST /files/upload` · `GET /files/:id/presigned` · `DELETE /files/:id`

**Жалобы** — `POST /complaints` (Student/Starosta/Teacher, 10/час) · `GET /complaints` (Moderator+, scope) · `GET /complaints/:id` · `GET /complaints/:id/messages` (доступ к чату по жалобе, пишется в аудит) · `PATCH /complaints/:id/resolve` (DELETE_CONTENT / BLOCK_USER / DISMISS)

**Аудит** — `GET /audit` (Moderator+/Admin, scope: платформа — всё, админ вуза — свой вуз, модератор — свои действия)

**Служебное** — `GET /health` (публ.) · `GET /api/docs` (только dev)

Пагинация: списки контента и сообщений — cursor (`?cursor=&limit=`, `limit ≤ 50`); административные таблицы — offset (`?page=&limit=`, `limit ≤ 100`).

---

## 9. WebSocket

Транспорт socket.io, единый `ChatGateway`. Аутентификация — JWT в `socket.handshake.auth.token`.

### 9.1 Клиент → сервер

| Событие | Payload |
|---|---|
| `chat:join` | `{ chatId }` — только после серверной проверки членства |
| `chat:leave` | `{ chatId }` |
| `message:send` | `{ chatId, content, replyToId? }` |
| `message:edit` | `{ messageId, content }` |
| `message:delete` | `{ messageId }` |
| `message:read` | `{ chatId, messageId }` |
| `typing:start` / `typing:stop` | `{ chatId }` — throttle 3 с |
| `auth:refresh` | `{ token }` — обновление токена без разрыва соединения |

### 9.2 Сервер → клиент

| Событие | Payload |
|---|---|
| `message:new` · `message:updated` | `{ message, chatId }` |
| `message:pinned` · `message:unpinned` · `message:reaction` | `{ message, chatId }` |
| `message:deleted` | `{ messageId, chatId }` |
| `presence:changed` | `{ userId, online }` |
| `message:read` | `{ messageId, chatId, userId, readAt }` |
| `typing:started` | `{ chatId, userId, userName }` |
| `typing:stopped` | `{ chatId, userId }` |
| `chat:updated` | `{ chat }` |
| `chat:member-added` | `{ chatId, user }` |
| `chat:member-removed` | `{ chatId, userId }` |
| `notification:new` | `{ notification }` |
| `schedule:changed` | `{ change, groupId }` |
| `story:new` | `{ story }` |
| `application:updated` | `{ applicationId, status }` |

### 9.3 Комнаты

| Комната | Когда вход |
|---|---|
| `user:{userId}` | Автоматически при подключении |
| `group:{groupId}` | Автоматически, если есть `groupId` |
| `university:{universityId}` | Автоматически |
| `chat:{chatId}` | По `chat:join` после проверки членства |

Широковещательная рассылка (`server.emit`) запрещена — только адресно по комнатам.

### 9.4 Поток отправки сообщения

```
Клиент A: emit('message:send', { chatId, content })
  → ChatGateway: Zod-валидация payload + проверка членства в чате
  → prisma.message.create()
  → job 'new-message' в очередь notifications (для офлайн-участников)
  → server.to(`chat:${chatId}`).emit('message:new', { message, chatId })
  → NotificationsProcessor: Notification в БД → WS онлайн → email/push офлайн
```

---

## 10. Асинхронная обработка

### 10.1 Очереди (BullMQ + Redis)

| Очередь | Job'ы |
|---|---|
| `email` | `send-invite`, `send-welcome`, `send-application-status`, `send-schedule-change`, `send-event-reminder`, `send-notification` (офлайн-зеркало in-app уведомления) |
| `notifications` | `new-message`, `schedule-changed`, `application-updated`, `new-post`, `new-story`, `event-created`, `complaint-resolved` |
| `file-processing` | `generate-thumbnail` (sharp, 400×400), `compress-video` (ffmpeg, 720p), `scan-file` |
| `cleanup` | Тяжёлые операции очистки, поставленные из cron |

Базовая конфигурация job'а: `attempts: 3`, exponential backoff от 5 с, `removeOnComplete: true`, `removeOnFail: false`. Payload содержит только идентификаторы. Все job'ы идемпотентны.

Каждый job очереди `notifications`: создать запись `Notification` → отправить WS `notification:new` онлайн-пользователям → для офлайн с включённым каналом поставить задачу в `email` (`send-notification`) / push. Идемпотентность — через `Notification.dedupeKey` (уникален в пределах пользователя): повторный запуск job'а не создаёт дубликат и не рассылает повторно.

### 10.2 Cron (`CleanupService`, `@nestjs/schedule`)

| Задача | Расписание | Действие |
|---|---|---|
| `expireInvites` | `0 * * * *` | `PENDING` + истёкшие → `EXPIRED` |
| `deleteExpiredStories` | `*/30 * * * *` | Удаление сторисов из БД и MinIO |
| `scheduleEventReminders` | `*/15 * * * *` | Напоминания за ~1 час, окно `[now+55м, now+70м]`, дедупликация через `reminderSentAt` |
| `cleanOldNotifications` | `0 2 * * 0` | Прочитанные уведомления старше 30 дней |
| `cleanAuditLogs` | `0 1 1 * *` | `AuditLog` старше 90 дней |
| `cleanOrphanFiles` | `0 4 * * *` | Объекты MinIO без записи в `File` |

Все задачи работают батчами (`take: 500`) и логируют количество обработанных записей. В multi-instance деплое выполняются на одном инстансе.

---

## 11. Безопасность и приватность

### 11.1 Принципы доступа

- Студент не видит персональные данные других студентов.
- Староста не видит личные заявки, оценки и документы одногруппников.
- Администраторы и модераторы не получают доступ к личным чатам без жалобы; каждый такой доступ пишется в `AuditLog`.
- Любой `:id` в маршруте проверяется на принадлежность scope пользователя (защита от IDOR).
  Для `GET /users/:id` это реализовано через `profileVisibility` + роль смотрящего (§3.7): вне
  аудитории/scope отдаётся только `limited`-визитка, а не полная карточка.
- Soft delete для всех критичных сущностей.

### 11.2 Три уровня guard

```
JwtAuthGuard (глобальный, снимается @Public) → RolesGuard (@Roles) → ScopeGuard (scope из JWT)
```
Guard не заменяет проверку в сервисе: сервис дополнительно сверяет фактическую принадлежность ресурса.

### 11.3 Персональные данные

Минимальный сбор · выгрузка своих данных по запросу · удаление аккаунта · настройки приватности профиля · запрет логирования персональных данных, паролей и токенов.

### 11.4 Аудит

`AuditLog` фиксирует: login, logout, все операции с инвайтами, смену роли, смену статуса университета, блокировку пользователя, решения модератора, доступ администратора к личным чатам. Поля: `userId`, `action`, `entity`, `entityId`, `metadata`, IP, user-agent, `createdAt`.

---

## 12. Карта экранов по ролям

```
PLATFORM_ADMIN → /platform-admin/
  dashboard · universities · users · roles · posts · stories · events
  complaints · chats · stats · settings · audit

PLATFORM_MODERATOR → /moderator/platform/
  dashboard · complaints · posts · comments · stories · events · users · universities · audit

UNIVERSITY_ADMIN → /university-admin/
  dashboard · profile · faculties · groups · students · teachers · deans
  schedule · applications · posts · stories · events · chats · stats · settings · audit

UNIVERSITY_MODERATOR → /moderator/university/
  dashboard · complaints · posts · comments · stories · events · users · audit

DEAN → /dean/
  dashboard · faculty · groups · students · teachers · starostas · schedule
  applications · posts · stories · events · chats · complaints · reports

TEACHER → /teacher/
  dashboard · profile · subjects · groups · schedule · materials
  posts · stories · events · chats · notifications

STAROSTA → /starosta/
  dashboard · group · classmates · schedule · posts · stories · events
  chat · applications · notifications

STUDENT → /
  feed · profile · university · faculty · group · schedule · applications
  posts · stories · events · chats · notifications · settings
```

Ролевой редирект — `ROLE_HOME` в `shared/config/routes.ts`, применяется в `middleware.ts` до рендера.

---

## 13. Переменные окружения

Все переменные валидируются Zod-схемой на старте приложения. Отсутствие обязательной переменной = приложение не запускается. `.env.example` обновляется в том же PR, что и новая переменная.

### `apps/api/.env`
```env
NODE_ENV=development
PORT=3001
API_PREFIX=api/v1

DATABASE_URL=postgresql://postgres:password@localhost:5432/studenthub
DATABASE_URL_TEST=postgresql://postgres:password@localhost:5432/studenthub_test

JWT_ACCESS_SECRET=          # минимум 32 символа, без значения по умолчанию
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET_AVATARS=avatars
MINIO_BUCKET_POSTS=posts-media
MINIO_BUCKET_STORIES=stories-media
MINIO_BUCKET_APPLICATIONS=applications

SMTP_HOST=  SMTP_PORT=587  SMTP_USER=  SMTP_PASS=
SMTP_FROM="StudentHub <noreply@studenthub.app>"

CORS_ORIGIN=http://localhost:3000
THROTTLE_TTL=900
THROTTLE_LIMIT=5
SENTRY_DSN=
```

### `apps/web/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_WS_URL=http://localhost:3001
NEXT_PUBLIC_MINIO_URL=http://localhost:9000
NEXT_PUBLIC_APP_NAME=StudentHub
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### `docker/.env`
```env
POSTGRES_USER=postgres  POSTGRES_PASSWORD=  POSTGRES_DB=studenthub
REDIS_PASSWORD=
MINIO_ROOT_USER=  MINIO_ROOT_PASSWORD=
API_PORT=3001  WEB_PORT=3000  MINIO_PORT=9000  MINIO_CONSOLE_PORT=9001
POSTGRES_PORT=5432  REDIS_PORT=6379
```

---

## 14. Первый запуск

```bash
pnpm install

cp docker/.env.example docker/.env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
# заполнить секреты

docker compose -f docker/docker-compose.yml up -d postgres redis minio
# дождаться healthy (~10 с)

pnpm --filter api prisma migrate deploy
pnpm --filter api prisma db seed

pnpm dev        # turbo поднимает api:3001 и web:3000
```

### Что создаёт seed

| # | Объект | Значение |
|---|---|---|
| 1 | `PLATFORM_ADMIN` | `admin@studenthub.app` / `Admin1234!` — **сменить сразу** |
| 2 | Демо-университет | `seed-university-001`, Демо Университет, Алматы |
| 3 | Демо-факультет | `seed-faculty-001`, ФИТ |
| 4 | Демо-группа | `seed-group-001`, ИС-21 |
| 5 | Dev-инвайт `UNIVERSITY_ADMIN` | `http://localhost:3000/register?token=seed-invite-university-admin-token` |
| 6 | Аудитории | А-101, А-201, Б-105 |

Seed идемпотентен (`upsert`). В production запускается один раз; после первого использования dev-инвайт отзывается, пароль администратора меняется.

Дальнейший порядок ввода пользователей — см. `IMPLEMENTATION_PLAN.md`, Приложение Б.

---

## 15. Тестирование и качество

| Приоритет | Область | Тип | Блокирует мёрж |
|---|---|---|---|
| 🔴 | Guard'ы (JWT, Roles, Scope, WS) | unit | Да |
| 🔴 | `InviteService` | unit | Да |
| 🔴 | `ApplicationService.transitionStatus()` | unit | Да |
| 🔴 | Auth-флоу (login, refresh, register-by-invite) | e2e | Да |
| 🟡 | `PostsService` (audience, cursor) | unit | Да |
| 🟡 | `ChatsGateway` (auth, комнаты) | unit | Нет |
| 🟡 | `FilesService` (MinIO) | integration | Нет |
| 🟢 | `NotificationsService` | unit | Нет |
| 🟢 | Критичные экраны | e2e (Playwright) | Нет |

Инструменты: `jest` + `@nestjs/testing` + `supertest` (backend) · `vitest` + React Testing Library + MSW (frontend) · `playwright` (E2E).

---

## 16. Git и процесс

Ветки: `main` (production, только PR) · `develop` (интеграционная, только PR) · `feat/*` · `fix/*` · `refactor/*` · `chore/*` · `hotfix/*` (от `main`).

Conventional Commits, scope обязателен для `feat` и `fix`:
`feat(auth): регистрация по инвайту` · `fix(schedule): корректный расчёт чётности недели` · `perf(feed): cursor-пагинация`.

PR: ≤ ~400 строк изменений, минимум 1 approve, зелёный CI, squash merge. Чеклист PR — в `BACKEND_RULES §17` / `FRONTEND_RULES §14`.

Именование: файлы `kebab-case` · переменные и функции `camelCase` · классы, типы, enum `PascalCase` · константы `UPPER_SNAKE_CASE` · таблицы `snake_case` через `@@map`.

Prettier: без точек с запятой, одинарные кавычки, `trailingComma: all`, `printWidth: 100`, `tabWidth: 2`.
ESLint: `no-console: warn`, `@typescript-eslint/no-explicit-any: error`.

---

## 17. Открытые решения

Требуют явного ответа от владельца продукта до соответствующей фазы:

| # | Вопрос | До какой фазы |
|---|---|---|
| 1 | Часовые пояса: университеты в разных городах и странах. Где хранится таймзона и в чём отдаётся время расписания? | Ф6 |
| 2 | Как `middleware.ts` определяет роль, если access-токен не в cookie? (читать refresh-cookie или отдельную нечувствительную cookie с ролью) | Ф1 |
| 3 | Сторисы отнесены к v2.0, но присутствуют в маршрутах всех ролей v1.0. Скрывать за фича-флагом или убрать из навигации? | Ф0 |
| 4 | Может ли студент создавать события (в матрице ⚠️)? Какие именно и с чьей модерацией? | Ф10 |
| 5 | Политика хранения: сколько живут сообщения, вложения заявок, удалённые аккаунты? | Ф13 |
| 6 | Мультиязычность контента: посты и объявления пишутся на одном языке или требуют переводов? | Ф13 |
| 7 | Восемь пунктов расхождений в исходной документации — см. `BACKEND_RULES §19` | Ф5 |
