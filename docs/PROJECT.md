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

### 3.2 Заявки в деканат (услуги университета)
Цифровой сервис получения университетских услуг (переработка модуля, идёт в ветке `feat/applications-redesign`). Студент выбирает **услугу** из каталога (категория → услуга), видит требования/срок/способ выдачи, заполняет форму, прикладывает документы (в т.ч. из личного хранилища «Документы»), отправляет; деканат обрабатывает и выдаёт результат (электронно или оригинал). Принцип: «студент приходит в деканат только за готовым результатом».

**Каталог (настраиваемый, не enum):** `ApplicationCategory` (ACADEMIC · CERTIFICATES · FINANCIAL · MILITARY · DORMITORY · PERSONAL_DATA · TECHNICAL · OTHER) → `ApplicationService` (локализованные название/описание/инструкции, `slaHours`, `deliveryModes[ELECTRONIC|PAPER]`, `requiresPickup`, `processingMode`, `universityId` для кастома вуза) → `ServiceRequirement` (чек-лист документов, `documentType` → каталог «Документов») и `ServiceFormField` (динамическая форма). Глобальные шаблоны (`universityId=null`) видны всем вузам.

**Статусная модель** (строки; SSOT — `@studenthub/shared-schemas` `APPLICATION_TRANSITIONS`):
```
DRAFT → SUBMITTED → IN_REVIEW → NEEDS_CORRECTION → RESUBMITTED → IN_REVIEW
                            ↓
                      IN_PREPARATION → READY | READY_FOR_PICKUP → DELIVERED | ISSUED
терминальные: REJECTED, CANCELLED
```
`Application`: `number` (SH-YYYY-NNNNNN), `serviceId`, `deliveryType`, `formData(Json)`, `assignedToId`, SLA-тайминги (`submittedAt/startedAt/dueAt/readyAt/issuedAt`), pickup-поля. Каждый переход/событие пишется в `ApplicationEvent` (единый journal → человеческий timeline студенту + audit сотруднику). Права — `ApplicationPolicy` (единый источник для guard/сервиса/scope, §2.2). Отзыв — статус `CANCELLED` (не DELETE). Документы-требования и результат строятся поверх домена «Документы» (`Document`/`issuedByUniversity`).

> Старая тикет-модель (`ApplicationRequest`, статусы NEW…CLOSED, `PATCH /status`) снята с регистрации и удаляется в финальном cleanup переработки.

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

**Доступность полей профиля по роли.** Набор «самоописываемых» полей зависит от роли —
единый источник `PROFILE_FIELD_ROLES` в `@studenthub/shared-schemas` (одна карта на форму
и на валидацию). Общие поля (ФИО, headline, bio, phone, telegram, languages, timezone,
showEmail/showPhone, profileVisibility) — у всех ролей; личное и соцсети (birthDate, gender,
country, website, instagram) — студенты и преподаватели; академические (academicDegree,
academicTitle, department, subjects, officeHours, researchInterests, publicationsUrl) —
только TEACHER и DEAN; вузовские служебные (employeeNumber, appointmentDate, officeRoom,
jobTitle) — сотрудники вуза; position и workPhone — все не-студенты; responsibilities —
администраторы и модераторы вуза и платформы; moderationAreas — только модераторы;
duties — только STAROSTA. Платформенные роли вне вуза, поэтому кафедры, предметов
и табельного номера у них нет.

`PATCH /users/me` с полем, недоступным роли, отвечает `400 BAD_REQUEST`; `details[]`
перечисляет отклонённые поля (`field` + сообщение). Запрос отклоняется целиком, разрешённая
часть тоже не сохраняется. Роль читается из JWT, не из тела.

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

### 3.9 Помещения и QR над дверью (Ф16)

Над каждым помещением вуза висит печатная наклейка с QR. Студент наводит камеру телефона
(без установки приложения) и попадает на страницу `/r/<код>`, где видит:

- **учебные помещения** (аудитория, лаборатория, спортзал) — «Свободно» или «Занято до 12:30»,
  идущую пару с предметом, **группой** и преподавателем, следующую пару и остаток дня;
- **неучебные** (библиотека, актовый зал, деканат, бухгалтерия, столовая, общежитие) — часы
  работы, телефон и примечание. Часы работы печатаются и на самой наклейке: у двери
  бухгалтерии это нужнее возможности отсканировать.

Занятость считается из расписания с наложением разовых изменений (`ScheduleChange`): отменённая
пара освобождает помещение, перенос в другую аудиторию убирает занятость отсюда, перенос сюда —
добавляет. Чётность недели и «сейчас» — те же правила, что в сетке расписания и на экране
«Сегодня» (общий `buildDayPairs` в `entities/schedule`), иначе экраны расходились бы в показаниях.
«Сейчас» приходит с сервера в таймзоне вуза: часы на телефоне студента могут врать.

**Доступ.** Страница закрыта авторизацией — расписание группы это внутренние данные вуза (§1),
а наклейка висит в открытом коридоре. Незалогиненного ведём на `/login?next=/r/<код>` и после
входа возвращаем на помещение. Неизвестный код и помещение чужого вуза дают ОДИНАКОВЫЙ `NOT_FOUND`:
иначе код становится оракулом для перебора.

**Код.** Короткий (8 символов, алфавит без похожих `0/O`, `1/I/L`) и отдельный от `id` помещения:
QR получается менее плотным (сканируется с большего расстояния) и код можно перевыпустить, обесценив
утёкшую или устаревшую распечатку. Печатается на наклейке текстом как запасной путь. Выдаёт
администратор вуза — по одному помещению или пачкой на корпус/этаж (`/university-admin/rooms`).

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

