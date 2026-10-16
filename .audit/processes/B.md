## Группа B — Структура вуза и платформа

### B-01 Заявка вуза на подключение (демо) и одобрение платформой

- Бизнес-цель: дать вузу без аккаунта попросить подключение, не нарушая правило «доступ только по инвайту»; одобрение создаёт вуз и инвайт UNIVERSITY_ADMIN.
- Роли: аноним (заявитель), PLATFORM_ADMIN (модерация).
- Вход: UI `/demo` (лендинг → кнопка «Заявка»), `/demo/verify?token=`, `/platform-admin/demo-requests`; cron `purgeUnconfirmedDemoRequests` (04:30).
- Завершение: заявка APPROVED (вуз PENDING + UniversityOnboarding + инвайт, письмо со ссылкой `/register?token=`) или REJECTED (письмо с отказом); неподтверждённые PENDING_EMAIL удаляются cron-ом.
- Шаги и файлы: `POST /demo-requests` (@Public, 5/15мин) → письмо подтверждения (TTL 24ч) → `POST /demo-requests/verify` (@Public) → статус NEW → `GET /demo-requests`, `GET /demo-requests/:id` → `POST /demo-requests/:id/approve|reject`. API: apps/api/src/modules/onboarding/demo-requests.{controller,service}.ts, apps/api/src/modules/cleanup/cleanup.service.ts (cron), apps/api/src/modules/email/email.processor.ts. Web: apps/web/src/views/demo/ui/{demo-request-view,demo-verify-view}.tsx, apps/web/src/views/platform-admin/ui/{demo-requests-view,demo-request-modal}.tsx, apps/web/src/entities/onboarding/api/onboarding-api.ts; лендинг apps/landing/src/ui/{hero,cta}.tsx.
- Данные на входе / выходе: название вуза, город (свободный текст), сайт, оценка числа студентов, контакт, email, телефон, согласие (consentAt/consentVersion, IP, UA) / `UniversityDemoRequest` (PENDING_EMAIL→NEW→APPROVED|REJECTED), `University`, `Invite`, `AuditLog` (`demo_request_*`).
- Внешние зависимости: BullMQ (очередь EMAIL: SEND_DEMO_VERIFICATION/APPROVED/REJECTED), SMTP, Redis (throttler), модуль invites.
- Тесты: apps/api/src/modules/onboarding/demo-requests.service.spec.ts; web/e2e — нет.
- Замечено: approve не атомарен — вуз создаётся транзакцией, а инвайт и смена статуса после неё; сбой инвайта или две параллельные кнопки «Одобрить» (проверка `status !== 'NEW'` до транзакции) дают вуз-дубликат.

### B-02 Создание вуза и управление им со стороны платформы

