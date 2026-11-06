## Группа C — Учебный процесс

### C-01 Справочники вуза: дисциплины, семестры, курсы групп

- Бизнес-цель: завести академический каркас вуза — справочник предметов (`Subject`), семестры (`Term`) и курсы «предмет × группа × семестр» с преподавателем (`Course`), на которые опираются задания, журнал и экзамены.
- Роли: UNIVERSITY_ADMIN, PLATFORM_ADMIN (предметы/семестры/курсы); DEAN (только курсы своего факультета); чтение — все роли вуза по scope.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/university-admin/courses`, `/dean/courses` (вкладки «Курсы / Предметы / Семестры»).
- Завершение: курс создан/удалён, запись в аудит; удаление курса с оценками/работами/результатами — `409 CONFLICT`, предмета/семестра, на которые ссылаются курсы, — тоже `CONFLICT`.
- Шаги и файлы: `apps/api/src/modules/courses/{courses,subjects,terms}.controller.ts`, `courses.service.ts` (scope-гейты, `handleUnique`, аудит); `GET|POST /subjects`, `PATCH|DELETE /subjects/:id`, `GET|POST /terms`, `PATCH|DELETE /terms/:id`, `GET|POST /courses`, `GET|PATCH|DELETE /courses/:id`; web `apps/web/src/views/course-admin/ui/{course-admin-view,create-course-modal,create-subject-modal,create-term-modal}.tsx`, `apps/web/src/entities/course/api/course-api.ts`; схема `prisma/schema/17-courses.prisma`.
- Данные на входе / выходе: `{name}` / `{name,number,startsOn,endsOn,isActive}` / `{subjectId,groupId,teacherId?,termId?,credits?}` → строки справочников; уникальности `[universityId,name]`, `[subjectId,groupId,termId]`.
- Внешние зависимости: PostgreSQL; `AuditService`.
- Тесты: `apps/api/src/modules/courses/courses.service.spec.ts` (удаление с записями, кого можно назначить преподавателем); `apps/api/test/cross-tenant.e2e-spec.ts` (чужой курс → 403/404).
- Замечено: в вебе нет редактирования — `updateCourseRequest` экспортирован, но не вызывается; PATCH предметов/семестров на клиенте не реализован вовсе.

### C-02 Дисциплины студента: список и рабочее место курса

- Бизнес-цель: дать студенту единый экран по каждой дисциплине — ближайшие пары, преподаватель, материалы, задания, оценки, посещаемость, участники.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/courses`, `/courses/[subject]` (ключ — строка `subject`, закодирована в URL).
- Завершение: экран отрисован (только чтение).
- Шаги и файлы: `apps/web/src/app/(student)/courses/page.tsx`, `apps/web/src/app/(student)/courses/[subject]/page.tsx`, `apps/web/src/views/courses/ui/{courses-view,course-view,material-row}.tsx`, `apps/web/src/views/courses/lib/build-courses.ts` (агрегация пар расписания + материалов + курсов); API: `GET /schedule`, `GET /materials`, `GET /courses`, `GET /assignments?courseId=`, `GET /gradebook/me`, `GET /attendance/me`.
- Данные на входе / выходе: группа из JWT → карточки дисциплин (ближайшая пара, число материалов, статусы заданий, % оценок).
- Внешние зависимости: нет (только API).
- Тесты: нет.
- Замечено: дисциплина склеивается по строке `Pair.subject`/`Material.subject` с `Course.subject.name` — FK `Pair→Course` нет (`prisma/schema/03-schedule.prisma`), переименование предмета рвёт связку.

### C-03 Учебный план и академический профиль студента

