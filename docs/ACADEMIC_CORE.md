# StudentHub Academic Core — аудит и план реализации

> Живой документ по эпику «Academic Core» (30 задач: ежедневное ядро, дисциплины,
> задания, оценки, посещаемость, экзамены, сервисы, поиск; AI-задачи 17–19 вне объёма).
> Главный принцип: **одна дизайн-система StudentHub**, не «второй UI для учёбы».
> Ветка: `feat/applications-redesign` (эпик продолжается поверх неё).

---

## Финальный статус эпика

**Готово (api+web typecheck/lint/build зелёные, api-тесты 402 passed):**
1, 2, 3, 4, 5, **6 (QR-посещаемость)**, 7, 8, 9, 10, 11, **12 (академ-профиль `/academic`)**, 13, 14,
15, 16, **20 (Цифровой студенческий)**, **21 (Портфолио)**, 22, 23, 24 (задания/консультации/деканат;
экзамены — без связки), 25 (навигация: группировка секций для студента), 27, **28 (тёмная тема:
ThemeProvider + переключатель System/Light/Dark в настройках)**, 29 (a11y-фиксы новых экранов),
30 + Phase 0/1.

**Вне объёма (решение продукта):** 17–19 (StudentHub AI) — исключены.

**Частично:** 26 (mobile — новые экраны адаптивны: responsive QR/сетки/секции; сквозного аудита всех
старых экранов не делал).

**Миграции ждут применения пользователем** (`pnpm db:deploy && pnpm db:seed`): courses, assignments,
attendance, gradebook, exams, consultations, appointments, **portfolio** (`20260812120000..190000`).
QR (6) и Student ID (20) миграций не требуют. Новая зависимость не добавлялась — `qrcode` уже был в проекте.

**Рефакторинг:** подпись/проверка QR-токенов вынесена в `apps/api/src/common/crypto/signed-token.ts`
(+unit-тесты `signed-token.spec.ts`), переиспользуется в attendance и student-id.

---

## PHASE 0 — Аудит существующего проекта

### Design tokens (единственный источник — `apps/web/src/app/globals.css`)

Tailwind v4, `@theme inline` + OKLCH-переменные `:root` / `.dark`. **Своих цветов не
вводить** — только семантические токены.

- Цвета: `background/foreground`, `card`, `popover`, `primary` (образовательный синий
  `oklch(0.546 0.215 262.9)`), `secondary`, `muted/muted-foreground`, `accent`,
  `border`, `input`, `ring`; статусы `success` (зелёный), `warning` (оранжевый),
  `info` (синий), `destructive` (красный) — у каждого есть `-foreground`; `chart-1..5`;
  полный набор `sidebar-*`.
- Радиусы: база `--radius: 0.625rem`; шкала `radius-sm..4xl`. На практике: инпуты/кнопки/
  карточки — `rounded-xl`, модалки — `rounded-2xl`, статус-экран — `rounded-3xl`.
- **Теней нет** (осознанное решение): вместо них `ring-1 ring-foreground/10` на карточках,
  фокус — `ring-4 ring-ring/15..20`. Новые компоненты теней не добавляют.
- Шрифт: `Inter Variable` (offline), `--font-heading` = sans; заголовки — `font-heading`.
- Тема: класс `.dark`, вариант `@custom-variant dark`. Токены готовы к тёмной теме;
  **ThemeProvider/переключатель ещё не смонтирован** (задача 28 — отдельный шаг).

### Component audit (`apps/web/src/shared/ui`, баррель `index.ts`)

Существуют и переиспользуются: `Button` (варианты + `loading`, `asChild`), `Input`,
`Textarea`, `Label`, `Card`(+Header/Title/Description/Action/Content/Footer), `Badge`,
`Alert`/`FormAlert`, `Checkbox`, `Select`, `DictSingleSelect`, `DatePicker`/`DateRangePicker`/
`DateTimePicker`/`DateTimeField`, `Modal`, `AlertDialog`, `ConfirmProvider/useConfirm`,
`PromptDialog`, `Skeleton`, `Avatar`, `EmptyState`, `PageHeader`, `PageLoader`,
`StatusScreen`/`Forbidden`, `Stepper`, `FileUpload`, `MediaViewer`, `Flag*`.