`next` (App Router) · `typescript` · `tailwindcss` (v4) + `shadcn/ui` (style `radix-nova`: `radix-ui`, `sonner` + `next-themes`, `tw-animate-css`, `class-variance-authority`) · `@reduxjs/toolkit` (auth + UI) · `@tanstack/react-query` (серверное состояние) · `react-hook-form` + `zod` · `axios` · `socket.io-client` · `recharts` · `lucide-react` · `date-fns` · `next-intl` · `@ducanh2912/next-pwa`

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
**Академическая структура:** `University`, `Faculty`, `Group`, `Room`, `Subject`, `Term`, `Course`, `Assignment`, `Submission`, `Attendance`, `GradeColumn`, `Grade`, `Exam`, `ExamResult`, `ConsultationSlot`, `DeaneryAppointment`, `PortfolioItem`
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
   → то же для 401 + code=UNAUTHORIZED, если запрос ушёл БЕЗ Bearer (холодная
     загрузка страницы: токен ещё не восстановлен) — FRONTEND_RULES §5.3
   → новый access → прозрачный повтор исходного запроса (один раз)
   → refresh отклонён (истёк, погашен реюз-детектором, подделан) → 401 И гашение
     обеих cookie, включая нечувствительную sh_role: иначе она переживает мёртвую
     сессию и middleware разворачивает пользователя с /login обратно в приложение,
     где refresh падает снова — бесконечный редирект
   → повтор только что ротированного токена при живой цепочке → новая ротация, а не
     разрыв: ответ мог не доехать до клиента (окно REFRESH_REUSE_GRACE_MS,
     BACKEND_RULES §6.2)

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

**Массовый импорт (CSV/XLSX).** Для онбординга многих студентов сразу — двухшаговый поток:
`POST /invites/bulk/preview` (multipart-файл) парсит CSV/XLSX (колонки `email`, `group` — имя группы, необязательная `role`, по умолчанию STUDENT), разрешает имя группы в id в scope создателя и валидирует каждую строку БЕЗ записи → `{ rows: [{ line, email, groupName, role, groupId, status: READY|DUPLICATE|ERROR, error }], summary }`. Затем `POST /invites/bulk` создаёт инвайты по подтверждённым строкам (сервер повторно валидирует scope/иерархию через тот же `resolveInviteTarget`, пропускает дубли) → `{ created, skipped, failed }`. Обе ручки — те же роли, что и одиночный инвайт (PLATFORM_ADMIN/UNIVERSITY_ADMIN/DEAN/STAROSTA); лимит 500 строк за импорт.

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
| 401 | `INVALID_2FA_CODE` | Неверный/просроченный код 2FA (TOTP или backup) на втором шаге входа |
| 403 | `TWO_FACTOR_SETUP_REQUIRED` | Привилегированной роли нужно включить 2FA; доступ к API закрыт до настройки (кроме эндпоинтов 2FA). Клиент ведёт на `/setup-2fa` |
| 409 | `USERNAME_TAKEN` | Имя пользователя занято другим аккаунтом (`PATCH /users/me/username`). Отдельно от `CONFLICT`: форма подсвечивает именно поле имени |
| 500 | `INTERNAL_ERROR` | Внутренняя ошибка |

Коды — публичный контракт: клиент реагирует на `code`, не на `message`. Тексты для пользователя формирует фронтенд через i18n.

### 8.3 Реестр эндпоинтов

**Auth** — `POST /auth/login` (публ.; тело `{ identifier, password }` — `identifier` это email ИЛИ username, регистронезависимо; при включённой 2FA возвращает `{ twoFactorRequired: true, challengeToken }` вместо токенов) · `POST /auth/login/2fa` (публ.; `{ challengeToken, code }` → сессия) · `POST /auth/refresh` (cookie) · `POST /auth/logout` · `GET /auth/me`. Регистрация (`/auth/register-by-invite`) требует `username` (обязателен, 3–32 [a-z0-9_], хранится в нижнем регистре, уникален). Модель: `User.username String? @unique` (nullable — у зарегистрированных до фичи его нет; задать или сменить можно в настройках, в карточке «Личные данные» — тем же сохранением, что и ФИО; запрос отдельный: `PATCH /users/me/username`). `username` отдаётся **только владельцу** (в `/users/me`): в чужой карточке он вырезается, как и `twoFactorEnabled` — это половина учётных данных, а не публичный хэндл.

**2FA (TOTP)** — `POST /auth/2fa/setup` (секрет + QR/otpauth, pending) · `POST /auth/2fa/enable` (`{ code }` → включить, вернуть backup-коды один раз) · `POST /auth/2fa/disable` (`{ code }` — TOTP или backup). Секрет хранится зашифрованным (AES-256-GCM), backup-коды — bcrypt-хэши; наружу отдаётся только `twoFactorEnabled` (в `/users/me`).

**Форс 2FA для привилегированных ролей.** Ролям `PLATFORM_ADMIN`, `PLATFORM_MODERATOR`, `UNIVERSITY_ADMIN`, `UNIVERSITY_MODERATOR`, `DEAN` двухфакторная аутентификация обязательна. Глобальный `TwoFactorGuard` (после `JwtAuthGuard`) отдаёт `403 TWO_FACTOR_SETUP_REQUIRED` на все эндпоинты, кроме помеченных `@TwoFactorExempt()` (контроллер `auth/2fa/*`), пока 2FA не включена. Флаг `tfa` кладётся в access-токен (без обращения к БД на каждый запрос); при `refresh` payload пересобирается из БД, поэтому после включения 2FA следующая ротация токена снимает форс. Фронт: интерсептор по этому коду уводит на `/setup-2fa` (обязательная настройка); после включения — жёсткий переход на `/`, где `SessionInitializer` перевыпускает токен с `tfa=true`.

**Вход по QR** (стиль Telegram Web; телефон уже авторизован) — `POST /auth/qr/create` (публ.; → `{ qrId, qr, claimSecret, expiresIn }`, QR кодирует `${WEB}/qr?t=<approveToken>`) · `POST /auth/qr/approve` (авторизован; `{ approveToken }` — подтверждение с телефона) · `POST /auth/qr/claim` (публ.; `{ qrId, claimSecret }` → сессия). Состояние — в Redis (TTL 2 мин, одноразовое). WS: отдельный namespace `/qr-login` (без токена), клиент шлёт `qr:subscribe { qrId }`, сервер эмитит `qr:approved { qrId }` при подтверждении. `claimSecret` в QR не попадает — сессию заберёт только инициировавший десктоп.

**Инвайты** — `GET /invites/:token/preview` (публ.) · `POST /auth/register-by-invite` (публ.) · `POST /invites` · `GET /invites` · `POST /invites/bulk/preview` · `POST /invites/bulk` · `PATCH /invites/:id/revoke`