- Бизнес-цель: показать студенту траекторию обучения — дисциплины по семестрам, кредиты, прогресс, итоги (учебный план) и сводку успеваемости/посещаемости/экзаменов/долгов (академический профиль).
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/study-plan`, `/academic`.
- Завершение: экран отрисован (только чтение); статус дисциплины вычисляется на клиенте (`term.isActive` → «изучается», % по опубликованным оценкам).
- Шаги и файлы: `apps/web/src/views/study-plan/ui/study-plan-view.tsx` (`GET /courses` + `GET /gradebook/me`), `apps/web/src/views/academic/ui/academic-view.tsx` (`GET /users/me`, `GET /gradebook/me`, `GET /attendance/me`, `GET /exams`, `GET /assignments`).
- Данные на входе / выходе: курсы группы с семестром/кредитами + опубликованные оценки → таблица плана, метрики (кредиты, средний %).
- Внешние зависимости: нет.
- Тесты: нет.
- Замечено: отдельной модели ИУП/учебного плана нет — план = курсы группы; выбор элективов и индивидуальная траектория не поддерживаются.

### C-04 Составление и публикация расписания группы (версии, пары, конфликты)

- Бизнес-цель: собрать недельную сетку пар группы с учётом чётности недели и опубликовать её как единственную активную версию без пересечений по группе, преподавателю и аудитории.
- Роли: DEAN, UNIVERSITY_ADMIN, PLATFORM_ADMIN (версии и любые пары в scope); TEACHER (только свои пары в группах, где ведёт курс).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/dean/schedule`, `/university-admin/schedule`, `/teacher/schedule` (`ScheduleManageView mode="teacher"`).
- Завершение: версия создана/активирована (прочие версии группы деактивируются в транзакции), пара сохранена; при пересечении — `409 CONFLICT` с `details[]` по полям `groupId/teacherId/roomId`; аудит.
- Шаги и файлы: `apps/api/src/modules/schedules/{schedules,pairs}.controller.ts`, `schedules.service.ts` (`createSchedule/updateSchedule/removeSchedule`, `createPair/updatePair/removePair`, `assertNoConflict`, `assertTeacherPairScope`, `assertTeachesGroup`); `GET|POST /schedules`, `GET|PATCH|DELETE /schedules/:id`, `POST /pairs`, `PATCH|DELETE /pairs/:id`; web `apps/web/src/views/schedule/ui/schedule-manage-view.tsx`, `apps/web/src/features/manage-schedule/ui/{manage-schedule,schedule-editor,add-pair-modal,create-version-modal,schedule-day-list}.tsx`, `apps/web/src/entities/schedule/api/schedule-api.ts`; схема `prisma/schema/03-schedule.prisma`.
- Данные на входе / выходе: `{groupId,name,isActive}`; пара `{scheduleId,groupId,subject,teacherId?,roomId?,dayOfWeek,startTime,endTime,weekType ODD|EVEN|BOTH}` → `Schedule`, `Pair`.
- Внешние зависимости: PostgreSQL; `AuditService`; `RoomService` (аудитория своего вуза).
- Тесты: `apps/api/src/modules/schedules/schedules.service.spec.ts` (конфликты, чётность, scope преподавателя); `apps/web/e2e/schedule.e2e.ts` (декан добавляет пару).
- Замечено: правка/удаление самих пар не шлёт ни WS, ни уведомлений — студенты узнают о перестройке сетки только при перезагрузке.

### C-05 Разовые изменения расписания: перенос, замена, смена аудитории, отмена

- Бизнес-цель: оперативно сообщить группе и преподавателям об изменении конкретного занятия на конкретную дату, не трогая базовую сетку.
- Роли: DEAN, UNIVERSITY_ADMIN, PLATFORM_ADMIN (создают); получатели — студенты группы, преподаватель пары и заменяющий.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI модалка пары в `/dean/schedule`, `/university-admin/schedule` → `POST /schedule/changes`; очередь `notifications`, job `schedule-changed`.
- Завершение: запись `ScheduleChange`, аудит `schedule_change_created`, WS `schedule:changed` + конверт `schedule.lesson.updated` в комнату `group:<id>`, in-app/push-уведомление `SCHEDULE_CHANGE` (dedupe `schedule-changed:<changeId>`).
- Шаги и файлы: `apps/api/src/modules/schedules/schedule-view.controller.ts`, `schedules.service.ts` (`createChange`, `enqueueChangeNotification`, `listChanges`); `apps/api/src/modules/notifications/notifications.processor.ts`; web `apps/web/src/features/manage-schedule/ui/pair-details-modal.tsx`, наложение в `apps/web/src/widgets/schedule-grid/ui/schedule-grid.tsx`, `apps/web/src/widgets/today/ui/{student,teacher,dean}-today.tsx`.
- Данные на входе / выходе: `{pairId,date,type MOVED|ROOM_CHANGED|CANCELLED|SUBSTITUTED,newRoomId?,newTeacherId?,newStartTime?,newEndTime?,note?}` → `ScheduleChange`, `GET /schedule/changes?from=&to=`.
- Внешние зависимости: Redis/BullMQ (очередь уведомлений), Socket.IO (`RealtimeGateway`), push-провайдеры через модуль уведомлений.
- Тесты: `apps/api/src/modules/schedules/schedules.service.spec.ts` (createChange: БД + WS + job); `apps/api/src/modules/notifications/notifications.processor.spec.ts` (общая обработка очереди).
- Замечено: WS уходит только в `group:<id>`, а преподаватель в JWT не несёт groupId — `teacher-today.tsx` подписан на `schedule:changed`, но живого обновления не получит; изменение нельзя отменить/исправить (нет PATCH/DELETE `/schedule/changes/:id`).

