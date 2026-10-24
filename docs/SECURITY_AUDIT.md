# StudentHub — аудит безопасности API (план 13.5)

> Дата аудита: **2026-10-23**. База: `develop` @ `d51a8586`.
> Чеклист: `docs/BACKEND_RULES.md` §14 (10 правил) плюс смежные жёсткие правила, на которые он
> опирается: §6.1 (guard'ы и публичный список), §6.3 (лимиты), §5.3/§18.8 (`findMany` без
> `take`), §7 (инвайты), §8 (загрузки файлов).
> Реестр: `apps/api/openapi.json` — **473 пути, 582 операции**, 81 контроллер.

Документ — отчёт, а не правила: правила живут в `BACKEND_RULES.md`. Найденное здесь **не
исправлялось** — раздел «Открытые замечания» в конце — очередь на исправление с приоритетом.

---

## 1. Как проверялось

Автоматическая часть — `scripts/security-audit.mjs` (Node, без зависимостей, приложение не
запускает):

```bash
node scripts/security-audit.mjs          # markdown-отчёт
node scripts/security-audit.mjs --json   # то же в JSON
```

Что делает скрипт:

| Проверка | Как |
|---|---|
| Реестр эндпоинтов | Разбирает декораторы всех `*.controller.ts` (`@Controller`, HTTP-метод, `@Public`, `@Roles`, `@RestrictedAllowed`, `@Scope`, `@Throttle`/`@AuthThrottle`, `@UseGuards`) с семантикой `getAllAndOverride` (пометка обработчика заменяет пометку класса) и сверяет с `openapi.json` по `operationId` |
| §6.1 публичный список | `@Public` из кода против таблицы в `BACKEND_RULES.md` §6.1 (таблица читается из файла, не копией) |
| §6.1 «любой вошедший» | Операции без `@Roles` и без `@Public` |
| §14.10 IDOR (эвристика) | Операции с параметром в пути, обработчик которых не берёт `@CurrentUser()` — сервису нечем проверить принадлежность |
| Роли с запретом по умолчанию | Полный список `@RestrictedAllowed` |
| §5.3 / §18.8 | Каждый `.findMany(` в `apps/api/src` (без spec): есть ли `take` на верхнем уровне аргумента |
| §6.1 / §18.5 роль и scope из тела | Поля `role`/`universityId`/`facultyId`/`groupId` в Zod-схемах тела/query (`packages/shared-schemas`, локальные DTO) и каждое чтение `dto.*`/`input.*`/`query.*` этих полей в сервисах и контроллерах |
| §14.9 / §18.6 секреты в ответе | `passwordHash`/`refreshTokenHash`/`tokenHash`/`twoFactorSecret`/`twoFactorBackupCodes`/`claimSecret: true` в `select`; `include` связи на `User` целиком (`author: true` и т. п., имена связей — из `prisma/schema`); запросы к `User` без `select` |
| §8 загрузки | Обработчики, читающие multipart (`readSingleUpload`, `readUploadWithFields`, `req.file()`, `req.parts()`, в том числе через приватный помощник контроллера), и путь от них по вызовам (до трёх уровней) к проверке типа по magic bytes (`FileService.upload`, `putAuxImage`, `detectAllowedFileType`) |
| §14.1–14.6 | Строковые литералы, похожие на секрет; `$queryRawUnsafe`/`$executeRawUnsafe`/`Prisma.raw`; вызовы bcrypt и их cost; `origin: '*'`/`true`; `helmet` и CORS в `main.ts`; `min(32)` у JWT-секретов в `env.schema.ts` |

Скрипт находит **кандидатов**, а не выносит приговор: «без `@Roles`» законно, если сервис сам
режет выдачу по scope из токена. Поэтому каждый класс находок ниже разобран руками — что
открыто, какой файл, что проверено.

Чего аудит **не** покрывает: поведение во время выполнения (не было пентеста и фаззинга),
события WebSocket (`ChatGateway`, `QrLoginGateway`), бизнес-IDOR сверх эвристики и выборки
ниже, уязвимости зависимостей (их ловят `pnpm audit` и trivy в `codeChecks`), мини-апп
(`MiniAppGuard`, белый список `@MiniAllowed`).

