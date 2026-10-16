## Группа B — аудит

Проверено чтением кода API (apps/api/src/modules/{universities,faculties,groups,specialties,rooms,kato,onboarding,platform,analytics,releases,client-version,health}, cleanup-кроны, telegram-notify, guard'ы), Prisma-схемы и веба (views/platform-admin, university-admin, rooms, onboarding, dean-_, demo, role-landing, home, widgets/stats-dashboard, platform-gate, entities/_). Unit-спеки модулей группы прогнаны: 13 наборов, 166 тестов, все зелёные. Находка B-F01 подтверждена отдельным временным тестом в scratchpad (вне репозитория).

### Статусы процессов

| Процесс                              | Статус                       | Коротко                                                                                                                                                    |
| ------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 Демо-заявка вуза                | работает с проблемами        | Одобрение и отказ не атомарны: гонка даёт вуз-дубликат (B-F02); при сбое Redis при подаче письмо молча не уходит (B-F11)                                   |
| B-02 Вузы платформы                  | работает с проблемами        | BLOCKED/PENDING ничего не ограничивают (B-F03); нет UI правки/удаления; при Redis down статистика 500 (B-F17)                                              |
| B-03 Мастер онбординга               | работает с проблемами        | Админ вуза сам снимает BLOCKED через launch (B-F04); шаг «О вузе» показывает код КАТО (B-F13)                                                              |
| B-04 Факультеты                      | работает                     | Scope корректен; нет уникальности названия (B-F15)                                                                                                         |
| B-05 Специальности                   | работает с проблемами        | Профиль хранит строку, переименование не доходит; комментарий в коде утверждает обратное (B-F14)                                                           |
| B-06 Группы и староста               | работает с проблемами        | Веб видит только первые 100 групп (B-F06); удаление «пустой» группы каскадом стирает курсы, оценки, экзамены (B-F05)                                       |
| B-07 Помещения и QR                  | работает с проблемами        | Редактор расписания видит 100 аудиторий (B-F06); удаление молча обнуляет ссылки, кэш не сбрасывается, пакетная выдача QR не идемпотентна при гонке (B-F16) |
| B-08 Статус помещения по QR          | работает                     | Ответ для чужого вуза и неизвестного кода одинаковый, код из crypto.randomInt                                                                              |
| B-09 Справочник КАТО                 | работает с проблемами        | Город вуза хранится то кодом, то текстом (B-F13)                                                                                                           |
| B-10 Режим техработ                  | сломан (плановый режим)      | Плановые техработы роняют весь API 500-ми (B-F01); немедленный режим работает                                                                              |
| B-11 Рычаги платформы                | работает с проблемами        | Публичное состояние раскрывает адресные баннеры (B-F19); падает при плановых техработах (B-F01); рычаги только в мини-аппе (B-F18)                         |
| B-12 Дежурство и уведомления         | работает с проблемами        | Тихие часы и сводка считаются в UTC (B-F08); без Telegram у дежурного сигналы теряются молча (B-F09)                                                       |
| B-13 Наблюдение (очереди, хранилище) | работает                     | Полные сканы `files` и `audit_logs` (B-F20)                                                                                                                |
| B-14 «Что нового»                    | работает с проблемами        | `announcedVersion` никто не читает (B-F18)                                                                                                                 |
| B-15 Версия клиента                  | работает                     | Заголовок версии очищается перед логом, эндпоинт публичный осознанно                                                                                       |
| B-16 Health-check                    | работает с проблемами        | Анониму отдаются сырые ошибки зависимостей, нет таймаутов и тестов (B-F23)                                                                                 |
| B-17 Аналитика платформы             | работает с проблемами        | `/platform-admin/stats` бьёт в rate-limit и блокирует админа (B-F07); период не ограничен (B-F21)                                                          |
| B-18 Аналитика вуза                  | работает с проблемами        | Дашборд делает по некэшированному обзору на факультет; загрузка аудиторий считает старые расписания (B-F22)                                                |
| B-19 Аналитика декана                | работает с проблемами        | Drill-down группы режет посещаемость на 20 000 строк без порядка (B-F10)                                                                                   |
| B-20 Обзоры преподавателя/старосты   | работает, но не используется | Мёртвый API без тестов (B-F24)                                                                                                                             |
| B-21 Наполнение людьми               | работает с проблемами        | Выбор группы в инвайте ограничен первыми 100 (B-F06); ядро — группа A                                                                                      |
| B-22 Стартовые экраны ролей          | работает                     | RoleGuard в layout'ах есть; мёртвый `RoleLanding`, catch-all заглушки прячут 404 (B-F24, B-F26)                                                            |

### Проблемы

#### B-F01 [P0] Плановые техработы роняют весь API: `maintenanceFrom` из Redis-кэша не превращается обратно в Date

- Процесс: B-10 (и B-11 — `GET /platform/state`)
- Где: apps/api/src/modules/platform/platform.service.ts:635-642 (`reviveDates` восстанавливает `maintenanceUntil`, `bannerUntil`, `updatedAt`, но не `maintenanceFrom`), :142 (`this.memo.from.getTime()` в `maintenanceActive`), :590 и :593 (`row.maintenanceFrom?.toISOString()` / `.getTime()` в `project`); apps/api/src/common/guards/maintenance.guard.ts:41 (вызов на каждый неосвобождённый запрос)
- Суть: `PATCH /platform/maintenance` со `startsInMinutes > 0` пишет `maintenanceFrom` в БД. Первое чтение после записи идёт из БД (Date) и кладёт строку в Redis как JSON. Следующее чтение (через ≤5 с, когда истекает память процесса, или сразу на другом инстансе) берёт строку из кэша, и `maintenanceFrom` остаётся строкой. `MaintenanceGuard` → `maintenanceActive` падает с `TypeError: this.memo.from.getTime is not a function`. Каждый запрос к API, кроме маршрутов с `@MaintenanceExempt` (вход, мини-апп, platform, health), получает 500 у всех ролей, включая платформенные. `GET /platform/state` пока окно не истекло падает с `TypeError: row.maintenanceFrom?.toISOString is not a function`. Падение не заканчивается вместе с окном: `maintenanceFrom` остаётся в строке БД, а `from.getTime()` вычисляется раньше проверки срока. API лежит, пока кто-то явно не снимет режим: `minutes: null` записывает `from = null`. Подтверждено временным jest-тестом в scratchpad: Redis отдаёт `JSON.stringify` строки с `maintenanceFrom`, получены обе TypeError. В platform.service.spec.ts путь через кэш при плановых работах не покрыт: там `setup(..., cached = null)`.
- Решение: в `reviveDates` восстанавливать и `maintenanceFrom`, лучше — все DateTime-поля модели списком. Добавить в спецификацию кейс «плановые работы, состояние из кэша» для `maintenanceActive` и `publicState`. В `MaintenanceGuard` ловить исключение `maintenanceActive` и пропускать запрос — как уже сделано для сбоя чтения БД в `read()`.
- Файлы для правки: apps/api/src/modules/platform/platform.service.ts, apps/api/src/modules/platform/platform.service.spec.ts, apps/api/src/common/guards/maintenance.guard.ts
- Стоп-точки: нет

#### B-F02 [P1] Одобрение демо-заявки не атомарно: двойной клик или сбой инвайта даёт вуз-дубликат

- Процесс: B-01
- Где: apps/api/src/modules/onboarding/demo-requests.service.ts:406 (проверка `status !== 'NEW'` до транзакции), :410-426 (транзакция создаёт только вуз и онбординг), :431-436 (инвайт вне транзакции), :438-449 (смена статуса безусловным `update` по id); `reject` — :484-498
- Суть: статус проверяется до транзакции, а инвайт и перевод заявки в APPROVED идут отдельными запросами после неё. Два параллельных «Одобрить» (две вкладки, повтор после таймаута) оба проходят проверку и создают два вуза PENDING с двумя онбордингами и двумя инвайтами UNIVERSITY_ADMIN на один адрес; заявка указывает на последний. Сбой между транзакцией и `update` (например, упал `invites.create`) оставляет заявку в NEW при уже созданном вузе, и повторное нажатие создаёт второй вуз. `reject` устроен так же: при параллельных approve и reject заявитель получает письмо об отказе при уже заведённом вузе, или статус перезаписывается.
- Решение: одна интерактивная транзакция. Первым шагом `updateMany({ where: { id, status: 'NEW' }, data: { status: 'APPROVED', ... } })`, при `count === 0` — CONFLICT. Затем вуз, онбординг и инвайт через `tx`: у `InviteService.create` добавить вариант с переданным клиентом транзакции. Для `reject` — тот же условный `updateMany`. Письма — после коммита, как сейчас.
- Файлы для правки: apps/api/src/modules/onboarding/demo-requests.service.ts, apps/api/src/modules/invites/invites.service.ts, apps/api/src/modules/onboarding/demo-requests.service.spec.ts
- Стоп-точки: нет

#### B-F03 [P1] Статус вуза BLOCKED (и PENDING) ничего не ограничивает

- Процесс: B-02
- Где: apps/api/src/modules/universities/universities.service.ts:137-158 (`setStatus` только пишет поле); apps/api/src/modules/auth/strategies/jwt.strategy.ts:42 и apps/api/src/modules/auth/auth.service.ts:107-160 (`registerByInvite`, вход) — статус вуза не читается. Grep по `university.status`/`'BLOCKED'` в apps/api/src находит только онбординг (onboarding.service.ts:52,70,142,218). UI: apps/web/src/views/platform-admin/ui/universities-admin-view.tsx:118-123, 229-244
- Суть: PLATFORM_ADMIN выбирает «Заблокирован» и получает тост «статус изменён». Но вход, refresh, guard'ы и регистрация по инвайту статус вуза не проверяют: пользователи заблокированного вуза продолжают работать, админ вуза продолжает выписывать инвайты. То же для PENDING: вуз до запуска мастера полностью рабочий. PROJECT.md §6.1 описывает только enum, семантики нет.
- Решение: определить семантику и применить её. Для BLOCKED — отказ во входе, refresh и регистрации по инвайту с отдельным кодом ошибки (например, `UNIVERSITY_BLOCKED`) и гашение сессий при переводе в BLOCKED. Статус вуза проверять в JwtStrategy через кэш в Redis. Если блокировка не нужна — убрать BLOCKED из UI, чтобы не вводить админа в заблуждение.
- Файлы для правки: apps/api/src/modules/auth/auth.service.ts, apps/api/src/modules/auth/strategies/jwt.strategy.ts, apps/api/src/modules/universities/universities.service.ts, apps/api/src/modules/invites/invites.service.ts, docs/PROJECT.md
- Стоп-точки: «контракт API/shared-schemas» (новый код ошибки, изменение guard'ов)

#### B-F04 [P1] Админ заблокированного вуза сам переводит его в ACTIVE через мастер

- Процесс: B-03
- Где: apps/api/src/modules/onboarding/onboarding.service.ts:70 (`canLaunch: ... && status !== 'ACTIVE'`), :142-153 (`launch` отбивает только ACTIVE и пишет `status: 'ACTIVE'` без условия на текущий статус)
- Суть: `POST /onboarding/launch` доступен UNIVERSITY_ADMIN и проверяет лишь «уже ACTIVE». Вуз, который платформа перевела в BLOCKED, при заполненных шагах снова «готов к запуску» — у работавшего вуза шаги заполнены. Админ вуза одним нажатием перезаписывает решение платформы на ACTIVE. После исправления B-F03 это станет обходом блокировки.
- Решение: запуск разрешать только из PENDING: условный `updateMany({ where: { id, status: 'PENDING' } })`, иначе CONFLICT. `canLaunch` считать как `status === 'PENDING' && blocking.length === 0`.
- Файлы для правки: apps/api/src/modules/onboarding/onboarding.service.ts, apps/api/src/modules/onboarding/onboarding.service.spec.ts
- Стоп-точки: нет

#### B-F05 [P1] Удаление «пустой» группы каскадом стирает курсы, задания, оценки, экзамены и материалы

- Процесс: B-06
- Где: apps/api/src/modules/groups/groups.service.ts:221-240 (`group.delete` без предварительных проверок, ловится только P2003 с текстом «со студентами» — :228); prisma/schema/17-courses.prisma:57 (`Course.group` onDelete: Cascade), 21-exams.prisma:21 (`Exam.group` Cascade) и :45 (`ExamResult.exam` Cascade), 12-materials.prisma:20 (`Material.group` Cascade), 18-assignments.prisma:26 и 20-gradebook.prisma:18 (каскад от курса); подтверждение в вебе — apps/web/src/views/university-admin/ui/groups-view.tsx:114, apps/web/messages/ru.json:768 («Удалить группу «{name}»?»)
- Суть: удаление блокируют только студенты (Restrict на `User.group`) и расписание (Restrict на `Schedule`/`Pair`). Типичный сценарий: студентов перевели в новую группу (смена курса, слияние), у старой группы курсы с оценками и экзамены с результатами без расписания. Её удаление молча уничтожает все курсы, задания со сдачами, журнал оценок, экзамены с результатами и материалы — то есть академическую историю переведённых студентов. Восстановить можно только из бэкапа. Если у группы есть расписание, админ получает «Нельзя удалить группу со студентами», хотя студентов нет.
- Решение: перед удалением считать курсы, экзамены и материалы и отвечать CONFLICT с перечнем того, что мешает (как сделано у помещений: rooms.service.ts:183-186). Каскад заменить на Restrict для `Course.group`, `Exam.group` и `Material.group` — через новую миграцию. Текст ошибки строить по фактической причине.
- Файлы для правки: apps/api/src/modules/groups/groups.service.ts, apps/api/src/modules/groups/groups.service.spec.ts, prisma/schema/17-courses.prisma, prisma/schema/21-exams.prisma, prisma/schema/12-materials.prisma
- Стоп-точки: «миграция» (если меняется onDelete)

#### B-F06 [P1] Веб видит только первые 100 групп и 100 аудиторий вуза — выбор остальных невозможен

- Процесс: B-06, B-07, B-21 (и смежные экраны групп C/E)
- Где: apps/web/src/entities/group/api/group-api.ts:33-35 (`fetchGroups` — `page: 1, limit: 100`, `meta.total` отбрасывается); apps/web/src/entities/room/api/room-api.ts:17-19 (`fetchRooms` — то же); apps/api/src/modules/groups/groups.service.ts:107 (сортировка по имени — обрезается алфавитный хвост); потребители: apps/web/src/views/university-admin/ui/groups-view.tsx:172, apps/web/src/features/create-invite/ui/create-invite-modal.tsx:59, apps/web/src/features/manage-schedule/ui/manage-schedule.tsx:62-67, apps/web/src/views/course-admin/ui/course-admin-view.tsx:120, apps/web/src/views/schedule/ui/schedule-view.tsx:36, apps/web/src/views/materials/ui/create-material-modal.tsx:39, features/create-post, create-story, repost-post
- Суть: у вуза на 10 000 студентов около 400 групп и больше сотни аудиторий. Экран `/university-admin/groups` молча показывает первые 100 групп по алфавиту. Инвайт студенту в группу из «хвоста» не выписать, курс и расписание на неё не завести, пару не поставить в 101-ю аудиторию. Индикации обрезки нет. Серверная схема пускает не больше 100 (`OffsetPaginationSchema`), так что поднять лимит на клиенте нельзя.
- Решение: экран групп — серверная пагинация, как у помещений (`fetchRoomsSorted`) и вузов. Селекторы групп и аудиторий — комбобокс с серверным поиском (`search` в `GroupListQuery`/`RoomListQuery`) вместо загрузки всего списка.
- Файлы для правки: apps/web/src/entities/group/api/group-api.ts, apps/web/src/entities/room/api/room-api.ts, apps/web/src/views/university-admin/ui/groups-view.tsx, apps/web/src/features/create-invite/ui/create-invite-modal.tsx, apps/web/src/features/manage-schedule/ui/manage-schedule.tsx; API — apps/api/src/modules/groups/groups.service.ts (поиск), packages/shared-schemas/src/groups.ts
- Стоп-точки: «контракт API/shared-schemas» (новый параметр `search`)

#### B-F07 [P1] `/platform-admin/stats` шлёт по запросу на вуз и при ~100 вузах упирается в rate-limit, блокируя админа на минуту

- Процесс: B-17
- Где: apps/web/src/views/platform-admin/ui/platform-stats-view.tsx:89-99 (`useQueries` — `GET /universities/:id/stats` на каждый из до 200 вузов); apps/web/src/entities/university/api/university-api.ts:60-68 (список до 200); apps/api/src/app.module.ts:108 (`throttlers: [{ ttl: 60_000, limit: 100 }]`); apps/api/src/common/guards/user-throttler.guard.ts (счётчик на пользователя)
- Суть: открытие страницы — это 1 + N запросов за раз. При N ≥ ~99 (на мега-сиде 100 вузов) хвост получает 429, таблица и итоги неполные. Пользовательский лимит исчерпан на минуту — у PLATFORM_ADMIN отказывают и остальные экраны. Каждый промах кэша — ещё 5 `count` в БД на вуз. Агрегат для этого уже есть: `GET /analytics/platform/universities-size` (один `groupBy`, кэш 5 мин), но он не отдаёт факультеты, группы и аудитории.
- Решение: расширить `universitiesSize` (или завести `GET /analytics/platform/universities-stats`) счётчиками факультетов, групп и аудиторий через `groupBy` — один запрос и один кэш. Перевести страницу на него.
- Файлы для правки: apps/api/src/modules/analytics/platform-analytics.service.ts, apps/api/src/modules/analytics/platform-analytics.controller.ts, apps/web/src/views/platform-admin/ui/platform-stats-view.tsx, apps/web/src/entities/analytics/api/analytics-api.ts, docs/PROJECT.md
- Стоп-точки: «контракт API/shared-schemas» (новые поля ответа)

#### B-F08 [P1] Тихие часы и час суточной сводки считаются по UTC: команду будят ночью и глушат утром

- Процесс: B-12
- Где: apps/api/src/common/telegram/telegram-notify.service.ts:32-36 (`isQuiet` — `now.getHours()`); apps/api/src/modules/cleanup/cleanup.service.ts:591 (`policy.digestHour !== new Date().getHours()`); apps/api/Dockerfile:12,60 (`node:24-alpine`, переменной `TZ` нет ни в Dockerfile, ни в railway.json — процесс в UTC); выбор в мини-аппе: apps/mini-app/src/screens/control.tsx:823-832 (чипы «22–8», «19–9», «утром» = 9, «вечером» = 18)
- Суть: админ выбирает «тишина 22–8», а сервер в UTC глушит уведомления с 03:00 до 13:00 по Алматы (UTC+5). Ночью с 22:00 до 03:00 жалобы будят дежурного, а утром в рабочие часы сигналы не приходят. «Сводка утром» приходит в 14:05 по Алматы, «вечером» — в 23:05. Крон смены дежурства `0 9 * * 1` срабатывает в 14:00 по Алматы.
- Решение: считать час в таймзоне платформы. Константа `Asia/Almaty` или настройка в `PlatformState` — через `Intl.DateTimeFormat(..., { timeZone, hour: 'numeric', hourCycle: 'h23' })`, как `wallClockNow` в rooms. Крону указать `timeZone` в `@Cron`. Подпись в мини-аппе — с таймзоной.
- Файлы для правки: apps/api/src/common/telegram/telegram-notify.service.ts, apps/api/src/modules/cleanup/cleanup.service.ts, apps/api/src/common/telegram/telegram-notify.service.spec.ts, apps/mini-app/src/screens/control.tsx
- Стоп-точки: нет

#### B-F09 [P1] Если у дежурного нет активной привязки Telegram, сигналы команде теряются молча

- Процесс: B-12
- Где: apps/api/src/common/telegram/telegram-notify.service.ts:85-99 (при заданном `dutyUserId` выборка сужается до одного пользователя с фильтром роли staff и `isBlocked: false`; при пустом результате — `if (accounts.length === 0) return` без лога и запасного адресата); packages/shared-schemas/src/platform.ts:117,128 (`dutyUserId` и `rotation` проверяются только как uuid); apps/api/src/modules/platform/platform.service.ts:355-377 (`setDuty`) и :386-405 (`rotateDuty`) — существование, роль и привязка Telegram не проверяются
- Суть: дежурный отвязал Telegram, его заблокировали или понизили из staff, в ротацию по ошибке попал id не-сотрудника, или крон по понедельникам передал дежурство человеку без привязки. Тогда все уведомления о жалобах и обращениях и суточная сводка (`notifyStaff('digest')`) не уходят никому. Ни лога, ни аудита, ни fallback на команду.
- Решение: в `notifyStaff` при пустой выборке по дежурному повторять выборку без фильтра `userId` (вся команда) и писать warn. В `setDuty` и `setNotifications` проверять, что id — платформенный сотрудник с активной привязкой (иначе 422). `rotateDuty` пропускает кандидатов без привязки.
- Файлы для правки: apps/api/src/common/telegram/telegram-notify.service.ts, apps/api/src/modules/platform/platform.service.ts, apps/api/src/common/telegram/telegram-notify.service.spec.ts, apps/api/src/modules/platform/platform.service.spec.ts
- Стоп-точки: нет

#### B-F10 [P1] Drill-down посещаемости группы грузит до 20 000 отметок в Node и молча обрезает их

- Процесс: B-19
- Где: apps/api/src/modules/analytics/analytics.service.ts:234-277 (`groupAttendance`: `attendance.findMany({ where: { pair: { groupId } }, take: 20000 })` без `orderBy` и фильтра по периоду, свёртка в JS)
- Суть: отметки копятся за всё время. Группа из 30 человек с 20 парами в неделю набирает около 19 000 отметок за учебный год, к середине второго года — больше 20 000. Дальше Postgres отдаёт произвольные 20 000 строк, и проценты и «отмечено» по студентам считаются по случайному подмножеству — декан видит неверные цифры без признака обрезки. Каждый клик — выгрузка 20 000 строк в процесс. Обзор факультета уже переведён на SQL-агрегат (`attendanceByStudent`, :86-108), drill-down — нет.
- Решение: агрегировать в SQL (`GROUP BY a.student_id` с `FILTER (WHERE status = 'ABSENT')`, по образцу `attendanceByStudent` с фильтром по группе) и ограничить период текущим семестром или параметром. Добавить спек на `groupAttendance`.
- Файлы для правки: apps/api/src/modules/analytics/analytics.service.ts, apps/api/src/modules/analytics/analytics.service.spec.ts
- Стоп-точки: нет

#### B-F11 [P2] Подача демо-заявки: сбой Redis даёт 500, а повтор в течение 5 минут молча не шлёт письмо; уборка удаляет заявку с живой ссылкой

- Процесс: B-01
- Где: apps/api/src/modules/onboarding/demo-requests.service.ts:180-190 (`queue.enqueue` при первой подаче не обёрнут, в отличие от `enqueueQuietly`), :245-251 (пауза 5 мин считается от `expiresAt − TTL` и при повторе возвращает успех без письма), :289-293 (`purgeUnconfirmed` удаляет по `createdAt`, а повторная отправка продлевает только `emailVerificationExpiresAt`)
- Суть: (1) Redis недоступен — строка заявки уже создана, ответ 500. Человек жмёт ещё раз — `findOpen` находит строку, пауза не прошла, ответ «письмо отправлено», но письма нет. (2) Заявку, которую повторно отправили на 6-й день, крон на 7-й день удаляет по `createdAt`, хотя ссылка из свежего письма ещё действует — человек получает «ссылка недействительна».
- Решение: первую постановку письма тоже делать через `enqueueQuietly`. Паузу считать от отдельного поля «последняя отправка». Уборку вести по `emailVerificationExpiresAt < now() - N`, а не по `createdAt`.
- Файлы для правки: apps/api/src/modules/onboarding/demo-requests.service.ts, apps/api/src/modules/onboarding/demo-requests.service.spec.ts
- Стоп-точки: нет (миграция — только если заводить поле «последняя отправка»)

#### B-F12 [P2] Удаление вуза, факультета или группы не отзывает ожидающие инвайты — регистрация по ним падает невнятной ошибкой

- Процесс: B-02, B-04, B-06
- Где: prisma/schema/01-users.prisma:285-287 (`Invite.universityId/facultyId/groupId` без FK); apps/api/src/modules/universities/universities.service.ts:161-182, faculties.service.ts:99-118, groups.service.ts:221-240 (инвайты не трогаются); apps/api/src/common/filters/http-exception.filter.ts:135-139 (P2003 → 400 «Нарушение ссылочной целостности»)
- Суть: человек открывает ещё действующую ссылку-приглашение, заполняет форму и получает 400 «Нарушение ссылочной целостности» — FK на удалённую группу или факультет при создании пользователя. Инвайт при этом остаётся PENDING и в воронках считается живым.
- Решение: при удалении вуза, факультета или группы переводить их PENDING-инвайты в REVOKED в той же транзакции. В `claimInvite` проверять существование scope и отвечать `INVITE_REVOKED`.
- Файлы для правки: apps/api/src/modules/universities/universities.service.ts, apps/api/src/modules/faculties/faculties.service.ts, apps/api/src/modules/groups/groups.service.ts, apps/api/src/modules/invites/invites.service.ts
- Стоп-точки: нет

#### B-F13 [P2] Город вуза хранится в двух форматах: код КАТО или свободный текст

- Процесс: B-01, B-02, B-03, B-09
- Где: packages/shared-schemas/src/universities.ts:15 (`city: z.string()` — любой текст, не `KatoCodeSchema`); apps/api/src/modules/onboarding/demo-requests.service.ts:416 (одобрение кладёт текст из формы); apps/web/src/views/onboarding/ui/step-body.tsx:85 (шаг «О вузе» показывает `university.city` как есть — у вуза из админки это 9-значный код)
- Суть: у вуза, заведённого через KatoSelect, админ в мастере видит «751110000» вместо «Алматы». У вуза из демо-заявки город — текст, который не резолвится справочником, и поиск или сортировка по городу невозможны.
- Решение: в мастере резолвить код через `useKatoNames`. В форме одобрения заявки дать KatoSelect, предзаполненный поиском по тексту из заявки. Схему `city` ужесточить до `KatoCodeSchema` и разовым скриптом перевести существующие тексты в коды.
- Файлы для правки: apps/web/src/views/onboarding/ui/step-body.tsx, apps/web/src/views/platform-admin/ui/demo-request-modal.tsx, packages/shared-schemas/src/universities.ts, packages/shared-schemas/src/onboarding.ts
- Стоп-точки: «контракт API/shared-schemas»

#### B-F14 [P2] Справочник специальностей не связан с профилем: переименование не доходит, а комментарий в коде утверждает обратное

- Процесс: B-05
- Где: prisma/schema/01-users.prisma:91 (`User.specialty String?`); packages/shared-schemas/src/users.ts:93 (`specialty: shortText` — любая строка, не из справочника); apps/api/src/modules/specialties/specialties.service.ts:64-66 (комментарий «профили ссылаются на специальность по id»)
- Суть: после переименования или удаления специальности в справочнике в профилях остаётся старое название. Студент может вписать произвольный текст в обход справочника.
- Решение: FK `User.specialtyId` с SetNull и перенос значений по совпадению названия, либо хотя бы проверка значения по справочнику вуза при записи профиля и каскадное переименование строк в `update`. Комментарий исправить.
- Файлы для правки: apps/api/src/modules/specialties/specialties.service.ts, apps/api/src/modules/users/users.service.ts, prisma/schema/01-users.prisma, packages/shared-schemas/src/users.ts
- Стоп-точки: «миграция», «контракт API/shared-schemas»

#### B-F15 [P2] Нет уникальности названия факультета в вузе и группы на факультете

- Процесс: B-04, B-06
- Где: prisma/schema/02-academic.prisma:57-76 (`Faculty` — только `@@index([universityId])`), :78-104 (`Group` — только `@@index([facultyId])`); для сравнения `Specialty` — `@@unique([universityId, name])` (:52)
- Суть: быстрый ввод в мастере и двойной клик создают дубли «ИТ-21» и «Факультет права», которые потом неотличимы в селекторах инвайтов и расписания.
- Решение: `@@unique([universityId, name])` для Faculty и `@@unique([facultyId, name])` для Group (предварительно проверить дубли в данных), P2002 → CONFLICT в сервисах.
- Файлы для правки: prisma/schema/02-academic.prisma, apps/api/src/modules/faculties/faculties.service.ts, apps/api/src/modules/groups/groups.service.ts
- Стоп-точки: «миграция»

#### B-F16 [P2] Помещения: кэш статистики не сбрасывается, удаление молча обнуляет ссылки, пакетная выдача QR не идемпотентна при гонке

- Процесс: B-07
- Где: apps/api/src/modules/rooms/rooms.service.ts:97-119 и :180-195 (нет `invalidateStats`, в отличие от faculties.service.ts:46 и groups.service.ts:89); :183-187 (проверяются только `pair`, не `ScheduleChange.newRoom` (prisma/schema/03-schedule.prisma:92, SetNull) и `Exam.room` (21-exams.prisma:24, SetNull); между `count` и `delete` нет транзакции); apps/api/src/modules/rooms/room-qr.service.ts:117-124 (`if (!room.qrCode) assignCode` — read-then-write)
- Суть: счётчик «аудиторий» на дашбордах отстаёт до 5 минут. Удалённое помещение молча пропадает из будущих экзаменов и замен «перенос в ауд. X» — студенты не знают, куда идти. Два одновременных «Печать QR» по одним помещениям выдают два кода, и первая распечатка сразу недействительна.
- Решение: сбрасывать кэш статистики при create и delete. Перед удалением проверять будущие экзамены и изменения расписания (CONFLICT). В `assignCode` для batch писать через `updateMany({ where: { id, qrCode: null } })` и перечитывать код. Добавить unit-спек на rooms.service.ts.
- Файлы для правки: apps/api/src/modules/rooms/rooms.service.ts, apps/api/src/modules/rooms/room-qr.service.ts, apps/api/src/modules/rooms/rooms.module.ts
- Стоп-точки: нет

#### B-F17 [P2] Статистика вуза отвечает 500 при недоступном Redis

- Процесс: B-02, B-18
- Где: apps/api/src/modules/universities/universities.service.ts:189 и :194 (`redis.get`/`redis.set` без try/catch; `invalidateStats` там же и `cached` в university-analytics.service.ts:310-325 ошибки Redis глотают)
- Суть: сбой Redis роняет плитки дашборда вуза и всю `/platform-admin/stats`, хотя посчитать можно напрямую из БД.
- Решение: обернуть чтение и запись кэша в try/catch по образцу `UniversityAnalyticsService.cached`.
- Файлы для правки: apps/api/src/modules/universities/universities.service.ts, apps/api/src/modules/universities/universities.service.spec.ts
- Стоп-точки: нет

#### B-F18 [P2] Рычаги платформы доступны только из мини-аппа, `announcedVersion` никто не читает, мобильные клиенты состояние платформы игнорируют

- Процесс: B-10, B-11, B-13, B-14
- Где: apps/api/src/modules/platform/platform.service.ts (`announceRelease`) → в вебе `announcedVersion` только в типах (apps/web/src/entities/platform/model/state.ts:55,64), решение о ноте — apps/web/src/entities/release/lib/pick-note.ts по бандлу; в apps/web нет экранов для `/platform/maintenance|banner|sections|queues|storage|changes`; apps/ios/Sources и apps/android/app/src/main не обращаются к `/platform/state` (grep `disabledSections`/`platform/state` пуст)
- Суть: «объявить релиз» из мини-аппа ни на что не влияет. Без Telegram управлять техработами и баннером можно только curl'ом. Погашенный раздел и баннер не действуют в iOS/Android — там погашенный раздел работает дальше.
- Решение: либо читать `announcedVersion` в `pickReleaseNote` (не показывать ноту новее объявленной), либо удалить рычаг. Добавить в `/platform-admin` минимальную панель рычагов и наблюдения. Мобильным клиентам — чтение `GET /platform/state` (баннер, разделы).
- Файлы для правки: apps/web/src/entities/release/lib/pick-note.ts, apps/web/src/widgets/whats-new/ui/whats-new-dialog.tsx, apps/web/src/views/platform-admin/*, apps/ios/Sources, apps/android/app/src/main
- Стоп-точки: нет

#### B-F19 [P2] Публичный `GET /platform/state` раскрывает анониму адресные баннеры, список вузов-адресатов и id дежурного

- Процесс: B-11, B-12
- Где: apps/api/src/modules/platform/platform.controller.ts:40-46 (`@Public`); apps/api/src/modules/platform/platform.service.ts:578-618 (`project` отдаёт `banner.text`, `roles`, `universityIds` и `notifications.dutyUserId` всем); фильтрация по аудитории — только на клиенте (apps/web/src/widgets/platform-gate/ui/platform-gate.tsx:137-146)
- Суть: объявление «только для студентов вуза X» читает любой без входа, вместе с UUID вузов и UUID дежурного админа.
- Решение: анониму отдавать только техработы и баннеры без адресации. Адресные баннеры фильтровать на сервере по JWT (или отдельный авторизованный эндпоинт). `notifications` убрать из публичного ответа — мини-апп читает их через `GET /platform/duty`.
- Файлы для правки: apps/api/src/modules/platform/platform.controller.ts, apps/api/src/modules/platform/platform.service.ts, apps/web/src/entities/platform/model/state.ts, apps/mini-app/src/api/platform.ts
- Стоп-точки: «контракт API/shared-schemas»

#### B-F20 [P2] Наблюдение за платформой сканирует большие таблицы целиком

- Процесс: B-11, B-13
- Где: apps/api/src/modules/platform/platform.service.ts:295-300 (`file.count()` и `file.aggregate(sum size)` по всей таблице `files` на каждое открытие «Обзора»); :311 и :425-429 (`auditLog.findMany/findFirst({ where: { action: { startsWith: 'platform.' } }, orderBy: createdAt desc })` — btree по `action` (09-audit.prisma:17) префиксный LIKE без `text_pattern_ops` не использует, план идёт по `createdAt` назад до первого `platform.*`, а таких записей единицы на миллионы); :424-433 (`undoLast` берёт последнюю `platform.*` запись, включая крон `platform.duty.rotate` без `before`, и отвечает «отменять нечего», хотя правка админа была)
- Суть: на мега-сиде (~21 млн строк, аудит — заметная часть) экран «Обзор» и кнопка отката делают полные сканы. Откат в понедельник после ротации не работает.
- Решение: кэш `storageUsage` на несколько минут. Для журнала — фильтр по `entity = 'PlatformState'` с индексом `(entity, createdAt)` или `action IN (...)` по известному списку. В `undoLast` пропускать записи без `before`.
- Файлы для правки: apps/api/src/modules/platform/platform.service.ts, prisma/schema/09-audit.prisma
- Стоп-точки: «миграция» (если добавлять индекс)

#### B-F21 [P2] Период аналитики платформы не ограничен: `from=1970` строит десятки тысяч корзин с джойном на `audit_logs`

- Процесс: B-17
- Где: packages/shared-schemas/src/analytics.ts:23-29 (`from`/`to` — любые даты, нет `from < to` и максимальной длины); apps/api/src/modules/analytics/platform-analytics.service.ts:547-551 (`resolveRange` без ограничений), :186-215 (`generate_series` по всему периоду × `LEFT JOIN audit_logs` с `COUNT(DISTINCT)` и окном WAU 7 дней); ограничение `MAX_BUCKETS = 1000` (:588) действует только в JS после запроса
- Суть: один запрос модератора платформы (в том числе из мини-аппа) с `from=1970-01-01&interval=day` строит около 20 000 корзин, на каждую — диапазонный проход по аудиту. Это минуты нагрузки на общую БД, а кэш по ключу с произвольным `from` не помогает.
- Решение: в схеме — `refine(from < to)` и максимальная длина периода по интервалу (например, 366 корзин). Обрезку корзин делать до SQL.
- Файлы для правки: packages/shared-schemas/src/analytics.ts, apps/api/src/modules/analytics/platform-analytics.service.ts, apps/api/src/modules/analytics/platform-analytics.service.spec.ts
- Стоп-точки: «контракт API/shared-schemas»

#### B-F22 [P2] Дашборд вуза: по некэшированному обзору на каждый факультет, загрузка аудиторий считает старые расписания

- Процесс: B-18
- Где: apps/web/src/widgets/stats-dashboard/ui/stats-dashboard.tsx:96-103 (`useQueries` — `GET /analytics/faculty?facultyId=` на каждый факультет); apps/api/src/modules/analytics/analytics.service.ts:155-231 (`facultyOverview` без кэша, посещаемость за всё время); apps/api/src/modules/analytics/university-analytics.service.ts:139-148 (`roomLoad` — `FROM pairs p JOIN rooms r` без `schedules.is_active` и без учёта `week_type`; старые версии расписания деактивируются, а не удаляются — schedules.service.ts:244-245)
- Суть: каждое открытие главной админа вуза — N тяжёлых агрегатов по всей истории посещаемости, мимо Redis. Средняя посещаемость вуза считается как невзвешенное среднее групп и расходится с `attendance-trend`. Тепловая карта аудиторий после каждого нового семестра растёт на число старых расписаний, а пары «по чётным» и «по нечётным» складываются в одну.
- Решение: агрегат «плитки вуза» одним запросом с кэшем (по образцу `UniversityAnalyticsService.cached`). В `roomLoad` — `JOIN schedules s ON s.id = p.schedule_id AND s.is_active` и вес 0.5 для пар, идущих через неделю.
- Файлы для правки: apps/api/src/modules/analytics/university-analytics.service.ts, apps/api/src/modules/analytics/university-analytics.controller.ts, apps/web/src/widgets/stats-dashboard/ui/stats-dashboard.tsx
- Стоп-точки: «контракт API/shared-schemas» (если новый эндпоинт)

#### B-F23 [P2] Health-check отдаёт анониму сырые ошибки зависимостей, не имеет таймаутов и тестов

- Процесс: B-16
- Где: apps/api/src/modules/health/indicators/prisma.health.ts:18, redis.health.ts:22, minio.health.ts:20 (`indicator.down({ message: error.message })` на `@Public` маршруте); apps/api/src/modules/health/health.controller.ts:25-31 (нет таймаута на `ping`/`listBuckets`); apps/api/railway.json (`healthcheckPath: /api/v1/health` — деплой упадёт при сбое MinIO, хотя прод-compose от этого сознательно отказался)
- Суть: текст ошибок Prisma, ioredis и MinIO может содержать внутренние хосты и порты. Подвисший Redis или MinIO подвешивает health-запрос до таймаута Railway. Спеков у модуля нет.
- Решение: наружу отдавать только `up/down`, подробности — в лог. `HealthIndicator` с `Promise.race`-таймаутом (например, 3 с). Для Railway — лёгкий `/health/live` без внешних зависимостей. Unit-спек на индикаторы.
- Файлы для правки: apps/api/src/modules/health/*, apps/api/railway.json, .github/workflows/{uptime,smoke}.yml
- Стоп-точки: «контракт API/shared-schemas» (смена формата ответа health, публичный эндпоинт)

#### B-F24 [P2] Мёртвый код: `/analytics/teacher`, `/analytics/my-group`, `RoleLanding`

- Процесс: B-20, B-22
- Где: apps/api/src/modules/analytics/analytics.controller.ts:47-66 и analytics.service.ts:386-667 (`teacherOverview`, `myGroupOverview`) — grep по apps/{web,mini-app,ios,android} вызовов не находит; тестов нет. apps/web/src/views/role-landing/ui/role-landing.tsx и экспорт в apps/web/src/views/role-landing/index.ts:1 — нигде не импортируется
- Суть: около 280 строк непокрытого кода с собственными выборками (`take: 50_000`) и около 100 строк UI поддерживаются без потребителя и расширяют поверхность API.
- Решение: либо подключить дашборды преподавателя и старосты в вебе, либо удалить эндпоинты, сервисные методы и `RoleLanding`, обновив docs/PROJECT.md и openapi.json.
- Файлы для правки: apps/api/src/modules/analytics/analytics.controller.ts, apps/api/src/modules/analytics/analytics.service.ts, apps/web/src/views/role-landing/*, apps/api/openapi.json, docs/PROJECT.md
- Стоп-точки: «контракт API/shared-schemas» (удаление эндпоинтов)

#### B-F25 [P2] Сообщение об ошибке удаления группы не соответствует причине

- Процесс: B-06
- Где: apps/api/src/modules/groups/groups.service.ts:227-229 (любой P2003 → «Нельзя удалить группу со студентами»; реальная причина бывает и в `Schedule`/`Pair` с Restrict — prisma/schema/03-schedule.prisma:24,54)
- Суть: у группы нет студентов, но есть расписание. Админ видит «со студентами» и не понимает, что мешает.
- Решение: вместе с B-F05 — явные проверки студентов, расписания, курсов и экзаменов с отдельными сообщениями (i18n-ключи на вебе).
- Файлы для правки: apps/api/src/modules/groups/groups.service.ts, apps/web/messages/{ru,kk,en}.json
- Стоп-точки: нет

#### B-F26 [P2] Catch-all `[...section]` превращает любую опечатку в URL зоны роли в заглушку «в разработке»

- Процесс: B-22
- Где: apps/web/src/app/{platform-admin,dean,teacher,starosta}/[...section]/page.tsx, apps/web/src/app/moderator/{platform,university}/[...section]/page.tsx → apps/web/src/views/role-landing/ui/section-stub.tsx
- Суть: `/dean/studnets` показывает «раздел в разработке» вместо 404 — битые ссылки в навигации и письмах не обнаруживаются.
- Решение: заглушку отдавать только для ключей из `nav.ts` с пометкой «в разработке», для остального — `notFound()`.
- Файлы для правки: apps/web/src/app/*/[...section]/page.tsx, apps/web/src/widgets/app-shell/model/nav.ts
- Стоп-точки: нет

#### B-F27 [P2] Пробелы в тестах группы B

- Процесс: все
- Где: нет спеков на apps/api/src/modules/rooms/rooms.service.ts (CRUD, scope, запрет удаления), apps/api/src/modules/analytics/university-analytics.service.ts, `groupAttendance`/`teacherOverview`/`myGroupOverview` в analytics.service.ts, apps/api/src/modules/health/*. В platform.service.spec.ts нет пути «состояние из Redis» с датами (причина пропуска B-F01). Нет тестов гонок одобрения демо-заявки (B-F02) и запуска не из PENDING (B-F04). Веб: нет тестов whats-new-dialog, stats-dashboard, platform-stats-view, groups-view. E2E админских сценариев (структура вуза, онбординг, демо-заявка) нет.
- Решение: добавить перечисленные unit-спеки, в первую очередь по B-F01, B-F02, B-F04 и B-F05. E2E: демо-заявка → одобрение → регистрация админа вуза → мастер → запуск.
- Файлы для правки: apps/api/src/modules/{rooms,analytics,health,platform,onboarding}/_.spec.ts, apps/web/e2e/_
- Стоп-точки: нет