### C-06 Просмотр расписания по роли

- Бизнес-цель: показать каждому «своё» расписание в таймзоне вуза: студенту/старосте — группы, преподавателю — свои пары, декану — факультет, админу — вуз; с учётом чётности недели и наложенных изменений.
- Роли: STUDENT, STAROSTA, TEACHER, DEAN, UNIVERSITY_ADMIN/MODERATOR, PLATFORM_ADMIN.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/schedule`, `/starosta/schedule` (`ScheduleView`), сетка в `ScheduleManageView` для персонала; `GET /schedule`, `GET /schedule/changes`, `GET /me/today` (BFF «Сегодня»).
- Завершение: сетка отрисована; при WS `schedule:changed` перезапрашиваются только изменения.
- Шаги и файлы: `apps/api/src/modules/schedules/schedules.service.ts` (`getSchedule` + `buildReadWhere` — scope из JWT, `take: 500`, `resolveViewerTimezone`); `apps/api/src/modules/me/me.service.ts`; web `apps/web/src/views/schedule/ui/schedule-view.tsx`, `apps/web/src/widgets/schedule-grid/ui/schedule-grid.tsx`, `apps/web/src/entities/schedule/lib/{day,layout-columns}.ts`, `apps/web/src/widgets/today/`.
- Данные на входе / выходе: фильтры `groupId/teacherId/roomId/dayOfWeek/weekType/subject` → `{timezone, pairs[]}` + список `ScheduleChange`.
- Внешние зависимости: Socket.IO (живое обновление).
- Тесты: `apps/api/src/modules/schedules/schedules.service.spec.ts` (ролевая выборка, подмена groupId студентом, чётность); `apps/web/src/widgets/today/lib/schedule-day.test.ts`, `apps/web/src/widgets/today/ui/next-pair-card.test.tsx`, `apps/web/src/widgets/today/lib/attention.test.ts`; `apps/web/e2e/a11y.e2e.ts` (доступность `/schedule`, `/dean/schedule`).
- Замечено: `isoWeekParity` (`apps/web/src/shared/lib/tz-date.ts`) считает неделю от 4 января без поправки на его день недели — номер недели расходится с ISO 8601 (известный открытый вопрос).

### C-07 Календарь и «Дела» студента

- Бизнес-цель: свести в одну ленту времени пары (с изменениями), дедлайны заданий, события вуза и заявки — чтобы студент видел, что и когда ему нужно сделать.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/calendar`, `/tasks`.
- Завершение: экран отрисован (только чтение, агрегация на клиенте).
- Шаги и файлы: `apps/web/src/views/calendar/ui/calendar-view.tsx` + `lib/calendar-events.ts` (`GET /schedule`, `GET /schedule/changes`, `GET /events`, `GET /assignments`); `apps/web/src/views/tasks/ui/tasks-view.tsx` + `lib/tasks.ts` (`GET /schedule`, заявки, `GET /events`, `GET /assignments`).
- Данные на входе / выходе: ответы доменных API → события календаря / список дел с приоритетом по сроку.
- Внешние зависимости: нет.
- Тесты: `apps/web/src/views/calendar/lib/calendar-events.test.ts`, `apps/web/src/views/tasks/lib/tasks.test.ts`.
- Замечено: календарь не тянет экзамены и консультации, хотя PROJECT.md §3.1 называет их «особыми событиями» расписания.

### C-08 Отметка посещаемости преподавателем (журнал занятия)