Референс-идиомы (копировать, не изобретать): row-card — `widgets/groups-list`;
DataTable в карточке + триада loading/error/empty + фильтр-бар — `widgets/users-table`;
segmented control/tabs — `widgets/user-profile/ui/profile-tabs`; bottom-sheet — хук
`shared/lib/use-sheet-drag-close`; таймлайн пар/PairBlock — `widgets/schedule-grid`.

### Navigation audit

Конфиг ролевой навигации — `widgets/app-shell/model/nav.ts` (`NavItem {key,href,icon,exact?}`,
массивы `*_NAV`, `ROLE_TO_VARIANT`, `NAV_BY_VARIANT`, общий `DOCUMENTS_NAV`). Десктоп-сайдбар —
`app-sidebar.tsx` (`hidden lg:flex w-72`); мобильная нижняя навигация + «Ещё»-лист —
`app-shell.tsx` (`BottomNav`, первые 4 пункта + More). Уведомления/друзья/профиль — не пункты
навигации. Новый модуль = папка роута + `NavItem` + `Nav.<key>` в ru/kk/en.

### Responsive audit

Mobile-first Tailwind, порог `lg` (1024) — сайдбар↔нижняя навигация; `md` (768) — вторичный.
JS-хук `shared/lib/use-media-query` (используется точечно). BottomSheet собирается инлайном
(`slide-in-from-bottom`) + `use-sheet-drag-close` + `use-body-scroll-lock`. Safe-area —
`env(safe-area-inset-*)`. Проверять на 375 / 768 / 1280.

### Backend audit (важно для планирования)

NestJS + Fastify + Prisma, модули в `apps/api/src/modules`, схема — `prisma/schema/*.prisma`.
Envelope `{success,data,meta}` через `response.interceptor` + `Paginated`. Guards
`JwtAuthGuard → RolesGuard → ScopeGuard`; `@Roles()`, `@Scope()`, `@CurrentUser()`; scope в
сервисах через `buildReadWhere`/`assert*ScopeForGroup`. Контракты — `packages/shared-schemas`
(Zod → `createZodDto` на API, тот же схем в формах на web).

**Ключевой факт:** академический домен — greenfield. Есть `University/Faculty/Group/Room/
Schedule/Pair/ScheduleChange/Material/Specialty/Application`. **Нет** сущностей
`Subject/Course`, `Assignment`, `Submission`, `Grade`, `Attendance`, `Exam`, `Consultation` —
«предмет» сейчас это строка (`Pair.subject`, `Material.subject`). Любой из этих модулей =
новая Prisma-модель + миграция + модуль + guard'ы + shared-schema + web-слой.

> Стоп-точка проекта: миграции к непустой БД применяет **пользователь** (как в
> `applications-redesign`). Агент готовит `schema.prisma` + `migration.sql` и показывает SQL;
> не применяет `migrate dev/deploy` сам.

---

## PHASE 1 — Foundation (сделано)

Добавлены недостающие универсальные примитивы в `shared/ui` (radix-ui, токены, без теней,
стиль проекта): **Tabs**, **Progress**, **Tooltip** (+ `TooltipProvider` в `providers.tsx`),
**DropdownMenu**, **Sheet** (right/left/bottom — Drawer + BottomSheet на Radix Dialog),
**Breadcrumb**. `Badge` расширен вариантами `warning` и `destructive` (для статусов).

DataTable отдельным компонентом не выделялся — используется идиома `users-table` (карточка +
`<table>`); выделим в примитив на задаче «Журнал оценок», когда понадобится inline-edit.

---

## Реестр компонентов (задача 30): REUSE / EXTEND / CREATE

**REUSE (без изменений):** Button, Input, Textarea, Select, Card, Modal, AlertDialog,
useConfirm, PromptDialog, DatePicker/DateTime*, FileUpload, Avatar, EmptyState, PageHeader,
Skeleton, StatusScreen, Stepper, MediaViewer, схема расписания/PairBlock, users-table-идиома.

