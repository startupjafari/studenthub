# Журнал полного аудита (audit/full-pass)

Ветка `audit/full-pass` от `develop` @ d47ff79f (включает PR #357–#359). Ничего не пушится без
команды владельца. Правила проекта (AGENTS.md) действуют: коммиты по-русски, без следов агента,
миграции к БД — только с показом SQL, новые зависимости и смена контрактов — через QUESTIONS.md.

## Текущее состояние

- Фаза: 1 — инвентаризация бизнес-процессов
- Следующий шаг: волна 1 агентов инвентаризации (группы A, B, C)

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