- Бизнес-цель: зафиксировать присутствие студентов на конкретном занятии в конкретную дату (PRESENT/LATE/ABSENT/EXCUSED) и подсветить преподавателю ещё не отмеченные пары.
- Роли: TEACHER (только свои пары), DEAN (факультет), UNIVERSITY_ADMIN, PLATFORM_ADMIN; STAROSTA отмечать не может.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/attendance`, карточка «Отметить посещаемость» на главной преподавателя (`widgets/today/ui/teacher-actions.tsx`).
- Завершение: upsert отметок в транзакции (`markedById` = актор), аудит; повторное сохранение перезаписывает статус.
- Шаги и файлы: `apps/api/src/modules/attendance/attendance.controller.ts`, `attendance.service.ts` (`roster`, `marked`, `mark`, `assertManagePair`); `GET /attendance/roster?pairId=&date=`, `GET /attendance/marked?date=&pairIds=`, `PUT /attendance`; web `apps/web/src/views/attendance/ui/{teacher-attendance-view,attendance-roster}.tsx`, `apps/web/src/views/attendance/lib/status-visuals.ts`, `apps/web/src/entities/attendance/api/attendance-api.ts`; схема `prisma/schema/19-attendance.prisma`.
- Данные на входе / выходе: `{pairId,date,entries:[{studentId,status,note?}]}` → строки `Attendance` (`@@unique([pairId,date,studentId])`); ростер — студенты группы + текущие отметки.
- Внешние зависимости: PostgreSQL; `AuditService`.
- Тесты: нет (у модуля `attendance` нет ни одного spec; косвенно — `apps/api/src/modules/analytics/analytics.service.spec.ts`).
- Замечено: `GET /attendance/marked` не проверяет scope пар (сознательно, отдаёт лишь факт отметки); дата не сверяется с днём недели пары и отменами из `ScheduleChange`.

### C-09 QR-самоотметка студента на занятии

- Бизнес-цель: ускорить перекличку — преподаватель показывает QR, студенты сами отмечаются как присутствующие.
- Роли: TEACHER/DEAN/UNIVERSITY_ADMIN/PLATFORM_ADMIN (выдают QR); STUDENT, STAROSTA (сканируют).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI модалка QR в `/teacher/attendance` → `GET /attendance/qr?pairId=&date=`; студент открывает ссылку `/checkin?t=<token>` → `POST /attendance/check-in`.
- Завершение: создана отметка `PRESENT` (`markedById = null`) или возвращена существующая (`already: true`, без перезаписи); аудит; истёкший токен → `400`, подделанный → `401`.
- Шаги и файлы: `apps/api/src/modules/attendance/attendance.service.ts` (`createQrToken`, `checkIn`, `verifyQrToken`, ключ = sha256(`JWT_ACCESS_SECRET` + `:attendance-qr:v1`), TTL 90 с), `apps/api/src/common/crypto/signed-token.ts`; web `apps/web/src/views/attendance/ui/{attendance-qr-modal,checkin-view}.tsx`, `apps/web/src/app/(student)/checkin/page.tsx`.
- Данные на входе / выходе: `{pairId,date}` → `{token, qr (data-URL), checkinUrl, ttlSeconds}`; `{token}` → `{status, subject, date, already}`.
- Внешние зависимости: генерация QR-картинки на сервере; `CORS_ORIGIN` (база ссылки в QR).
- Тесты: `apps/api/src/common/crypto/signed-token.spec.ts` (подпись/истечение токена); сценарий check-in не покрыт.
- Замечено: токен stateless и без привязки к устройству/месту — в пределах 90 с скрин QR можно переслать отсутствующему одногруппнику.

### C-10 Сводка посещаемости студента

- Бизнес-цель: показать студенту его посещаемость (процент, пропуски, опоздания) по периоду и по дисциплинам.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/attendance`, блоки на `/academic` и `/courses/[subject]`; `GET /attendance/me?from=&to=`.
- Завершение: экран отрисован (только чтение).
- Шаги и файлы: `apps/api/src/modules/attendance/attendance.service.ts` (`studentSummary`); web `apps/web/src/views/attendance/ui/student-attendance-view.tsx`, `apps/web/src/app/(student)/attendance/page.tsx`.
- Данные на входе / выходе: период → `{total,present,late,absent,excused,rate,recent[≤100]}`.
- Внешние зависимости: нет.
- Тесты: нет.
- Замечено: счётчики строятся по `findMany(..., take: 2000)` вместо `groupBy` — за несколько лет учёбы без фильтра периода статистика молча обрежется.

### C-11 Ведение журнала оценок: контрольные точки и выставление баллов