- Бизнес-цель: завести вуз (тенант) на платформе, вести реестр вузов, менять статус, удалять пустые.
- Роли: PLATFORM_ADMIN (создание/правка/статус/удаление), PLATFORM_MODERATOR (просмотр), UNIVERSITY_ADMIN/MODERATOR (свой профиль и статистика).
- Вход: UI `/platform-admin/universities`; эндпоинты `/universities*`.
- Завершение: вуз создан в статусе PENDING (дальше — инвайт UNIVERSITY_ADMIN через модуль invites и мастер B-03); статус ACTIVE/BLOCKED; удаление возможно только без факультетов/аудиторий/пользователей (FK → 409).
- Шаги и файлы: `POST /universities`, `GET /universities` (page/limit/search/status/sort), `GET /universities/:id`, `GET /universities/:id/stats` (Redis-кэш 5 мин), `PATCH /universities/:id`, `PATCH /universities/:id/status`, `DELETE /universities/:id`. API: apps/api/src/modules/universities/universities.{controller,service}.ts, dto/*. Web: apps/web/src/views/platform-admin/ui/{universities-admin-view,create-university-modal}.tsx, apps/web/src/entities/university/api/university-api.ts, apps/web/src/entities/kato/ui/kato-select.tsx.
- Данные на входе / выходе: name, shortName, country, city (код КАТО или текст), timezone / `University`, счётчики {faculties, groups, rooms, students, teachers}, `AuditLog` (`university_*`).
- Внешние зависимости: Redis (кэш статистики), справочник КАТО (B-08).
- Тесты: apps/api/src/modules/universities/universities.service.spec.ts; web/e2e — нет.
- Замечено: статус вуза BLOCKED нигде не применяется (ни в логине, ни в guard'ах — grep по `university.status` находит только онбординг); в вебе нет UI для `PATCH /universities/:id` и `DELETE`.

### B-03 Мастер настройки вуза (онбординг) и запуск

- Бизнес-цель: провести нового админа вуза по шагам заполнения структуры и перевести вуз из PENDING в ACTIVE.
- Роли: UNIVERSITY_ADMIN.
- Вход: UI `/university-admin/setup`, баннер на `/university-admin`; эндпоинты `/onboarding*`.
- Завершение: `POST /onboarding/launch` переводит вуз в ACTIVE (только если все обязательные шаги выполнены и не пропущены); либо баннер скрыт (`dismiss`).
- Шаги и файлы: `GET /onboarding` (шаги profile/faculties/specialties/groups/rooms/terms/subjects/deans/launch, done считается по count-ам, `canLaunch`) → `POST /onboarding/confirm-profile` → `POST /onboarding/skip` (только specialties/rooms/subjects) → `POST /onboarding/dismiss` → `POST /onboarding/launch`. API: apps/api/src/modules/onboarding/onboarding.{controller,service}.ts, packages/shared-schemas/src/onboarding.ts. Web: apps/web/src/views/onboarding/ui/{setup-view,setup-banner,step-body,quick-add}.tsx, apps/web/src/entities/onboarding/api/onboarding-api.ts.
- Данные на входе / выходе: шаг для пропуска / `UniversityOnboarding` (profileConfirmedAt, skippedSteps, dismissedAt), `University.status`, `AuditLog` (`onboarding_*`).
- Внешние зависимости: Redis (сброс кэша статистики вуза при запуске).
- Тесты: apps/api/src/modules/onboarding/onboarding.service.spec.ts; web/e2e — нет.
- Замечено: шаг «О вузе» показывает `university.city` как есть — для вуза, созданного через KatoSelect, это 9-значный код КАТО, а не название (apps/web/src/views/onboarding/ui/step-body.tsx:85); у вуза из демо-заявки город — свободный текст.

### B-04 Факультеты вуза: создание, переименование, удаление

- Бизнес-цель: завести верхний уровень академической структуры вуза, к которому привязываются группы, деканы и заявки.
- Роли: UNIVERSITY_ADMIN (свой вуз), PLATFORM_ADMIN (любой); чтение — все по scope.
- Вход: UI `/university-admin/faculties`, быстрый ввод в мастере `/university-admin/setup`; эндпоинты `/faculties*`.
- Завершение: факультет создан/переименован; удаление — только пустого (FK Restrict → 409 CONFLICT).
- Шаги и файлы: `POST /faculties` (scope по `universityId` в теле), `GET /faculties`, `GET /faculties/:id`, `PATCH /faculties/:id`, `DELETE /faculties/:id`. API: apps/api/src/modules/faculties/faculties.{controller,service}.ts. Web: apps/web/src/views/university-admin/ui/{faculties-view,create-faculty-modal,rename-button}.tsx, apps/web/src/views/onboarding/ui/quick-add.tsx, apps/web/src/entities/faculty/api/faculty-api.ts.
- Данные на входе / выходе: name, universityId / `Faculty`, `AuditLog` (`faculty_*`), сброс кэша статистики вуза.
- Внешние зависимости: Redis (инвалидация `universities/:id/stats`).
- Тесты: apps/api/src/modules/faculties/faculties.service.spec.ts, apps/api/test/cross-tenant.e2e-spec.ts (чтение/правка/удаление чужого факультета, списки); web/e2e — нет.
- Замечено: нет уникальности названия факультета в пределах вуза (у `Faculty` нет `@@unique([universityId, name])`, в отличие от `Specialty`).

### B-05 Справочник специальностей вуза

- Бизнес-цель: вести список специальностей вуза для выбора в профиле студента и в мастере.
- Роли: UNIVERSITY_ADMIN (CRUD в своём вузе; вуз из JWT); чтение — пользователи вуза.
- Вход: UI `/university-admin/specialties`, шаг мастера «Специальности» (пропускаемый); эндпоинты `/specialties*`.
- Завершение: специальность создана/переименована/удалена; дубль названия → 409.
- Шаги и файлы: `GET /specialties`, `POST /specialties`, `PATCH /specialties/:id`, `DELETE /specialties/:id`. API: apps/api/src/modules/specialties/specialties.{controller,service}.ts. Web: apps/web/src/views/university-admin/ui/{specialties-view,create-specialty-modal}.tsx, apps/web/src/entities/specialty/api/specialty-api.ts.
- Данные на входе / выходе: name / `Specialty` (`@@unique([universityId, name])`), `AuditLog` (`specialty_*`).
- Внешние зависимости: нет.
- Тесты: apps/api/src/modules/specialties/specialties.service.spec.ts (3 кейса); web/e2e — нет.
- Замечено: `User.specialty` — свободная строка без FK, поэтому переименование/удаление специальности в справочнике не доходит до профилей студентов.

### B-06 Учебные группы, состав и назначение старосты

- Бизнес-цель: завести группы факультета, показывать состав и назначать старосту (смена роли STUDENT↔STAROSTA).
- Роли: UNIVERSITY_ADMIN/PLATFORM_ADMIN (CRUD), DEAN (староста своего факультета, просмотр), STAROSTA/STUDENT (своя группа).
- Вход: UI `/university-admin/groups`, `/dean/groups`, `/starosta/group`, `/starosta/classmates`, мастер `/university-admin/setup`; эндпоинты `/groups*`.
- Завершение: группа создана/изменена/удалена; староста назначен или снят (роль сменена в транзакции, разжалованному гасятся сессии).
- Шаги и файлы: `POST /groups`, `GET /groups` (scope смотрящего), `GET /groups/:id`, `GET /groups/:id/members` (take 500), `PATCH /groups/:id`, `PATCH /groups/:id/starosta`, `DELETE /groups/:id`. API: apps/api/src/modules/groups/groups.{controller,service}.ts, apps/api/src/modules/users/users.service.ts (`syncGroupStarosta`, `afterStarostaChange`). Web: apps/web/src/views/university-admin/ui/{groups-view,create-group-modal,edit-group-modal}.tsx, apps/web/src/widgets/{groups-list,group-members}, apps/web/src/features/assign-starosta/ui/assign-starosta.tsx, apps/web/src/views/people/ui/own-group-view.tsx, apps/web/src/entities/group/api/group-api.ts.
- Данные на входе / выходе: name, year, facultyId, starostaId|null / `Group`, `User.role`, `AuditLog` (`group_*`, `user_role_changed`).
- Внешние зависимости: Redis (кэш статистики вуза, сессии).
- Тесты: apps/api/src/modules/groups/groups.service.spec.ts, apps/api/src/modules/users/users.service.spec.ts (syncGroupStarosta), apps/api/test/cross-tenant.e2e-spec.ts; web/e2e — нет.
- Замечено: веб грузит только первую страницу (`fetchGroups` с `limit: 100`, без пагинации) — у вуза с >100 группами экран `/university-admin/groups` молча обрезается; удаление группы без студентов каскадно сносит её курсы, экзамены и материалы (onDelete: Cascade).

### B-07 Помещения вуза: справочник аудиторий и выпуск QR-наклеек

- Бизнес-цель: вести реестр помещений (учебных и служебных) для расписания и печатать над дверью QR с коротким кодом; уметь обесценить утёкшую распечатку.
- Роли: UNIVERSITY_ADMIN (свой вуз), PLATFORM_ADMIN; чтение — пользователи вуза по scope.
- Вход: UI `/university-admin/rooms`, шаг мастера «Аудитории» (пропускаемый); эндпоинты `/rooms*`.
- Завершение: помещение создано/изменено/удалено (удаление запрещено, если на него есть пары → 409); выданы коды и готов лист печати, либо код перевыпущен (старая наклейка даёт 404).
- Шаги и файлы: `POST /rooms`, `GET /rooms`, `GET /rooms/:id`, `PATCH /rooms/:id`, `DELETE /rooms/:id`, `POST /rooms/qr/batch` (идемпотентно), `POST /rooms/:id/qr/rotate`. API: apps/api/src/modules/rooms/{rooms.controller,rooms.service,room-qr.service,room-code}.ts, apps/api/src/common/crypto/readable-code.ts. Web: apps/web/src/views/rooms/ui/{rooms-admin-view,create-room-modal,room-qr-sheet}.tsx, apps/web/src/views/rooms/lib/format-code.ts, apps/web/src/entities/room/api/room-api.ts.
- Данные на входе / выходе: name, kind, building, floor, capacity, openHours, phone, info / `Room` (+`qrCode` 8 символов, `qrIssuedAt`), PNG/data-URL QR для печати, `AuditLog`.
- Внешние зависимости: библиотека `qrcode` (генерация изображения на сервере).
- Тесты: apps/api/src/modules/rooms/room-qr.service.spec.ts, apps/api/test/cross-tenant.e2e-spec.ts (чтение/удаление чужой аудитории), apps/web/src/views/rooms/lib/format-code.test.ts; unit-спеки на `rooms.service.ts` (CRUD) — нет.
- Замечено: создание/удаление помещения не сбрасывает Redis-кэш статистики вуза (счётчик `rooms` отстаёт до 5 мин), в отличие от факультетов и групп.

### B-08 Сканирование QR над дверью: статус помещения «сейчас»

- Бизнес-цель: студент или сотрудник по QR в коридоре видит, свободна ли аудитория, какая пара идёт и что дальше; у служебных помещений — часы работы и телефон.
- Роли: любой аутентифицированный пользователь вуза помещения (платформа — любой); аноним уводится на `/login?next=/r/<код>`.
- Вход: UI `/r/[code]` (переход по QR), `/r` (ручной ввод кода); `GET /rooms/qr/:code`.
- Завершение: показан статус помещения в таймзоне вуза; неизвестный код и чужой вуз — одинаковый 404.
- Шаги и файлы: apps/web/src/app/r/page.tsx, apps/web/src/app/r/[code]/page.tsx, apps/web/src/views/rooms/ui/{room-code-entry-view,room-status-view}.tsx, apps/web/src/entities/room/lib/room-day.ts, apps/web/src/entities/schedule (`buildDayPairs`); API: apps/api/src/modules/rooms/room-qr.service.ts (`statusByCode`, `dayInRoom` — пары дня с наложением `ScheduleChange`).
- Данные на входе / выходе: код из QR / помещение, флаг `academic`, `now` (серверное время вуза), пары дня, изменения.
- Внешние зависимости: middleware Next.js (редирект на логин), модуль расписания (Pair, ScheduleChange).
- Тесты: apps/api/src/modules/rooms/room-qr.service.spec.ts, apps/web/src/entities/room/lib/room-day.test.ts; web/e2e — нет.

### B-09 Справочник КАТО: выбор города вуза и показ названий

- Бизнес-цель: хранить город вуза кодом КАТО (устойчиво к переименованиям, двуязычно ru/kk) и давать комбобокс поиска.
- Роли: любой аутентифицированный (без @Roles и scope); фактически используют PLATFORM_ADMIN/MODERATOR.
- Вход: комбобокс в `/platform-admin/universities` (создание вуза), колонки города в реестре вузов и `/platform-admin/stats`; `GET /kato`, `GET /kato/resolve`; заливка — сид `pnpm db:seed:kato`.
- Завершение: код выбран и сохранён в `University.city`; коды в таблицах заменены названиями на языке интерфейса.
- Шаги и файлы: `GET /kato?search=&scope=places|regions|all&limit=`, `GET /kato/resolve?codes=` (≤100). API: apps/api/src/modules/kato/kato.{controller,service}.ts. Сид: prisma/seed/steps/00-kato.mjs, prisma/seed/data/kato.json, scripts/gen-kato.mjs. Web: apps/web/src/entities/kato/{ui/kato-select.tsx,lib/use-kato-names.ts,lib/kato-name.ts,api/kato-api.ts}, apps/web/src/views/platform-admin/ui/{create-university-modal,universities-admin-view,platform-stats-view}.tsx.
- Данные на входе / выходе: строка поиска, scope, коды / `KatoUnit` (code, kind, nameRu/nameKk, parentCode, regionCode), 16 205 записей.
- Внешние зависимости: выгрузка stat.gov.kz (офлайн, через скрипт генерации).
- Тесты: apps/api/src/modules/kato/kato.service.spec.ts; web — нет.
- Замечено: КАТО не используется ни в форме демо-заявки, ни в одобрении (город — свободный текст), ни на шаге «О вузе» мастера — город вуза хранится в двух форматах вперемешку.

### B-10 Режим техработ (немедленный и плановый)

- Бизнес-цель: остановить платформу для всех, кроме платформенной команды, без деплоя; предупредить заранее о плановом окне; снять режим можно всегда и быстро.
- Роли: PLATFORM_ADMIN (включение/снятие); все пользователи и анонимы (видят экран/предупреждение); PLATFORM_ADMIN/MODERATOR проходят сквозь режим.
- Вход: Telegram мини-апп (экран «Управление»); `PATCH /platform/maintenance` (5/мин); чтение — `GET /platform/state` (@Public).
- Завершение: режим действует до `maintenance_until` (≤12 ч) и снимается сам; либо снят `minutes: null`; все прочие запросы получают 503 MAINTENANCE.
- Шаги и файлы: включение требует кода 2FA (`TwoFactorService.verifyForUser`, иначе 401 INVALID_2FA_CODE), `startsInMinutes` → плановое окно. API: apps/api/src/modules/platform/platform.{controller,service}.ts, apps/api/src/common/guards/maintenance.guard.ts (`@MaintenanceExempt` на auth/2FA/mini/platform/health/client-version/telegram-hook). Клиенты: apps/mini-app/src/screens/control.tsx, apps/mini-app/src/api/platform.ts; web apps/web/src/widgets/platform-gate/ui/platform-gate.tsx, apps/web/src/entities/platform/model/use-platform-state.ts, apps/web/src/app/providers.tsx.
- Данные на входе / выходе: minutes, startsInMinutes, тексты ru/kk/en, code (2FA) / `PlatformState` (singleton: maintenance_from/until), Redis-кэш 60 с + память процесса 5 с, `AuditLog` (`platform.maintenance.on|off`).
- Внешние зависимости: Redis, Telegram (мини-апп, initData), TOTP.
- Тесты: apps/api/src/modules/platform/platform.service.spec.ts, apps/api/src/common/guards/maintenance.guard.spec.ts, apps/web/src/widgets/platform-gate/ui/platform-gate.test.tsx; e2e — нет.
- Замечено: в веб-админке платформы нет UI для рычагов — управлять режимом можно только из Telegram мини-аппа (или прямым API-вызовом).

### B-11 Оперативные рычаги платформы: баннер, погашение разделов, сезон, откат

- Бизнес-цель: без деплоя показать объявление (адресно по ролям/вузам), спрятать сломанный раздел у всех, выключить/подменить праздничное оформление и отменить последнее нажатие.
- Роли: PLATFORM_ADMIN (запись); все (чтение публичного состояния).
- Вход: Telegram мини-апп; `PATCH /platform/banner`, `PATCH /platform/sections`, `PATCH /platform/season`, `POST /platform/undo`; чтение — `GET /platform/state`.
- Завершение: баннер висит до `banner_until` (≤30 сут), раздел убран из навигации и закрыт по прямой ссылке, сезон выключен/подменён; undo возвращает только переписанные поля (не старше 30 мин, иначе 409).
- Шаги и файлы: apps/api/src/modules/platform/platform.service.ts (`setBanner`, `setSections`, `setSeason`, `undoLast`, `write`/`snapshot`), dto/{set-banner,set-sections,set-season}.dto.ts. Web: apps/web/src/widgets/platform-gate/ui/platform-gate.tsx (`disabledSectionForPath`), apps/web/src/entities/platform/lib/{sections,pick-text}.ts, apps/web/src/widgets/app-shell/ui/app-shell.tsx (баннер, `isNavKeyDisabled`), apps/web/src/shared/config/holidays.ts, apps/web/src/shared/ui/{season-icon.ts,season-decor.tsx,season-greeting.tsx}. Мини-апп: apps/mini-app/src/screens/control.tsx.
- Данные на входе / выходе: текст ru/kk/en, level, minutes, roles[], universityIds[], disabled[], {off, override} / `PlatformState`, `AuditLog` (`platform.banner.*`, `platform.sections.set`, `platform.season.set`, снимок «как было» в metadata).
- Внешние зависимости: Redis (кэш состояния), Telegram (мини-апп).
- Тесты: apps/api/src/modules/platform/platform.service.spec.ts, apps/web/src/widgets/platform-gate/ui/platform-gate.test.tsx, apps/web/src/shared/config/holidays.test.ts, apps/web/src/shared/ui/season-icon.test.ts; тестов экрана мини-аппа control.tsx — нет.

### B-12 Дежурство команды платформы и уведомления (тихие часы, суточная сводка)

- Бизнес-цель: направлять сигналы о жалобах/обращениях одному дежурному по очереди, не будить в тихие часы и ежедневно присылать сводку очереди.
- Роли: PLATFORM_ADMIN (настройка); система (cron); дежурный/команда (получатели в Telegram).
- Вход: мини-апп (экран «Управление»); `GET|PATCH /platform/duty`, `PATCH /platform/notifications`; cron `rotateDuty` (пн 09:00), cron `sendDailyDigest` (ежечасно, отправка в выбранный час).
- Завершение: дежурство переходит к следующему в `rotation`; сводка отправлена (даже при пустой очереди).
- Шаги и файлы: apps/api/src/modules/platform/platform.service.ts (`duty`, `setDuty`, `rotateDuty`, `setNotifications`, `notificationPolicy`), apps/api/src/modules/cleanup/cleanup.service.ts (cron + Redis-лок), apps/api/src/common/telegram/telegram-notify.service.ts, apps/mini-app/src/screens/control.tsx, apps/mini-app/src/api/platform.ts (`/mini/links` — пул дежурных).
- Данные на входе / выходе: rotation (≤10 id), quiet from/to, muted[], dutyUserId, digestHour / `PlatformState`, сообщения Telegram, `AuditLog`.
- Внешние зависимости: Telegram Bot API, Redis (локи cron).
- Тесты: apps/api/src/modules/platform/platform.service.spec.ts, apps/api/src/modules/cleanup/cleanup.service.spec.ts, apps/api/src/common/telegram/telegram-notify.service.spec.ts.

### B-13 Наблюдение за платформой: очереди, хранилище, журнал изменений

- Бизнес-цель: видеть с телефона, не отстаёт ли воркер (ждущие/упавшие задачи BullMQ), сколько занимают файлы и кто последним трогал рычаги.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR.
- Вход: мини-апп, экран «Обзор»; `GET /platform/queues`, `GET /platform/storage`, `GET /platform/changes`.
- Завершение: показаны счётчики очередей, объём файлов по таблице `File`, последние записи `platform.*` аудита.
- Шаги и файлы: apps/api/src/modules/platform/platform.controller.ts (`queues` → `QueueService.counts`), apps/api/src/modules/platform/platform.service.ts (`storageUsage`, `recentChanges`), apps/api/src/common/queue/queue.service.ts; apps/mini-app/src/screens/overview.tsx, apps/mini-app/src/api/overview.ts.
- Данные на входе / выходе: — / {queue, waiting, failed}[], {files, bytes}, список изменений с автором.
- Внешние зависимости: Redis/BullMQ.
- Тесты: apps/api/src/modules/platform/platform.service.spec.ts («наблюдение»); тестов на `queues` и экран overview — нет.
- Замечено: в веб-панели `/platform-admin` эти данные не выводятся — только в мини-аппе.

### B-14 Релизы «Что нового»: объявление версии и показ ноты

- Бизнес-цель: после релиза один раз показать пользователю ноту об изменениях, не обгоняя сборку, которая у него реально загружена (PWA живёт неделями).
- Роли: PLATFORM_ADMIN (объявляет номер версии); все аутентифицированные (читают и отмечают прочитанным).
- Вход: мини-апп (`PATCH /platform/release`); диалог в вебе при старте приложения; `GET /releases/me`, `POST /releases/seen`.
- Завершение: нота показана и отмечена (`ReleaseView.version`); если объявленная версия выше собственной сборки клиента или аккаунт создан после релиза — промолчать.
- Шаги и файлы: API apps/api/src/modules/platform/platform.service.ts (`announceRelease` → `PlatformState.announced_version`), apps/api/src/modules/releases/releases.{controller,service}.ts. Web: apps/web/src/widgets/whats-new/ui/whats-new-dialog.tsx, apps/web/src/entities/release/{api/releases-api.ts,model/notes.json,model/notes.ts,lib/pick-note.ts,lib/compare-versions.ts,ui/release-note-modal.tsx}, apps/web/src/app/providers.tsx; тексты нот — в бандле web, не в БД; регламент docs/RELEASE.md.
- Данные на входе / выходе: version / `{ version, seenAt, accountCreatedAt }`, `ReleaseView` (одна строка на пользователя), `AuditLog` (`platform.release.announce`).
- Внешние зависимости: Redis (кэш `GET /platform/state`), Telegram (мини-апп).
- Тесты: apps/api/src/modules/releases/releases.service.spec.ts, apps/api/src/modules/platform/platform.service.spec.ts (объявление версии), apps/web/src/entities/release/lib/pick-note.test.ts, apps/web/src/entities/release/model/notes.test.ts; тестов диалога whats-new — нет.
- Замечено: `announcedVersion` (рычаг `PATCH /platform/release`) веб нигде не читает — диалог решает только по `notes.json` бандла и `GET /releases/me`, так что объявление из мини-аппа ни на что не влияет.

### B-15 Проверка версии клиента (мобильные приложения) и обновление PWA

- Бизнес-цель: не пускать устаревшие сборки iOS/Android в неработающий API — показать экран «Обновите приложение» со ссылкой на магазин; в вебе — предложить перезагрузку на новый бандл.
- Роли: любой клиент до входа (эндпоинт публичный, не закрывается техработами).
- Вход: `GET /client-version?platform=ios|android` при запуске приложения; заголовок `X-Client-Version` на каждом запросе; в вебе — событие нового service worker.
- Завершение: клиент сравнивает свою версию с `minimumVersion` и при отставании блокирует работу (кнопка «Обновить» только при наличии `storeUrl`); веб показывает тост «Обновить».
- Шаги и файлы: API apps/api/src/modules/client-version/client-version.{controller,service}.ts (ENV `IOS_/ANDROID_MIN_SUPPORTED_VERSION`, `*_STORE_URL`), apps/api/src/common/logging/client-version.ts, apps/api/src/common/monitoring/sentry.ts (тег `client_version`). Клиенты: apps/ios/Sources/Core/Version/ClientVersionAPI.swift, apps/ios/Sources/Features/Update/UpdateGateModel.swift, apps/android/app/src/main/kotlin/kz/studenthub/app/features/update/UpdateGateModel.kt; web apps/web/src/shared/lib/use-sw-update.ts (`BUILD_ID`, `useAppUpdate`, восстановление после ChunkLoadError).
- Данные на входе / выходе: platform, X-Client-Version / `{ platform, minimumVersion, storeUrl? }`.
- Внешние зависимости: переменные окружения, App Store / Google Play, Sentry.
- Тесты: apps/api/src/modules/client-version/client-version.service.spec.ts, apps/ios/Tests/StudentHubTests/UpdateGateTests.swift, apps/android/app/src/test/kotlin/kz/studenthub/app/core/VersionAndQrTest.kt, apps/web/src/shared/lib/chunk-error.test.ts.

### B-16 Health-check API и мониторинг доступности

- Бизнес-цель: давать хостингу и CI сигнал живости API и его зависимостей (PostgreSQL, Redis, MinIO).
- Роли: система (Railway, GitHub Actions), аноним.
- Вход: `GET /api/v1/health` (@Public, @MaintenanceExempt); Railway `healthcheckPath`; workflow `uptime.yml` (cron каждые 10 мин), `smoke.yml` (после деплоя).
- Завершение: 200 со статусами индикаторов либо 503, если любой из трёх недоступен.
- Шаги и файлы: apps/api/src/modules/health/health.controller.ts, apps/api/src/modules/health/indicators/{prisma,redis,minio}.health.ts, apps/api/railway.json, .github/workflows/{uptime,smoke}.yml, docker/docker-compose.prod.yml (там намеренно TCP-проверка вместо /health).
- Данные на входе / выходе: — / отчёт @nestjs/terminus `{ status, info, error, details }`.
- Внешние зависимости: PostgreSQL, Redis, MinIO, @nestjs/terminus.
- Тесты: нет unit/e2e-спеков модуля health (проверяется только workflow-ами smoke/uptime).
- Замечено: Railway использует как healthcheck тот же `/health`, что падает в 503 при сбое MinIO или Redis — прод-compose от этого сознательно отказался (TCP-проверка), а Railway нет.

### B-17 Дашборд и аналитика платформы

- Бизнес-цель: дать команде платформы картину по всем вузам — вузы по статусам, рост и активность пользователей (DAU/WAU), поток и скорость разбора жалоб, воронка инвайтов, тепловая карта активности.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR.
- Вход: UI `/platform-admin` (дашборд), `/platform-admin/stats` (таблица вузов); мини-апп «Обзор»; `GET /analytics/platform/*`.
- Завершение: показаны плитки, ряды с полными корзинами (`from`/`to`/`interval`) и таблица размеров вузов.
- Шаги и файлы: `GET /analytics/platform/{overview,users-growth,active-users,universities-size,complaints-flow,complaints-latency,invites-funnel,activity-heatmap,top-actions}`. API: apps/api/src/modules/analytics/platform-analytics.{controller,service}.ts, dto/platform-*.dto.ts. Web: apps/web/src/views/platform-admin/ui/{platform-dashboard-view,platform-stats-view}.tsx, apps/web/src/widgets/platform-dashboard/ui/{platform-dashboard,primitives,sparkline,use-in-view}.tsx, apps/web/src/entities/analytics/api/analytics-api.ts; мини-апп apps/mini-app/src/api/overview.ts.
- Данные на входе / выходе: from, to, interval, tz, limit / агрегаты поверх User/University/Complaint/Invite/AuditLog, Redis-кэш 300 с.
- Внешние зависимости: Redis, PostgreSQL (`percentile_cont`, groupBy по `audit_logs`).
- Тесты: apps/api/src/modules/analytics/platform-analytics.service.spec.ts, apps/web/src/widgets/platform-dashboard/ui/{primitives,use-in-view}.test.tsx.
- Замечено: `/platform-admin/stats` делает N+1 — по запросу `GET /universities/:id/stats` на каждый вуз (до 200, сверх — молча обрезается), хотя для этого есть `GET /analytics/platform/universities-size`.

### B-18 Дашборд и аналитика вуза

- Бизнес-цель: показать админу вуза счётчики структуры и динамику: посещаемость по неделям/факультетам, загрузку аудиторий 7×24, итоги экзаменов, поток заявок, воронку приглашений.
- Роли: UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR (вуз — только из JWT).
- Вход: UI `/university-admin` (StatsDashboard + баннер мастера), `/university-admin/analytics` (обзор факультета на выбор); `GET /analytics/university/*`, `GET /universities/:id/stats`, `GET /analytics/faculty?facultyId=`.
- Завершение: дашборд построен; данные из кэша Redis 5 мин.
- Шаги и файлы: `GET /analytics/university/{attendance-trend,attendance-breakdown,room-load,exam-results,applications-flow,invites-funnel}`. API: apps/api/src/modules/analytics/university-analytics.{controller,service}.ts, apps/api/src/modules/universities/universities.service.ts (`getStats`). Web: apps/web/src/widgets/stats-dashboard/ui/stats-dashboard.tsx, apps/web/src/app/university-admin/{page,analytics/page}.tsx, apps/web/src/views/dean-analytics/ui/dean-analytics-view.tsx, apps/web/src/entities/analytics/api/analytics-api.ts.
- Данные на входе / выходе: weeks / ряды по факультетам, сетка 7×24, воронка статусов.
- Внешние зависимости: Redis.
- Тесты: нет спеков на apps/api/src/modules/analytics/university-analytics.service.ts; web — нет.

### B-19 Дашборд и аналитика декана (факультет, группы, «требует внимания»)

- Бизнес-цель: декану видеть показатели факультета, посещаемость по группам с проваливанием до студентов и список студентов в зоне риска с явными причинами.
- Роли: DEAN (свой факультет из JWT); UNIVERSITY_ADMIN/MODERATOR и PLATFORM_ADMIN (факультет параметром).
- Вход: UI `/dean` (DeanDashboard), `/dean/analytics` (+ drill-down по группе); `GET /analytics/faculty`, `GET /analytics/group/:id/attendance`, `GET /analytics/at-risk`.
- Завершение: показаны плитки, группы < 60% посещаемости, студенты с причинами LOW_ATTENDANCE / OVERDUE_ASSIGNMENTS / LOW_GRADES.
- Шаги и файлы: API apps/api/src/modules/analytics/analytics.{controller,service}.ts (`facultyOverview`, `groupAttendance`, `atRiskStudents`, `resolveFaculty`, `assertGroupScope`), dto/faculty-analytics-query.dto.ts. Web: apps/web/src/views/dean-dashboard/ui/dean-dashboard.tsx (плюс очередь заявок `fetchQueueStats`), apps/web/src/views/dean-analytics/ui/{dean-analytics-view,group-drilldown}.tsx, apps/web/src/entities/analytics.
- Данные на входе / выходе: facultyId? / показатели, посещаемость по группам/студентам, at-risk список.
- Внешние зависимости: нет (прямые агрегаты Prisma, без кэша).
- Тесты: apps/api/src/modules/analytics/analytics.service.spec.ts (5 кейсов: facultyOverview, atRiskStudents); groupAttendance и web — нет.

### B-20 Обзоры преподавателя и старосты (API-агрегаты)

- Бизнес-цель: дать преподавателю сводку нагрузки/очереди проверки/консультаций, а старосте — агрегаты своей группы без персональных срезов.
- Роли: TEACHER, STAROSTA.
- Вход: `GET /analytics/teacher`, `GET /analytics/my-group`.
- Завершение: возвращён агрегат по пользователю из JWT.
- Шаги и файлы: apps/api/src/modules/analytics/analytics.controller.ts, apps/api/src/modules/analytics/analytics.service.ts (`teacherOverview`, `myGroupOverview`).
- Данные на входе / выходе: — / сводные счётчики.
- Внешние зависимости: нет.
- Тесты: нет.
- Замечено: ни веб, ни iOS/Android, ни мини-апп эти эндпоинты не вызывают — мёртвый API (~280 строк сервиса без тестов).

### B-21 Наполнение вуза людьми из админки: приглашения, массовый импорт CSV/XLSX, списки

- Бизнес-цель: после создания структуры завести в вуз деканов, преподавателей и студентов — по одному или файлом — и видеть списки людей по ролям. Ядро процесса — модуль invites/users (группа A), здесь — входы из админок вуза и деканата.
- Роли: UNIVERSITY_ADMIN, DEAN, STAROSTA (роль строго ниже своей, в своём scope), PLATFORM_ADMIN.
- Вход: UI `/university-admin/invites`, `/dean/invites`, `/starosta/invites`, списки `/university-admin/{students,teachers,deans}`, `/dean/{students,teachers,starostas}`; шаг мастера «Деканы»; эндпоинты `POST /invites`, `POST /invites/bulk/preview`, `POST /invites/bulk`, `GET /users`.
- Завершение: инвайты созданы (письма уходят через очередь EMAIL), строки с ошибками показаны в предпросмотре; шаг мастера «Деканы» закрывается уже выписанным PENDING-инвайтом.
- Шаги и файлы: apps/web/src/views/university-admin/ui/invites-view.tsx → apps/web/src/features/create-invite/ui/{create-invite,create-invite-modal,bulk-invite}.tsx; apps/web/src/widgets/users-table/ui/users-table.tsx; API apps/api/src/modules/invites/{invites.controller,invites.service,bulk-parse,invite-hierarchy}.ts.
- Данные на входе / выходе: роль, email, факультет/группа; файл CSV/XLSX / `Invite[]`, отчёт предпросмотра по строкам.
- Внешние зависимости: xlsx (SheetJS, тарбол с CDN), BullMQ + SMTP.
- Тесты: apps/api/src/modules/invites/{bulk-invite,invite-hierarchy,invites.service}.spec.ts, apps/web/e2e/register.e2e.ts (регистрация по инвайту); e2e импорта файла — нет.

### B-22 Стартовые экраны ролей: ролевой редирект, главная студента, заглушки разделов

- Бизнес-цель: после входа отправить каждого на «дом» своей роли и показать стартовый экран; несуществующие разделы роли — аккуратная заглушка «в разработке» вместо 404.
- Роли: все 8 ролей (STUDENT/STAROSTA → `/`, PLATFORM_ADMIN → `/platform-admin`, UNIVERSITY_ADMIN → `/university-admin`, DEAN → `/dean`, TEACHER → `/teacher`, модераторы → `/moderator/*`, EMPLOYER → `/employer`).
- Вход: middleware Next.js и формы входа/регистрации (`ROLE_HOME`); UI `/` (главная студента), catch-all `[...section]` в `/platform-admin`, `/dean`, `/teacher`, `/starosta`, `/moderator/*`.
- Завершение: пользователь на своей главной; для студента — лента, сторисы, пары на сегодня, ближайшие события, друзья.
- Шаги и файлы: apps/web/src/shared/config/routes.ts (`ROLE_HOME`), apps/web/src/middleware.ts, apps/web/src/shared/session/server.ts, apps/web/src/app/(student)/page.tsx → apps/web/src/views/home/ui/{home-view,home-sidebar}.tsx (FeedList, StoriesRail, FriendsPanel, `fetchSchedule`, `fetchEvents`), apps/web/src/views/role-landing/ui/{section-stub,role-landing}.tsx, apps/web/src/widgets/app-shell/model/nav.ts.
- Данные на входе / выходе: роль из сессии / редирект, данные ленты/расписания/событий.
- Внешние зависимости: нет.
- Тесты: apps/web/e2e/{login,access,feed}.e2e.ts; unit — нет.
- Замечено: `RoleLanding` (apps/web/src/views/role-landing/ui/role-landing.tsx) экспортируется, но нигде не используется — мёртвый код.