**EXTEND (универсально):** Badge (+warning/+destructive — done); PageHeader (при
необходимости `tabs`-режим уже поддержан); schedule-grid визуальный язык пар переиспользуется
в «Сегодня»/«Календаре»; DataTable-идиома → примитив на «Журнале оценок».

**CREATE (реально отсутствовали, универсальны, >1 места):** Tabs, Progress, Tooltip,
DropdownMenu, Sheet, Breadcrumb (все — done, Phase 1). Далее по мере необходимости: `KpiCard`
(аналитика декана — если stats-dashboard не покрывает), `CommandPalette` (Ctrl/Cmd+K — на
Radix Dialog + фильтр), `QrScanner`-обёртка (посещаемость по QR).

---

## PHASE 2 — Daily Core

- [x] **«Сегодня»** (`views/today`) для STUDENT и TEACHER: герой «Следующая пара», таймлайн
  дня (состояния: обычная/отменена/перенос/смена аудитории/замена, «сейчас/прошло»),
  «Требует внимания» (заявки NEEDS_CORRECTION/DRAFT + события, приоритеты Срочно/Сегодня/Скоро),
  «Последние изменения» (срез важных уведомлений). Всё — из существующих API
  (`/schedule`, `/schedule/changes`, `/applications`, `/events`, `/notifications`),
  таймзона вуза учтена (`nowInTz`). Роуты `/today`, `/teacher/today`; в навигации; i18n ru/kk/en;
  typecheck/lint/build — зелёные.
- [x] **«Сегодня» для DEAN** (`views/today/ui/dean-today.tsx`, роут `/dean/today`) —
  операционный экран: KPI дня (занятия/изменения/новые заявки/просрочено), «Проблемы расписания
  сегодня» (из `/schedule/changes`), «Очередь заявок» (`/applications/queue-stats`), последние
  изменения. Не BI-дашборд.
- [x] **«Мои задачи»** (`views/tasks`, роут `/tasks`) — авто-todo из заявок (DRAFT/
  NEEDS_CORRECTION/READY_FOR_PICKUP/выполнено) и событий; бакеты Срочно/Сегодня/На неделе/
  Позже/Выполнено. Источники расширяются заданиями/документами со своими доменами.
- [x] **Единый календарь** (`views/calendar`, роут `/calendar`) — пары (разворот недельного
  шаблона на даты + наложение изменений) + события в одной модели; фильтр Все/Пары/События;
  Месяц (desktop) / Повестка (mobile, `useMediaQuery`). Переиспользует `shared/ui/calendar-grid`
  (`monthCells`) и `Tabs`. Дедлайны заданий/экзамены подключатся со своими доменами.

Общие tz-хелперы вынесены в `shared/lib/tz-date.ts` (`nowInTz`, `isoWeekParity`) — переиспользуют
«Сегодня»/«Задачи»/«Календарь».

---

## PHASE 4 — Задания (backend готов, миграцию применяет пользователь)

Backend-домен «Задания» (задача 3) реализован (api typecheck+lint+build зелёные):
- Схема `prisma/schema/18-assignments.prisma` — `Assignment` (по `Course`) + `Submission`
  (`@@unique([assignmentId,studentId])`), статусы/типы строками. Back-relations на Course/User.
- Миграция `prisma/migrations/20260812130000_add_assignments/migration.sql` (аддитивно, 2 таблицы;
  требует таблицу `courses`, т.е. применять после `20260812120000_add_courses`).
- Контракт `packages/shared-schemas/src/assignments.ts` (типы/статусы + Create/Update/Query,
  SaveSubmissionDraft, Grade, Return; префикс во избежание коллизии с documents).
- Модуль `apps/api/src/modules/assignments` — сервис + контроллеры `/assignments`, `/submissions`;
  scope: студент видит PUBLISHED своей группы + свою сдачу (`mySubmission`), препод — свои
  дисциплины (owner), декан/админ — scope. Полный жизненный цикл: create→publish→submit→grade/return.

