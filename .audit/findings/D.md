## Группа D — аудит

> Фаза 2, только чтение кода. Проверены API модулей application-services, documents,
> data-export, complaints, career, common/export, связанные места users (setBlocked/warn),
> cleanup-кроны и chats/support (в части D-16), Prisma-схема и веб (widgets/applications,
> views/documents, document-types, platform-documents, verify-document, career, employer,
> moderation, moderator-dashboard, support-desk). Unit-спеки группы прогнаны
> (`pnpm --filter api test -- src/modules/{application-services,documents,data-export,complaints,career} src/common/export`):
> 25 наборов, 343 теста, все зелёные. Каждая P1 подтверждена чтением указанных строк; P0 не найдено.
> Сводка: P0 — 0, P1 — 14 (D-F01…D-F14), P2 — 18 (D-F15…D-F32).

### Статусы процессов

| Процесс                              | Статус                      | Коротко                                                                                                                                                                                                             |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 Каталог услуг и шаблоны         | работает с проблемами       | Правила полей (`validation`) теряются при настройке шаблона и не проверяются сервером, `formData` не ограничен (D-F15)                                                                                              |
| D-02 Подача заявки студентом         | работает с проблемами       | «Отозвать» видна там, где сервер отказывает (D-F02); повторная отправка без обязательных документов (D-F03); двойная отправка перевыпускает номер (D-F04); смена услуги в мастере отправляет чужой черновик (D-F05) |
| D-03 Обработка деканатом             | работает с проблемами       | Очередь начинается с чужих черновиков (D-F01); видна только первая страница документа (D-F06); запрос замены без условия на статус (D-F04); нет сигналов о новых заявках и SLA (D-F16)                              |
| D-04 Справка об обучении             | работает с проблемами       | Гонка двойной выдачи, отзыв без уведомления и отметки на документе, без тестов (D-F19)                                                                                                                              |
| D-05 Обращения группы (староста)     | работает                    | Scope из JWT по `student.groupId`, черновики исключены, урезанная проекция                                                                                                                                          |
| D-06 Проверка по QR/коду             | работает                    | Резолвит коды любых выгрузок вопреки комментарию, контроллер без тестов (D-F23)                                                                                                                                     |
| D-07 Хранилище документов            | работает с проблемами       | Выключенные вузом типы падают в конце мастера (D-F09); удалённые сканы живут вечно (D-F21); «выданные вузом» правит владелец (D-F22)                                                                                |
| D-08 Доступ третьим лицам            | сломан (для получателя)     | Грант выдаётся, но получателю негде его увидеть и нечем открыть (D-F10)                                                                                                                                             |
| D-09 Запросы документов              | работает с проблемами       | Принятый комплект меняется после проверки (D-F07); нет закрытия и срока, видит только автор, неограниченные выборки (D-F25)                                                                                         |
| D-10 Каталог типов вуза              | работает с проблемами       | Правки вуза видит только его админ — клиенты используют статику (D-F09)                                                                                                                                             |
| D-11 Истечение и архивирование       | работает с проблемами       | EXPIRING/EXPIRED работают; архивация по сроку хранения встаёт после 500 неподходящих документов (D-F08)                                                                                                             |
| D-12 Спец-режим админа платформы     | работает                    | Файлы — с причиной и аудитом; метаданные — без причины (D-F24)                                                                                                                                                      |
| D-13 Выгрузка своих данных           | работает с проблемами       | Без карьеры, жалоб, поддержки, записей; содержит чужие email из инвайтов (D-F26)                                                                                                                                    |
| D-14 Подача жалобы                   | работает с проблемами       | Пункт меню у ролей с 403; только POST/COMMENT; нет защиты от повторных жалоб (D-F27)                                                                                                                                |
| D-15 Разбор жалоб                    | работает с проблемами       | Параллельные решения применяют меру дважды (D-F11); дубли закрываются молча (D-F27)                                                                                                                                 |
| D-16 Поддержка и жалоба из обращения | работает                    | Жалоба из обращения — только в мини-аппе (D-F27)                                                                                                                                                                    |
| D-17 Дашборд модератора вуза         | работает с проблемами       | Разбивки по первым 200 жалобам, без тестов (D-F27, D-F32)                                                                                                                                                           |
| D-18 Саморегистрация работодателя    | работает                    | Ответ одинаков для занятого email, токен хэшем; неподтверждённый аккаунт входит и не чистится (D-F28)                                                                                                               |
| D-19 Допуск компании к вузу          | работает с проблемами       | Отзыв каскадирует; истечение срока — нет (D-F13); решение без условия на статус, без уведомлений (D-F28, D-F29)                                                                                                     |
| D-20 Вакансии и модерация            | работает с проблемами       | Правка одобренной вакансии обходит модерацию (D-F12); вакансии компании с истёкшим допуском на витрине (D-F13)                                                                                                      |
| D-21 Отклики и воронка               | работает с проблемами       | Новые отклики после истечения допуска доходят до компании (D-F13); переходы с условием на статус — корректно                                                                                                        |
| D-22 Карьерный профиль и согласия    | работает с проблемами       | Карточка отдаёт приватные записи портфолио (D-F14); экрана карточки у работодателя нет (D-F30)                                                                                                                      |
| D-23 Резюме и публичная ссылка       | работает с проблемами       | Публичная версия показывает записи портфолио PRIVATE (D-F14); «подтверждённые сертификаты» всегда пусты (D-F30)                                                                                                     |
| D-24 Карьерные мероприятия           | работает, но не наполняется | `careerKind` выставляет только сид, аудитория события игнорируется (D-F30)                                                                                                                                          |
| D-25 Карьерная аналитика             | работает с проблемами       | Доля открытых профилей завышена (D-F31); метрик компании в UI нет (D-F30)                                                                                                                                           |
| D-26 Зона /moderator                 | работает с проблемами       | У модератора вуза нет раздела заявок при праве на обработку (D-F16); e2e зоны нет (D-F32)                                                                                                                           |

### Проблемы

#### D-F01 [P1] Очередь деканата и админа вуза показывает чужие черновики, и при сортировке по умолчанию — первыми

