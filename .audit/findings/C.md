## Группа C — аудит

### Статусы процессов

| Процесс                                       | Статус                | Коротко                                                                                                                                                                                                                                          |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-01 Справочники: дисциплины, семестры, курсы | сломан                | Курс из UI нельзя связать с преподавателем — ни в создании, ни правкой (C-F01); в модалке только текущая страница предметов/семестров и 100 групп (C-F02); удаление курса теряет ведомости без баллов (C-F03); дубли курсов без семестра (C-F04) |
| C-02 Дисциплины студента                      | работает с проблемами | Склейка по строке названия, курсы разных семестров путаются (C-F25); посещаемость по дисциплине из последних 100 отметок (C-F14); материалы режутся на 200 (C-F18)                                                                               |
| C-03 Учебный план и академ. профиль           | работает с проблемами | «Пройдена/Не сдана» по первой оценке активного семестра (C-F26); задания в профиле — 100 самых ранних (C-F17)                                                                                                                                    |
| C-04 Составление расписания                   | работает с проблемами | Удаление пары/версии каскадом стирает посещаемость (C-F11); новая версия сразу активна и гасит текущую (C-F13); гонка конфликтов, преподаватель-студент (C-F27)                                                                                  |
| C-05 Разовые изменения                        | работает с проблемами | Замена не видна заменяющему (C-F12); изменения нельзя отменить, нет проверки конфликтов, WS не доходит до преподавателя (C-F16)                                                                                                                  |
| C-06 Просмотр расписания                      | работает с проблемами | Заменяющий не видит пару (C-F12); после «новой версии» — пустая сетка (C-F13); правило чётности не задокументировано (C-F25)                                                                                                                     |
| C-07 Календарь и «Дела»                       | работает с проблемами | Задания — 100 самых ранних по сроку, на «Сегодня» — 20 (C-F17); нет экзаменов и консультаций (C-F22)                                                                                                                                             |
| C-08 Отметка посещаемости                     | работает с проблемами | Заменяющий не может отметить (C-F12); дата не сверяется с парой/отменами (C-F15); история гибнет при удалении пары (C-F11); тестов нет (C-F29)                                                                                                   |
| C-09 QR-самоотметка                           | работает с проблемами | QR на любую дату, без окна времени и проверки отмены (C-F15)                                                                                                                                                                                     |
| C-10 Сводка посещаемости                      | работает с проблемами | Счётчики по `take: 2000` без сортировки, разные формулы процента (C-F14)                                                                                                                                                                         |
| C-11 Журнал оценок                            | работает с проблемами | Балл не сверяется с максимумом (C-F08); сохранение колонки целиком затирает чужие правки, аудит без значений (C-F21)                                                                                                                             |
| C-12 Оценки студента                          | работает с проблемами | Процент может быть > 100 % (C-F08); после перевода в другую группу оценки пропадают, правки опубликованных не приходят вживую (C-F21)                                                                                                            |
| C-13 Задание: создание/публикация/закрытие    | работает с проблемами | «Удалить» стирает все сданные работы (C-F07); тип «Файл» несдаваем (C-F06); `publishAt`/`maxAttempts` не работают, правки нет (C-F20)                                                                                                            |
| C-14 Сдача работы                             | работает с проблемами | При типе «Файл» сдать невозможно (C-F06); 2-й семестр — новые задания не видны (C-F17); попытки не ограничены и затирают прошлые (C-F20)                                                                                                         |
| C-15 Проверка работ                           | работает с проблемами | Балл без проверки `maxScore` (C-F08); переоценка невозможна, гонка оценить/вернуть (C-F20)                                                                                                                                                       |
| C-16 Планирование экзаменов                   | работает с проблемами | Список декана/админа обрезается на 200 самых старых (C-F09); нет уведомлений и проверок пересечений (C-F22)                                                                                                                                      |
| C-17 Ведомость экзамена                       | работает с проблемами | Пересдача затирает первую попытку (C-F10); балл/допуск не валидируются (C-F08); результат виден студенту без публикации (C-F22)                                                                                                                  |
| C-18 Консультации                             | работает              | Мелкое: слоты в прошлом и внахлёст, `listTeachers` из 5000 строк в памяти, двойное уведомление при отмене+удалении (C-F23)                                                                                                                       |
| C-19 Запись в деканат                         | работает с проблемами | Очередь вытесняется архивом после 300 строк (C-F19); деканат не уведомляется, `applicationId` не проверяется (C-F24)                                                                                                                             |
| C-20 Учебные материалы                        | работает с проблемами | `/teacher/materials` — 200 последних материалов всего вуза, у студента старые пропадают (C-F18); публикация в любую группу вуза (C-F27)                                                                                                          |

Итого: P0 — 2, P1 — 12, P2 — 16. Юнит-тесты модулей группы C (11 наборов, 66 тестов) проходят; e2e, lint, build не запускались.

### Проблемы

#### C-F01 [P0] Преподавателя нельзя назначить на дисциплину ни из одного клиента — преподавательские сценарии на новых курсах мертвы

- Процесс: C-01 (каскадно C-04, C-11, C-13, C-15, C-16, C-17)
- Где: apps/web/src/views/course-admin/ui/create-course-modal.tsx:59-146 (поля только subject/group/term/credits, `teacherId` в форме нет); apps/web/src/entities/course/api/course-api.ts:94-100 (`updateCourseRequest` экспортирован, `grep -rn updateCourseRequest apps/web/src` — только реэкспорт в entities/course/index.ts:15, вызовов нет); в apps/mini-app, apps/ios, apps/android обращений к `/courses` нет
- Суть: `Course.teacherId` выставляется только сидом. Курс, созданный админом/деканом через `/university-admin/courses` или `/dean/courses`, навсегда остаётся без преподавателя, а изменить его нельзя (PATCH /courses/:id из UI не вызывается). Все права преподавателя завязаны на `Course.teacherId`: задания (assignments.service.ts:439-441, 497-499), журнал (gradebook `assertManage`), экзамены (exams `assertManageCourse`), пары в группах (schedules `assertTeachesGroup`), поиск (search.service.ts:116), аналитика преподавателя (analytics.service.ts:382-449). На реальном вузе, заведённом через UI, преподаватель не увидит ни одного курса в `/teacher/gradebook`, `/teacher/assignments`, не создаст экзамен и не сможет добавить пару.
- Решение: добавить в `CreateCourseModal` выбор преподавателя (список TEACHER/DEAN вуза — тот же фильтр, что в `assertTeacherSameUniversity`) и модалку правки курса (преподаватель, семестр, кредиты) на `updateCourseRequest`; в таблице курсов — действие «Изменить». Серверная часть уже есть.
- Файлы для правки: apps/web/src/views/course-admin/ui/create-course-modal.tsx, apps/web/src/views/course-admin/ui/course-admin-view.tsx, новый apps/web/src/views/course-admin/ui/edit-course-modal.tsx, словари i18n CourseAdmin
- Стоп-точки: нет