Применить: `pnpm db:deploy` (после courses-миграции). Сдача файлов — следующей миграцией
(сейчас текст + ссылка).

Frontend готов (web typecheck+lint+build зелёные): `entities/assignment` (API+ключи+мутации);
студент — `views/assignments` роут `/assignments` (список + деталь/сдача: черновик text/link,
отправка, статусы Не начато/Черновик/На проверке/Проверено/Требуются исправления/Просрочено,
показ балла и фидбэка); преподаватель — роут `/teacher/assignments` (список своих дисциплин,
создание задания через `CreateAssignmentSchema.safeParse`, публикация/закрытие/удаление). В навигации
студента и преподавателя; i18n ru/kk/en.

**Workspace проверки (задача 4) — готов** (web green): `views/assignments/ui/grading-workspace.tsx`,
открывается кликом по заданию в `/teacher/assignments`. Desktop — split-view (список сдач |
работа + панель оценки), mobile — последовательно (список → работа/оценка, «назад»). Балл +
комментарий, «Поставить балл» / «Вернуть на исправление», автопереход к следующей неоцененной
работе. Использует `GET /assignments/:id/submissions` + `POST /submissions/:id/grade|return`.

**Связность (задача 24) — готово** (api+web green):
- Backend: при **публикации** задания — уведомление студентам группы; при **оценке/возврате** —
  студенту (тип `SYSTEM`, `data.url='/assignments'`, идемпотентно по dedupeKey; job-константы
  `ASSIGNMENT_PUBLISHED/GRADED`). QueueService в `AssignmentsService`.
- Frontend: задания подключены в **«Мои задачи»** (бакеты по сроку: сдать/исправить/выполнено),
  **«Сегодня» → Требует внимания** (к сдаче/исправить/просрочено) и **«Календарь»** (дедлайны,
  фильтр «Задания»). Доменная деривация статуса вынесена в `entities/assignment/lib/status.ts`
  (переиспользуется всеми экранами без cross-slice импортов).

**Осталось по домену:** файловые сдачи (миграция). Далее по ТЗ — Посещаемость (задача 5).

## PHASE 4b — Посещаемость (задача 5, backend+frontend готовы; миграцию применяет пользователь)

- Схема `prisma/schema/19-attendance.prisma` (`Attendance`, `@@unique([pairId,date,studentId])`),
  миграция `20260812140000_add_attendance` (аддитивно), контракт `shared-schemas/src/attendance.ts`
  (статусы PRESENT/LATE/ABSENT/EXCUSED), модуль `apps/api/src/modules/attendance`
  (`GET /attendance/roster`, `PUT /attendance`, `GET /attendance/me`; scope: препод — свои пары).
- Frontend: `entities/attendance`; преподаватель `/teacher/attendance` (дата → занятия дня → ростер:
  переключатели статуса на студента, **«Отметить всех»** + правка исключений, сохранение массово);
  студент `/attendance` (общий % + разбивка present/late/absent/excused + последние занятия). В навигации,
  i18n ru/kk/en. api+web green.

**Осталось:** агрегация посещаемости для декана (факультет→группа→студент) и **QR-отметка (задача 6)**.

## PHASE 4c — Журнал оценок (задача 7, backend+frontend препода; миграцию применяет пользователь)

- Схема `prisma/schema/20-gradebook.prisma` (`GradeColumn` + `Grade`, `@@unique([columnId,studentId])`),
  миграция `20260812150000_add_gradebook` (после courses-миграции), контракт `shared-schemas/src/gradebook.ts`
  (kind LAB/CONTROL/EXAM/OTHER), модуль `apps/api/src/modules/gradebook`
  (`GET /gradebook/course/:id`, columns CRUD, publish/unpublish, `PUT /gradebook/grades`, `GET /gradebook/me`).
- Frontend: `entities/gradebook`; преподаватель `/teacher/gradebook` — выбор дисциплины → матрица
  (desktop-таблица со sticky-колонкой студента + inline-редактирование, mobile — карточки студентов),
  добавление контрольных, публикация колонки (черновик/опубликовано), удаление, авто-итог (%). Save массово.
