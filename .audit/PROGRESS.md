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
- AUD-B готово: P0 1, P1 9, P2 17. P0 B-F01: техработы роняют весь API (reviveDates не оживляет maintenanceFrom → TypeError в MaintenanceGuard). P1: каскадное удаление группы, BLOCKED вуза не блокирует (и админ сам снимает через onboarding/launch), двойное одобрение демо-заявки, лимит 100 групп/аудиторий, stats упирается в троттлер, тихие часы по UTC. Запущен AUD-D.
- AUD-A готово: P0 0, P1 9, P2 23. P1: токен мини-аппа принимается WebSocket (realtime.gateway без проверки client), email регистрозависим (сброс пароля не находит учётку), лимиты auth по IP режут кампус за NAT, удалённый сотрудник сохраняет Telegram-доступ, companyId=null после 2FA, студент правит поля студбилета, нет восстановления 2FA, refresh_tokens не чистятся, два bcrypt на refresh. Запущен AUD-E.
- AUD-C готово: P0 2, P1 12, P2 16. P0 C-F01: в UI нельзя назначить преподавателя на курс (teacherId=null навсегда). P0 C-F11: Attendance.pair onDelete Cascade — удаление пары/версии расписания стирает посещаемость. P1: обрезка списков заданий/записей/экзаменов (take без порядка по актуальности), задание «Файл» не сдаётся, удаление задания стирает оценённые работы, баллы без maxScore, заменяющий преподаватель не видит пару, новая версия расписания гасит действующую. Запущен AUD-F.
- Написан .audit/tools/build_report.py (сборка AUDIT_REPORT.md и issues.json из findings).
- AUD-D готово: P0 0, P1 14, P2 18; D-08 сломан. P1: правка одобренной вакансии без повторной модерации (D-F12), истёкший допуск компании не проверяется (D-F13), очередь деканата видит черновики (D-F01), PRIVATE портфолио в резюме (D-F14), двойное применение меры по жалобе (D-F11), архивация документов встаёт после 500 (D-F08).