#### C-F02 [P1] Модалка «Новый курс» предлагает только текущую страницу предметов/семестров и первые 100 групп

- Процесс: C-01
- Где: apps/web/src/views/course-admin/ui/course-admin-view.tsx:108-120 (subjects/terms — постраничные запросы таблиц, `limit` 20 по умолчанию), :420-424 (в модалку уходят `subjectRows`/`termRows` — строки ТЕКУЩЕЙ страницы вкладок), apps/web/src/entities/group/api/group-api.ts:33-35 (`fetchGroups` — `page:1, limit:100`)
- Суть: в выпадающем списке «Предмет» видны только 20 предметов текущей страницы вкладки «Предметы» (по умолчанию — первые 20 по алфавиту), в «Семестре» — 20 семестров текущей страницы, в «Группе» — первые 100 групп. В вузе с сотнями дисциплин и групп назначить курс по предмету «из конца алфавита» можно только, если догадаться перелистать скрытую вкладку. Неиспользуемые `fetchSubjects`/`fetchTerms` (course-api.ts:59-67) тоже ограничены 20 (дефолт `OffsetPaginationSchema`).
- Решение: в модалке использовать поисковые комбобоксы с серверным поиском (`/subjects?search=`, `/groups?search=`), семестры — отдельный запрос всех активных/последних семестров; удалить мёртвые `fetchSubjects`/`fetchTerms`.
- Файлы для правки: apps/web/src/views/course-admin/ui/create-course-modal.tsx, apps/web/src/views/course-admin/ui/course-admin-view.tsx, apps/web/src/entities/course/api/course-api.ts, apps/web/src/entities/course/index.ts
- Стоп-точки: нет

#### C-F03 [P1] Удаление курса стирает результаты экзаменов без балла (зачёт «сдал», «неявка», «не сдал»)

- Процесс: C-01, C-17
- Где: apps/api/src/modules/courses/courses.service.ts:357-370 (`examResult.count({ where: { exam: { courseId }, score: { not: null } } })`, затем `course.delete`); каскад Exam→Course и ExamResult→Exam
- Суть: гард «у дисциплины есть результаты экзаменов» считает только строки с баллом. Ведомость зачёта/устного экзамена обычно заполняется статусами PASSED/FAILED/ABSENT без балла (score необязателен в shared-schemas exams) — такой курс удаляется вместе с экзаменами и ведомостью без следа. То же для колонок журнала: проверяются только оценки с баллом (это корректно — null удаляет оценку), но не учитываются опубликованные колонки. Проверка и удаление — разными запросами без транзакции.
- Решение: считать `examResult` с `status <> 'SCHEDULED' OR score IS NOT NULL OR admitted = false`; посчитать и удалить в одной `$transaction`; добавить кейс в courses.service.spec.ts.
- Файлы для правки: apps/api/src/modules/courses/courses.service.ts, apps/api/src/modules/courses/courses.service.spec.ts
- Стоп-точки: нет

#### C-F04 [P2] Дубли курса без семестра: уникальность `[subjectId, groupId, termId]` не работает при `termId = NULL`

- Процесс: C-01
- Где: prisma/schema/17-courses.prisma:64; prisma/migrations/20260812120000_add_courses/migration.sql:73 (обычный UNIQUE INDEX, без `NULLS NOT DISTINCT`); create-course-modal.tsx:117-125 (вариант «без семестра» — по умолчанию)
- Суть: в Postgres NULL-ы различны, поэтому одну дисциплину без семестра можно назначить группе сколько угодно раз (двойной клик «Создать» тоже даёт дубль). Студент получает две одинаковые карточки, задания/журнал расползаются по двум курсам.
- Решение: миграция с `CREATE UNIQUE INDEX ... NULLS NOT DISTINCT` (PG15+) или частичный уникальный индекс `(subject_id, group_id) WHERE term_id IS NULL` (предварительно найти и слить дубли).
- Файлы для правки: prisma/schema/17-courses.prisma, новая миграция
- Стоп-точки: миграция

#### C-F05 [P2] Семестр: PATCH допускает `startsOn > endsOn`, «активных» семестров может быть сколько угодно

- Процесс: C-01, C-03
- Где: packages/shared-schemas/src/courses.ts:24-38 (у `UpdateTermSchema` нет refine, в отличие от Create :18-21); apps/api/src/modules/courses/courses.service.ts:234-256 (частичное обновление дат без сверки с сохранённой парой), :225,249 (`isActive` без сброса у остальных)
- Суть: правкой одной даты можно получить семестр, который кончается раньше начала. Несколько `isActive=true` одновременно ломают «текущие/прошлые» дисциплины в учебном плане (study-plan считает «изучается» по `term.isActive`). Плюс `deleteSubject` превращает любую ошибку БД в CONFLICT «используется в курсах» (courses.service.ts:191-193).
- Решение: в `updateTerm` сверять итоговые startsOn/endsOn; при `isActive=true` в транзакции снимать флаг с остальных семестров вуза (или явно разрешить несколько активных и задокументировать); в `deleteSubject` ловить только P2003.
- Файлы для правки: apps/api/src/modules/courses/courses.service.ts, apps/api/src/modules/courses/courses.service.spec.ts
- Стоп-точки: нет

#### C-F06 [P1] Задание с типом сдачи «Файл» сдать невозможно

- Процесс: C-13, C-14
- Где: apps/web/src/views/assignments/ui/create-assignment-modal.tsx:161-175 (в селекте все `SUBMISSION_TYPES`, включая FILE); apps/web/src/views/assignments/ui/student-assignment-detail.tsx:118-119 (`showText` только для TEXT/MIXED, `showLink` — для LINK/MIXED), :89-91 (отправка — черновик `{text:null, linkUrl:null}` + submit); apps/api/src/modules/assignments/assignments.service.ts:324-326 (`!text && !linkUrl` → VALIDATION_ERROR); prisma/schema/18-assignments.prisma:3-4,36-51 (у Submission нет вложений)
- Суть: преподаватель может выбрать «Файл» (самый частый формат домашки), но у студента в карточке нет ни поля текста, ни поля ссылки, ни загрузки — кнопка «Отправить» всегда даёт «Работа пустая». При MIXED файл тоже не приложить.
- Решение: короткий путь — убрать FILE из селекта до появления вложений и показывать поле ссылки для FILE; полный — вложения сдачи через `File` (presign/confirm как у материалов, `File.submissionId`), проверка «не пусто» с учётом файлов.
- Файлы для правки: apps/web/src/views/assignments/ui/create-assignment-modal.tsx, apps/web/src/views/assignments/ui/student-assignment-detail.tsx; для полного решения — prisma/schema/18-assignments.prisma (+ files), apps/api/src/modules/assignments/assignments.service.ts, packages/shared-schemas/src/assignments.ts
- Стоп-точки: короткий путь — нет; полный — миграция, контракт API/shared-schemas