**Пользователи** — `GET|PATCH /users/me` · `PATCH /users/me/username` (смена имени входа; тело `{ username }`, нормализуется в нижний регистр, `409 USERNAME_TAKEN` если занято; пишется в аудит как `change_username`) · `POST|DELETE /users/me/avatar` · `POST|DELETE /users/me/cover` (обложка профиля, multipart-изображение ≤ 10 МБ, бакет `profile-covers`) · `PATCH /users/me/password` · `DELETE /users/me` · `GET /users/:id` · `GET /users` (Admin+; фильтры `role/facultyId/groupId/search/blocked`, offset-пагинация (`limit` ≤ 200 — таблица даёт выбрать 20/100/150/200) + сортировка `?sort=name|email|role|blocked|createdAt&order=asc|desc` — по всей выборке, не по странице; поле сортировки — enum, произвольное имя в `orderBy` не попадает) · `PATCH /users/:id/block|unblock` (Moderator+). Профиль отдаёт `avatarUrl`, `avatarThumbUrl` (квадратное превью ≈128px, генерируется джобой `generate-thumbnail` в очереди `file-processing`; асинхронно, до готовности `null`) и `coverUrl` (публичные URL; `coverUrl` виден и в «визитке» закрытого профиля).

**Друзья** (симметричная дружба, ВК-стиль; Social-зона — все роли) — `POST /friends/requests {userId}` (заявка; встречная PENDING → авто-принятие) · `POST /friends/requests/:id/accept` (только адресат) · `DELETE /friends/:id` (отмена/отклонение/удаление из друзей — любой участник) · `GET /friends` (друзья, cursor) · `GET /friends/requests?direction=incoming|outgoing` (заявки, cursor) · `GET /friends/count` (счётчики) · `GET /friends/status/:userId` (статус `NONE|PENDING_OUTGOING|PENDING_INCOMING|ACCEPTED` + `friendshipId` — для кнопки в профиле). Модель `Friendship` (`requesterId`/`addresseeId`/`status`, `@@unique([requesterId, addresseeId])`); enum `FriendshipStatus = PENDING|ACCEPTED` (блокировка — отдельная `UserBlock`). Уведомления о заявке/принятии — тип `SYSTEM` (`data.url='/friends'`).

**Университеты** — `GET|POST /universities` · `GET|PATCH /universities/:id` · `PATCH /universities/:id/status` (Platform Admin) · `GET /universities/:id/stats`. Поле `city` хранит **код КАТО** (9 цифр), а не название: город переименуют — записи не протухнут, и казахская локаль берётся из справочника. Для зарубежного вуза, которого в КАТО нет, остаётся свободный текст — внешним ключом поле не связано.

**Справочник КАТО** (классификатор административно-территориальных объектов РК) — `GET /kato?search=&scope=places|regions|all&limit=` (поиск для комбобокса; ищет по русскому и казахскому названию сразу) · `GET /kato/resolve?codes=a,b,c` (названия по кодам, до 100 за запрос — один запрос на список вместо запроса на строку). Доступен всем аутентифицированным, без `@Roles` и без scope-гейта: названия городов — не персональные данные, а справочник общий для платформы. Модель `KatoUnit` (`code` — 9-значный код КАТО как первичный ключ, `kind`, `nameRu`/`nameKk`, `parentCode` — self-FK, `regionCode`), enum `KatoKind = REGION|DISTRICT|ADMIN|CITY|SETTLEMENT|VILLAGE|STATION|OTHER`. 16 205 записей, заливаются сидером `pnpm db:seed:kato` из `prisma/data/kato.json` (генерируется из выгрузки stat.gov.kz скриптом `scripts/gen-kato.mjs`). **Верхний уровень — это `region_code = code` (20 записей: 17 областей + Астана, Алматы, Шымкент), а не `kind = 'REGION'`** (три города республиканского значения — города) и не `parentCode IS NULL` (под него попадают ещё 38 объектов с битой иерархией в исходной выгрузке).

**Факультеты** — `GET|POST /faculties` · `GET|PATCH|DELETE /faculties/:id` (удаление только без групп)

**Группы** — `GET|POST /groups` · `GET|PATCH|DELETE /groups/:id` · `GET /groups/:id/members`

**Расписание** — `GET /schedule` (по роли; фильтры `groupId/teacherId/roomId/dayOfWeek/weekType/subject`, отдаёт таймзону вуза) · `GET /schedule/changes` (`?from=&to=`) · `POST /schedule/changes` (Dean/Admin) · `GET|POST /schedules` · `GET|PATCH|DELETE /schedules/:id` · `POST /pairs` · `PATCH|DELETE /pairs/:id`

**Файлы** — `POST /files/upload?bucket=` (буферная, ≤10 МБ) · `POST /files/presign` + `POST /files/confirm` (прямая загрузка крупных файлов: шаги 1 и 3, между ними браузер делает PUT в MinIO) · `GET /files/:id/presigned` · `DELETE /files/:id`. Доменные загрузки имеют свои пары: `POST /documents/upload/presign|confirm`, `POST /materials/:id/files/presign|confirm`, `POST /profile-content/media/presign|confirm`. Правила недоверия на шаге confirm — `docs/BACKEND_RULES.md §8.1`.

**Помещения (Ф16)** — `GET /rooms` (`?kind=`) · `POST /rooms` (вуз из JWT, платформа указывает явно) · `GET|PATCH|DELETE /rooms/:id` · `GET /rooms/qr/:code` (статус по коду из печатного QR: помещение, «сейчас» по часам сервера в таймзоне вуза, пары дня и изменения) · `POST /rooms/qr/batch` (выдать коды пачкой, идемпотентно) · `POST /rooms/:id/qr/rotate` (перевыпуск — расклеенные наклейки перестают работать, пишется в аудит)