- Процесс: D-03 (и D-02)
- Где: apps/api/src/modules/application-services/applications.service.ts:378-387 (`buildWhere` для сотрудника не исключает `DRAFT`), :47-68 (`APP_SELECT` отдаёт `formData` в каждой строке списка); application.policy.ts:74-94 (`scopeWhere`/`canRead` статус не учитывают); apps/web/src/widgets/applications/ui/dean-applications-view.tsx:84 (сортировка по умолчанию `submittedAt desc`); create-wizard.tsx:295 (черновик создаётся уже на шаге «Подать заявку» в карточке услуги)
- Суть: черновик заводится, как только студент нажал «Подать заявку» на карточке услуги, и брошенные черновики копятся. Список `GET /applications` для DEAN/UNIVERSITY_* фильтрует только по scope, поэтому вкладка «Все» в `/dean/applications` и `/university-admin/applications` содержит черновики — с `formData` (свободный текст вроде причины академического отпуска), которые студент никуда не подавал. Сортировка по умолчанию — `submittedAt desc`, а у черновика `submittedAt = NULL`; Postgres при `DESC` ставит NULL первыми, поэтому первая страница очереди — это черновики. Тот же scope пускает сотрудника в `GET /applications/:id` черновика. Для старосты черновики уже исключены (applications.service.ts:271-273) именно из этих соображений.
- Решение: в `buildWhere` для ролей без `read:self` добавить `status: { not: 'DRAFT' }`, то же — в `getById`/`load` для не-владельца (404). В `queueStats` черновики уже не считаются — поведение станет согласованным. Добавить тест «сотрудник не видит черновики».
- Файлы для правки: apps/api/src/modules/application-services/applications.service.ts, apps/api/src/modules/application-services/application-process.service.ts, apps/api/src/modules/application-services/applications.service.spec.ts
- Стоп-точки: нет

#### D-F02 [P1] Кнопка «Отозвать» видна в статусах, из которых сервер отзыв не пропускает

- Процесс: D-02
- Где: packages/shared-schemas/src/application-services.ts:67 (`IN_REVIEW` → без `CANCELLED`), :69 (`RESUBMITTED` → только `IN_REVIEW`), :88-94 (`STUDENT_CANCELLABLE_STATUSES` включает `IN_REVIEW` и `RESUBMITTED`); apps/api/src/modules/application-services/applications.service.ts:182-187; apps/web/src/widgets/applications/ui/application-detail.tsx:98
- Суть: две константы одного файла противоречат друг другу. Веб показывает «Отозвать» по `STUDENT_CANCELLABLE_STATUSES`, сервис сначала проходит эту проверку, а затем падает на `APPLICATION_TRANSITIONS` с «Недопустимый переход». Самый частый случай — декан уже взял заявку (IN_REVIEW) или студент только что отправил исправление (RESUBMITTED): кнопка есть, нажатие даёт ошибку. Инвентаризация описывает отзыв «до подготовки», то есть IN_REVIEW должен отзываться.
- Решение: решить, какое правило верное, и свести к одному источнику: либо добавить `CANCELLED` в переходы `IN_REVIEW`/`RESUBMITTED`, либо убрать эти статусы из `STUDENT_CANCELLABLE_STATUSES`. Веб должен опираться на `canTransition(status, 'CANCELLED')`. Тест на согласованность констант.
- Файлы для правки: packages/shared-schemas/src/application-services.ts, apps/web/src/widgets/applications/ui/application-detail.tsx, apps/api/src/modules/application-services/applications.service.spec.ts
- Стоп-точки: «контракт API/shared-schemas»

#### D-F03 [P1] Повторная отправка не проверяет комплект: удалённый «к замене» документ пропускает заявку дальше

- Процесс: D-02
- Где: apps/api/src/modules/application-services/application-documents.service.ts:83-89 (`remove` в NEEDS_CORRECTION удаляет строку любого статуса), applications.service.ts:216-221 (`resubmit` считает только строки `REPLACEMENT_REQUIRED`, `assertRequiredDocuments` не вызывает)
- Суть: сотрудник помечает документ «требует замены» → заявка в NEEDS_CORRECTION. Студент вместо замены удаляет приложенный документ (`DELETE /applications/:id/documents/:requirementId` в NEEDS_CORRECTION разрешён). Строк `REPLACEMENT_REQUIRED` больше нет, `pending = 0`, заявка уходит в RESUBMITTED без обязательного документа. Так же можно удалить уже принятый документ. Проверка обязательных документов есть только в `submit`.
- Решение: в `resubmit` вызывать `assertRequiredDocuments(app.serviceId, id)` вдобавок к проверке `REPLACEMENT_REQUIRED`. В NEEDS_CORRECTION разрешить удалять только документы со статусом `REPLACEMENT_REQUIRED` (принятые — нет).
- Файлы для правки: apps/api/src/modules/application-services/applications.service.ts, apps/api/src/modules/application-services/application-documents.service.ts, apps/api/src/modules/application-services/applications.service.spec.ts
- Стоп-точки: нет

#### D-F04 [P1] Переходы заявки без проверки статуса в UPDATE: двойная отправка перевыпускает номер, гонка откатывает статус

- Процесс: D-02, D-03
- Где: apps/api/src/modules/application-services/applications.service.ts:159-163 (`submit`: `update where: { id }`), :223-227 (`resubmit`: `update where: { id }`), :134 (`updateDraft`); application-documents.service.ts:151-154 (запрос замены: `application.update where: { id: appId }`). Для сравнения — `cancel` (:189-195) и `transition` в application-process.service.ts:496-502 пишут `where: { id, status }` + `rethrowStaleStatus`.
- Суть: статус проверяется чтением, а пишется безусловно. Двойное нажатие «Отправить» (или повтор после таймаута): оба запроса проходят `loadOwnedDraft`, первый ставит номер N, второй пересчитывает `count + 1` и перезаписывает ту же заявку номером N+1, вторым `submittedAt` и вторым событием SUBMITTED — студент уже видел в тосте номер N. Если между чтением и записью сотрудник успел взять заявку (IN_REVIEW), второй `submit` вернёт её в SUBMITTED. Запрос замены документа так же безусловно ставит NEEDS_CORRECTION поверх параллельного `start-preparation`/`reject`/`cancel`.
- Решение: во всех четырёх местах писать `where: { id, status: <ожидаемый> }` и ловить P2025 через `rethrowStaleStatus`, как в `cancel`/`transition`. Для запроса замены — `where: { id: appId, status: app.status }`.
- Файлы для правки: apps/api/src/modules/application-services/applications.service.ts, apps/api/src/modules/application-services/application-documents.service.ts, соответствующие spec
- Стоп-точки: нет

#### D-F05 [P1] Мастер заявки: после смены услуги отправляется черновик прежней услуги

- Процесс: D-02
- Где: apps/web/src/widgets/applications/ui/create-wizard.tsx:76-77 (`serviceId`, `draftId` — независимые состояния), :221-226 и :245 (смена категории/услуги сбрасывает только `serviceId`), :283 (с карточки услуги «Назад» ведёт в каталог), :295 (при наличии `draftId` кнопка просто переходит к форме), :120-124 (отправка — всегда `draftId`)
- Суть: студент выбирает услугу A → «Подать заявку» (создан черновик A) → «Назад» до каталога → выбирает услугу B → «Далее». На шаге формы рисуются поля и требования B, но `draftId` указывает на черновик A. Прикрепление документа падает (`requirementId` из B не принадлежит A, сервер — «Требование не найдено»), а «Отправить» сохраняет ответы формы B в черновик A и отправляет A. Если у A нет обязательных полей и документов, студент получает поданную заявку не на ту услугу. Все ошибки при этом показываются одним тостом `loadError` (:113, :118, :129), без текста сервера.
- Решение: при смене `serviceId` сбрасывать `draftId` (или пересоздавать черновик, если `draft.service.id !== serviceId`). Показывать в тосте сообщение сервера для 400 (`Заполните поле: …`).
- Файлы для правки: apps/web/src/widgets/applications/ui/create-wizard.tsx
- Стоп-точки: нет