#### C-F07 [P1] Удаление задания одним кликом стирает все сданные и оценённые работы

- Процесс: C-13, C-15
- Где: apps/api/src/modules/assignments/assignments.service.ts:283-287 (`remove` — `assignment.delete` без проверок); prisma/schema/18-assignments.prisma:53 (Submission → Assignment `onDelete: Cascade`); apps/web/src/views/assignments/ui/teacher-assignments-view.tsx:122-124, 267-270 (пункт «Удалить» доступен в любом статусе, подтверждение показывает только название)
- Суть: в отличие от курса (courses.service.ts:355-369), колонки журнала (gradebook.service.ts:153-162) и экзамена (exams.service.ts:177-183), у задания гарда нет: опубликованное/закрытое задание с работами всей группы, отзывами и баллами удаляется каскадом без следа, кроме строки аудита `assignment_deleted`.
- Решение: в `remove` — CONFLICT, если есть сдачи не в DRAFT (или хотя бы GRADED); для таких заданий предлагать «Закрыть»; в UI прятать «Удалить» у PUBLISHED/CLOSED или показывать число работ в подтверждении; проверка+удаление в одной транзакции; тест.
- Файлы для правки: apps/api/src/modules/assignments/assignments.service.ts, apps/web/src/views/assignments/ui/teacher-assignments-view.tsx, новый spec
- Стоп-точки: нет

#### C-F08 [P1] Баллы не сверяются с максимумом: журнал и задания принимают «150 из 10», средний процент студента и аналитика декана уезжают за 100 %

- Процесс: C-11, C-12, C-15, C-17
- Где: apps/api/src/modules/gradebook/gradebook.service.ts:168-198 (`saveGrades` — только 0..1000 из схемы, `maxScore` колонки не читается), :100-119 (`updateColumn` может понизить `maxScore` ниже уже выставленных баллов); packages/shared-schemas/src/gradebook.ts:37; apps/api/src/modules/assignments/assignments.service.ts:349-367 (`grade` не читает `Assignment.maxScore`); apps/api/src/modules/exams/exams.service.ts:188-220 (`setResults` не читает `Exam.maxScore`, `admitted=false` + `PASSED` допустимо); web: apps/web/src/views/gradebook/ui/gradebook-table.tsx:95-103 (атрибут `max` не проверяется — сохранение кнопкой, не submit формы), apps/web/src/views/assignments/ui/grade-submission-modal.tsx:78-84
- Суть: опечатка преподавателя (лишний ноль) сохраняется как есть. Процент по дисциплине у студента (academic-view.tsx:38-44, gradebook-table.tsx:145-154) и средний процент в аналитике декана (analytics.service.ts:139-149 — `sum(score / max_score)`) получают значения > 100 %.
- Решение: в `saveGrades`/`grade`/`setResults` после загрузки колонки/задания/экзамена отклонять `score > maxScore` (VALIDATION_ERROR с `details[]` по studentId); в `updateColumn`/`update` экзамена/задания — запрещать понижение `maxScore` ниже максимального выставленного балла; в `setResults` — запрещать `admitted=false` с PASSED/FAILED; клиентская проверка в таблицах; тесты.
- Файлы для правки: apps/api/src/modules/gradebook/gradebook.service.ts, apps/api/src/modules/assignments/assignments.service.ts, apps/api/src/modules/exams/exams.service.ts, apps/web/src/views/gradebook/ui/gradebook-table.tsx, apps/web/src/views/assignments/ui/grade-submission-modal.tsx, apps/web/src/views/exams/ui/exam-results-roster.tsx, соответствующие spec
- Стоп-точки: нет

#### C-F09 [P1] Список экзаменов декана/админа: `take: 200` по возрастанию даты — после пары сессий ближайшие экзамены пропадают

- Процесс: C-16
- Где: apps/api/src/modules/exams/exams.service.ts:68-73 (`orderBy: { date: 'asc' }, take: 200`, без пагинации и фильтра периода); packages/shared-schemas/src/exams.ts:39-45 (в запросе нет `from/to`/страницы); apps/web/src/views/exams/ui/exam-management-view.tsx:66 (`fetchExams()` без фильтров)
- Суть: у декана scope — весь факультет, у админа — весь вуз. 30 групп × 5 экзаменов × 2 сессии = 300 экзаменов за год: ответ молча обрезается до 200 САМЫХ СТАРЫХ, и текущая сессия в `/dean/exams` не видна вовсе. У студента (своя группа) порог наступит не скоро, у админа вуза — в первую же сессию.
- Решение: серверная пагинация (`OffsetPaginationSchema` + `Paginated`) и фильтр `from/to` (по умолчанию — от начала текущего семестра), сортировка «ближайшие сверху»; таблица с `TablePagination`.
- Файлы для правки: apps/api/src/modules/exams/exams.service.ts, packages/shared-schemas/src/exams.ts, apps/web/src/entities/exam/api/exam-api.ts, apps/web/src/views/exams/ui/exam-management-view.tsx, apps/web/src/views/exams/ui/student-exams-view.tsx
- Стоп-точки: контракт API/shared-schemas (форма ответа `/exams` меняется на `Paginated`)

#### C-F10 [P2] Пересдача затирает первую попытку: `ExamResult.attempt` никогда не пишется

- Процесс: C-17
- Где: apps/api/src/modules/exams/exams.service.ts:200-219 (upsert по `[examId, studentId]`, поле `attempt` не задаётся ни в create, ни в update); prisma/schema/21-exams.prisma:40,48; apps/web/src/views/exams/ui/student-exams-view.tsx:225-226 (бейдж «попытка N» недостижим)
- Суть: статус RETAKE есть, а механики пересдачи нет: внесение результата пересдачи в ту же ведомость перезаписывает FAILED первой попытки; история остаётся только в аудите без значений (`metadata: { count }`). Обходной путь — отдельный экзамен на пересдачу, но его ведомость снова содержит всю группу, а `attempt` остаётся мёртвым полем.
- Решение: определиться с моделью: (а) пересдача = новый `Exam` с флагом/ссылкой `retakeOfId`, ведомость — только студенты с FAILED/ABSENT/RETAKE исходного экзамена, `attempt` = номер; или (б) уникальность `[examId, studentId, attempt]` и явное действие «Новая попытка». В аудит `exam_results_set` писать прежние и новые значения.
- Файлы для правки: apps/api/src/modules/exams/exams.service.ts, prisma/schema/21-exams.prisma, packages/shared-schemas/src/exams.ts, apps/web/src/views/exams/ui/exam-results-roster.tsx
- Стоп-точки: миграция, контракт API/shared-schemas

#### C-F11 [P0] Удаление пары (и версии расписания) каскадом стирает всю историю посещаемости по ней