**Заявки (услуги)** — каталог: `GET /application-categories` (категории с доступными услугами) · `GET /application-services/:id` (детали: требования-документы + поля формы). Заявки: `POST /applications` (черновик по `serviceId`) · `PATCH /applications/:id` (правка черновика: `deliveryType`+`formData`, только владелец/DRAFT) · `POST /applications/:id/submit` (DRAFT→SUBMITTED: номер SH-YYYY-N + `dueAt` по SLA + валидация формы) · `POST /applications/:id/cancel` (→CANCELLED, владелец до подготовки) · `GET /applications` (список/очередь: server-side пагинация + фильтры `status/serviceId/categoryCode/facultyId/assignedToId/search/overdue/dueToday`, scope через `ApplicationPolicy`) · `GET /applications/:id` (детали + timeline, scope-гейт). Обработка и выдача реализованы: `POST /applications/:id/take|assign|request-correction|start-preparation|reject` · `POST /applications/:id/results` (результат: `type` + `documentNumber?`/`note?`; с `fileId`+`documentType` сервер сам заводит Document на имя СТУДЕНТА — `ownerId=studentId`, `category=ISSUED_BY_UNIVERSITY`, `issuedByUniversity=true` — через привилегированный `DocumentsService.issueToOwner`, публичного эндпоинта у него нет) · `GET /applications/:id/results/:resultId/url?download=1` (presigned-ссылка на выданный документ; гейт — владелец заявки или обработчик, владение Document не проверяется) · `POST /applications/:id/mark-ready|issue|deliver` · документы заявки — `POST /applications/:id/documents`, `POST /applications/:id/documents/:docId/accept|request-replacement`, `GET /applications/:id/documents/:docId/url`. Права — `ApplicationPolicy` (роль+scope, единый источник).

**Посты** — у публикации есть постоянный адрес `/posts/<id>` (страница поста; видимость решает сервер — невидимый отвечает NOT_FOUND) и необязательный `title` (заголовок) и `content` в ОГРАНИЧЕННОМ markdown: `**жирный**`, `*курсив*`, `~~зачёркнутый~~`, `` `код` ``, `[ссылка](url)`, маркированный и нумерованный списки, цитата. Разметка хранится как есть, разбирается на клиенте компонентом `shared/ui/markdown` в React-элементы — `dangerouslySetInnerHTML` не используется нигде, схемы ссылок ограничены http/https/mailto. — `GET|POST /posts` (лента — cursor по видимости; таб `filter=ALL|GROUP|UNIVERSITY|TEACHERS|IMPORTANT` сужает поверх видимости: GROUP/UNIVERSITY — по audience, TEACHERS — посты от преподавателей, IMPORTANT — закреплённые) · `GET|DELETE /posts/:id` (удаление — автор/модератор scope) · `PATCH /posts/:id/pin` (роль строго выше автора) · `POST /posts/:id/reactions` · `DELETE /posts/:id/reactions/:emoji` · `GET|POST /posts/:id/comments` · `DELETE /posts/:id/comments/:commentId` · `POST /posts/:id/repost` (только опубликованный и не личный пост: PERSONAL → 403 `FORBIDDEN`, DRAFT/SCHEDULED → 400 `BAD_REQUEST`; аудитория репоста своя, от оригинала не наследуется; репост репоста ссылается на первоисточник)

**Материалы** — `GET|POST /materials` · `POST /materials/:id/files` (multipart) · `GET /materials/:id/files/:fileId/presigned` · `DELETE /materials/:id` (автор/админ)

**Задания** (Academic Core, задача 3) — `GET /assignments` (по роли; фильтры `courseId/groupId/status/mine`, offset-пагинация; студент/староста видят только PUBLISHED/CLOSED своей группы + своё поле `mySubmission`; преподаватель — свои дисциплины; декан/админ — scope) · `GET /assignments/:id` · `POST /assignments` (препод./декан/админ, только своя дисциплина) · `PATCH /assignments/:id` · `POST /assignments/:id/publish|close` · `DELETE /assignments/:id` · `GET /assignments/:id/submissions` (workspace проверки). Сдача студента: `PUT /assignments/:id/submission` (черновик: text/linkUrl) · `POST /assignments/:id/submit` (DRAFT/RETURNED→SUBMITTED, проверка срока/allowLate). Проверка: `POST /submissions/:id/grade` (score+feedback→GRADED) · `POST /submissions/:id/return` (feedback→RETURNED). Модели: `Assignment` (`courseId`, type/submissionType/status строками, maxScore/maxAttempts/allowLate/publishAt/dueAt), `Submission` (`@@unique([assignmentId,studentId])`, status DRAFT|SUBMITTED|GRADED|RETURNED, text/linkUrl/attemptNumber/score/feedback). Файловые вложения сдач — следующей миграцией (сейчас текст + ссылка).

**Консультации** (Academic Core, задача 15) — `GET /consultations/mine` (препод — свои слоты, студент — свои записи) · `GET /consultations/teachers` (студент: преподаватели вуза с открытыми слотами) · `GET /consultations/slots?teacherId=` (открытые слоты препода для записи) · `POST /consultations/slots` (препод/декан: интервал приёма) · `DELETE /consultations/slots/:id` · `POST /consultations/slots/:id/book` (студент, `{topic?}`) · `POST /consultations/slots/:id/cancel` (студент — снять запись, препод — отменить слот). Статусы: `OPEN|BOOKED|CANCELLED`. Модель `ConsultationSlot` (teacherId/studentId?/startsAt/endsAt/location?/isOnline/topic?). Уведомления (SYSTEM) на запись/отмену.

**Запись в деканат** (Academic Core, задача 16) — `POST /deanery-appointments` (студент: `{type,requestedAt,topic?,applicationId?}`) · `GET /deanery-appointments/mine` (студент) · `POST /deanery-appointments/:id/cancel` (студент) · `GET /deanery-appointments/queue` (деканат: очередь факультета) · `POST /deanery-appointments/:id/{confirm,reschedule}` (`{scheduledAt,staffNote?}`) · `POST /deanery-appointments/:id/complete` · `POST /deanery-appointments/:id/staff-cancel`. Типы `CONSULTATION|DOCUMENT|ACADEMIC|OTHER`, статусы `REQUESTED|CONFIRMED|RESCHEDULED|COMPLETED|CANCELLED` (SSOT — shared-schemas). Модель `DeaneryAppointment`. Уведомления студенту (SYSTEM).

**Портфолио** (Academic Core, задача 21) — `GET /portfolio/mine` (владелец: все записи, включая приватные) · `GET /portfolio/user/:id` (с учётом приватности: `PUBLIC` всем, `UNIVERSITY` внутри вуза, `PRIVATE` скрыт) · `POST /portfolio` · `PATCH /portfolio/:id` · `DELETE /portfolio/:id` (только владелец). Виды `EDUCATION|EXPERIENCE|PROJECT|CERTIFICATE|ACHIEVEMENT`, видимость `PRIVATE|UNIVERSITY|PUBLIC` (SSOT — shared-schemas). Модель `PortfolioItem` (kind/title/organization?/description?/url?/startDate?/endDate?/visibility).