- Бизнес-цель: преподаватель ведёт по курсу журнал из колонок (лабораторные, контрольные, экзамен) и выставляет баллы; студенты видят оценку только после публикации колонки.
- Роли: TEACHER (только свои курсы), DEAN (факультет), UNIVERSITY_ADMIN, PLATFORM_ADMIN (через API; UI — только у преподавателя).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/gradebook`.
- Завершение: оценки сохранены (upsert, `score=null` удаляет); колонка опубликована → WS-конверт `grade.published` каждому студенту с оценкой в ней; удаление опубликованной колонки с оценками — `409 CONFLICT`; аудит.
- Шаги и файлы: `apps/api/src/modules/gradebook/gradebook.controller.ts`, `gradebook.service.ts` (`gradebook`, `createColumn/updateColumn/deleteColumn`, `setPublished`, `saveGrades`, `assertManage`); `GET /gradebook/course/:courseId`, `POST /gradebook/columns`, `PATCH|DELETE /gradebook/columns/:id`, `POST /gradebook/columns/:id/publish|unpublish`, `PUT /gradebook/grades`; web `apps/web/src/views/gradebook/ui/{gradebook-view,gradebook-table,add-column-modal}.tsx`, `apps/web/src/entities/gradebook/api/gradebook-api.ts`; схемы `prisma/schema/20-gradebook.prisma`, `packages/shared-schemas/src/gradebook.ts`.
- Данные на входе / выходе: колонка `{courseId,title,kind LAB|CONTROL|EXAM|OTHER,maxScore?,position}`; `{columnId,entries:[{studentId,score|null}]}` → матрица «студенты × колонки».
- Внешние зависимости: Socket.IO (`RealtimeGateway.emitEventToUser`); `AuditService`.
- Тесты: `apps/api/src/modules/gradebook/gradebook.service.spec.ts` (только `deleteColumn`); `apps/web/src/shared/realtime/realtime-context.test.tsx` (доставка `grade.published`).
- Замечено: сервер не сверяет балл с `maxScore` колонки (схема пропускает 0..1000); правка оценок в уже опубликованной колонке студенту ни WS, ни уведомлением не сообщается.

### C-12 Оценки студента

- Бизнес-цель: студент видит свои опубликованные оценки по дисциплинам и средний процент, вживую обновляемые при публикации.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/grades`, блоки на `/academic`, `/study-plan`, `/courses/[subject]`; `GET /gradebook/me`; WS `grade.published`.
- Завершение: экран отрисован; при `grade.published` запрос перезапрашивается.
- Шаги и файлы: `apps/api/src/modules/gradebook/gradebook.service.ts` (`myGrades` — только `published` колонки); web `apps/web/src/views/student-grades/ui/student-grades-view.tsx`, `apps/web/src/app/(student)/grades/page.tsx`.
- Данные на входе / выходе: JWT студента → `MyGradesCourse[]` (курс, колонки, балл/макс).
- Внешние зависимости: Socket.IO.
- Тесты: `apps/web/src/shared/realtime/realtime-context.test.tsx` (косвенно); на `myGrades` — нет.

### C-13 Задание: создание, публикация, закрытие

- Бизнес-цель: преподаватель ставит группе задание по курсу (тип, формат сдачи, макс. балл, попытки, срок, поздняя сдача), публикует его и закрывает приём.
- Роли: TEACHER (свой курс), DEAN (факультет), UNIVERSITY_ADMIN, PLATFORM_ADMIN; получатели — студенты/староста группы курса.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/assignments` (модалка создания); очередь `notifications`, job `ASSIGNMENT_PUBLISHED`.
- Завершение: `Assignment` в статусе DRAFT → PUBLISHED (`publishAt = now`, уведомление группе, dedupe `assignment-published:<id>`) → CLOSED; удаление каскадом сносит сдачи; аудит.
- Шаги и файлы: `apps/api/src/modules/assignments/assignments.controller.ts`, `assignments.service.ts` (`create`, `update`, `setStatus`, `notifyPublished`, `remove`, `scopeWhere`, `assertManageCourse`); `GET|POST /assignments`, `GET|PATCH|DELETE /assignments/:id`, `POST /assignments/:id/publish|close`; web `apps/web/src/views/assignments/ui/{teacher-assignments-view,create-assignment-modal}.tsx`, `apps/web/src/entities/assignment/api/assignment-api.ts`; схемы `prisma/schema/18-assignments.prisma`, `packages/shared-schemas/src/assignments.ts`.
- Данные на входе / выходе: `{courseId,title,description?,type,submissionType,maxScore?,maxAttempts?,allowLate?,publishAt?,dueAt?}` → `Assignment`; студенту в списке видны только PUBLISHED/CLOSED своей группы + `mySubmission`.
- Внешние зависимости: Redis/BullMQ (уведомления); `AuditService`.
- Тесты: нет (на создание/публикацию; см. C-14/C-15).
- Замечено: поле `publishAt` только хранится — отложенной публикации нет (ни cron, ни фильтра по времени), задание публикуется лишь кнопкой.

### C-14 Сдача работы студентом

- Бизнес-цель: студент готовит черновик ответа (текст/ссылка) и отправляет его на проверку в срок; после возврата — дорабатывает и пересдаёт.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/assignments` (список + карточка задания), дедлайны также в `/calendar`, `/tasks`, `/courses/[subject]`.
- Завершение: `Submission` DRAFT/RETURNED → SUBMITTED (`submittedAt`, `attemptNumber+1` после возврата); пустая работа → `VALIDATION_ERROR`; после срока без `allowLate` → `409 CONFLICT` (возвращённую можно сдать и после срока).
- Шаги и файлы: `apps/api/src/modules/assignments/assignments.service.ts` (`saveDraft`, `submit`, `assertStudentCanSubmit`); `PUT /assignments/:id/submission`, `POST /assignments/:id/submit`; web `apps/web/src/views/assignments/ui/{student-assignments-view,student-assignment-detail}.tsx`, `apps/web/src/views/assignments/lib/assignment-status.ts`, `apps/web/src/entities/assignment/lib/status.ts`.
- Данные на входе / выходе: `{text?,linkUrl?}` → `Submission` (`@@unique([assignmentId,studentId])`).
- Внешние зависимости: нет.
- Тесты: `apps/api/src/modules/assignments/submit-deadline.spec.ts`; `apps/web/src/entities/assignment/lib/status.test.ts`.
- Замечено: `maxAttempts` нигде не проверяется — пересдавать после возврата можно бесконечно; файловых вложений у сдачи нет (только текст и ссылка), преподавателю о новой сдаче не сообщается.