- Процесс: C-04, C-08, C-10
- Где: prisma/schema/19-attendance.prisma:16 (`Attendance.pair ... onDelete: Cascade`); prisma/schema/03-schedule.prisma:53 (`Pair.schedule ... onDelete: Cascade`); apps/api/src/modules/schedules/schedules.service.ts:475-497 (`removePair` — `pair.delete` без проверок, доступно TEACHER для своих пар: pairs.controller.ts:62-63), :302-321 (`removeSchedule` — комментарий «пары и их изменения удаляются каскадом»); web: apps/web/src/features/manage-schedule/ui/pair-details-modal.tsx:125-126, 280-288 (кнопка «Удалить пару» у декана/админа/преподавателя, подтверждение без предупреждения об отметках)
- Суть: перестройка сетки посреди семестра («удалить пару и поставить заново в другой день») или удаление старой версии расписания через API уничтожает все отметки посещаемости по этим парам за весь семестр (а также `ScheduleChange`). Сводки студентов (`/attendance/me`), аналитика декана и допуск по посещаемости молча меняются; в аудите — только `pair_deleted`.
- Решение: (1) в `removePair`/`removeSchedule` — CONFLICT, если у пар есть отметки посещаемости (предлагать перенос через PATCH или деактивацию версии); (2) миграцией сменить `Attendance.pair` на `onDelete: Restrict` как страховку; (3) в долгую — «мягкое» удаление пары (`archivedAt`) и денормализация `subject/groupId` в `Attendance`, чтобы история жила без пары. Тест на запрет удаления.
- Файлы для правки: apps/api/src/modules/schedules/schedules.service.ts, apps/api/src/modules/schedules/schedules.service.spec.ts, prisma/schema/19-attendance.prisma (+ миграция), apps/web/src/features/manage-schedule/ui/pair-details-modal.tsx (текст ошибки CONFLICT)
- Стоп-точки: миграция (для пункта 2–3; пункт 1 — без миграции)

#### C-F12 [P1] Замена преподавателя не доходит до заменяющего: пары нет в его расписании, отметить посещаемость он не может

- Процесс: C-05, C-06, C-08, C-09
- Где: apps/api/src/modules/schedules/schedules.service.ts:177-179 (`getSchedule` для TEACHER — только `pair.teacherId = sub`), :798-801 (`changePairScope` для TEACHER — тоже только `pair.teacherId`, изменения с `newTeacherId = sub` отфильтрованы); apps/api/src/modules/attendance/attendance.service.ts:343-351 (`assertManagePair` — только `pair.teacherId`); `grep -rn newTeacherId apps/api/src` — используется лишь при создании изменения и для получателя уведомления (schedules.service.ts:563-632)
- Суть: SUBSTITUTED создаёт уведомление заменяющему, но в `/teacher/schedule`, «Сегодня» и `/teacher/attendance` занятия у него нет, `GET /schedule/changes` его не возвращает, а ростер/отметка/QR для этой пары дают FORBIDDEN. Отмечать продолжает отсутствующий основной преподаватель (у него пара видна). Сценарий замены — штатный, по нему в UI есть отдельная форма (pair-details-modal.tsx:403).
- Решение: в `changePairScope` для TEACHER — `OR: [{ teacherId: sub }, { changes: { some: { newTeacherId: sub } } }]` на уровне изменений (или фильтр `ScheduleChange.newTeacherId = sub`); в BFF/вебе накладывать «чужие» пары по заменам на сетку преподавателя; в `assertManagePair` разрешать заменяющему на дату замены (принимать `date` и проверять `ScheduleChange{pairId,date,type:SUBSTITUTED,newTeacherId:sub}`), основному на эту дату — запрещать. Тесты.
- Файлы для правки: apps/api/src/modules/schedules/schedules.service.ts, apps/api/src/modules/attendance/attendance.service.ts, apps/api/src/modules/me/me.service.ts, apps/web/src/widgets/today/ui/teacher-today.tsx, apps/web/src/views/attendance/ui/teacher-attendance-view.tsx, spec обоих модулей
- Стоп-точки: нет

#### C-F13 [P1] «Новая версия расписания» сразу становится активной и гасит текущую — группа видит пустую сетку

- Процесс: C-04, C-06
- Где: apps/api/src/modules/schedules/schedules.service.ts:239-247 (`makeActive = input.isActive ?? true`, остальные версии группы деактивируются); apps/web/src/features/manage-schedule/ui/create-version-modal.tsx:34 (`createScheduleRequest({ groupId, name })` — `isActive` не передаётся); apps/web/src/features/manage-schedule/ui/manage-schedule.tsx:106-114 (отдельная кнопка «Сделать активной» есть — то есть задумано готовить версию заранее)
- Суть: декан, начавший готовить сетку следующего семестра, в тот же момент снимает с публикации действующее расписание: у студентов и преподавателей `/schedule`, «Сегодня», календарь и посещаемость показывают пустую неделю (выборка только по `schedule.isActive`, :172), пока версия не будет заполнена или не активируют старую. Кроме того, при активации версии (`updateSchedule`, :279-291) её пары не перепроверяются на конфликты с активными расписаниями других групп — `assertNoConflict` сравнивал их с сеткой, действовавшей на момент добавления.
- Решение: в модалке передавать `isActive: false` (или чекбокс «сразу сделать активной», по умолчанию выключен); при `isActive: true` в `updateSchedule` прогонять `assertNoConflict` для всех пар версии и отдавать `details[]`.
- Файлы для правки: apps/web/src/features/manage-schedule/ui/create-version-modal.tsx, apps/api/src/modules/schedules/schedules.service.ts, apps/api/src/modules/schedules/schedules.service.spec.ts
- Стоп-точки: нет

#### C-F14 [P1] Посещаемость студента по дисциплине и общая сводка считаются по обрезанной выборке и разными формулами

- Процесс: C-02, C-10
- Где: apps/api/src/modules/attendance/attendance.service.ts:181-202 (счётчики — `findMany(..., take: 2000)` без сортировки; `records` — последние 100); apps/web/src/views/courses/ui/course-view.tsx:174-187 (статистика дисциплины = фильтр `records` (последние 100 отметок по ВСЕМ предметам) по строке `pair.subject`; формула `(present+late)/total`); сервер: `rate = (total - absent)/total` (EXCUSED считается посещением); `student-attendance-view.tsx:45`, `academic-view.tsx:60` — без `from/to`
- Суть: при ~20 парах в неделю 100 последних отметок покрывают ~5 недель, поэтому «Посещаемость по дисциплине» на `/courses/[subject]` после первого месяца показывает долю только по свежему хвосту, а не за семестр. Общая сводка без периода после ~2000 отметок (3-4 курса) считается по произвольному подмножеству строк. Одна и та же уважительная причина в общей сводке повышает процент, а на странице дисциплины — понижает.
- Решение: в `studentSummary` считать `groupBy({ by: ['status'] })` (и опционально `groupBy` по `pair.subject` через raw/денормализацию) вместо выборки; отдать разбивку по дисциплинам с сервера; по умолчанию — период текущего семестра; единая формула в shared-константе.
- Файлы для правки: apps/api/src/modules/attendance/attendance.service.ts, packages/shared-schemas/src/attendance.ts (ответ), apps/web/src/views/courses/ui/course-view.tsx, apps/web/src/views/attendance/ui/student-attendance-view.tsx
- Стоп-точки: контракт API/shared-schemas (если в ответ добавляется разбивка по дисциплинам)