**Цифровой студенческий** (Academic Core, задача 20) — `GET /student-id/me` (студент/староста: карта — ФИО/факультет/группа/№ билета/статус + подписанный QR TTL 5мин со ссылкой `/verify-id?t=`) · `GET /student-id/verify?token=` (сотрудник вуза: верификация карты по QR, scope — тот же вуз). Без новой модели (данные из `User`). Токен — HMAC (`common/crypto/signed-token`).

**Поиск** (Academic Core, задача 22; расширен Unified UX PR-6) — `GET /search?q=` (мин. 2 символа) → кросс-модульно по scope: `{ people, courses, assignments, materials, events, chats }` (по 6). События — по названию в пределах вуза; чаты — только те, где смотрящий состоит (scope = членство). Устойчив к непримененным миграциям (`Promise.allSettled` — недоступный источник просто пуст). Command Palette (Ctrl/Cmd+K) на фронте использует этот же эндпоинт.

**Аналитика декана** (Academic Core, задача 14) — read-only агрегаты (декан/админ вуза): `GET /analytics/faculty` (`?facultyId=` для админа; декан — свой факультет из JWT) → показатели (студенты, группы, посещаемость %, работ на проверке, экзаменов впереди) + посещаемость по группам + блок «требует внимания» (группы с посещаемостью < 60%) · `GET /analytics/group/:id/attendance` (drill-down: посещаемость по студентам группы) · `GET /analytics/at-risk` (Early Warning, Unified UX PR-7: студенты «требует внимания» с ЯВНЫМИ причинами — `LOW_ATTENDANCE`<60% / `OVERDUE_ASSIGNMENTS` шт / `LOW_GRADES`<50%, каждая с числовым `value`; `severity` = число причин; без скрытого скоринга). Без новых моделей — агрегация поверх `Attendance`/`Submission`/`Grade`/`Exam` в пределах scope.

**Аналитика вуза** (дашборд `UNIVERSITY_ADMIN`/`UNIVERSITY_MODERATOR`) — read-only агрегаты, scope = `universityId` из JWT (параметром вуз не принимается): `GET /analytics/university/attendance-trend?weeks=` (посещаемость по неделям, ряд на факультет) · `GET /analytics/university/attendance-breakdown` (PRESENT/LATE/ABSENT/EXCUSED по факультетам) · `GET /analytics/university/room-load` (сетка 7×24 «день недели × час начала пары» + пик и число учебных аудиторий) · `GET /analytics/university/exam-results` (PASSED/FAILED/ABSENT/RETAKE по факультетам) · `GET /analytics/university/applications-flow?weeks=` (заявки по неделям: поступило / закрыто по `ready_at` / закрыто с `ready_at > due_at`) · `GET /analytics/university/invites-funnel` (выдано/принято/ждут/истекли/отозваны + конверсия). Все ряды считаются в SQL (`date_trunc`/`FILTER`), кэш Redis 5 мин, новых моделей нет.

**Аналитика платформы** (дашборд `PLATFORM_ADMIN`) — read-only агрегаты по всем вузам, только
`PLATFORM_ADMIN`/`PLATFORM_MODERATOR`, префикс `GET /analytics/platform/*`. Общие query-параметры
периода: `from`, `to` (полуинтервал `[from, to)`, по умолчанию последние 30 дней), `interval`
(`day|week|month`, по умолчанию `day`). Все ряды приходят с ПОЛНЫМИ корзинами — сервер досыпает
нули, клиент ничего не достраивает. Каждый агрегат кэшируется в Redis (TTL 300 с, ключ
`analytics:platform:<имя>:<параметры>`).

- `overview` — плитки: вузы по статусам, всего пользователей, жалоб в очереди, медиана времени
  разбора жалобы (за 30 дней + предыдущие 30 для дельты), DAU/WAU; спарклайны за 14 дней.
- `users-growth` — новые регистрации по корзинам, три группы ролей (`students` = STUDENT+STAROSTA,
  `teachers`, `staff`).
- `active-users` — `dau`/`wau` по `COUNT(DISTINCT audit_logs.user_id)`. Источник — журнал аудита,
  а НЕ `users.last_seen_at`: последнее поле перезаписывается при каждом уходе в оффлайн и
  исторического ряда не даёт. Считаются пользователи, чьи действия попадают в аудит.
- `universities-size` — студенты/преподаватели/всего по каждому вузу одним запросом (заменяет
  N+1 на странице «Статистика»), сортировка по убыванию размера.
- `complaints-flow` — `created`/`resolved` по корзинам (обе величины — счётчики, одна ось).
- `complaints-latency` — распределение `resolved_at − created_at` по неравным корзинам
  (`lt1h`,`lt4h`,`lt1d`,`lt3d`,`lt7d`,`gte7d`) + медиана в часах (`percentile_cont`).
- `invites-funnel` — конверсия в регистрацию (`USED`/всего, проценты), разбивка по статусам и
  ряд статусов по корзинам.
- `activity-heatmap` — сетка 7×24 событий аудита, `cells[dow][hour]`, `dow` 0 = понедельник.
  Время в **UTC**: у вузов свои таймзоны, единого локального часа у платформы нет.
- `top-actions` — топ действий аудита за период (`limit` 1…20, по умолчанию 8).

Без новых моделей — агрегация поверх `User`/`University`/`Complaint`/`Invite`/`AuditLog`.

**Экзамены** (Academic Core, задача 11) — `GET /exams` (по роли; фильтры `groupId/courseId/mine`; студент видит свою сессию + поле `myResult`) · `GET /exams/:id` · `POST /exams` (декан/препод: дисциплина+дата+формат+аудитория?+экзаменатор?) · `PATCH|DELETE /exams/:id` · `GET /exams/:id/results` (ведомость: студенты группы + результаты) · `PUT /exams/results` (массово: `{examId,entries:[{studentId,admitted,status,score?,note?}]}`). Формат: `ORAL|WRITTEN|TEST|PROJECT|OTHER`; статус результата: `SCHEDULED|PASSED|FAILED|ABSENT|RETAKE`; допуск — `admitted:boolean`; пересдача — `attempt`. Модели: `Exam` (courseId/groupId/examinerId?/roomId?/date/format/maxScore), `ExamResult` (`@@unique([examId,studentId])`).