### C-15 Проверка работ: очередь, оценка, возврат на доработку

- Бизнес-цель: преподаватель видит, сколько работ ждёт проверки, оценивает их с отзывом или возвращает на доработку; студент получает уведомление.
- Роли: TEACHER, DEAN, UNIVERSITY_ADMIN, PLATFORM_ADMIN (scope как у списка заданий).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/assignments` (рабочее место проверки), карточка «На проверке» на главной преподавателя; очередь `notifications`, job `ASSIGNMENT_GRADED`.
- Завершение: SUBMITTED → GRADED (`score`, `feedback`, `gradedById`) или → RETURNED (`feedback`); уведомление студенту (dedupe по `submissionId:attemptNumber`); аудит; повторная проверка не SUBMITTED-работы → `409`.
- Шаги и файлы: `apps/api/src/modules/assignments/{assignments,submissions}.controller.ts`, `assignments.service.ts` (`reviewQueue`, `submissions`, `grade`, `returnForFix`, `notifyStudent`); `GET /assignments/review-queue?limit=`, `GET /assignments/:id/submissions`, `POST /submissions/:id/grade`, `POST /submissions/:id/return`; web `apps/web/src/views/assignments/ui/{grading-workspace,grade-submission-modal}.tsx`, `apps/web/src/widgets/today/ui/teacher-actions.tsx`.
- Данные на входе / выходе: `{score 0..1000, feedback?}` / `{feedback}` → обновлённый `Submission`; очередь → `{total, items[{id,title,subject,dueAt,pending}]}`.
- Внешние зависимости: Redis/BullMQ (уведомления); `AuditService`.
- Тесты: `apps/api/src/modules/assignments/review-queue.spec.ts` (роли и порядок маршрутов).
- Замечено: балл не сверяется с `Assignment.maxScore`; оценка за задание не попадает в журнал (`GradeColumn`/`Grade`) — два независимых контура оценивания.

### C-16 Экзаменационная сессия: планирование экзаменов

- Бизнес-цель: назначить группе экзамены по курсам — дата, формат, аудитория, экзаменатор, макс. балл — и показать студентам их сессию.
- Роли: DEAN, TEACHER (ведущий курс), UNIVERSITY_ADMIN, PLATFORM_ADMIN — создают/правят; экзаменатор править экзамен не может; STUDENT/STAROSTA — смотрят.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/dean/exams`, `/teacher/exams` (`ExamManagementView`), студент — `/exams`, блок на `/academic`.
- Завершение: `Exam` создан/изменён; удаление экзамена с результатами — `409 CONFLICT`; аудит; студент видит экзамен с полем `myResult`.
- Шаги и файлы: `apps/api/src/modules/exams/exams.controller.ts`, `exams.service.ts` (`list` take 200, `getById`, `create`, `update`, `remove`, `scopeWhere`, `assertManageCourse`, проверки экзаменатора/аудитории своего вуза); `GET|POST /exams`, `GET|PATCH|DELETE /exams/:id`; web `apps/web/src/views/exams/ui/{exam-management-view,create-exam-modal,student-exams-view}.tsx`, `apps/web/src/views/exams/lib/visuals.ts`, `apps/web/src/entities/exam/api/exam-api.ts`; схема `prisma/schema/21-exams.prisma`.
- Данные на входе / выходе: `{courseId,groupId,date,format ORAL|WRITTEN|TEST|PROJECT|OTHER,roomId?,examinerId?,maxScore?,note?}` → `Exam`.
- Внешние зависимости: PostgreSQL; `AuditService`; `RoomService`/таблица аудиторий.
- Тесты: `apps/api/src/modules/exams/exams-remove.spec.ts`, `apps/api/src/modules/exams/exams-room.spec.ts`, `apps/api/src/modules/exams/exams.service.spec.ts` (права экзаменатора).
- Замечено: ни назначение, ни перенос экзамена не шлют студентам уведомлений/WS; экзамены не попадают в `/calendar` и сетку расписания (возможен конфликт аудитории с парой — проверки нет).