#### C-F15 [P2] Отметка посещаемости на любую дату: не сверяется с днём недели пары, чётностью, отменами и активностью версии

- Процесс: C-08, C-09
- Где: apps/api/src/modules/attendance/attendance.service.ts:114-153 (`mark` — дата любая), :215-233 (`createQrToken` — QR на любую дату, в т.ч. будущую), :237-293 (`checkIn` — не проверяет, что занятие идёт сейчас и не отменено `ScheduleChange.CANCELLED`)
- Суть: можно проставить «присутствовал» на воскресенье, на отменённую пару или на пару из неактивной версии; QR на завтрашнюю дату позволяет отметиться заранее. Токен без привязки к сеансу/устройству — скрин пересылается отсутствующему в течение 90 с (известное ограничение).
- Решение: общий хелпер «занятие проводится в дату D» (dayOfWeek по таймзоне вуза, weekType, нет CANCELLED, версия активна; для MOVED — новое время) — в `mark`, `createQrToken`, `checkIn`; для QR дополнительно окно «±N минут от начала пары». Spec для модуля attendance (его сейчас нет вовсе).
- Файлы для правки: apps/api/src/modules/attendance/attendance.service.ts, новый apps/api/src/modules/attendance/attendance.service.spec.ts
- Стоп-точки: нет

#### C-F16 [P2] Разовые изменения расписания нельзя отменить/исправить, они не проверяются на конфликты и не обновляют преподавателей вживую

- Процесс: C-05
- Где: apps/api/src/modules/schedules/schedule-view.controller.ts:21-55 (только GET /schedule, GET/POST /schedule/changes — PATCH/DELETE нет); schedules.service.ts:551-606 (`createChange` — нет проверки, что `date` совпадает с днём недели/чётностью пары, нет дубля «две отмены на одну дату», MOVED/ROOM_CHANGED/SUBSTITUTED не проверяются на занятость аудитории/преподавателя; MOVED меняет только время — перенос на другой день невозможен), :592-600 (WS только в `group:<id>`, а преподаватель в эту комнату не входит — teacher-today.tsx:46 подписан впустую); правки/удаления самих пар (`updatePair`/`removePair`) не шлют ни WS, ни уведомлений
- Суть: ошибочно созданную отмену занятия деканат исправить не может — студенты получили пуш и видят «отменено». Перенос/замена может поставить пару в занятую аудиторию или к занятому преподавателю.
- Решение: `DELETE /schedule/changes/:id` (+ уведомление «изменение отменено»), уникальность `(pairId, date)` для CANCELLED; проверка конфликта для MOVED/ROOM_CHANGED/SUBSTITUTED через `assertNoConflict` с учётом даты; эмит также в `user:<teacherId>`/`user:<newTeacherId>`; WS/уведомление на `updatePair`/`removePair`.
- Файлы для правки: apps/api/src/modules/schedules/schedules.service.ts, apps/api/src/modules/schedules/schedule-view.controller.ts, packages/shared-schemas/src/schedule.ts, apps/web/src/features/manage-schedule/ui/pair-details-modal.tsx, docs/PROJECT.md (новый эндпоинт)
- Стоп-точки: контракт API/shared-schemas (новый эндпоинт), миграция (если уникальность изменения)

#### C-F17 [P1] Со второго семестра студент не видит новых заданий: список — 100 самых ранних по сроку за всё время

- Процесс: C-07, C-14, C-03
- Где: apps/web/src/entities/assignment/api/assignment-api.ts:22-28 (`fetchAssignments` — `page:1, limit:100`, массив без `total`); apps/api/src/modules/assignments/assignments.service.ts:673-684 (по умолчанию `dueAt asc`), :433-437 (scope студента — все PUBLISHED/CLOSED заданий группы за все семестры); BFF «Сегодня» — apps/api/src/modules/me/me.service.ts:87-89 (`assignments.list(viewer, this.q(20))` — 20 самых ранних по сроку); потребители: apps/web/src/views/assignments/ui/student-assignments-view.tsx:82, apps/web/src/views/tasks/ui/tasks-view.tsx:79-83, apps/web/src/views/calendar/ui/calendar-view.tsx:77-81, apps/web/src/views/academic/ui/academic-view.tsx:64-68
- Суть: 10 дисциплин × 8 заданий ≈ 80 за семестр. На главной («Сегодня», `/me/today`) порог — всего 20 заданий, то есть уже через 2–3 недели семестра блок дедлайнов показывает только давно прошедшие. Когда в группе накопится больше 100 заданий, ответ содержит 100 заданий с САМЫМИ РАННИМИ сроками (прошлые семестры), а свежие с ближайшими дедлайнами отсекаются: в `/assignments`, «Делах», календаре и академическом профиле их нет. Признака усечения клиент не получает.
- Решение: для студенческих экранов — фильтры на сервере (`status`/`dueFrom`/`termId` или «активные + последние N закрытых»), сортировка «ближайшие сверху», для списка `/assignments` — постраничность через `fetchAssignmentsPaged`; календарю — запрос по диапазону дат.
- Файлы для правки: packages/shared-schemas/src/assignments.ts (фильтр `dueFrom/dueTo`), apps/api/src/modules/assignments/assignments.service.ts, apps/api/src/modules/me/me.service.ts, apps/web/src/entities/assignment/api/assignment-api.ts, apps/web/src/views/assignments/ui/student-assignments-view.tsx, apps/web/src/views/tasks/ui/tasks-view.tsx, apps/web/src/views/calendar/ui/calendar-view.tsx, apps/web/src/views/academic/ui/academic-view.tsx
- Стоп-точки: контракт API/shared-schemas (новые параметры запроса — обратносовместимо)

#### C-F18 [P1] Материалы: преподаватель видит 200 последних материалов всего вуза, а не свои; у студента старые материалы исчезают