**Журнал оценок** (Academic Core, задача 7) — `GET /gradebook/course/:courseId` (преподаватель: колонки+студенты+матрица оценок) · `POST /gradebook/columns` · `PATCH /gradebook/columns/:id` · `POST /gradebook/columns/:id/publish|unpublish` (черновик vs опубликовано) · `DELETE /gradebook/columns/:id` · `PUT /gradebook/grades` (массовое сохранение оценок колонки, score=null очищает) · `GET /gradebook/me` (студент: опубликованные оценки по дисциплинам — задача 8). Модели: `GradeColumn` (контрольная точка курса: kind `LAB|CONTROL|EXAM|OTHER` строкой, maxScore, position, `published`), `Grade` (`@@unique([columnId,studentId])`, score Float). Студент видит только оценки опубликованных колонок.

**Посещаемость** (Academic Core, задача 5) — `GET /attendance/roster?pairId=&date=` (преподаватель/декан/админ: студенты группы + их отметки на занятии) · `PUT /attendance` (массово: `{pairId,date,entries:[{studentId,status,note?}]}`, upsert, scope: препод только свои пары) · `GET /attendance/me?from=&to=` (студент: сводка — total/present/late/absent/excused/rate + последние записи). Статусы строкой: `PRESENT|LATE|ABSENT|EXCUSED` (SSOT — shared-schemas). Модель `Attendance` (`@@unique([pairId,date,studentId])`, `markedById`). **QR-отметка (задача 6):** `GET /attendance/qr?pairId=&date=` (препод/декан/админ: подписанный короткоживущий токен TTL 90с + QR-картинка + `checkinUrl` вида `/checkin?t=`) · `POST /attendance/check-in {token}` (студент: самоотметка `PRESENT`, идемпотентно — не перетирает существующую отметку; проверка принадлежности группе). Токен — HMAC-подпись (`common/crypto/signed-token`), stateless. Агрегация по факультету/группе (декан) — задача 14.

**Дисциплины** (Academic Core, задача 2) — справочники вуза: `GET /subjects` (по scope; `?search=`) · `POST|PATCH|DELETE /subjects[...]` (админ вуза) · `GET /terms` (семестры вуза) · `POST|PATCH|DELETE /terms[...]` (админ вуза). Курсы: `GET /courses` (по роли; фильтры `groupId/termId/teacherId/mine`, offset-пагинация; студент/староста — своя группа, декан — факультет, преподаватель/админ — вуз) · `GET /courses/:id` (scope-гейт) · `POST|PATCH|DELETE /courses[...]` (декан/админ вуза). Модели: `Subject` (справочник дисциплин вуза, `@@unique([universityId,name])`), `Term` (семестр как сущность: `startsOn/endsOn/isActive`), `Course` (дисциплина группы в семестре: `subjectId/groupId/teacherId?/termId?/credits?`, `@@unique([subjectId,groupId,termId])`). Связь `Pair.subject`/`Material.subject` с `Course` — следующей миграцией.

**Сторисы (v2.0)** — `GET|POST /stories` · `GET|DELETE /stories/:id` · `POST /stories/:id/reactions`

**События** — `GET|POST /events` · `GET|PATCH|DELETE /events/:id` · `POST|DELETE /events/:id/register` · `GET /events/:id/participants`