- **`GET /gradebook/me` готов** (опубликованные оценки студента) — это backend задачи 8 «Оценки студента».

**Оценки студента (задача 8) — готово** (web green, без миграции): `views/student-grades`, роут
`/grades` — карточки дисциплин (итог %, `Progress`, список контрольных с баллами) + общий средний
балл (взвешен по кредитам) + сумма кредитов. Потребляет `GET /gradebook/me`. В навигации, i18n.

**Осталось:** QR-отметка (6); аналитика/агрегация декану (14); Экзамены (11); Учебный план (13).

## PHASE 5a — Экзамены и сессия (задача 11, backend+frontend; миграцию применяет пользователь)

- Схема `prisma/schema/21-exams.prisma` (`Exam` + `ExamResult`, `@@unique([examId,studentId])`),
  миграция `20260812160000_add_exams` (после courses-миграции), контракт `shared-schemas/src/exams.ts`
  (формат ORAL/WRITTEN/TEST/PROJECT/OTHER; статус SCHEDULED/PASSED/FAILED/ABSENT/RETAKE; допуск/пересдача),
  модуль `apps/api/src/modules/exams` (list/detail/CRUD + `GET /exams/:id/results` + `PUT /exams/results`).
- Frontend: `entities/exam`; студент `/exams` (timeline сессии: предстоящие/прошедшие, допуск, статус,
  балл, пересдача); декан `/dean/exams` и преподаватель `/teacher/exams` (список + назначение экзамена
  + **ведомость**: допуск/статус/балл по студентам, массовое сохранение). В навигации, i18n ru/kk/en.

**Учебный план (задача 13) — готово** (web green, без миграции): `views/study-plan`, роут
`/study-plan` — дисциплины сгруппированы по семестрам (`Term`), статус (Завершено/Изучается/
Предстоит/Не зачтено) выводится из оценок (`/gradebook/me`) + активного семестра, прогресс по
кредитам (X/Y + %). Потребляет `/courses` + `/gradebook/me`. В навигации, i18n.

**Аналитика декана (задача 14) — готово** (api+web green, БЕЗ миграции — read-only агрегаты):
модуль `apps/api/src/modules/analytics` (`GET /analytics/faculty`, `GET /analytics/group/:id/attendance`),
контракт `shared-schemas/src/analytics.ts`. Frontend `entities/analytics` + `views/dean-analytics`
роут `/dean/analytics`: KPI факультета, «требует внимания» (группы <60% посещаемости), таблица групп
с бар-индикаторами и **drill-down** факультет→группа→студент. В навигации декана, i18n.
Система не принимает дисциплинарных решений — только объективные данные (принцип ТЗ).

**Глобальный поиск + Command Palette (задачи 22–23) — готово** (api+web green, БЕЗ миграции):
модуль `apps/api/src/modules/search` (`GET /search?q=`, кросс-модульно по scope, `Promise.allSettled`),
контракт `shared-schemas/src/search.ts`. Frontend `entities/search` + виджет `widgets/command-palette`
(смонтирован в `providers`, gated по auth): открытие **Ctrl/Cmd+K**, кнопка поиска в сайдбаре (desktop) и
в мобильном «Ещё»-листе; быстрые действия по роли (`quick-actions.ts`, переиспользуют `Nav.*`), поиск с
дебаунсом, клавиатурная навигация (↑↓/Enter), группы Люди/Дисциплины/Задания/Материалы. i18n `Command`.

**Консультации (задача 15) — готово** (api+web green; миграцию применяет пользователь): схема
`prisma/schema/22-consultations.prisma` (`ConsultationSlot`), миграция `20260812170000_add_consultations`,
контракт `shared-schemas/src/consultations.ts` (OPEN/BOOKED/CANCELLED), модуль
`apps/api/src/modules/consultations` (mine/teachers/slots + create/delete/book/cancel + уведомления
SYSTEM на запись/отмену). Frontend `entities/consultation` + студент `/consultations` (мои записи +
выбор преподавателя → слоты → запись с темой) и преподаватель `/teacher/consultations` (создание
слотов + записи студентов). В навигации, i18n.