#### D-F06 [P1] Сотрудник видит только первую страницу документа заявки, просмотр не попадает в журнал документа

- Процесс: D-03 (и D-07)
- Где: apps/api/src/modules/application-services/application-documents.service.ts:193-220 (`presignedUrl` берёт `file.findFirst` с `orderBy: { order: 'asc' }` — одну первую страницу), apps/web/src/widgets/applications/ui/staff-workspace.tsx:399-402 (единственное действие — открыть эту ссылку); для сравнения — documents.service.ts:326-345 (`getFileUrl` по конкретному `fileId` с событием VIEW/DOWNLOAD) и document-requests.service.ts:400-430 (`getSubmissionFileUrl` пишет VIEW)
- Суть: мастер загрузки документа поддерживает несколько страниц (паспорт — разворот и прописка, диплом — с приложением), но обработчик заявки получает ссылку только на страницу с наименьшим `order`. Остальные страницы декан открыть не может и принимает документ, не видя его целиком. Кроме того, просмотр через заявку не пишет `DocumentEvent` — в журнале «кто открывал мой паспорт» у студента этого чтения нет, хотя для запросов документов и грантов оно пишется.
- Решение: отдавать список файлов документа (id, mime, order) в карточке заявки и выдавать presigned по `fileId` с проверкой `file.documentId === ad.documentId`, писать `DocumentEvent` VIEW (`metadata: { viaApplication }`). В staff-workspace показать все страницы.
- Файлы для правки: apps/api/src/modules/application-services/application-documents.service.ts, applications.controller.ts, applications.service.ts (select файлов в `getById`), apps/web/src/widgets/applications/ui/staff-workspace.tsx, entities/application-service/api/application-service-api.ts
- Стоп-точки: «контракт API/shared-schemas» (новый параметр `fileId` у `GET /applications/:id/documents/:docId/url`)

#### D-F07 [P1] Комплект по запросу документов меняется после проверки: принятый комплект с подменённым документом остаётся ACCEPTED

- Процесс: D-09
- Где: apps/api/src/modules/documents/document-requests.service.ts:604-658 (`saveSubmission`: статус комплекта не проверяется, `upsert` позиции ставит `PENDING`), :660-695 (`submitSubmission`: повторная отправка из любого статуса, :683-692 сбрасывает все вердикты), :432-458 (`reviewItem`) и :460-500 (`finalizeSubmission`) — статус комплекта тоже не проверяют
- Суть: после того как сотрудник закрыл комплект как ACCEPTED, студент через `PUT /document-requests/:id/submission` заменяет документ в позиции. Позиция становится PENDING, а сам комплект остаётся ACCEPTED: в списке у сотрудника он «принят», хотя приложен уже другой файл. `POST :id/submit` из ACCEPTED/REJECTED сбрасывает решения проверяющего без его участия. С другой стороны, сотрудник может проверить и «принять» черновик (DRAFT), который студент ещё не отправлял.
- Решение: `saveSubmission` и `submitSubmission` разрешать только в `DRAFT` и `REJECTED`/`PARTIAL` (для исправления), в `SUBMITTED`/`ACCEPTED` — CONFLICT; `reviewItem`/`finalizeSubmission` — только для `SUBMITTED`. Обновления статуса писать с условием на текущий статус. Тесты на каждый запрещённый переход.
- Файлы для правки: apps/api/src/modules/documents/document-requests.service.ts, apps/api/src/modules/documents/document-requests.service.spec.ts
- Стоп-точки: нет

#### D-F08 [P1] Архивация по сроку хранения останавливается навсегда, как только накопится 500 «просроченных, но ещё не к архиву» документов

- Процесс: D-11
- Где: apps/api/src/modules/documents/documents.service.ts:767-787 (`sweepRetention`: `findMany` по `status: 'EXPIRED'` с `take: 500`, без `orderBy` и без условия на срок; документы, у которых срок не прошёл или `retentionDays === null`, пропускаются в цикле, :776-778)
- Суть: кандидаты выбираются без фильтра по сроку. EXPIRED-документы, у которых `retentionDays` не задан (так у всех типов, пока вуз не настроил срок, — document-types.service.ts:95-102) или срок ещё не наступил, остаются EXPIRED навсегда и каждую ночь снова попадают в ту же первую пачку. Когда таких документов на всей платформе станет 500 (на 100 вузов это первые же месяцы), до остальных выборка не доходит, и архивация не срабатывает ни для одного вуза, даже с настроенным сроком.
- Решение: выбирать только те, у кого `retentionDays` задан. Можно одним SQL-запросом с join на `document_types` и условием `expires_at + retention_days * interval '1 day' < now()`. Можно циклом по вузам и типам с ненулевым `retentionDays` и условием `expiresAt < now - days` в `where`. Обрабатывать пачками до исчерпания, как `sweepStage`. Добавить тест «500 не подходящих не блокируют подходящий».
- Файлы для правки: apps/api/src/modules/documents/documents.service.ts, apps/api/src/modules/documents/document-types.service.ts, apps/api/src/modules/documents/documents.service.spec.ts
- Стоп-точки: нет

#### D-F09 [P1] Каталог типов документов вуза не доходит до клиентов: выключенный тип ломает загрузку, собственные типы недоступны

- Процесс: D-10, D-07, D-09
- Где: apps/api/src/modules/documents/document-types.controller.ts:13 (`@Roles(UNIVERSITY_ADMIN)` на весь контроллер, включая `GET /document-types`); apps/web/src/views/documents/ui/upload-wizard.tsx:64 (типы — статический `DOCUMENT_TYPES`), views/documents/ui/staff-requests.tsx:259 (то же для запросов), widgets/applications/ui/result-modal.tsx:8 (то же для результата заявки); проверка на сервере — documents.service.ts:160-165 (`assertType` → `resolveUsable`), document-types.service.ts:86-92
- Суть: админ вуза выключает тип или добавляет собственный, но ни студент, ни декан, ни преподаватель эффективный каталог получить не могут — эндпоинт закрыт ролью. Веб показывает все 25 статических типов. Студент выбирает выключенный тип, заполняет мастер, загружает файлы и в конце получает `BAD_REQUEST «Тип документа отключён»`. Загруженные файлы при этом остаются непривязанными (см. D-F21). Собственный тип вуза нельзя выбрать ни в загрузке, ни в запросе документов. Он используется только в редакторе требований услуги, то есть студент не может приложить документ такого типа из UI.
- Решение: открыть чтение эффективного каталога всем ролям вуза (например, `GET /document-types/effective` без `@Roles` с `universityId` из JWT), а управление оставить UNIVERSITY_ADMIN. В трёх местах веба брать типы из этого запроса: только `enabled`, у собственных типов — `label`.
- Файлы для правки: apps/api/src/modules/documents/document-types.controller.ts, apps/web/src/entities/document-type/api/document-type-api.ts, apps/web/src/views/documents/ui/upload-wizard.tsx, staff-requests.tsx, apps/web/src/widgets/applications/ui/result-modal.tsx, docs/PROJECT.md
- Стоп-точки: «контракт API/shared-schemas» (новый эндпоинт, изменение списка ролей)

