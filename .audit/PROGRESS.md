# Журнал полного аудита (audit/full-pass)

Ветка `audit/full-pass` от `develop` @ d47ff79f (включает PR #357–#359). Ничего не пушится без
команды владельца. Правила проекта (AGENTS.md) действуют: коммиты по-русски, без следов агента,
миграции к БД — только с показом SQL, новые зависимости и смена контрактов — через QUESTIONS.md.

## Текущее состояние

- Фаза: 3 — исправления (фаза 2 завершена: отчёт .audit/AUDIT_REPORT.md, задачи .audit/TASKS.md)
- Следующий шаг: волна P0 — FIX-B-F01, FIX-C-F01, FIX-E-F01; затем FIX-F-F01, FIX-C-F11, FIX-F-F09; затем P1

## Группы модулей

| Код | Группа                                | API-модули                                                                                                                   | Веб (views/маршруты)                                                                                                                                                           |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | Учётки и доступ                       | auth, invites, users, me, student-id, telegram-hook, mini                                                                    | (auth), settings, student-id, verify, qr, r, legal, onboarding (вход)                                                                                                          |
| B   | Структура вуза и платформа            | universities, faculties, groups, specialties, rooms, kato, onboarding, platform, analytics, releases, client-version, health | platform-admin, university-admin, rooms, people, dean-dashboard, dean-analytics, demo, role-landing, home                                                                      |
| C   | Учебный процесс                       | courses, assignments, attendance, gradebook, exams, schedules, consultations, appointments, materials                        | academic, assignments, attendance, calendar, consultations, course-admin, courses, exams, gradebook, materials, schedule, student-grades, study-plan, tasks, teacher, starosta |
| D   | Услуги, документы, карьера, модерация | application-services, documents, data-export, complaints, career                                                             | service-catalog, documents, document-types, platform-documents, verify-document, career, employer, moderation, moderator-dashboard, support-desk                               |
| E   | Соцчасть и контент                    | posts, profile-content, polls, stories, friends, events, search, portfolio                                                   | feed, post, events, portfolio, (профиль: widgets/user-profile)                                                                                                                 |
| F   | Коммуникации и инфраструктура         | chats (+support), notifications, push, email, files, media, cleanup (cron), очереди BullMQ, realtime                         | chats, join-chat, notifications, support-desk (чат), offline                                                                                                                   |

## Журнал

- Старт: созданы файлы состояния и ветка.
- Волна 1 инвентаризации запущена: A, B, C (по агенту на группу, пишут в .audit/processes/<группа>.md).
- INV-C готово: 20 процессов (C-01…C-20). Первые замечания: schedule:changed не доходит до преподавателей (комната group:), ExamResult.attempt не пишется (пересдача перезаписывает), maxAttempts/publishAt/maxScore не проверяются, оценки заданий не попадают в журнал, нет тестов посещаемости, take:2000 в сводке посещаемости.
- Запущен INV-D.
- INV-A готово: 28 процессов (A-01…A-28). Замечено: удалённый аккаунт сохраняет доступ через привязанный Telegram (telegram-hook/mini не проверяют deletedAt), companyId=null у работодателя после входа с 2FA, refresh_tokens не чистятся, чувствительные операции не в аудите, DELETE /users/me без пароля/2FA, approve QR-входа без проверки pending.
- Запущен INV-E.
- INV-B готово: 22 процесса (B-01…B-22). Замечено: статус вуза BLOCKED/PENDING нигде не применяется, одобрение демо-заявки не атомарно (двойной вуз), мёртвые /analytics/teacher и /analytics/my-group, announcedVersion не читается вебом, /university-admin/groups без пагинации (100), N запросов stats на вуз, удаление пустой группы каскадом сносит курсы/экзамены/материалы.
- Запущен INV-F.
- INV-E готово: 23 процесса (E-01…E-23). Замечено: публичное резюме отдаёт PRIVATE-записи портфолио, profileVisibility не соблюдается для статей и опросов по прямому запросу, закладки статей не перепроверяют видимость, поиск не находит события ALL, отложенный пост встаёт в ленту на дату создания.
- Фаза 2 начата досрочно для готовых групп: запущен AUD-A (параллельно с INV-D, INV-F).
- Шаблон задания аудита сохранён в .audit/AGENT_PROMPTS.md.
- INV-D готово: 26 процессов (D-01…D-26). Замечено: правка одобренной вакансии обходит модерацию, допуск компании к вузу не проверяется в поиске/отклике/воронке, CLOSED и dueAt запросов документов не применяются, подмена документа после ACCEPTED, гонки статусов заявок и решений по жалобам.
- Запущен AUD-B.
- INV-F готово: 29 процессов (F-01…F-29). Замечено: emailFallback/emailEnabled → письмо на каждое сообщение без сокета, push по умолчанию выключен, socket.io без Redis-адаптера (не масштабируется на инстансы), дубли официальных и личных чатов при гонке, DELETE /files/:id удаляет привязанные файлы, пустое сообщение при сбое подтверждения файла, отложенные сообщения без клиента.
- ФАЗА 1 ЗАВЕРШЕНА: 148 процессов (A 28, B 22, C 20, D 26, E 23, F 29). Реестр собран в PROCESSES.md.
- Запущен AUD-C.
- AUD-B готово: P0 1, P1 9, P2 17. P0 B-F01: техработы роняют весь API (reviveDates не оживляет maintenanceFrom → TypeError в MaintenanceGuard). P1: каскадное удаление группы, BLOCKED вуза не блокирует (и админ сам снимает через onboarding/launch), двойное одобрение демо-заявки, лимит 100 групп/аудиторий, stats упирается в троттлер, тихие часы по UTC. Запущен AUD-D.
- AUD-A готово: P0 0, P1 9, P2 23. P1: токен мини-аппа принимается WebSocket (realtime.gateway без проверки client), email регистрозависим (сброс пароля не находит учётку), лимиты auth по IP режут кампус за NAT, удалённый сотрудник сохраняет Telegram-доступ, companyId=null после 2FA, студент правит поля студбилета, нет восстановления 2FA, refresh_tokens не чистятся, два bcrypt на refresh. Запущен AUD-E.
- AUD-C готово: P0 2, P1 12, P2 16. P0 C-F01: в UI нельзя назначить преподавателя на курс (teacherId=null навсегда). P0 C-F11: Attendance.pair onDelete Cascade — удаление пары/версии расписания стирает посещаемость. P1: обрезка списков заданий/записей/экзаменов (take без порядка по актуальности), задание «Файл» не сдаётся, удаление задания стирает оценённые работы, баллы без maxScore, заменяющий преподаватель не видит пару, новая версия расписания гасит действующую. Запущен AUD-F.
- Написан .audit/tools/build_report.py (сборка AUDIT_REPORT.md и issues.json из findings).
- AUD-D готово: P0 0, P1 14, P2 18; D-08 сломан. P1: правка одобренной вакансии без повторной модерации (D-F12), истёкший допуск компании не проверяется (D-F13), очередь деканата видит черновики (D-F01), PRIVATE портфолио в резюме (D-F14), двойное применение меры по жалобе (D-F11), архивация документов встаёт после 500 (D-F08).
- Написан .audit/tools/build_tasks.py (задачи фазы 3 из issues.json: P0/P1 по одной, P2 пакетами по модулю, «после» по пересечению файлов).
- AUD-E готово: P0 1, P1 10, P2 17. P0 E-F01 = D-F14 (PRIVATE/UNIVERSITY портфолио в публичном резюме и карточке кандидата) — объединить в одну задачу. P1: репост показывает снятый/невидимый оригинал, модераторы видят личную ленту вместо очереди, запрос на каждую картинку упирается в лимит, статьи/опросы закрытого профиля, блокировка не рвёт дружбу, события делят кэш с виджетом (4 шт.).
- AUD-F готово: P0 2 (F-F01 поиск для забаненного, F-F09 пуши выключены и iOS не может включить), P1 10, P2 17.
- ФАЗА 2 ЗАВЕРШЕНА: 178 проблем (P0 6, P1 64, P2 108); процессы: 27 работают, 116 с проблемами, 4–5 сломаны. Отчёт собран build_report.py, задачи (133) — build_tasks.py. Шаблон агента-исправителя в AGENT_PROMPTS.md.
- Волна P0-1 запущена: FIX-B-F01, FIX-C-F01, FIX-E-F01 (+D-F14).
- FIX-B-F01 done: reviveDates оживляет все DateTime (типизированный список), toDate без Invalid Date; guard не роняет запрос при ошибке проверки (лог раз в минуту); +5 тестов, platform+guards 91/91. Запущен FIX-F-F01.
- FIX-E-F01 done (+D-F14): portfolioVisibilityWhere(owner|university|external) в portfolio.service, публичное резюме и карточка работодателя — только PUBLIC; новый spec портфолио + регрессии, 42 теста, typecheck чистый. PROJECT.md дополнен. Хвост → P2-E-portfolio-followup. Запущен FIX-C-F11.
- FIX-F-F01 done: глобальный поиск по сообщениям ограничен чатами с bannedAt: null; прочие пути чтения уже через assertMembership; +2 теста, чаты 116/116, typecheck чистый. Открытый продуктовый вопрос: очищенная у себя история находится поиском (оставлено как есть). Запущен FIX-F-F09.
- FIX-C-F01 done (только веб): выбор преподавателя в создании и новом окне правки дисциплины (AsyncSelect по /users TEACHER|DEAN), PATCH только изменённых полей; vitest+eslint+tsc чистые. Хвосты: C-F02 (справочники из текущей страницы), декан видит только своих преподавателей.
- P1 начат: пачка заявок FIX-D-F01, D-F03, D-F04 (application-services).

## План пачек P1 (по модулю, ≤3 задачи на агента; параллельно — без общих файлов)

1. заявки API: D-F01, D-F03, D-F04 — запущено
2. auth: A-F05, A-F08, A-F09 → затем B-F03 (тоже auth)
3. realtime/telegram: A-F03, A-F04
4. карьера: D-F12, D-F13
5. документы: D-F07, D-F08, D-F10
6. чаты: F-F03, F-F04, F-F05 (F-F05 — миграция)
7. задания: C-F06, C-F07, C-F08
8. онбординг/группы: B-F02, B-F04; отдельно B-F05 (миграция)
9. лента: E-F02, E-F03; затем E-F04, E-F05 (аддитивный контракт); E-F06 (миграция)
10. профиль/соцчасть: E-F07, E-F09, E-F10
11. аналитика: B-F07, B-F10
12. обрезка списков: C-F09, C-F19, C-F18, C-F17, B-F06; C-F14 после C-F11
13. жалобы: D-F11; E-F08 (миграция+контракт)
14. после FIX-C-F11 (schedules): C-F12, C-F13; C-F02, C-F03
15. после FIX-F-F09 (notifications/push): F-F10, F-F07, F-F08
16. чаты-производительность: F-F02, F-F12
17. прочее: A-F01 (миграция+контракт), A-F02, A-F06, A-F07 (новый эндпоинт), B-F08, B-F09, D-F02, D-F05, D-F06, D-F09, E-F11, F-F06, F-F11

- FIX-C-F11 done: removePair/removeSchedule отказывают 409 при наличии отметок (+гонка → тот же 409), веб предупреждает; FK attendance→pair RESTRICT — миграция создана, НЕ применена (Q1). schedules 30/30, typecheck чистый.
- FIX-F-F09 done: registerDevice включает pushEnabled на новом/перехваченном токене (повторная регистрация не трогает); iOS DTO pushEnabled/emailEnabled; Android уже верный; push spec 3 кейса, 51 тест, typecheck чистый. Вопрос Q2. ВСЕ P0 ЗАКРЫТЫ (6/6).
- Запущены пачки P1: auth (A-F05, A-F08, A-F09) и карьера (D-F12, D-F13).
- Пачка заявок done (D-F01, D-F03, D-F04): submittedOnlyWhere скрывает черновики от сотрудников (404), resubmit проверяет комплект, remove отказывает для ACCEPTED, переходы статусов условным UPDATE → 409; 88 тестов, typecheck чистый.
- ПРАВИЛО: параллельные агенты не правят docs/PROJECT.md — строки для документации копятся в «Долг документации» ниже и вносятся одним коммитом.
- Запущена пачка документов: D-F07, D-F08, D-F10.

## Долг документации (внести в docs/PROJECT.md)

- Заявки (§ заявок): сотрудники не видят неотправленные заявки; повторная отправка проверяет комплект документов; переходы статусов при гонке → 409 CONFLICT; ACCEPTED-документ нельзя убрать, пока ждут исправление.
- Пачка auth done (A-F05, A-F08, A-F09): companyId в токене после 2FA; cron purgeRefreshTokens (истёкшие >1 сут, ≤100×500 за прогон; погашенные живых цепочек хранятся до expiresAt ради детектора повтора), убран аудит каждого refresh; refresh-секреты SHA-256 + constant-time, старые bcrypt-записи доживают (ветку удалить через ~30 дней после деплоя). 172 теста, typecheck чистый.
- Долг документации: §6.2 «в БД только SHA-256-хэш секрета (выданные до перехода bcrypt-записи доживают свой срок)»; §10.2 строка `purgeRefreshTokens | 25 * * * * | RefreshToken, истёкшие больше суток назад; погашенные строки живых цепочек хранятся до expiresAt (детектор повтора); ≤100 батчей по 500 за прогон`.
- Хвост: удалить bcrypt-ветку refreshSecretMatches через ~30 дней после деплоя.
- Пачка auth закоммичена (714a1a42; cleanup-часть выделена из общих файлов патчем с контекстом). Запущена пачка realtime/telegram: A-F03, A-F04.
- Пачка карьеры done (D-F12, D-F13): правка содержательных полей одобренной вакансии → одобрения вузов в PENDING (транзакция); vacancyVisibleWhere/applicationScopeWhere — действующий допуск компании для витрины, карточки, отклика, воронки; cron expireCompanyAccess (:40) переводит истёкшие допуски в REVOKED с каскадом. 202 теста, typecheck чистый.
- Долг документации (карьера): «…и только пока допуск компании в этот вуз действует (APPROVED без истёкшего expiresAt). Правка содержательных полей вакансии (всё, кроме deadline) тем же шагом возвращает её одобрения в PENDING.»; Допуск: «Истёкший допуск ежечасно переводится в REVOKED с причиной «Истёк срок допуска» и тем же каскадом на вакансии; expiresAt сохраняется. Доступ закрывается по сроку сразу, cron лишь приводит состояние в порядок.»; Отклики: «Воронка компании показывает отклики вузов с действующим допуском, а из остальных — поданные до конца допуска.»; §10.2: expireCompanyAccess | 40 * * * * | истёкшие допуски → REVOKED + решения по вакансиям вуза → REJECTED. Плюс устаревший комментарий prisma/schema/26-career.prisma:105-106 («отдельной джобы не требует»).
- Запущена пачка чатов: F-F03, F-F04, F-F05 (F-F05 — миграция).
- Пачка realtime/telegram done (A-F03, A-F04): WS отклоняет client:'mini' (handshake и auth:refresh); удаление аккаунта удаляет TelegramAccount в той же транзакции; хук/мини-апп/notifyStaff не пускают удалённых (+сотрудников без 2FA при TWO_FACTOR_ENFORCE). 154 теста, typecheck чистый. Вопрос Q3 (разовая чистка).
- Долг документации: §8.3 «Токен мини-аппа (client:'mini') в Socket.IO не пускает: handshake и auth:refresh его отклоняют»; «Вебхук бота»: «Удалённый аккаунт бот не узнаёт, а при TWO_FACTOR_ENFORCE — и сотрудника без 2FA»; §11.3: «Удаление аккаунта удаляет и привязку Telegram (telegram_accounts)».
- Запущена пачка заданий: C-F06, C-F07, C-F08.
- Пачка документов done (D-F07, D-F08, D-F10): комплект по запросу правится только в DRAFT/REJECTED/PARTIAL, закрытый/просроченный → 409, правка возвращённого → DRAFT, review/finalize только SUBMITTED/PARTIAL, условные UPDATE, поле acceptsSubmissions; архивация по сроку — по правилам типов с курсором до исчерпания; новый GET /documents/shared-with-me + раздел «Открытые мне» + уведомление получателю гранта (job document-shared). 100 тестов, web tsc чистый. Хвосты: закрытие запроса автором/кроном (D-F25, P2), правка файлов принятого документа через attachFiles/update, индекс грантов UNIVERSITY.
- Долг документации (запросы документов): «Студент сохраняет и отправляет комплект только в DRAFT/REJECTED/PARTIAL; SUBMITTED/ACCEPTED, закрытый запрос или истёкший dueAt — 409. dueAt без времени действует до конца дня. Правка возвращённого комплекта → DRAFT, вердикты нетронутых позиций сохраняются. review/finalize — только SUBMITTED/PARTIAL. GET /document-requests(/:id) отдают acceptsSubmissions.» (документы): «Архивация по сроку хранения идёт по типам с retentionDays пачками до исчерпания. GET /documents/shared-with-me?cursor&limit≤50 — активные гранты на меня (USER), мой факультет (DEPARTMENT, декану), мой вуз (UNIVERSITY, администрации), без своих документов.» (§10.1): «job document-shared (SYSTEM, documents.shared.title/body, url /documents?section=shared, dedupe doc-shared:<accessId>) — при гранте USER/DEPARTMENT получателю из вуза владельца; на UNIVERSITY уведомления нет.»
- Запущена пачка ленты: E-F02, E-F03.
- Пачка заданий done (C-F06, C-F07, C-F08): файлы в сдаче задания (File.submissionId, миграция 20261017140000 — НЕ применена, Q4; классификатор прав запретил migrate deploy), 5 новых эндпоинтов (аддитивно), веб прикрепление/скачивание; удаление задания со сданными работами → 409; баллы > max → VALIDATION_ERROR (задания, журнал, экзамены), понижение max ниже выставленного → 409. api 81 тест, typecheck чистый. Хвост: DELETE /files/:id снимает файл сданной работы (= F-F06).
- Долг документации (задания): «Сдача задания может содержать до 10 файлов (File.submissionId → Submission, ON DELETE CASCADE, бакет applications): POST /assignments/:id/submission/files (≤10 МБ), …/files/presign + …/files/confirm, DELETE …/files/:fileId (до отправки), GET /submissions/:id/files/:fileId/presigned (автор или проверяющий); ответы сдач содержат files[]. DELETE /assignments/:id → 409, если есть сдачи не в DRAFT. Балл выше maxScore задания/колонки/экзамена → VALIDATION_ERROR (score | entries.<i>.score); admitted=false с PASSED/FAILED → VALIDATION_ERROR; понижение maxScore ниже выставленного → 409.»
- Запущена пачка онбординга: B-F02, B-F04.
- Шаблон агента: предпочитать решения без изменения схемы (миграции применить нельзя — классификатор прав).