### Глобальные guard'ы — от чего отталкиваются выводы

`apps/api/src/modules/auth/auth.module.ts:61-80`, по порядку:
`JwtAuthGuard` (снимается `@Public`) → `MaintenanceGuard` → `MiniAppGuard` (токену мини-аппа —
только `@MiniAllowed`) → `RestrictedRoleGuard` (охране и библиотекарю — только
`@RestrictedAllowed`) → `RolesGuard` (`@Roles`; без него — любой вошедший) →
`ActionConfirmGuard` → `ScopeGuard` (`@Scope`) → `TwoFactorGuard`. Плюс `UserThrottlerGuard`
(`app.module.ts:185`): 100/мин с пользователя, у анонимного — с адреса.

Следствие, важное для раздела 3: операция без `@Roles` открыта **всем вошедшим, кроме охраны
и библиотекаря** — то есть восьми ролям, включая `EMPLOYER`.

---

## 2. Сверка реестра

- Разобрано 583 операции; все 582 операции `openapi.json` найдены (0 пропусков разбора).
- Лишняя одна: `POST /telegram/webhook` — контроллер помечен `@ApiExcludeController()`
  (`telegram-hook.controller.ts:21`) и в реестр не попадает намеренно. Разобран ниже вместе с
  публичными.

---

## 3. Результаты по правилам

### §6.1 — публичные маршруты: 29 в коде, 25 в согласованном списке

Полный список `@Public` (скрипт, раздел «@Public»). «Глобальный» — общий лимит 100/мин с адреса.

| Операция | Throttle | Обоснование | В §6.1 |
|---|---|---|---|
| `GET /` | глобальный | статический пинг `{ name, version }` | да |
| `GET /health` | глобальный | проба живости (Railway) | да |
| `GET /client-version` | глобальный | приложение спрашивает про обновление до входа | да |
| `POST /auth/login` | `AuthThrottle` 5/15 мин на учётку + 50/15 мин с адреса; `LocalAuthGuard` | вход | да |
| `POST /auth/login/2fa` | 5/15 мин на challenge + 50/15 мин с адреса | второй шаг входа | да |
| `POST /auth/refresh` | 10/мин на cookie + 1000/мин с адреса | обмен refresh-cookie | да |
| `POST /auth/logout` | глобальный | выход при истёкшем access; гасит только свою сессию | да |
| `POST /auth/register-by-invite` | 10/час на токен инвайта + 100/час с адреса | регистрация по инвайту | да |
| `POST /auth/password/forgot` | 3/15 мин | сброс пароля тем, кто войти не может | да |
| `POST /auth/password/reset` | 5/15 мин | новый пароль по одноразовому токену | да |
| `POST /auth/qr/create` | 20/мин | QR-сессию создаёт неавторизованный десктоп | да |
| `POST /auth/qr/claim` | 30/мин | десктоп забирает сессию по `claimSecret` | да |
| `GET /invites/{token}/preview` | 30/час на токен + 200/час с адреса | превью инвайта | да |
| `GET /verify/{code}` | 20/мин | проверка подлинности бланка посторонним | да |
| `GET /career/resume/public/{slug}` | 30/мин | публичное резюме, включает сам студент | да |
| `POST /career/companies/signup` | 5/15 мин | единственное исключение из инвайт-онли (§18.7, §19 п. 9) | да |
| `POST /career/companies/verify-email` | 10/15 мин | подтверждение почты работодателя | да |
| `POST /career/companies/resend-verification` | 3/15 мин | новая ссылка взамен истёкшей | да |
| `POST /mini/session` | 30/мин | Telegram без JWT; защита — подпись initData | да |
| `POST /mini/link` | 10/мин | то же + одноразовый код из веба | да |
| `GET /media/{fileId}/hls/master.m3u8` | 1200/мин | HLS приватного видео: Safari не приложит JWT; play-токен | да |
| `GET /media/{fileId}/hls/{rendition}/index.m3u8` | 1200/мин | то же | да |
| `GET /media/{fileId}/hls/{rendition}/{segment}` | 1200/мин | `302` на presigned сегмента по play-токену | да |
| `POST /camera-agent/sync` | 60/мин; `AgentAuthGuard` | агент камер без JWT, вход по токену агента | да |
| `GET /.well-known/media-jwks.json` | глобальный | открытый ключ медиатокенов | да |
| `POST /demo-requests` | 5/15 мин | заявка вуза на тестирование (строка в очереди к модератору, аккаунта не создаёт) | **нет** |
| `POST /demo-requests/verify` | 10/15 мин | подтверждение адреса заявки по ссылке из письма | **нет** |
| `GET /platform/state` | глобальный; `OptionalJwtGuard` | баннер техработ до входа; аноним получает только неадресный баннер | **нет** |
| `POST /telegram/webhook` | 120/мин | вебхук бота; секрет в заголовке, сравнение за постоянное время (`telegram-hook.service.ts:206`), без секрета — no-op | **нет** |