### C-17 Ведомость экзамена: допуск, результаты, пересдачи

- Бизнес-цель: экзаменатор или ведущий курс заполняет ведомость группы — допуск, статус (сдал/не сдал/неявка/пересдача), балл, примечание; студент видит свой результат.
- Роли: TEACHER (ведущий курс или назначенный экзаменатор), DEAN, UNIVERSITY_ADMIN, PLATFORM_ADMIN; STUDENT/STAROSTA — чтение своего `myResult`.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI ведомость в `/dean/exams`, `/teacher/exams`; `GET /exams/:id/results`, `PUT /exams/results`.
- Завершение: upsert `ExamResult` по каждому студенту в транзакции, аудит `exam_results_set`, ответ — обновлённая ведомость.
- Шаги и файлы: `apps/api/src/modules/exams/exams.service.ts` (`results`, `setResults`, `findManageable(..., {examiner:true})`); web `apps/web/src/views/exams/ui/exam-results-roster.tsx`, `student-exams-view.tsx`; схема `packages/shared-schemas/src/exams.ts`.
- Данные на входе / выходе: `{examId, entries:[{studentId,admitted,status SCHEDULED|PASSED|FAILED|ABSENT|RETAKE,score?,note?}]}` → строки `ExamResult` (`@@unique([examId,studentId])`).
- Внешние зависимости: `AuditService`.
- Тесты: `apps/api/src/modules/exams/exams.service.spec.ts` (экзаменатор открывает и заполняет ведомость, посторонний — нет).
- Замечено: поле `ExamResult.attempt` никогда не пишется (всегда 1) — бейдж «попытка N» в `student-exams-view.tsx` недостижим, история пересдач затирается upsert'ом; балл не сверяется с `Exam.maxScore`, `admitted=false` + `PASSED` не запрещено; студенту о результате не сообщается.

### C-18 Консультации: слоты преподавателя и запись студентов

- Бизнес-цель: преподаватель публикует окна приёма, студент своего вуза выбирает преподавателя и записывается в свободный слот с темой; обе стороны могут отменить.
- Роли: TEACHER, DEAN (создают/удаляют/отменяют свои слоты; UI — только у преподавателя); STUDENT, STAROSTA (запись/снятие записи).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/consultations`, `/consultations`; очередь `notifications`, jobs `CONSULTATION_BOOKED`, `CONSULTATION_CANCELLED`.
- Завершение: слот OPEN → BOOKED (условный `updateMany` только из OPEN, гонка → `409`) (уведомление преподавателю) → отмена студентом возвращает OPEN, отмена/удаление преподавателем → CANCELLED + уведомление записанному студенту; прошедший слот записать нельзя; аудит.
- Шаги и файлы: `apps/api/src/modules/consultations/consultations.controller.ts`, `consultations.service.ts` (`createSlot`, `deleteSlot`, `listMine` + `slotOrderBy`, `listTeachers`, `listTeacherSlots`, `book`, `cancel`); `GET /consultations/mine`, `GET /consultations/teachers`, `GET /consultations/slots?teacherId=`, `POST /consultations/slots`, `DELETE /consultations/slots/:id`, `POST /consultations/slots/:id/book|cancel`; web `apps/web/src/views/consultations/ui/{teacher-consultations-view,create-slot-modal,student-consultations-view,book-slot-modal}.tsx`, `apps/web/src/entities/consultation/api/consultation-api.ts`; схема `prisma/schema/22-consultations.prisma`.
- Данные на входе / выходе: `{startsAt,endsAt,location?,isOnline?}`; `{topic?}` → `ConsultationSlot` (OPEN|BOOKED|CANCELLED); `mine` — `Paginated` с серверной сортировкой `startsAt|status|student`.
- Внешние зависимости: Redis/BullMQ (уведомления, время в таймзоне вуза); `AuditService`.
- Тесты: `apps/api/src/modules/consultations/consultations.service.spec.ts` (сортировка, гонка записи, удалённый преподаватель, отмена отменённого).
- Замечено: при создании слота не проверяются пересечения с другими слотами и парами преподавателя и дата в прошлом (схема сверяет только `endsAt > startsAt`); напоминаний перед консультацией нет.

### C-19 Запись в деканат (очередь приёма)

- Бизнес-цель: студент просит приём в деканате (консультация, документы, учебный вопрос) на желаемое время; сотрудник деканата подтверждает/переносит с точным временем, завершает или отменяет приём.
- Роли: STUDENT, STAROSTA (заявка, отмена своей); DEAN (UI), UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, PLATFORM_ADMIN (через API).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/appointments` (студент), `/dean/appointments` (очередь факультета); очередь `notifications`, job `APPOINTMENT_UPDATED`.
- Завершение: статусы по таблице `TRANSITIONS` — REQUESTED → CONFIRMED/RESCHEDULED → COMPLETED, отмена из любого незавершённого; COMPLETED/CANCELLED конечные (иначе `409`); при подтверждении назначается `assignedToId`, студенту — уведомление со временем в поясе вуза; аудит.
- Шаги и файлы: `apps/api/src/modules/appointments/appointments.controller.ts`, `appointments.service.ts` (`create` — факультет из JWT, `listMine` take 200, `cancelMine`, `listQueue` take 300, `confirm`, `setStatus`, `assertTransition`, `scopeWhere`); `POST /deanery-appointments`, `GET /deanery-appointments/mine`, `POST /deanery-appointments/:id/cancel`, `GET /deanery-appointments/queue`, `POST /deanery-appointments/:id/{confirm,reschedule,complete,staff-cancel}`; web `apps/web/src/views/appointments/ui/{student-appointments-view,create-appointment-modal,dean-appointments-view,confirm-appointment-modal}.tsx`, `apps/web/src/entities/appointment/api/appointment-api.ts`; схема `prisma/schema/23-appointments.prisma`.
- Данные на входе / выходе: `{type CONSULTATION|DOCUMENT|ACADEMIC|OTHER,requestedAt,topic?,applicationId?}`; `{scheduledAt,staffNote?}` → `DeaneryAppointment`.
- Внешние зависимости: Redis/BullMQ (уведомления); `AuditService`.
- Тесты: `apps/api/src/modules/appointments/appointments.service.spec.ts` (переходы статусов, условное подтверждение, пояс вуза).
- Замечено: о новой заявке деканат не уведомляется (только опрос очереди); `applicationId` — мягкая ссылка без FK и без проверки, что заявка принадлежит студенту, а в UI создания поле не передаётся.