- Процесс: C-20, C-02
- Где: apps/api/src/modules/materials/materials.service.ts:87-100 (`list` — `take: 200`, `createdAt desc`, без пагинации), :211-214 (scope TEACHER — все группы вуза); packages/shared-schemas/src/materials.ts:16 (в запросе только `groupId`, нет `mine`/страницы); apps/web/src/views/materials/ui/materials-view.tsx:58 (`fetchMaterials()` без фильтров на `/teacher/materials`)
- Суть: в `/teacher/materials` выводится общий поток материалов всех преподавателей вуза; при десятках преподавателей свой материал, выложенный неделю назад, уже вне первых 200 — его не найти и не удалить из UI. У студента лента группы режется теми же 200: ~150 материалов за семестр → к середине второго семестра материалы первого пропадают со страниц дисциплин и счётчиков `/courses`.
- Решение: `MaterialListQuerySchema` + `mine`, `subject`, `page/limit` → `Paginated`; `/teacher/materials` — `mine=true` по умолчанию; страница дисциплины — фильтр по `subject` (или по `courseId`, см. C-F25) на сервере.
- Файлы для правки: packages/shared-schemas/src/materials.ts, apps/api/src/modules/materials/materials.service.ts, apps/web/src/entities/material/api/material-api.ts, apps/web/src/views/materials/ui/materials-view.tsx, apps/web/src/views/courses/ui/course-view.tsx, apps/web/src/views/courses/ui/courses-view.tsx
- Стоп-точки: контракт API/shared-schemas (форма ответа `/materials`)

#### C-F19 [P1] Очередь записи в деканат: закрытые записи вытесняют новые после 300 строк

- Процесс: C-19
- Где: apps/api/src/modules/appointments/appointments.service.ts:113-124 (`orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }], take: 300`); prisma/schema/23-appointments.prisma:12 (`status String` — сортировка по алфавиту: CANCELLED < COMPLETED < CONFIRMED < REQUESTED < RESCHEDULED); apps/web/src/views/appointments/ui/dean-appointments-view.tsx:78 (`fetchAppointmentQueue()` без фильтра статуса, пагинации нет)
- Суть: «сначала по статусу» на строковом поле ставит в начало отменённые и завершённые записи, которые только копятся. Когда их у факультета наберётся 300 (несколько недель работы деканата крупного факультета), в ответ не попадёт ни одной новой (REQUESTED) или подтверждённой записи — очередь у декана выглядит пустой/архивной, студенты не получают ответа. Клиентская сортировка «по времени» работает уже по обрезанному набору.
- Решение: по умолчанию отдавать только активные статусы (REQUESTED/CONFIRMED/RESCHEDULED), архив — отдельной вкладкой с пагинацией; явный порядок через `CASE` (raw) или отдельный числовой `statusRank`; `Paginated` вместо массива.
- Файлы для правки: apps/api/src/modules/appointments/appointments.service.ts, packages/shared-schemas/src/appointments.ts, apps/web/src/entities/appointment/api/appointment-api.ts, apps/web/src/views/appointments/ui/dean-appointments-view.tsx, apps/api/src/modules/appointments/appointments.service.spec.ts
- Стоп-точки: контракт API/shared-schemas (если меняется форма ответа на `Paginated`)

#### C-F20 [P2] Задания: попытки, отложенная публикация, правка и переоценка не реализованы; переходы статусов не охраняются

- Процесс: C-13, C-14, C-15
- Где: apps/api/src/modules/assignments/assignments.service.ts:226-228,247-254 (`maxAttempts`/`publishAt` только сохраняются — других обращений в apps/api/src нет), :263-281 (`setStatus` без проверки исходного статуса: DRAFT→CLOSED, CLOSED→PUBLISHED, повторная публикация перезаписывает `publishAt`), :338-344 (пересдача перезаписывает текст/ссылку/балл/отзыв прошлой попытки — истории попыток нет), :355-367, :386-397 (`grade`/`returnForFix`: проверка `status === 'SUBMITTED'` и безусловный `update` — параллельные «оценить» и «вернуть» дают последнее слово случайному; оценённую работу исправить нельзя — 409), :297-311 (`saveDraft`: проверка статуса и upsert разными запросами); web: `updateAssignmentRequest` (entities/assignment/api/assignment-api.ts:63) нигде не вызывается — продлить срок или исправить условие нельзя, только удалить (см. C-F07); create-assignment-modal.tsx не предлагает `maxAttempts`/`publishAt`; преподаватель не получает уведомления о новой сдаче
- Суть: параметры задания из схемы API (попытки, отложенная публикация) ничего не делают, а в форме их нет; ошибку в оценке или сроке исправить штатно нельзя; одновременные действия преподавателей дают недетерминированный итог, а повторная сдача стирает прошлую попытку.
- Решение: условные `updateMany({ where: { id, status: 'SUBMITTED' } })` в `grade`/`returnForFix` с CONFLICT при `count===0`; разрешить переоценку GRADED (с аудитом старого балла); таблица переходов статусов задания; проверка `attemptNumber < maxAttempts` в `submit`; cron/фильтр для `publishAt` либо убрать поле из схемы и UI; модалка правки задания; уведомление преподавателю о сдаче (с дедупом).
- Файлы для правки: apps/api/src/modules/assignments/assignments.service.ts, apps/web/src/views/assignments/ui/teacher-assignments-view.tsx, apps/web/src/views/assignments/ui/create-assignment-modal.tsx, apps/web/src/views/assignments/ui/grade-submission-modal.tsx, spec
- Стоп-точки: нет (миграция — только если хранить историю попыток отдельной таблицей)

#### C-F21 [P2] Журнал: сохранение колонки целиком затирает чужие правки; правки опубликованных оценок не видны студенту и не попадают в аудит значениями

- Процесс: C-11, C-12
- Где: apps/web/src/views/gradebook/ui/gradebook-table.tsx:95-104 (на сохранение уходят ВСЕ студенты колонки, пустая ячейка = `score:null`); apps/api/src/modules/gradebook/gradebook.service.ts:184-198 (`null` → `deleteMany`), :199-206 (аудит — только `count`), :121-147 (WS только при публикации; при правке опубликованной колонки и снятии с публикации — ничего), :215-221 (`myGrades` — курсы по ТЕКУЩЕЙ группе студента: после перевода в другую группу вся прошлая успеваемость пропадает с его экранов), :84-92 (`position = count` — гонка даёт одинаковые позиции)
- Суть: если журнал открыт у преподавателя и у декана (или в двух вкладках), сохранение одной стороны удаляет оценки, выставленные другой после загрузки страницы. Изменение уже опубликованной оценки нельзя восстановить по аудиту.
- Решение: отправлять только изменённые ячейки (dirty по ячейке, не по колонке); в аудит писать `{studentId, from, to}`; WS `grade.published` (или `grade.updated`) при правке опубликованной колонки; `myGrades` — по `Grade.studentId`, а не по группе.
- Файлы для правки: apps/web/src/views/gradebook/ui/gradebook-table.tsx, apps/api/src/modules/gradebook/gradebook.service.ts, apps/api/src/modules/gradebook/gradebook.service.spec.ts
- Стоп-точки: нет

#### C-F22 [P2] Экзамены: студенты не узнают о назначении, переносе и результатах; нет проверки пересечений; ведомость видна студенту по мере заполнения