Вывод: у всех четырёх несогласованных маршрутов обоснование и защита в коде есть, но §6.1
прямо требует согласования любого расширения списка — замечание **S-1**. Обратных
расхождений (в списке, но закрыт) нет.

### §6.1 — без `@Roles` и без `@Public`: 270 операций («любой вошедший»)

160 из них — изменяющие (не `GET`). Распределение по контроллерам (полный список — скрипт,
раздел «Без @Roles»):

| Контроллер | Операций | Из них изменяющих |
|---|---|---|
| `chats/chats.controller.ts` | 57 | 38 |
| `application-services/applications.controller.ts` | 26 | 20 |
| `profile-content/profile-content.controller.ts` | 26 | 18 |
| `documents/documents.controller.ts` | 19 | 12 |
| `users/users.controller.ts` (`/users/me*`, `/users/{id}`, справочник) | 14 | 9 |
| `posts/posts.controller.ts` | 13 | 9 |
| `events/events.controller.ts` | 11 | 6 |
| `polls/polls.controller.ts` | 10 | 7 |
| `files/files.controller.ts` | 9 | 8 |
| `stories/stories.controller.ts` | 8 | 5 |
| `friends`, `notifications` | по 7 | 3 и 4 |
| `portfolio` | 6 | 4 |
| `push` | 5 | 4 |
| `auth/two-factor`, `chats/chat-folders` | по 4 | 4 и 3 |
| остальные 24 контроллера (справочники, расписание, курсы, группы, факультеты, поиск, КАТО…) | 1–3 | 0–2 |

Что это значит. Эти маршруты по смыслу «свои»: личные чаты, свои документы, свой профиль, своя
заявка, лента своей аудитории. Право решает сервис по `@CurrentUser()`, а не роль маршрута.
Проверено выборочно:

- **Заявки** — 20 изменяющих операций сотрудника (`take`, `assign`, `reject`, `issue`…) без
  `@Roles`: права — матрица `ApplicationPolicy` (`application.policy.ts:41`) с `assert`/
  `assertCanProcess` в `application-process.service.ts:98,105,555`,
  `application-documents.service.ts:244,300,353`, `applications.service.ts:95,339`;
  у `TEACHER`, `PLATFORM_MODERATOR`, `EMPLOYER`, охраны и библиотекаря действий нет.
- **Справочники вуза** (`/groups`, `/faculties`, `/rooms`): не-платформенная роль видит только
  свой вуз, пустой scope подменяется заведомо несуществующим `'__none__'`
  (`faculties.service.ts:198`, `rooms.service.ts:295`, `groups.service.ts:395-402`) — `null` в
  токене не превращается в «без фильтра».
- **Файлы**: `GET /files/{id}/presigned` и `DELETE /files/{id}` — только свои
  (`files.controller.ts:185,206` → `getPresignedUrl(id, user.sub)`, `deleteDetached`).