**Запись в деканат (задача 16) — готово** (api+web green; миграцию применяет пользователь): схема
`prisma/schema/23-appointments.prisma` (`DeaneryAppointment`), миграция `20260812180000_add_deanery_appointments`,
контракт `shared-schemas/src/appointments.ts` (тип CONSULTATION/DOCUMENT/ACADEMIC/OTHER; статус
REQUESTED/CONFIRMED/RESCHEDULED/COMPLETED/CANCELLED), модуль `apps/api/src/modules/appointments`
(create/mine/cancel + queue/confirm/reschedule/complete/staff-cancel + уведомления студенту). Frontend
`entities/appointment` + студент `/appointments` (запись: тип/время/тема + мои записи) и деканат
`/dean/appointments` (очередь + подтвердить/перенести/завершить/отменить). Мягкая ссылка на заявку
(`applicationId`). В навигации, i18n.

**Осталось из ядра:** QR-отметка (6); связь экзаменов с уведомлениями/календарём (задача 24).

## PHASE 5+ — следующие домены (порядок из ТЗ)

Каждый пункт = отдельный PR со стоп-точкой на миграцию (SQL показать, применяет пользователь).

- **Дисциплины / Course Workspace** — новая модель `Subject`/`Course` (прецедент словаря —
  `Specialty` с `@@unique([universityId,name])`); FK из `Pair.subject`/`Material.subject`.
  Вкладки Обзор/Материалы/Задания/Оценки/Посещаемость/Участники/Обсуждения (примитив `Tabs`).
- **Задания / Submissions** — модель `Assignment` + `Submission` (+файлы, попытки, статусы —
  паттерн из `application-services`: `*.policy.ts`, строковые статусы, events-таблица).
- **Проверка заданий** — split-view (desktop) через `Sheet`/панель + `users-table`-идиома;
  mobile — последовательный workflow.
- **Посещаемость** (+ **QR**) — модель `Attendance`; массовые действия; QR на Radix Dialog +
  scanner-обёртка; ручная правка преподавателем обязательна.
- **Журнал оценок** — Gradebook: DataTable → примитив с inline-edit; черновик vs опубликовано;
  mobile — карточка студента.
- **Оценки студента / Учебный план / Академ-профиль (вкладка) / Аналитика декана** —
  переиспользовать `Card/Progress/Tabs/Badge`, `stats-dashboard`, `ProfileHeader/Tabs`.
- **Консультации / Запись в деканат / Student ID / Портфолио**.
- **Глобальный поиск / Command Palette**.

> **Вне объёма (по решению продукта):** StudentHub AI (задачи 17–19) — исключены, не реализуются
> в рамках этого эпика.

---

## PHASE 3 — статус и backend-предложение

### Сделано (frontend-MVP, без миграции)

- [x] **«Дисциплины»** (`views/courses`, роуты `/courses`, `/courses/[subject]`) — список
  дисциплин студента, агрегированный из существующих данных: `subject` пар расписания →
  преподаватель(и), занятий/нед, ближайшее занятие; счётчик материалов из `/materials`.
  Course Workspace c вкладками (примитив `Tabs` + `Breadcrumb`): **Обзор** (преподаватель,
  ближайшее занятие, последние материалы), **Материалы** (список + скачивание через presigned),
  **Участники** (состав группы `/groups/:id/members`). Вкладки Задания/Оценки/Посещаемость/
  Обсуждения появятся со своими доменами.

### Backend-домен «Дисциплины» — реализован (миграцию применяет пользователь)

Решения продукта (подтверждены): семестр — **отдельная сущность** `Term` (с датами); кредиты —
**храним** (`Course.credits`); прогресс дисциплины — по **доле прошедших занятий И оценкам**
(считается позже, когда появится домен оценок).