- Процесс: C-16, C-17, C-07
- Где: apps/api/src/modules/exams/exams.service.ts:128-173 (`create`/`update` — ни очереди уведомлений, ни WS; нет проверки занятости аудитории/экзаменатора и пересечения с парами группы), :188-230 (`setResults` — без уведомления; `selectWithMine` :234-238 отдаёт студенту результат сразу, без шага публикации, в отличие от журнала), :266-280 (`getById` для TEACHER разрешает любой экзамен вуза, тогда как `list` — только свои/экзаменатора); apps/web/src/views/calendar/lib/calendar-events.ts (экзамены и консультации в календарь не попадают, хотя PROJECT.md §3.1 называет их особыми событиями расписания)
- Суть: о самом важном событии сессии студент узнаёт только зайдя в `/exams`; аудитория может оказаться занята парой; промежуточные (ошибочные) записи ведомости студент видит сразу; преподаватель по прямой ссылке читает чужие экзамены вуза.
- Решение: job `EXAM_SCHEDULED`/`EXAM_UPDATED`/`EXAM_RESULT` в очередь `notifications` с дедупом; флаг `resultsPublished` у экзамена (или публикация как у колонок); проверка конфликтов по аудитории/экзаменатору/группе в дату; в `assertRead` для TEACHER — то же условие, что в `scopeWhere`; экзамены в календаре.
- Файлы для правки: apps/api/src/modules/exams/exams.service.ts, packages/shared-schemas/src/exams.ts, apps/web/src/views/calendar/lib/calendar-events.ts, apps/web/src/views/calendar/ui/calendar-view.tsx
- Стоп-точки: миграция (если флаг публикации результатов), контракт API/shared-schemas

#### C-F23 [P2] Консультации: слот можно создать в прошлом и внахлёст, список преподавателей собирается из 5000 строк в памяти

- Процесс: C-18
- Где: apps/api/src/modules/consultations/consultations.service.ts:40-56 (`createSlot` — нет проверки `startsAt > now`, пересечений со своими слотами и парами, максимальной длительности); packages/shared-schemas/src/consultations.ts:19 (`endsAt > startsAt` — сравнение ISO-строк, при разных смещениях даёт неверный результат); consultations.service.ts:116-161 (`listTeachers` — `findMany take: 5000` без сортировки + агрегация в JS: при большем числе открытых слотов часть преподавателей произвольно выпадает; нужен `groupBy`), :58-83 (`deleteSlot` — уведомление студенту ДО удаления, дедуп-ключ отличается от ключа отмены (`:teacher`) — после «отменить» и «удалить» студент получает два уведомления об отмене), нет ограничения на число одновременных записей студента к одному преподавателю, нет напоминаний
- Суть: создание слотов не защищено от опечаток в дате и двойного бронирования времени преподавателя; список преподавателей неполон при большом числе слотов; студент получает дубли уведомлений.
- Решение: валидация будущего времени и пересечений в `createSlot`; сравнение дат через `Date` в refine; `groupBy({ by: ['teacherId'], _count })` + выборка имён; уведомление после успешного удаления и единый дедуп-ключ отмены.
- Файлы для правки: apps/api/src/modules/consultations/consultations.service.ts, packages/shared-schemas/src/consultations.ts, apps/api/src/modules/consultations/consultations.service.spec.ts
- Стоп-точки: нет

#### C-F24 [P2] Запись в деканат: деканат не уведомляется о новых заявках, `applicationId` не проверяется, лимитов нет

- Процесс: C-19
- Где: apps/api/src/modules/appointments/appointments.service.ts:65-83 (`create` — нет уведомления сотрудникам деканата, `requestedAt` в прошлом допустим, число активных записей студента не ограничено, `applicationId` (мягкая ссылка без FK) не сверяется с заявками самого студента); apps/web/src/views/appointments/ui/student-appointments-view.tsx:175 (ссылка на заявку показывается по непроверенному id)
- Суть: новые заявки лежат в очереди, пока сотрудник сам не откроет страницу; студент может прикрепить к записи чужой/несуществующий id заявки и создать неограниченно много записей.
- Решение: job уведомления деканам факультета (или счётчик в навигации); проверка `applicationId` по `Application.studentId = actor.sub`; `requestedAt >= now`; не больше N активных записей на студента.
- Файлы для правки: apps/api/src/modules/appointments/appointments.service.ts, apps/api/src/modules/appointments/appointments.service.spec.ts
- Стоп-точки: нет

#### C-F25 [P2] Дисциплина склеивается по строке названия: пары, материалы и курсы разных семестров путаются

- Процесс: C-02, C-03, C-20, C-06
- Где: apps/web/src/views/courses/lib/build-courses.ts:58-63, 100-138 (`mergeApiCourses` — карта по `course.subject.name`: курсы одной дисциплины разных семестров перезаписывают друг друга, побеждает последний в недетерминированном порядке — courses.service.ts:85-86 сортирует только по названию); apps/web/src/views/courses/ui/course-view.tsx:139-160 (материалы, оценки и `courseId` для заданий — по совпадению строки); prisma/schema/03-schedule.prisma (у `Pair` нет FK на `Course`), prisma/schema/12-materials.prisma (`Material.subject` — свободная строка); apps/web/src/shared/lib/tz-date.ts:51-58 (`isoWeekParity` не равен ISO 8601 — в 2025–2026 чётность инвертирована относительно ISO, и правило не привязано к началу семестра; согласовано с iOS/Android/room-qr, то есть это договорённость, но её нет в PROJECT.md и деканам не показывается)
- Суть: «Математика» в 1-м и 2-м семестре — одна карточка; на странице дисциплины задания могут подтянуться из прошлогоднего курса; опечатка/переименование предмета в справочнике рвёт связь с парами и материалами.
- Решение: `Pair.courseId` и `Material.courseId` (nullable, с бэкфиллом по имени+группе+активному семестру), страница дисциплины по `courseId`; для чётности — явное правило в PROJECT.md (ISO или от `Term.startsOn`) и подпись «текущая неделя: числитель/знаменатель» в редакторе расписания.
- Файлы для правки: prisma/schema/03-schedule.prisma, prisma/schema/12-materials.prisma, apps/api/src/modules/schedules/schedules.service.ts, apps/api/src/modules/materials/materials.service.ts, apps/web/src/views/courses/lib/build-courses.ts, apps/web/src/views/courses/ui/course-view.tsx, docs/PROJECT.md
- Стоп-точки: миграция, контракт API/shared-schemas

#### C-F26 [P2] Учебный план: статус «Пройдена/Не сдана» по первой же опубликованной оценке активного семестра

- Процесс: C-03
- Где: apps/web/src/views/study-plan/ui/study-plan-view.tsx:38-53 (`statusOf`: если есть хоть одна опубликованная оценка — `completed` при ≥50 %, иначе `notPassed`, даже при `term.isActive`), :105-112 (кредиты такой дисциплины засчитываются в «освоено»); результаты экзаменов не учитываются вовсе
- Суть: после первой лабораторной на 6/10 дисциплина текущего семестра отображается «Пройдена» и добавляет кредиты в прогресс; после 4/10 — «Не сдана». Студент видит неверную траекторию.
- Решение: для `term.isActive` статус всегда «изучается» (процент — справочно); «пройдена/не сдана» — по итоговому результату экзамена (`ExamResult.status`) или итоговой колонке kind=EXAM.
- Файлы для правки: apps/web/src/views/study-plan/ui/study-plan-view.tsx (+ запрос `/exams`)
- Стоп-точки: нет