- **EMPLOYER** в «своих» сервисах обрабатывается явно: `Record<Role, …>` в постах, сторис,
  событиях, заявках, чатах, инвайтах заставляет назвать роль (`posts.service.ts:47,70`,
  `chats.service.ts:409,824,948,1911`, `users.service.ts:723`, `friends.service.ts:86`).

Защита при этом держится на каждом сервисе по отдельности: для `EMPLOYER` (scope пустой) нет
запрета по умолчанию на уровне guard'а, как у охраны и библиотекаря, — замечание **S-2**.

### §14.10 — IDOR (эвристика)

Операций с параметром в пути без `@CurrentUser()` — **1**: `GET /demo-requests/{id}`
(`demo-requests.controller.ts:86`), `@Roles(PLATFORM_ADMIN)` — платформа видит все заявки
по определению. Нарушений нет.

Эвристика ловит только «сервис не знает, кто спрашивает». Что сервис, зная, проверяет
принадлежность, — проверено выборочно (файлы, заявки, справочники выше; жалобы
`complaints.service.ts:698` через `findScoped`), сплошной ручной проход по 270 операциям не
делался.

### `@RestrictedAllowed` — что открыто охране и библиотекарю: 85 операций

| Кому | Операций | Что |
|---|---|---|
| `...RESTRICTED_ROLES` (обе роли) | 40 | весь `/auth/*` (вход, QR, 2FA, сброс пароля, `me`), `GET /me/export`, `/notifications/*` (7), `/push/*` (5), `/releases/me`, `/releases/seen`, свой аккаунт `/users/me*` (9, включая пароль, аватар, удаление) |
| `SECURITY_GUARD` | 8 | `/cameras` (список, настройки, сеанс просмотра: старт/heartbeat/end) — в паре с `@Roles(UNIVERSITY_ADMIN, SECURITY_GUARD)`; `GET /rooms`, `GET /rooms/qr/{code}`, `GET /rooms/{id}` |
| `LIBRARIAN` | 36 | весь `/library/*` (контроллеры помечены целиком). На студенческих ручках (`/library/me/*`, бронь, спор) `@Roles(STUDENT, STAROSTA)` всё равно закрывает их библиотекарю — пометка класса не открывает больше, чем разрешает роль |
| обе роли | 1 | `GET /student-id/verify` (`@Roles(...VERIFY_ROLES)`) |

Решение владельца «охрана и библиотекарь — только свои экраны» соблюдено: ни чатов, ни ленты,
ни поиска, ни профилей в списке нет. Замечаний нет.

### §14.1 — секретов в коде и git нет

- В git только `*.env.example` (6 файлов: `apps/api`, `apps/web`, `apps/mini-app`, `docker/dev`,
  `docker/prod` ×2), настоящих `.env` нет (`git ls-files`).
- Строковых литералов вида `secret|password|token|apiKey… = '<16+ символов>'` в `apps/api/src`
  (без spec) — **0**.
- История проверяется `gitleaks` в каждом прогоне `codeChecks` (job «Безопасность»).
- Пароль `Admin1234!` в `apps/web/e2e/support/sign-in.ts` и `prisma/e2e-fixture.mjs` — тестовые
  аккаунты одноразовой базы e2e, не секрет. Прод-админ — отдельная тема (`docs/RUNBOOK.md`,
  критерий v1.0 «пароль seed-админа сменён»).

**Нарушений нет.**

### §14.2 — env валидируется Zod на старте

`apps/api/src/config/env.schema.ts`: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`TOTP_ENCRYPTION_KEY` — `z.string().min(32)` без значения по умолчанию (строки 33–39):
нет переменной — приложение не стартует. `MEDIA_TOKEN_SECRET` необязателен, выводится из
access-секрета с отдельной солью. **Нарушений нет.**

### §14.3 — bcrypt, cost ≥ 10

Единственный вызов — `apps/api/src/common/security/password.service.ts:15`,
`BCRYPT_ROUNDS = 12` (строка 7). Других алгоритмов для паролей нет. **Нарушений нет.**