**Чаты** — `GET|POST /chats` (список: последнее сообщение + флаги непрочитанного/`muted`; официальные чаты авто-создаются) · `GET /chats/:id/messages` (cursor; аддитивно: `around=<messageId>` — окно из ≤`limit` старее + целевое + ≤`limit` новее, `meta.{cursor,hasNext}` — старые, `meta.{prevCursor,hasPrev}` — новые; `aroundDate=<ISO>` — окно вокруг первого сообщения на/после даты (переход по дате; нет таких — новейшие); `direction=older|newer` — направление курсорной подгрузки, `newer` для скролла вниз после jump) · `POST /chats/:id/messages` (multipart: текст + вложения, `message:new` эмитится сервером один раз) · `GET /chats/:id/updates?since=<seq>&sinceTs=<ISO>` (догон после обрыва связи: `created` — сообщения с `Message.seq > since`, `mutated` — известные клиенту сообщения с правкой или (от)закреплением после `sinceTs`, `deletedIds` — удалённые за то же время, `latestSeq` — текущий `Chat.lastSeq`; `overflow: true` — разрыв больше 200 сообщений, клиент перезапрашивает историю целиком. Без `sinceTs` возвращаются только новые. Снятие реакции дельтой не покрывается — удалённая строка `MessageReaction` следа не оставляет) · `GET /chats/search?q=&chatId=&senderId=&hasFile=` (в чате при `chatId`, иначе по всем чатам участника; фильтры §4: `senderId` — по автору, `hasFile` — только с вложениями; cursor) · `GET /chats/:id/media?type=media|file|voice` (общие материалы §23: вложения по MIME — media=image/video, voice=audio, file=остальное; cursor; отдаёт `id,messageId,name,mime,size,hasPoster,createdAt,sender`) · `GET /chats/:id/links` (сообщения с `linkPreview`; cursor; `messageId,createdAt,sender,linkPreview`) · `POST /chats/:id/poll` (опрос §38: сообщение-опрос + `ChatPoll`; `{question, options[2..10], multiple?, anonymous?, allowRevote?, randomOrder?}`; эмит `message:new`) · `GET /chats/polls/:pollId` (результаты для смотрящего: счётчики + `myOptionIds`; у неанонимного опроса — `options[].voters` (имена и аватары первых 300 проголосовавших, §39), у анонимного список всегда пуст — личности не раскрываются даже автору) · `POST /chats/polls/:pollId/vote` (`{optionIds[]}`, пустой — снять голос; эмит WS `poll:updated {pollId, chatId}`) · `GET /chats/:id/pinned` · `POST|DELETE /chats/messages/:messageId/pin` · `POST /chats/messages/:messageId/reactions` (тоггл эмодзи) · `POST /chats/:id/forward {messageId}` (пересылка в этот чат, участник обоих) · `GET /chats/:id/export` (история хронологически, cap 5000) · `POST|DELETE /chats/:id/mute` (§17: POST `{minutes?, importantOnly?}` — заглушить на время (`ChatMember.mutedUntil`), иначе навсегда; `importantOnly` — режим «только важные»: ответы на мои сообщения и упоминания меня по имени уведомление всё равно создают (`ChatMember.muteImportantOnly`); DELETE — включить, флаг режима сбрасывается) · `GET|POST /chats/folders` · `PATCH|DELETE /chats/folders/:id` (§2, пользовательские папки: личные вкладки поверх списка чатов; состав правится целиком, до 20 папок и 200 чатов в каждой; встроенные вкладки по типу чата считает клиент и в БД их нет) · `POST|DELETE /chats/:id/pin` (закрепить/открепить чат «у себя» — сверху списка, персонально) · `GET /chats/:id/presence` (онлайн-статусы участников) · `GET /chats/:id/members` (участники с ролью, онлайн, `lastSeenAt` §49 у оффлайн, и флагом `banned` — окно управления группой) · `GET /chats/attachments/:fileId/url` (presigned, доступ по членству) · `POST /chats/:id/members` · `DELETE /chats/:id/members/:userId` · `POST|DELETE /chats/:id/members/:userId/ban` (бан/разбан участника группы — только создатель) · `POST|DELETE /chats/:id/avatar` (аватар группы, multipart; только создатель) · `POST|DELETE /chats/blocks/:userId` (личная блокировка — запрет переписки в PRIVATE в любую сторону) · `GET /chats/blocks` (список заблокированных мной) · `PATCH /chats/:id {title}` (переименовать группу — админ) · `DELETE /chats/:id` (владелец GROUP удаляет группу; иначе выход/удаление у себя) · `POST /chats/:id/clear` (очистка истории «для меня» через `ChatMember.clearedAt`) · `POST|DELETE /chats/:id/members/:userId/admin` (назначить/снять админа — только создатель) · `POST /chats/:id/transfer/:userId` (передать владение — только создатель). Отправка сообщений троттлится (20/10с на пользователя, RATE_LIMIT). Список чатов отдаёт `avatarUrl` (для PRIVATE — аватар собеседника), `unreadCount`, `pinned` (закреплённые сортируются сверху), `isOwner`, `isAdmin`, `blocked`/`blockedBy`; `GET /chats/:id/members` — `banned` и `isAdmin`. Модель: `Chat.avatarUrl/createdById/lastSeq`, `Message.seq` (монотонный номер внутри чата, уникальный `[chatId, seq]`; аллокатор — атомарный инкремент `Chat.lastSeq`), `ChatMember.bannedAt/isAdmin/clearedAt/pinnedAt/muteImportantOnly`, модели `UserBlock`, `ChatFolder`/`ChatFolderItem` (§2). Текстовые сообщения/typing/статусы/ответы (`replyToId`) — через WS (`ChatGateway`). Вложения — только REST (multipart, бакет `chat-media`, приватный). Системные сообщения группы (§20): `Message.systemType` (member_added/member_removed/member_left/admin_granted/admin_revoked/title_changed/avatar_changed/message_pinned/owner_changed) + `systemMeta` {targetName?, title?}; эмитятся `message:new` при событиях состава/названия/аватара/админа/владельца/закрепления; текст рендерит клиент по типу. Опросы: `ChatPoll`/`ChatPollOption`/`ChatPollVote` (§38, WS `poll:updated`). `GET /chats/saved` (§15: личный self-chat «Сохранённые» — `ChatType.SAVED`, единственный участник; найти/создать). Спойлер (§34): `File.spoiler` (multipart-поле `spoiler` в `POST /chats/:id/messages` помечает все вложения; клиент размывает до клика).

**Уведомления** — `GET /notifications` · `GET /notifications/unread-count` · `PATCH /notifications/:id/read` · `PATCH /notifications/read-all` · `DELETE /notifications/:id` · `GET|PATCH /notifications/settings`

**Файлы** — `POST /files/upload` · `GET /files/:id/presigned` · `DELETE /files/:id`

**Жалобы** — `POST /complaints` (Student/Starosta/Teacher, 10/час) · `GET /complaints` (Moderator+, scope; фильтры `status/priority`, offset-пагинация (`limit` ≤ 200) + сортировка `?sort=priority|createdAt|status|targetType&order=asc|desc`; порядок по умолчанию — очередь: необработанные → приоритет HIGH раньше LOW → свежие раньше) · `GET /complaints/:id` · `GET /complaints/:id/messages` (доступ к чату по жалобе, пишется в аудит) · `PATCH /complaints/:id/resolve` (DELETE_CONTENT / BLOCK_USER / DISMISS)

**Приоритет жалобы** (`Complaint.priority`, enum `ComplaintPriority` = `HIGH|MEDIUM|LOW`) выводится из категории цели и записывается при создании — клиент его не присылает, иначе жалующийся сам назначал бы себе «срочно». Правило одно для API и UI — `complaintPriorityFor` в `packages/shared-schemas`: `USER` и `MESSAGE` → HIGH (страдает конкретный человек: травля, угрозы, спам в личку), `POST` и `STORY` → MEDIUM (публичный контент, не адресован одному человеку), `COMMENT` → LOW (локальная реплика). Порядок значений enum = порядок разбора, поэтому `ORDER BY priority ASC` даёт HIGH сверху. Индекс `@@index([status, priority])`.

**Аудит** — `GET /audit` (Moderator+/Admin, scope: платформа — всё, админ вуза — свой вуз, модератор — свои действия; фильтры `action/userId`, offset-пагинация (`limit` ≤ 200) + сортировка `?sort=createdAt|action|entity|userId&order=asc|desc`, по умолчанию `createdAt desc`)