#### C-F27 [P2] Расписание: проверки пересечений и назначения преподавателя неполные

- Процесс: C-04, C-05
- Где: apps/api/src/modules/schedules/schedules.service.ts:698-709 (`assertTeacherInUniversity` не проверяет роль и `isBlocked` — преподавателем пары или заменяющим можно назначить студента или заблокированного; ср. courses.service.ts:458-474), :361-376 и :438-464 (проверка конфликтов и запись разными запросами — две параллельные правки занимают одну аудиторию), :409-421 (TEACHER меняет время/аудиторию своей пары без проверки, что ведёт дисциплину в этой группе — `assertTeachesGroup` только при создании); materials: apps/api/src/modules/materials/materials.service.ts:232-243 (TEACHER публикует материалы в ЛЮБУЮ группу вуза, хотя для пар то же правило ограничено группами, где он ведёт курс)
- Суть: в сетке может оказаться «преподаватель»-студент или заблокированный; при одновременной правке двумя сотрудниками одна аудитория занимается дважды; преподаватель может выкладывать материалы группам, где не преподаёт.
- Решение: в `assertTeacherInUniversity` — `role in (TEACHER, DEAN)`, `isBlocked: false`; конфликт+создание в `$transaction` с `SERIALIZABLE` или advisory-lock по (groupId/teacherId/roomId, dayOfWeek); в materials `create` для TEACHER — `assertTeachesGroup`.
- Файлы для правки: apps/api/src/modules/schedules/schedules.service.ts, apps/api/src/modules/materials/materials.service.ts, spec обоих модулей
- Стоп-точки: нет

#### C-F28 [P2] Справочники в UI: у декана кнопки, которые API отклоняет; правки предметов/семестров нет

- Процесс: C-01
- Где: apps/web/src/views/course-admin/ui/course-admin-view.tsx:166-182 (кнопки «Добавить дисциплину/семестр» и удаления на вкладках «Предметы/Семестры» видны всем ролям экрана, в т.ч. `/dean/courses`); apps/api/src/modules/courses/subjects.controller.ts:26 и terms.controller.ts:26 (`MANAGE_ROLES = [PLATFORM_ADMIN, UNIVERSITY_ADMIN]` — декан получает 403); PATCH /subjects/:id, PATCH /terms/:id в вебе не вызываются (course-api.ts — функций нет)
- Суть: декан нажимает «Добавить дисциплину/семестр» и получает ошибку; опечатку в названии предмета или датах семестра можно исправить только удалением (что невозможно, если на них ссылаются курсы).
- Решение: скрывать действия справочников для DEAN; модалки правки предмета (название/код) и семестра (даты/активность).
- Файлы для правки: apps/web/src/views/course-admin/ui/course-admin-view.tsx, apps/web/src/entities/course/api/course-api.ts, новые модалки правки
- Стоп-точки: нет

#### C-F29 [P2] Пробелы в тестах

- Процесс: C-08, C-09, C-10, C-11, C-13, C-15, C-17, C-02, C-03
- Где: apps/api/src/modules/attendance/ — нет ни одного spec (mark/roster/checkIn/studentSummary, scope преподавателя, QR); gradebook.service.spec.ts — только `deleteColumn`; assignments — только submit-deadline.spec.ts и review-queue.spec.ts (нет тестов scope списка/`getById` с DRAFT для студента, `grade`/`returnForFix`/`remove`); exams — нет тестов валидации `setResults`; schedules — нет теста `removePair`/каскада; web — нет тестов build-courses, study-plan, gradebook-table, course-admin. Прогон `pnpm --filter api test -- "src/modules/(courses|assignments|gradebook|exams|schedules|consultations|appointments|materials|attendance)/"`: 11 suites, 66 tests — все проходят.
- Суть: ключевые сценарии группы C (посещаемость целиком, выставление оценок, оценивание работ, удаление пар) не покрыты тестами — найденные выше дефекты регрессией не ловятся.
- Решение: добавить spec по каждому пункту вместе с исправлениями C-F01…C-F27.
- Файлы для правки: новые/дополненные *.spec.ts в перечисленных модулях, apps/web/src/views/courses/lib/build-courses.test.ts
- Стоп-точки: нет

#### C-F30 [P2] Дублирование и мёртвый код

- Процесс: все
- Где: `isPlatform`, `resolveGroup`, `resolveCourse`, `assertManageCourse`/`assertManage` скопированы почти дословно в 7 сервисах (courses.service.ts:56,476; assignments.service.ts:28,487,641; gradebook.service.ts:28,258,304; exams.service.ts:21,289,346; attendance.service.ts:41,343; materials.service.ts:42,264; schedules.service.ts:101,655) — правки scope приходится повторять 7 раз (C-F12 это и показывает); неиспользуемые `logger` в courses.service.ts:121, schedules.service.ts:139, materials.service.ts:48; веб-функции без вызовов: `fetchSubjects`, `fetchTerms`, `updateCourseRequest` (course-api.ts:59-67, 94-100), `updateAssignmentRequest` (assignment-api.ts:63), `deleteScheduleRequest` (schedule-api.ts:76), `fetchExam` (exam-api.ts:22); поле `ExamResult.attempt`; `mine: z.coerce.boolean()` (courses.ts:122, assignments.ts:69, exams.ts:43) превращает `?mine=false` в `true`; связи автора `Assignment/GradeColumn/Exam.createdBy` — `onDelete: Cascade` (18-assignments.prisma:27, 20-gradebook.prisma:19, 21-exams.prisma:22): физическое удаление аккаунта преподавателя (сейчас только prisma/seed/cleanup.mjs) снесло бы работы и оценки студентов
- Суть: одинаковые правила доступа размножены по семи сервисам и уже разошлись; часть клиентских функций и полей мертва; каскад от автора создаёт скрытый риск массовой потери данных.
- Решение: общий `AcademicScopeService` (resolve group/course + assertRead/assertManage по роли) в common; удалить мёртвые функции или подключить их (C-F01, C-F20, C-F28); `z.enum(['true','false']).transform`/`z.stringbool` для `mine`; автор → `onDelete: SetNull` (поле nullable) или Restrict.
- Файлы для правки: apps/api/src/common/ (новый хелпер), сервисы модулей группы C, packages/shared-schemas/src/{courses,assignments,exams}.ts, apps/web/src/entities/_/api, prisma/schema/{18,20,21}-_.prisma
- Стоп-точки: миграция (для onDelete), контракт API/shared-schemas (для `mine`)