### C-20 Учебные материалы курса: публикация и скачивание

- Бизнес-цель: преподаватель выкладывает группе материалы (описание, внешняя ссылка, файлы), студенты группы видят их на странице дисциплины и скачивают по подписанной ссылке.
- Роли: TEACHER (свои материалы, группы своего вуза), DEAN (факультет), UNIVERSITY_ADMIN, PLATFORM_ADMIN — публикуют/удаляют; STUDENT, STAROSTA — читают материалы своей группы.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/materials` (создание, загрузка файлов, удаление), студент — вкладка «Материалы» в `/courses/[subject]`; cron `CleanupService` чистит файлы без материала.
- Завершение: `Material` создан, файлы привязаны (`File.materialId`, бакет `MINIO_BUCKET_MATERIALS`); удаление материала → у файлов `materialId = null`, объекты удаляет cron; аудит.
- Шаги и файлы: `apps/api/src/modules/materials/materials.controller.ts`, `materials.service.ts` (`create`, `list` take 200 + `scopeWhere`, `presignFile`, `confirmFile`, `addFile`, `getFileUrl` + `MediaService.describeOne`, `remove`); `GET|POST /materials`, `POST /materials/:id/files/presign`, `POST /materials/:id/files/confirm`, `POST /materials/:id/files` (multipart), `GET /materials/:id/files/:fileId/presigned`, `DELETE /materials/:id`; `apps/api/src/modules/files/file.service.ts`, `apps/api/src/modules/cleanup/cleanup.service.ts`; web `apps/web/src/views/materials/ui/{materials-view,create-material-modal,material-detail-modal}.tsx`, `apps/web/src/views/courses/ui/material-row.tsx`, `apps/web/src/entities/material/api/material-api.ts`; схема `prisma/schema/12-materials.prisma`.
- Данные на входе / выходе: `{groupId,title,description?,subject?,url?}` + файлы (presign `{mime}` → PUT в MinIO → confirm) → `Material` с `media[]`; выдача — подписанный URL + описание медиа.
- Внешние зависимости: MinIO (presigned PUT/GET), медиа-система (`MediaService`, варианты/превью), cron очистки.
- Тесты: `apps/api/src/modules/materials/materials.service.spec.ts` (scope чтения, создание в чужом вузе, удаление чужого, `getFileUrl`); `apps/api/src/modules/files/file.service.spec.ts` (привязка файла к материалу).
- Замечено: материал привязан к группе и свободной строке `subject`, а не к `Course` — на странице дисциплины склейка по названию; редактирования материала (PATCH) нет; группа о новом материале не уведомляется.