### §14.4 — raw SQL только параметризованный

`$queryRawUnsafe` / `$executeRawUnsafe` / `Prisma.raw` — **0**. Сырые запросы — только
тегированные шаблоны `$queryRaw\`…\``/`$executeRaw\`…\`` (подстановки уходят параметрами;
пример — `users.service.ts:1543`). **Нарушений нет.**

### §14.5 — CORS по whitelist

`main.ts:115-120`: `origin: CORS_ORIGIN.split(',')`, `credentials: true`, явный список
методов. `origin: '*'` или `true` в коде — 0. Схема env при этом не запрещает `*` в
`CORS_ORIGIN` для production (`env.schema.ts:158`) — `@fastify/cors` сравнивает элементы
массива буквально, так что `*` в списке не станет подстановкой, но явной проверки нет —
замечание **S-6**.

### §14.6 — helmet всегда

`main.ts:102`: `app.register(helmet)` безусловно. Swagger — только в development
(`main.ts:128`). **Нарушений нет.**

### §14.7 — чужие персональные данные

Проверено выборочно, на уровне `select` и сервиса, а не UI:

- профиль другого человека — `users.service.ts:1088` `getProfileForViewer`: закрытый профиль
  (`profileVisibility = PRIVATE`) отдаёт только карточку, полный — по аудитории видимости
  (`isInVisibilityAudience`, строки 1248–1255), просмотр пишется в аудит (строка 1109);
- староста по заявкам = студент (`application.policy.ts:43`): только свои, чужих не видит;
- справочник людей (`GET /users/directory`) — свой вуз, визитки.

Сплошной проход по всем выдачам не делался. **Нарушений в выборке нет.**

### §14.8 — администратор и личные чаты

Модератор читает переписку только через жалобу: `GET /complaints/{id}/messages`
(`complaints.controller.ts:95`, `@Roles(...MODERATOR_ROLES)`) → `getMessageContext`
(`complaints.service.ts:698`): жалоба в scope модератора, цель — сообщение, каждый доступ —
`AuditLog` `moderator_chat_access` (строка 712). Других путей к чужому чату у ролей
модерации в реестре нет. **Нарушений нет.**

### §14.9 / §18.6 — секреты в ответах

- Секретные поля в `select` — 7 мест, все внутри auth-домена и наружу не уходят:
  `users.service.ts:341` (`findByLoginIdentifierForAuth` → `LocalStrategy`), `:1574`
  (`changePassword`, сверка текущего пароля), `:1952` (`deleteOwnAccount`), `:1489/1505/1506`
  (состояние 2FA для `TwoFactorService`), `auth.service.ts:673` (хэш refresh для сверки
  преемника, сравнение за постоянное время).
- `include` связи на `User` целиком (`author: true`, `sender: true`… — 29 связей из схемы) —
  **0**.
- Запросы к `User` без `select` — 6, все `user.update` с результатом `void`
  (`users.service.ts:1514,1522,1530,1552,1581,2258`).
- `invite.token`: в базе — хэш (`invites.service.ts:163`), сырой токен возвращается только
  создателю в момент выдачи (строка 186). `preview` email и `createdBy` не раскрывает
  (`BACKEND_RULES §7`).

**Нарушений нет.**

### §5.3 / §18.8 — `findMany` без `take`

Найдено **2**, оба ограничены списком `id in`, а не таблицей:

- `library-catalog.service.ts:346` — только что созданные экземпляры, их число ≤
  `LIBRARY_COPIES_MAX` (`shared-schemas/src/library.ts:156`);
- `platform.service.ts:397` — имена авторов ≤ 20 строк журнала (`take: 20` строкой выше).

Реальной выгрузки таблицы нет, но буква правила нарушена — замечание **S-5**.

### §6.1 / §18.5 — роль и scope из тела запроса

- Поля в схемах тела/query — 44 (полный список — скрипт). Это **цели** операции, а не
  личность вызывающего: «для какой группы расписание», «в какой факультет пост», «какую роль
  выдать инвайтом».