#### D-F10 [P1] Доступ к документу третьим лицам не доходит до получателя

- Процесс: D-08
- Где: apps/api/src/modules/documents/documents.service.ts:326-345 (`getFileUrl` — единственный путь получателя, нужен id документа и файла), :352-384 (`hasActiveGrant`); documents.controller.ts — нет ручки «документы, открытые мне»; apps/web/src/views/documents/ui/document-actions.tsx:323-342 (выдача гранта UNIVERSITY/DEPARTMENT), уведомлений о гранте нет (`grantAccess` :386-404)
- Суть: студент открывает документ деканату или вузу и видит «доступ выдан». Но у декана и администрации нет ни списка открытых им документов, ни уведомления, а без id документа и файла воспользоваться грантом нельзя. На практике деканат документ не увидит, и студент всё равно понесёт бумагу. Процесс закрыт только с одной стороны.
- Решение: эндпоинт `GET /documents/shared-with-me` (гранты USER на себя, DEPARTMENT своего факультета для DEAN, UNIVERSITY своего вуза для администрации; активные, с пагинацией, только метаданные с маской номера) и экран-вкладка у получателей. Уведомление получателю при выдаче гранта USER/DEPARTMENT. Если функция сейчас не нужна, скрыть кнопку выдачи, чтобы не вводить студента в заблуждение.
- Файлы для правки: apps/api/src/modules/documents/documents.controller.ts, documents.service.ts, apps/web/src/views/documents/ui/*, docs/PROJECT.md
- Стоп-точки: «контракт API/shared-schemas» (новый эндпоинт)

#### D-F11 [P1] Два одновременных решения по жалобе применяют меру дважды

- Процесс: D-15
- Где: apps/api/src/modules/complaints/complaints.service.ts:321-327 (статус проверяется чтением), :330-368 (мера — удаление, блокировка, предупреждение — выполняется ДО смены статуса), :373-382 (`complaint.update where: { id }` без условия на статус); `take` — :184-187 (`updateMany where: { id, reviewingById: null }` без условия на статус)
- Суть: два модератора (веб + мини-апп по кнопке из Telegram, или двойной клик) решают одну жалобу. Оба проходят проверку статуса и оба выполняют меру. При WARN_USER создаются две записи `ModerationWarning` и два уведомления нарушителю, хотя счётчик предупреждений — основа следующих решений. При BLOCK_USER со сроком побеждает последняя запись срока. Статус и `resolution` перезаписываются вторым решением, автор жалобы получает два уведомления. `resolve` не проверяет и то, кто взял жалобу через `take`. Параллельный `take` может вернуть уже решённую жалобу без `reviewingById` в REVIEWING.
- Решение: в начале `resolve` атомарно «забирать» жалобу: `updateMany({ where: { id, status: { in: [PENDING, REVIEWING] } }, data: { status: RESOLVING|... } })` и при `count === 0` отвечать CONFLICT. Либо выполнять меру и смену статуса в одной транзакции с условием на статус. В `take` добавить условие `status: { in: [PENDING, REVIEWING] }`. Тест на повторный `resolve`.
- Файлы для правки: apps/api/src/modules/complaints/complaints.service.ts, apps/api/src/modules/complaints/complaints.service.spec.ts
- Стоп-точки: нет

#### D-F12 [P1] Правка одобренной вакансии сразу видна студентам без повторной модерации

- Процесс: D-20
- Где: apps/api/src/modules/career/vacancies.service.ts:105-127 (`update` пишет любые поля без проверки статуса и без сброса `VacancyUniversityReview`); сравнить с :137-138 и :157-163 (сброс решений только в `publish`); витрина — :206-210 (видимость = `PUBLISHED` + `APPROVED`)
- Суть: работодатель — внешний участник, и модерация вуза единственная преграда между его текстом и студентами. Компания публикует безобидную вакансию, вуз одобряет её, после чего `PATCH /career/employer/vacancies/:id` меняет заголовок, описание, зарплату или ссылки. Статус остаётся PUBLISHED, решение APPROVED, и новый текст сразу отображается в витрине и в карточке вакансии у всех студентов вуза. Комментарий в коде утверждает, что «вуз одобрял конкретный текст», но это верно только для повторной публикации. Обход модерации тривиален и подходит для фишинга.
- Решение: в `update` для `PUBLISHED`/`PAUSED`-вакансии с изменением содержательных полей сбрасывать её ревью в `PENDING` в той же транзакции (как в `publish`). Альтернатива — запретить правку опубликованной вакансии: только снять, править и опубликовать заново. Тест «правка одобренной вакансии убирает её с витрины».
- Файлы для правки: apps/api/src/modules/career/vacancies.service.ts, apps/api/src/modules/career/vacancies.service.spec.ts, docs/PROJECT.md (§ Карьера — правило)
- Стоп-точки: нет

#### D-F13 [P1] Истёкший допуск компании не снимает её вакансии: студенты продолжают откликаться, компания получает новых кандидатов

- Процесс: D-19, D-20, D-21
- Где: apps/api/src/modules/career/companies.service.ts:480-481 (`expiresAt` только записывается); career-access.service.ts:56-62 (срок учитывается лишь в `allowedUniversityIds`); vacancies.service.ts:203-233 (`search`) и :267-279 (`byIdForStudent`) — видимость только по `VacancyUniversityReview.status = APPROVED`; career/applications.service.ts:79-97 (`apply` — та же проверка); cleanup.service.ts — крона для истёкших допусков нет (grep по `companyUniversityAccess` вне career — только аналитика)
- Суть: каскад, закрывающий вакансии, есть только у ручного отзыва (`REVOKED`, companies.service.ts:495-509). Одобренный допуск со сроком по истечении никак не меняет решения по вакансиям. Вакансии остаются на витрине, студенты откликаются, и `pipeline` (applications.service.ts:206-244) отдаёт компании ФИО, аватар, специальность, курс и навыки новых кандидатов вуза, к которому у неё уже нет допуска. Это прямое нарушение «ключевого правила» PROJECT.md (§ Карьера): «компания видит студентов только тех вузов, где её допуск активен прямо сейчас». (Сохранение уже поданных до отзыва откликов в PROJECT.md оговорено отдельно — к этому случаю оно не относится.)
- Решение: в `search`/`byIdForStudent`/`apply` добавить условие на активный допуск компании в вуз (`company.universityAccess some { universityId, status: APPROVED, OR: [expiresAt null, expiresAt > now] }`). Плюс ежедневный крон, который переводит истёкшие допуски в REVOKED/EXPIRED с тем же каскадом и сбросом кэша. Тесты на истёкший допуск.
- Файлы для правки: apps/api/src/modules/career/vacancies.service.ts, apps/api/src/modules/career/applications.service.ts, apps/api/src/modules/career/companies.service.ts, apps/api/src/modules/cleanup/cleanup.service.ts, соответствующие spec
- Стоп-точки: нет (без нового статуса); «миграция» — если вводить отдельный статус EXPIRED

#### D-F14 [P1] Публичное резюме и карточка кандидата показывают записи портфолио с видимостью PRIVATE

- Процесс: D-23, D-22
- Где: apps/api/src/modules/career/resume.service.ts:174-184 (`portfolioItems` без фильтра по `visibility`), :136-149 (`publicBySlug` → `assemble` для анонима); career-profile.service.ts:281-294 (то же в карточке для работодателя); prisma/schema/24-portfolio.prisma:3, :16 (`visibility`: PRIVATE — «только владелец» / UNIVERSITY / PUBLIC)
- Суть: студент помечает запись портфолио как «только я». Включив публичную ссылку на резюме, он открывает её любому анониму по `GET /career/resume/public/:slug`: в опыт, проекты и сертификаты попадают все записи, включая PRIVATE и UNIVERSITY. Карточка кандидата для работодателя устроена так же. Настройка приватности, которую студент выставил в профиле, здесь молча не действует.
- Решение: в публичном резюме брать только `visibility: 'PUBLIC'`, в карточке работодателя — `PUBLIC` (или `PUBLIC`+`UNIVERSITY`, если так решит продукт), в PDF для себя — всё. На экране резюме явно показывать, какие записи попадут в публичную версию. Тест на фильтр.
- Файлы для правки: apps/api/src/modules/career/resume.service.ts, apps/api/src/modules/career/career-profile.service.ts, resume.service.spec.ts, career-profile.service.spec.ts
- Стоп-точки: нет

#### D-F15 [P2] Анкета услуги: `validation` теряется при настройке шаблона и нигде не проверяется, `formData` не ограничен, выключенную услугу можно отправить

- Процесс: D-01, D-02
- Где: apps/api/src/modules/application-services/catalog-admin.service.ts:82-97 (`DETAIL_SELECT.formFields` без `validation`) и :294-300 (копия шаблона строится из него), :436-449 (`syncFormFields` `validation` не пишет); catalog.service.ts:104 (каталог `validation` отдаёт); applications.service.ts:424-447 (`assertFormValid`: только «обязательно» и значение из options), :412-421 (`serviceOf` не проверяет `active`); packages/shared-schemas/src/application-services.ts:109-114 (`formData: z.record(z.string(), z.unknown())`); catalog.service.ts:51-55 (вложенные услуги без `take`)
- Суть: правила полей (`ServiceFormField.validation`) клиент получает, но сервер их не применяет, а «Настроить для вуза» создаёт копию без них. Тип значения (число, дата, длина) не проверяется, лишние ключи и объём `formData` не ограничены — в заявку можно положить произвольный JSON размером до лимита тела запроса. Черновик услуги, которую вуз или платформа потом выключили, по-прежнему отправляется (`submit` берёт услугу без `active`).
- Решение: копировать `validation` при `customize`, применять её и тип поля в `assertFormValid`, отбрасывать неизвестные ключи, ограничить размер значения. В `submit` проверять видимость услуги тем же `visibleServicesWhere`. Вложенной выборке услуг дать `take`.
- Файлы для правки: apps/api/src/modules/application-services/catalog-admin.service.ts, applications.service.ts, catalog.service.ts, соответствующие spec; packages/shared-schemas/src/application-services.ts (ограничение размера)
- Стоп-точки: «контракт API/shared-schemas» (только если менять схему `formData`)

#### D-F16 [P2] Заявки: обработчики не узнают о новых и исправленных заявках, просрочка SLA ни о чём не сигналит, у модератора вуза нет экрана

- Процесс: D-02, D-03, D-26
- Где: apps/api/src/modules/application-services/applications.service.ts:138-176 (`submit`) и :211-239 (`resubmit`) — уведомлений нет; просрочка — только фильтр `overdue` (:395-397) и счётчик `queueStats` (application-process.service.ts:450-458), крона нет; application.policy.ts:46 (`UNIVERSITY_MODERATOR` — `read:university` + `process`); apps/web/src/widgets/app-shell/model/nav.ts (в `UNIVERSITY_MODERATOR_NAV` нет «Заявок»), apps/web/src/app/moderator/university/** (страницы заявок нет)
- Суть: студент получает уведомление на каждом шаге, а сторона вуза о новой или повторно отправленной заявке узнаёт, только если сама откроет очередь. Просроченная по SLA заявка тихо висит. Модератор вуза по политике вправе обрабатывать заявки, но экрана для этого у него нет.
- Решение: уведомление ответственному (или сотрудникам scope) при SUBMITTED/RESUBMITTED. Ежедневный крон по просрочке (сводка обработчику). Решить, нужны ли заявки модератору вуза: добавить раздел или убрать `process` из политики.
- Файлы для правки: apps/api/src/modules/application-services/applications.service.ts, application.policy.ts, apps/api/src/modules/cleanup/cleanup.service.ts, apps/web/src/widgets/app-shell/model/nav.ts, apps/web/src/app/moderator/university/
- Стоп-точки: нет

#### D-F17 [P2] Номер заявки через `count(startsWith)`: полный подсчёт на каждую подачу и исчерпание повторов при пиковой нагрузке

- Процесс: D-02
- Где: apps/api/src/modules/application-services/applications.service.ts:499-515 (`withNumberRetry`)
- Суть: номер = число заявок года по всей платформе + 1 + попытка. При одновременных подачах (начало семестра, 100 вузов на одном счётчике) пять попыток упираются в одни и те же номера, и студент получает `CONFLICT «Не удалось присвоить номер»`. Пропуски, оставленные удачными повторами, сдвигают последующие номера на занятые. Каждая подача — `COUNT` по префиксу без гарантированного индекса.
- Решение: брать номер из последовательности Postgres на год (или атомарный счётчик в отдельной таблице `UPDATE … RETURNING`) внутри транзакции подачи.
- Файлы для правки: apps/api/src/modules/application-services/applications.service.ts, prisma/schema/16-application-services.prisma (если таблица счётчика)
- Стоп-точки: «миграция» (если вводить счётчик/sequence)

#### D-F18 [P2] Обработка заявки: назначение в любом статусе, «готово» без результата, код выдачи генерируется и нигде не используется

- Процесс: D-03
- Где: apps/api/src/modules/application-services/application-process.service.ts:96-130 (`assign` — без проверки статуса, в т.ч. DRAFT/CANCELLED/DELIVERED), :381-403 (`markReady` не требует ни одного `ApplicationResult` для электронной выдачи), :392 (`pickupCode` пишется в БД); applications.service.ts:299-304 (`getById` не выбирает `pickupCode`); apps/web/src/widgets/applications/ui/staff-workspace.tsx:125 (поле рисуется, но всегда пусто); `issue` (:406-417) код не сверяет
- Суть: заявку можно поручить сотруднику уже после закрытия. Электронную заявку можно провести в READY → DELIVERED без единого результата: студент получит «готово», а скачать нечего. Код выдачи бумажного документа создаётся, но ни студенту, ни сотруднику не показывается и при выдаче не проверяется.
- Решение: в `assign` разрешить только не терминальные статусы после DRAFT. В `markReady` для ELECTRONIC/BOTH требовать хотя бы один результат. `pickupCode` — либо показывать студенту в карточке (и сверять в `issue`), либо убрать.
- Файлы для правки: apps/api/src/modules/application-services/application-process.service.ts, applications.service.ts, apps/web/src/widgets/applications/ui/application-detail.tsx
- Стоп-точки: нет

#### D-F19 [P2] Справка об обучении: гонка двойной выдачи, отзыв без уведомления и без отметки на документе, отзыв без тестов

- Процесс: D-04
- Где: apps/api/src/modules/application-services/application-process.service.ts:231-233 (`hasActiveDocument` проверяется до регистрации без блокировки), :337-355 (`revokeStudyCertificate`: только журнал выгрузок и событие заявки); application-process.service.spec.ts — `revokeStudyCertificate` не покрыт
- Суть: два одновременных «Сформировать справку» оба проходят проверку и выпускают две действующие справки с разными кодами. После отзыва студент не получает уведомления, а документ в его хранилище остаётся «Выданным университетом» без пометки «отозван». Студент может дальше прикладывать его к заявкам и запросам, и узнать об отзыве можно только по QR.
- Решение: частичный unique-индекс на `(document_number, kind) WHERE revoked_at IS NULL` или блокировка заявки (`SELECT … FOR UPDATE`) на время выдачи. При отзыве — уведомление студенту и статус документа (например, `REJECTED`/отдельная метка) в той же операции. Тесты на отзыв.
- Файлы для правки: apps/api/src/modules/application-services/application-process.service.ts, application-process.service.spec.ts, apps/api/src/common/export/export-registry.service.ts, prisma/schema/27-exports.prisma (если индекс)
- Стоп-точки: «миграция» (если индекс)

#### D-F20 [P2] Политика заявок: декан без факультета читает и обрабатывает «вузовские» заявки любого вуза (защита в глубину)

- Процесс: D-03
- Где: apps/api/src/modules/application-services/application.policy.ts:91 (`app.facultyId === viewer.facultyId`), :106 (то же в `canProcess`); заявки услуг без `facultyScoped` хранят `facultyId = null` (applications.service.ts:103)
- Суть: у DEAN с `facultyId = null` (факультет удалён, роль сменили руками) сравнение `null === null` истинно для любой заявки без факультета в любом вузе — `GET /applications/:id`, действия обработки и presigned на документы проходят. Список при этом защищён (`scopeWhere` требует `viewer.facultyId`, :79). Инвайт DEAN факультет требует (invite-hierarchy.ts:65-69), поэтому состояние нештатное — но проверка доступа не должна от этого зависеть.
- Решение: в `canRead`/`canProcess` для `read:faculty` требовать `viewer.facultyId` не пустым и `app.universityId === viewer.universityId`.
- Файлы для правки: apps/api/src/modules/application-services/application.policy.ts, application.policy.spec.ts
- Стоп-точки: нет

#### D-F21 [P2] Сканы удалённых документов и брошенных загрузок остаются в MinIO навсегда, удалённый документ по-прежнему открывается через заявку и запрос

- Процесс: D-07, D-03, D-09
- Где: apps/api/src/modules/documents/documents.service.ts:605-609 (`remove` — только `deletedAt`); apps/api/src/modules/cleanup/cleanup.service.ts:355-358 (`cleanDetachedFiles` чистит только бакеты чатов и материалов; бакет документов с `documentId = null` не трогается); application-documents.service.ts:211-215 и document-requests.service.ts:415-418 (`file.findFirst` по `documentId` без проверки `document.deletedAt`)
- Суть: студент удаляет паспорт — запись помечается удалённой, но файлы лежат в бакете бессрочно, и сотрудник, к чьей заявке или запросу документ был приложен, продолжает получать на него presigned-ссылку. Файлы, загруженные в мастере, который не дошёл до `POST /documents` (ошибка типа — см. D-F09, закрытая вкладка), и файлы результата, не выданные из-за ошибки, становятся вечными сиротами с персональными данными.
- Решение: решить срок хранения удалённых документов (с учётом того, что заявке нужен снимок) и чистить по нему. Добавить бакет документов в `cleanDetachedFiles` с порогом возраста. В двух путях сотрудника — проверять `deletedAt` или сознательно оставить (снимок для заявки), задокументировав в PERSONAL_DATA.md.
- Файлы для правки: apps/api/src/modules/cleanup/cleanup.service.ts, apps/api/src/modules/documents/documents.service.ts, application-documents.service.ts, document-requests.service.ts
- Стоп-точки: «потеря данных» (физическое удаление файлов — согласовать срок)

#### D-F22 [P2] «Выданные университетом» документы правит владелец; студент сам заводит документы этой категории; разархивация теряет статус

- Процесс: D-07, D-03
- Где: apps/api/src/modules/documents/documents.service.ts:540-553 (`update` — номер, даты, название без проверки `issuedByUniversity`), :261-297 (`attachFiles` — добавление страниц к любому своему документу), :487-537 (`issueToOwner` — единственный легальный путь выдачи); `create` (:444-465) + packages/shared-schemas/src/documents.ts:8-13, :36-38 (категория `ISSUED_BY_UNIVERSITY` доступна в `POST /documents`, тип `STUDY_PLACE_REF` и др. проходят `assertType`); :592-603 (`setArchived(false)` всегда ставит `UPLOADED`)
- Суть: студент может дописать страницу к справке, выданной вузом, поменять в ней номер и даты — флаг `issuedByUniversity` остаётся, и документ уходит в заявки и запросы как выданный вузом. Студент также может сам создать документ категории «Выданные университетом» (без флага, но в той же категории каталога). Разархивация превращает EXPIRED/REJECTED-документ в UPLOADED.
- Решение: для `issuedByUniversity` запретить `update`/`attachFiles`/`reorderFiles` владельцу (разрешить только архив и удаление). В `create` запрещать категорию `ISSUED_BY_UNIVERSITY`. При разархивации восстанавливать статус по сроку (`expiresAt`) или сохранять прежний.
- Файлы для правки: apps/api/src/modules/documents/documents.service.ts, documents.service.spec.ts
- Стоп-точки: нет

#### D-F23 [P2] Публичная проверка резолвит коды любых выгрузок, комментарий утверждает обратное; контроллер без тестов

- Процесс: D-06
- Где: apps/api/src/common/export/export-verify.controller.ts:34-39 (комментарий «одинаковый ответ на код чужого вида выгрузки», но фильтра по `kind` нет), export-registry.service.ts:152-176 (`findByShortId` по любому `kind`)
- Суть: по коду с рабочей выгрузки (список пользователей, чат, выгрузка «мои данные», резюме) анонимная страница отвечает 200 с `kind`, датой и маской ФИО автора выгрузки (для резюме и «моих данных» `subjectName` пуст, но `kind` и дата раскрываются). Перебор 31⁸ кодов при 20 запросах в минуту нереален, поэтому риск низкий, но поведение расходится с замыслом в комментарии. Контроллер и `findByShortId` тестами не покрыты.
- Решение: определиться: либо для не-официальных `kind` отвечать 404 (как в комментарии), либо поправить комментарий. Тест на контроллер (VALID/REVOKED/404, нормализация кода).
- Файлы для правки: apps/api/src/common/export/export-verify.controller.ts, export-registry.service.spec.ts
- Стоп-точки: нет

#### D-F24 [P2] Спец-режим админа платформы: метаданные чужого документа открываются без причины, хотя веб её собирает

- Процесс: D-12
- Где: apps/api/src/modules/documents/documents.service.ts:660-674 (`platformGet`: событие и аудит без `reason`); documents.controller.ts:199-206 (`GET /documents/:id/platform` без тела); apps/web/src/views/platform-documents/ui/platform-documents-view.tsx:99-100 (причина введена в форме, но в `fetchDocumentPlatform` не передаётся)
- Суть: в аудите `DOCUMENT_PLATFORM_VIEW` нет обоснования, хотя карточка раскрывает тип, название, маску номера, даты и состав файлов чужого документа. Правило «никакого тихого доступа» для метаданных соблюдено лишь наполовину.
- Решение: принимать `reason` и для метаданных (`POST /documents/:id/platform` или query) и писать её в событие и аудит.
- Файлы для правки: apps/api/src/modules/documents/documents.controller.ts, documents.service.ts, apps/web/src/entities/document/api/document-api.ts, platform-documents-view.tsx
- Стоп-точки: «контракт API/shared-schemas»

#### D-F25 [P2] Запросы документов: срок и закрытие не работают, автор — единственный, кто видит запрос, ответ открыт любой роли, неограниченные выборки

- Процесс: D-09
- Где: apps/api/src/modules/documents/document-requests.service.ts — статус `CLOSED` нигде не выставляется (grep), `dueAt` не проверяется в `saveSubmission`/`submitSubmission` (:604-695); :278-280 (`findAuthoredOrThrow` — только `createdById`); document-requests.controller.ts:73-100 (студенческие ручки без `@Roles` — TEACHER/DEAN/админ вуза видят запросы «на весь вуз» и могут «ответить»); :73 (`take: 5000` получателей уведомления); :248-258 (`listAuthored` тянет статусы всех комплектов каждого из 200 запросов), :299-308 (`getRequestForStaff` — все комплекты без пагинации); о сдаче комплекта сотрудник не уведомляется
- Суть: запрос нельзя закрыть, после срока студенты продолжают сдавать. Если декан сменился, новый не видит и не может проверить запросы предшественника. В вузе больше 5000 студентов запрос «на весь вуз» уведомит не всех. Запрос на весь вуз с тысячами комплектов отдаётся одним ответом.
- Решение: закрытие запроса автором и кроном по `dueAt`, отказ сдачи после срока. Scope просмотра — по подразделению (факультет/вуз), а не только по автору. `@Roles(STUDENT, STAROSTA)` на студенческие ручки. Счётчики через `groupBy`, пагинация комплектов. Уведомление автору о сдаче. Рассылку уведомлений — батчами без потолка.
- Файлы для правки: apps/api/src/modules/documents/document-requests.service.ts, document-requests.controller.ts, document-requests.service.spec.ts, apps/web/src/views/documents/ui/staff-requests.tsx
- Стоп-точки: «контракт API/shared-schemas» (новые эндпоинты/роли)

#### D-F26 [P2] Выгрузка «мои данные» неполная и содержит чужие адреса

- Процесс: D-13
- Где: apps/api/src/modules/data-export/data-export.service.ts:126-150 (перечень источников); :370-381 (`invitesIssued` с `email` получателей)
- Суть: класс объявляет выгрузку полной, но в ней нет карьерного профиля, согласий, откликов и резюме (26-career.prisma), поданных жалоб и предупреждений модерации (11-complaints.prisma), обращений в поддержку, записей в деканат (23-appointments.prisma), консультаций, привязки Telegram, статей/альбомов/опросов профиля (13-profile.prisma), реакций и голосов в чатах. Работодатель получает почти пустой файл без данных компании. При этом у декана или старосты в разделе `invitesIssued` лежат email-адреса сотен приглашённых — это персональные данные других людей, вопреки правилу «только собственные строки».
- Решение: дополнить перечень по схеме (и тест-сверку «каждая модель с userId учтена или явно исключена»), в `invitesIssued` маскировать email или убрать его.
- Файлы для правки: apps/api/src/modules/data-export/data-export.service.ts, data-export.service.spec.ts, docs/PERSONAL_DATA.md
- Стоп-точки: нет

#### D-F27 [P2] Жалобы: пункт «Пожаловаться» у ролей, которым сервер отвечает 403; дубликаты завышают счётчик; закрытие дублей молчит; веб без жалобы из обращения

- Процесс: D-14, D-15, D-16, D-17
- Где: apps/web/src/widgets/feed-list/ui/post-tile-menu.tsx:101 (`canReport = !isMine` для любой роли) против apps/api/src/modules/complaints/complaints.controller.ts:33 (`@Roles(STUDENT, STAROSTA, TEACHER)`); жаловаться в вебе можно только на POST/COMMENT; complaints.service.ts:308-310 (`targetReports` считает все жалобы, комментарий обещает «разных людей»), :116-128 (нет защиты от повторной жалобы того же автора на ту же цель), :421-451 (`closeDuplicates` не уведомляет авторов закрытых дублей и не пишет `resolution`); `POST /complaints/from-support` вызывается только мини-аппом; apps/web/src/views/moderator-dashboard/ui/university-moderator-dashboard.tsx:47-50, :100 (разбивки по первым 200 жалобам)
- Суть: декан, админ вуза или работодатель жмут «Пожаловаться» и получают 403. Один настойчивый пользователь даёт «10 жалоб на цель», и модератор видит травлю там, где её нет. Авторы дублей так и не узнают итог. Остальное — пробелы интерфейса.
- Решение: показывать пункт по роли. Считать `distinct reporterId`, отклонять повторную открытую жалобу того же автора на ту же цель. В `closeDuplicates` уведомлять авторов. Добавить действие «Завести жалобу» в веб-support-desk. Агрегирующий эндпоинт для дашборда.
- Файлы для правки: apps/web/src/widgets/feed-list/ui/post-tile-menu.tsx, apps/api/src/modules/complaints/complaints.service.ts, apps/web/src/views/support-desk/ui/support-thread-modal.tsx, apps/web/src/views/moderator-dashboard/ui/university-moderator-dashboard.tsx
- Стоп-точки: «контракт API/shared-schemas» (если новый эндпоинт агрегатов)

#### D-F28 [P2] Карьера без уведомлений; неподтверждённый работодатель входит в платформу, такие аккаунты не чистятся

- Процесс: D-18, D-19, D-20, D-21
- Где: apps/api/src/modules/career/companies.service.ts:275-337 (`requestAccess`) и :447-523 (`decideAccess`) — нет `enqueue`; vacancies.service.ts:322-357 (`decide`) — нет; career/applications.service.ts:79-131 (`apply`) — компания о новом отклике не узнаёт; apps/api/src/modules/auth/auth.service.ts — вход EMPLOYER не проверяет `Company.status` (grep `PENDING_EMAIL` — нет); cleanup.service.ts — компаний `PENDING_EMAIL` не чистит
- Суть: админ вуза узнаёт о заявке компании только из очереди, компания о решении — только заглянув в кабинет, о новом кандидате — тоже. Аккаунт, созданный публичной регистрацией, может входить и пользоваться общими ручками (например, загрузкой файлов в бакет документов) до подтверждения почты. Неподтверждённые аккаунты держат занятые email бессрочно.
- Решение: уведомления (email/in-app) на заявку, решение по допуску, решение по вакансии и новый отклик. До подтверждения email — вход запрещён или доступ только к экрану подтверждения. Крон удаления неподтверждённых компаний старше N дней.
- Файлы для правки: apps/api/src/modules/career/companies.service.ts, vacancies.service.ts, applications.service.ts, apps/api/src/modules/auth/auth.service.ts, apps/api/src/modules/cleanup/cleanup.service.ts
- Стоп-точки: «изменение guard'ов» (ограничение входа)

#### D-F29 [P2] Карьерные переходы без условия на статус: решение по вакансии вновь одобряет отозванную компанию, вакансия переходит в любой статус

- Процесс: D-19, D-20
- Где: apps/api/src/modules/career/companies.service.ts:472-483 (`decideAccess`: `update where: { id }` после проверки `canTransitionAccess` чтением); vacancies.service.ts:322-347 (`decide` — без проверки статуса ревью и активного допуска), :177-194 (`setStatus` из любого статуса, в т.ч. DRAFT → PAUSED), :140-174 (`publish` из CLOSED)
- Суть: два админа, параллельно одобряющий и отклоняющий заявку, оставляют последнее слово за тем, кто записал позже, и в аудите будут оба. Ревью, погашенное каскадом отзыва (REJECTED «Университет отозвал допуск»), модератор вуза может перевести в APPROVED — вакансия компании без допуска возвращается на витрину. Статус вакансии не следует графу.
- Решение: условие на ожидаемый статус в `update`, в `decide` — разрешать APPROVED только при активном допуске компании. Граф переходов вакансии в shared-schemas.
- Файлы для правки: apps/api/src/modules/career/companies.service.ts, vacancies.service.ts, packages/shared-schemas (граф статусов вакансии)
- Стоп-точки: «контракт API/shared-schemas» (если граф вакансии в общих схемах)

#### D-F30 [P2] Мёртвые и неподключённые части карьеры: «подтверждённые сертификаты» всегда пусты, карточка кандидата и метрики компании без экрана, карьерные мероприятия только из сида

- Процесс: D-22, D-23, D-24, D-25
- Где: статус документа `VERIFIED` ставит только сид (prisma/seed/steps/70-services.mjs; в apps/api/src — только чтения: resume.service.ts:186, career-profile.service.ts:297); `GET /career/profile/candidates/:id` (career-profile.controller.ts:56-57) не вызывает ни один клиент; `fetchCompanyCareerAnalytics` (apps/web/src/entities/career-event/api/career-event-api.ts:39) ни один экран не использует; `Event.careerKind` проставляет только сид, а career-events.service.ts:26-30 игнорирует аудиторию события (FACULTY/GROUP видны всему вузу); resume.service.ts:136-149 (`publicBySlug` отдаёт резюме заблокированного пользователя)
- Суть: заявленная «ценность платформы» — подтверждённые вузом сертификаты в резюме и карточке — в продакшене всегда пуста, потому что сценария верификации документа нет. Согласия на GPA, телефон и email студент выдаёт, но экран, который бы их применял, отсутствует. У работодателя нет метрик подбора, у вуза — способа завести карьерное мероприятие.
- Решение: либо сценарий верификации сертификатов (вуз переводит CERTIFICATE в VERIFIED), либо убрать блок. Экран карточки кандидата в `/employer/candidates`. Виджет метрик компании. Поле `careerKind` в форме события. Фильтр аудитории в списке мероприятий. Скрывать публичное резюме заблокированного пользователя.
- Файлы для правки: apps/api/src/modules/documents/_, apps/web/src/views/employer/_, apps/api/src/modules/events/*, apps/api/src/modules/career/career-events.service.ts, resume.service.ts
- Стоп-точки: «контракт API/shared-schemas» (верификация документа, поле события)

#### D-F31 [P2] Метрики карьеры: доля «открытых профилей» считается от студентов без старост; выпускники — выборкой до 10 000 строк

- Процесс: D-25
- Где: apps/api/src/modules/career/career-analytics.service.ts:75-78 (`profiles` — все роли, `studentsTotal` — только `role: 'STUDENT'`); career-report.service.ts:487-525 (то же в отчёте), :333-346 (`graduates`: `findMany distinct take 10_000` вместо подсчёта)
- Суть: старосты попадают в числитель (профили), но не в знаменатель (студенты), и доля завышена, в маленькой группе — до значений больше 100 %. Подсчёт трудоустроенных выпускников выборкой молча упирается в 10 000.
- Решение: считать знаменатель по `role in [STUDENT, STAROSTA]`, числитель с тем же фильтром. Выпускников — `COUNT(DISTINCT student_id)` запросом.
- Файлы для правки: apps/api/src/modules/career/career-analytics.service.ts, career-report.service.ts, соответствующие spec
- Стоп-точки: нет

#### D-F32 [P2] Пробелы тестов группы D

- Процесс: D-02…D-26
- Где: apps/api/src/modules/application-services/*.spec.ts (нет тестов на повторную подачу/отправку, черновики в очереди, удаление документа в NEEDS_CORRECTION, `revokeStudyCertificate`); apps/api/src/common/export/export-verify.controller.ts (без тестов); document-requests.service.spec.ts (нет тестов на статус комплекта); documents.service.spec.ts (нет теста на `sweepRetention` при пачке неподходящих); complaints.service.spec.ts (нет повторного `resolve`); vacancies.service.spec.ts (нет правки одобренной вакансии, истёкшего допуска); apps/web/e2e/access.e2e.ts (зона `/moderator` не проверяется); виджеты заявок (create-wizard) без компонентных тестов
- Суть: unit-наборы модулей группы (25 наборов, 343 теста) зелёные, но все найденные выше P1 проходят сквозь них: тесты проверяют счастливый путь и права, а не гонки, статусы и смену шага мастера.
- Решение: при исправлении каждой P1 добавлять регрессионный тест; e2e на зону модератора.
- Файлы для правки: перечисленные spec/e2e
- Стоп-точки: нет