**Мой день (BFF)** (Unified UX, PR-1/PR-9 — см. `docs/UNIFIED_UX.md`) — `GET /me/today` (операционный экран «Сегодня»/Action Center по роли: `{ role, date, timezone, pairs, scheduleChanges, applications, events, assignments, notifications }`). Агрегирует существующие доменные сервисы (Schedules/Events/Notifications/Assignments/Applications) по scope роли, чтобы клиент делал один запрос вместо нескольких; заявки — только студенту/старосте; каждый источник устойчив к сбою (пустой дефолт). · `GET /me/activity?limit=` (единая лента активности, PR-9/#14): свои события из трёх журналов (`ApplicationEvent`/`DocumentEvent`/`AuditLog`) в общем контракте `Activity { id, source, action, entityType, entityId, actorId, ts, meta }` — БЕЗ слияния таблиц; scope = свои (`studentId`/`ownerId`/`userId`), слияние по времени desc, общий лимит. Output-only.

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

### 9.2a Единый конверт `event` (Unified UX PR-8/#12)

Параллельно именованным событиям выше вводится **единый канал** `event` с конвертом
`{ type, entityId, version, ts, data }`, где `type` — `domain.entity.action`
(напр. `schedule.lesson.updated`, `notification.created`, `application.status.changed`,
`grade.published`). Контракт — `@studenthub/shared-schemas` (`RealtimeEnvelope`,
`REALTIME_CHANNEL`, `REALTIME_EVENTS`). Именованные события **не удаляются** — конверт
эмитится рядом (`RealtimeGateway.emitEventToUser/emitEventToRoom`), клиенты мигрируют
постепенно (`useRealtimeEnvelope(type, handler)`). Продублированы `schedule:changed`
→ `schedule.lesson.updated` и `notification:new` → `notification.created`. Реализованы
поверх конверта (без именованного дубля): **`application.status.changed`** (`{ status }` →
владельцу заявки при каждом переходе, вкл. запрос замены документа) и **`grade.published`**
(`{ columnId }` → каждому студенту с оценкой при публикации колонки журнала). Оба — точечно
в user-комнату, payload минимальный, без PII; клиент делает узкий `invalidateQueries`.

### 9.2b Одно соединение на все вкладки

Вкладки одного аккаунта выбирают мастера через `BroadcastChannel` (`shared/realtime/leader-election.ts`):
сокет держит только он, остальные получают события и отправляют свои `emit` через него по шине
(`realtime-bus.ts`). Потребители этого не видят — контекст в обеих ролях отдаёт `RealtimeClient` с тем
же API, что и раньше. Ключ канала включает id пользователя: вкладки разных аккаунтов соединение не
делят. Мастер ведёт рефкаунт комнат `chat:{chatId}` — `chat:leave` уходит на сервер, только когда
комнату отпустила последняя вкладка. Уход мастера (`pagehide`) или его молчание дольше 3 с запускают
перевыборы. Нет `BroadcastChannel` — каждая вкладка работает сама по себе, как до изменения.

### 9.2c Догон пропущенного после обрыва

События, прошедшие мимо отключённого клиента, никто не переприсылает. Вместо перезапроса страницы
истории чат-окно на `connect` забирает разницу: `GET /chats/:id/updates?since=<последний seq>`
(§8.3). `Message.seq` — монотонный номер внутри чата, выдаётся атомарным инкрементом `Chat.lastSeq`
в той же операции, что создаёт сообщение. Полный рефетч остаётся фолбэком: пустой кэш, ошибка
запроса или `overflow`. Остальные чаты по-прежнему обновляются одной инвалидацией списка.

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

### 11.5 Наблюдаемость и внешний трекер ошибок (Ф13.8)

Sentry подключён и на api (`@sentry/nestjs`), и на web (`@sentry/nextjs`). Без DSN не
инициализируется — dev, тесты и CI работают как раньше.

Что покрыто: HTTP-5xx (глобальный фильтр), падения job'ов очередей, сбои WS-обработчиков,
падения cron-задач, ошибки серверного рендера Next (`onRequestError`) и любые исключения в
браузере (error-boundary + глобальные обработчики SDK).

**Персональные данные во внешний сервис не уходят.** `sendDefaultPii: false` (без IP и
cookie), плюс собственный `beforeSend`: вырезаются тела запросов, cookie, `Authorization`,
`job.data`; из URL, имён транзакций и хлебных крошек вычищаются секреты (`?token=` ссылки
приглашения и QR студенческого, токен в пути `/invites/:token/preview`). Пользователь
идентифицируется только `id` — без email и ФИО. Session Replay сознательно не подключён.
Правила чистки — общий `scrubSentryEvent` в `@studenthub/shared-config`, покрыт тестами
в обоих приложениях.

Событие Sentry и строка лога связаны в обе стороны: тег `request_id` в событии и
`sentryEventId` в логе pino.

Цена на фронте (§11 — производительность важна, аудитория мобильная): shared First Load JS
106 → 142 кБ, **+36 кБ**. Без tree-shaking трейсинга было бы +89 кБ, поэтому в
`next.config.mjs` включён `webpack.treeshake.removeTracing` — но по условию от
`NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, иначе включение сэмплирования через env тихо не
работало бы.

---

## 12. Карта экранов по ролям

```
PLATFORM_ADMIN → /platform-admin/
  dashboard · universities · users · invites · roles · posts · stories · events
  complaints · chats · stats · settings · audit · document-access

PLATFORM_MODERATOR → /moderator/platform/
  dashboard (те же графики, что у админа) · complaints · posts · comments · stories · events
  users · universities · stats · audit · chats

UNIVERSITY_ADMIN → /university-admin/
  dashboard · profile · faculties · groups · students · teachers · deans
  schedule · applications · analytics · complaints · posts · stories · events · chats
  stats · settings · audit

UNIVERSITY_MODERATOR → /moderator/university/
  dashboard · complaints · posts · comments · stories · events · users · audit · chats

DEAN → /dean/
  dashboard · faculty · groups · students · teachers · starostas · schedule · calendar
  applications · posts · stories · events · chats · complaints · reports

TEACHER → /teacher/
  dashboard · profile · subjects · groups · schedule · calendar · materials
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

# Мониторинг (Ф13.8). Пусто = Sentry не инициализируется (dev, тесты, CI).
SENTRY_DSN=
SENTRY_ENVIRONMENT=          # production/staging/pilot; по умолчанию NODE_ENV
SENTRY_RELEASE=              # обычно git sha
SENTRY_TRACES_SAMPLE_RATE=0  # 0 = только ошибки, без трейсинга производительности
```

### `apps/web/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_WS_URL=http://localhost:3001
NEXT_PUBLIC_MINIO_URL=http://localhost:9000
NEXT_PUBLIC_APP_NAME=StudentHub
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Мониторинг (Ф13.8). DSN публичный (только принимает события), поэтому NEXT_PUBLIC_.
# Пусто = SDK не инициализируется.
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_SENTRY_ENVIRONMENT=
NEXT_PUBLIC_SENTRY_RELEASE=
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0

# Только на этапе сборки: загрузка source maps. Без токена шаг молча пропускается,
# но стектрейсы в трекере останутся минифицированными.
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=
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