- Чтений из `dto`/`input`/`query` — 76. Разобраны все, где значение уходит в запись или
  фильтр: за каждым стоит проверка scope из JWT — `assertScope`/`assertManageScope`
  (`faculties.service.ts:48`, `rooms.service.ts:100`), `assertFacultyInScope`/
  `assertGroupInScope` (`posts.service.ts:1423-1431`, `stories.service.ts:678-684`,
  `events.service.ts:772-777`), `assertGroupManage`/`assertTeachesGroup`
  (`materials.service.ts:66-67`, `courses.service.ts:369`), `resolveUniversityScope`
  (`career/*`), иерархия выдачи инвайта (`invites.service.ts:155`, `resolveInviteTarget`).
  Фильтры списков (`users.service.ts:415-417`, `schedules.service.ts:1381,1390`) накладываются
  поверх scope из токена, а не вместо.
- Роль вызывающего из тела не читается нигде: `@CurrentUser()` — единственный источник
  (`current-user.decorator.ts`). Регистрация по инвайту берёт роль и scope из инвайта.

**Нарушений нет.**

### §8 — загрузки файлов: тип по содержимому, лимит размера

Общий потолок буферной загрузки — `@fastify/multipart` `limits.fileSize =
DIRECT_UPLOAD_THRESHOLD_BYTES` (`main.ts:109`); больше — только presigned (`FILE_DIRECT_UPLOAD_REQUIRED`).

| Операция | Проверка типа (magic bytes) и лимита категории |
|---|---|
| `POST /files/upload` | `FileService.upload` → `detectAllowedFileType` (`file.service.ts:162`) |
| `POST /users/me/avatar` | `users.service.ts` `setAvatar` → `FileService.upload` |
| `POST /users/me/cover` | `FileService.putAuxImage` (`file.service.ts:667`: только IMAGE, лимит IMAGE) |
| `POST /chats/{id}/messages` | `chats.service.ts` `sendMessageRest` → `FileService.upload` |
| `POST /chats/{id}/avatar` | `chats.service.ts` `setChatAvatar` → `FileService.upload` |
| `POST /support/{id}/voice` | `support.service.ts` `voiceReply` → `sendMessageRest` → `FileService.upload` |
| `POST /documents/upload` | `documents.service.ts:301` → `FileService.upload` + белый список `DOCUMENT_MIME` |
| `POST /materials/{id}/files` | `materials.service.ts` `addFile` → `FileService.upload` |
| `POST /assignments/{id}/submission/files` | `assignments.service.ts` `addSubmissionFile` → `FileService.upload` |
| `POST /profile/media` | `profile-content.service.ts` `uploadMedia` → `FileService.upload` |
| `POST /profile/media/{fileId}/poster` | `FileService.putAuxImage` |
| `POST /profile/articles/cover` | `uploadCover` → `FileService.upload` (`expectedCategory: 'IMAGE'`) |
| `POST /library/books/{id}/cover` | `library-catalog.service.ts` `uploadCover` → `FileService.upload` |
| `POST /invites/bulk/preview` | **импорт таблицы**: формат — по расширению имени (`common/import/table-file.ts:92`), в хранилище не пишется |
| `POST /library/import/preview` | то же |

Прямая загрузка (presign → PUT → confirm, 22 операции) идёт через
`FileService.presignPut`/`confirmDirectUpload`: ключ с префиксом владельца, тип по первым
байтам из MinIO, размер из `statObject` (`BACKEND_RULES §8.1`).

Вывод: всё, что ложится в хранилище, проверяется по содержимому. Импорт таблиц определяет
формат по расширению — замечание **S-4**.

### §6.3 — лимиты против таблицы правил

Реализация разошлась с таблицей §6.3 намеренно (обоснование — `user-throttler.guard.ts:38-51`:
вуз за NAT делит один адрес на кампус), но таблица не обновлена:

| Маршрут | §6.3 | Код |
|---|---|---|
| `POST /auth/login` | 5 / 15 мин с IP | 5 / 15 мин на учётку + 50 / 15 мин с адреса |
| `POST /auth/register-by-invite` | 3 / час с IP | 10 / час на токен инвайта + 100 / час с адреса |
| `GET /invites/:token/preview` | 10 / час с IP | 30 / час на токен + 200 / час с адреса |

Замечание **S-3**.

---

## 4. Открытые замечания

Приоритет: **высокий** — эксплуатируемо сейчас; **средний** — нарушение правила или
структурный риск без известного пути эксплуатации; **низкий** — гигиена и документация.
Высоких нет.

| # | Приоритет | Что | Где | Что сделать |
|---|---|---|---|---|
| S-1 | средний | Четыре `@Public`-маршрута вне согласованного списка §6.1 (`POST /demo-requests`, `POST /demo-requests/verify`, `GET /platform/state`, `POST /telegram/webhook`). Защита в коде есть (лимиты, секрет вебхука, `OptionalJwtGuard`), согласования — нет, а §6.1 говорит «всё, чего здесь нет, обязано быть закрыто» | `demo-requests.controller.ts:49,60`, `platform.controller.ts:56`, `telegram-hook.controller.ts:22` | Решение владельца (стоп-точка): внести в таблицу §6.1 с обоснованием или закрыть |
| S-2 | средний | `EMPLOYER` не под запретом по умолчанию: 270 операций без `@Roles` открыты ему наравне со студентом, при пустом scope. Сейчас сервисы обрабатывают его явно (выборка в разделе 3), но новая ручка без `@Roles` откроется работодателю молча | `RestrictedRoleGuard` / `RESTRICTED_ROLES` (`packages/shared-types/src/roles.ts:55`) | Запрет по умолчанию для `EMPLOYER` с белым списком карьерных маршрутов — тем же приёмом, что `@RestrictedAllowed` (изменение guard'ов — стоп-точка) |
| S-3 | низкий | Таблица лимитов §6.3 не совпадает с кодом (вход, регистрация, превью инвайта — см. раздел 3) | `BACKEND_RULES.md` §6.3, `auth.controller.ts:73,169`, `invites.controller.ts:75` | Обновить таблицу под реализацию (или вернуть лимиты — решение владельца) |
| S-4 | низкий | Импорт таблиц определяет формат по расширению имени файла, а не по содержимому (§8). В хранилище файл не попадает, размер ограничен общим потолком multipart и `maxRows`, но разбор XLS(X) получает произвольные байты | `common/import/table-file.ts:92`; `POST /invites/bulk/preview`, `POST /library/import/preview` | Проверять сигнатуру до разбора (ZIP `PK\x03\x04` для xlsx, OLE CFB для xls, текст для csv) |
| S-5 | низкий | `findMany` без `take` (буква §18.8), хотя выборка ограничена `id in` | `library-catalog.service.ts:346`, `platform.service.ts:397` | Добавить `take` по размеру списка |
| S-6 | низкий | `CORS_ORIGIN` в production не проверяется на `*` | `env.schema.ts:158` | `refine` в схеме: в production без `*`, только `https://` |
| S-7 | низкий | `POST /telegram/webhook` не попадает в `openapi.json` (`@ApiExcludeController`), поэтому реестр 582 операций его не содержит, а сверка контракта CI его не видит | `telegram-hook.controller.ts:21` | Оставить исключение, но упомянуть маршрут в `PROJECT.md` §Мини-апп рядом с реестром; аудит его учитывает (раздел 2) |

---

## 5. Повторный аудит

```bash
node scripts/security-audit.mjs > /tmp/audit.md
```

Скрипт быстрый (секунды) и без побочных эффектов — его стоит прогонять перед релизным PR.
Ожидаемые числа на дату аудита: 29 `@Public` (4 вне списка), 270 «любой вошедший», 85
`@RestrictedAllowed`, 1 кандидат IDOR, 2 `findMany` без `take`, 0 секретов в ответах, 15
загрузок (13 через `FileService`, 2 импорта таблиц). Новое число в любой графе — повод
разобрать именно разницу.
