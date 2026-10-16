# Журнал полного аудита (audit/full-pass)

Ветка `audit/full-pass` от `develop` @ d47ff79f (включает PR #357–#359). Ничего не пушится без
команды владельца. Правила проекта (AGENTS.md) действуют: коммиты по-русски, без следов агента,
миграции к БД — только с показом SQL, новые зависимости и смена контрактов — через QUESTIONS.md.

## Текущее состояние

- Фаза: 2 — аудит (фаза 1 завершена: 148 процессов в .audit/PROCESSES.md)
- Следующий шаг: аудиты групп (AUD-A, AUD-B, AUD-C в работе; затем D, E, F), затем сводный отчёт и TASKS

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