Готово в коде (typecheck+build api зелёные): `prisma/schema/17-courses.prisma` (Subject/Term/Course,
back-relations на University/Group/User), контракт `packages/shared-schemas/src/courses.ts`, модуль
`apps/api/src/modules/courses` (сервис + 3 контроллера `/subjects`,`/terms`,`/courses`, scope как у
`materials`, аудит), регистрация в `app.module`, демо-данные в `prisma/seed.mjs` (seed-term/subject/course).
Миграция — `prisma/migrations/20260812120000_add_courses/migration.sql` (аддитивная: 3 таблицы, FK, индексы).

**Применить (пользователь):**
```
pnpm db:deploy      # применит 20260812120000_add_courses
pnpm db:seed        # демо: Осень 2025 / Основы программирования (CS101) / курс группы
```

Web уже подключён (работает и до применения — фолбэк):
- `entities/course` (API-клиент + ключи + мутации).
- `views/courses` (студент): `buildCourses` (агрегация) + `mergeApiCourses` — при доступном
  `GET /courses` показывает courseId/кредиты/семестр/официального преподавателя; иначе агрегация.
- `views/course-admin` (декан/админ вуза, роуты `/dean/courses`, `/university-admin/courses`):
  вкладки Курсы/Справочник/Семестры, создание Subject/Term/Course (RHF+Zod из shared-schemas),
  удаление с подтверждением. Назначение преподавателя курсу — следующий шаг (нужен picker
  преподавателей факультета).

Осталось (следующие шаги): teacher-picker в форме курса; линковка `Pair.subject`→`Course`
(отдельная миграция) для точного сопоставления вместо имени.

<details><summary>Прежние открытые вопросы (закрыты)</summary>

```prisma
// Дисциплина-справочник вуза (прецедент — Specialty).
model Subject {
  id           String   @id @default(uuid())
  universityId String   @map("university_id")
  name         String
  code         String?                         // напр. "CS101"
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  university University @relation(fields: [universityId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  courses    Course[]

  @@unique([universityId, name])
  @@index([universityId])
  @@map("subjects")
}

// Преподавание дисциплины конкретной группе в семестре (то, что студент видит как «дисциплину»).
model Course {
  id        String   @id @default(uuid())
  subjectId String   @map("subject_id")
  groupId   String   @map("group_id")
  teacherId String?  @map("teacher_id")
  semester  Int?                               // или term-модель, см. вопрос 2
  year      Int?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  subject Subject @relation(fields: [subjectId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  group   Group   @relation(fields: [groupId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  teacher User?   @relation("CourseTeacher", fields: [teacherId], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@unique([subjectId, groupId, semester, year])
  @@index([groupId])
  @@index([teacherId])
  @@map("courses")
}
```

Миграция затем: `Pair.subject: String` и `Material.subject: String?` → добавить nullable
`courseId`/`subjectId` FK (без удаления строкового поля — обратная совместимость), бэкофилл
скриптом, затем постепенный переход. Модуль `apps/api/src/modules/courses` по шаблону `schedules`
(controller `@Roles`+`@CurrentUser`, сервис — scope через `buildReadWhere`/`assert*ScopeForGroup`).

**Открытые вопросы продукта (нужны до миграции):**
1. Семестр: число (1..8) или отдельная сущность `Term`/`AcademicYear` с датами? От этого зависят
   «прошлые/текущие» дисциплины и фильтры.
2. Кредиты/ECTS у дисциплины — хранить (нужны для учебного плана, задача 13)?
3. Прогресс дисциплины (в карточке) считаем как долю прошедших занятий или по оценкам?

</details>

> Дальнейшие домены Phase 4+ (Assignment/Submission, Attendance, Grade, Exam) вводятся так же:
> модель + миграция на ревью, затем модуль по шаблону `application-services` (state-machine +
> `*.policy.ts`) или `schedules` (scoped-ресурс).

---

### Задача 24 — связность (обязательна на каждом модуле)

Уведомление → конкретный объект (`data.url`); Расписание→занятие→дисциплина→посещаемость→
материалы; Задание→дедлайн→календарь→мои задачи→оценка. Не вести на общий список, если можно
открыть сущность.
