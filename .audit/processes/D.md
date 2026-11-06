## Группа D — Услуги, документы, карьера, модерация

### D-01 Каталог услуг вуза и шаблоны платформы

- Бизнес-цель: дать вузу настраиваемый каталог услуг (категория → услуга → чек-лист документов + динамическая форма), а платформе — глобальные шаблоны, которые вуз может «настроить под себя» копией.
- Роли: UNIVERSITY_ADMIN (услуги своего вуза, customize шаблона), PLATFORM_ADMIN (глобальные шаблоны universityId=null); чтение каталога — любой вошедший.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /university-admin/services, /platform-admin/services (views/service-catalog); GET /application-categories, GET /application-categories/manage, GET /application-services/manage(/:id), POST /application-services, PUT /application-services/:id, POST /application-services/:id/customize, GET /application-services/:id.
- Завершение: услуга сохранена (убранные требования/поля выключаются active=false, не удаляются); копия шаблона с тем же code скрывает шаблон для студентов вуза; AuditLog.
- Шаги и файлы: apps/api/src/modules/application-services/application-services.controller.ts; catalog.service.ts (listCategories/getService); catalog-admin.service.ts (create/update/customize, syncRequirements/syncFormFields, assertCodeFree); service-visibility.ts (visibleServicesWhere — затенение шаблона кодом); application.policy.ts ('manage-services'); web: apps/web/src/views/service-catalog/ui/{service-catalog-view,service-editor-modal,requirements-editor,form-fields-editor}.tsx; entities/application-service/api/catalog-admin-api.ts.
- Данные на входе / выходе: UpsertApplicationServiceDto (code, nameRu/Kk/En, slaHours, deliveryModes, requiresPickup, processingMode, requirements[], formFields[]) → { id }; ApplicationCategory/ApplicationService/ServiceRequirement/ServiceFormField.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/application-services/catalog-admin.service.spec.ts; service-visibility.spec.ts; apps/web/src/entities/application-service/lib/localize.test.ts.
- Замечено: catalog.service.ts listCategories — вложенная выборка services без take (потолок только на категории).

### D-02 Подача заявки студентом: черновик, форма, документы, отправка, отзыв, повторная отправка

- Бизнес-цель: студент заказывает услугу онлайн и приходит в деканат только за готовым результатом.
- Роли: STUDENT, STAROSTA (те же права студента).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /applications, /applications/[id], /starosta/applications (widgets/applications: create-wizard, student-applications-view, application-detail, document-checklist); POST /applications, PATCH /applications/:id, POST /applications/:id/documents, DELETE /applications/:id/documents/:requirementId, POST /applications/:id/submit, POST /applications/:id/cancel, POST /applications/:id/resubmit, GET /applications, GET /applications/:id, GET /applications/:id/documents/:docId/url, GET /applications/:id/results/:resultId/url.
- Завершение: DRAFT → SUBMITTED с номером SH-YYYY-NNNNNN (год по таймзоне вуза) и dueAt = now + slaHours; либо CANCELLED (до подготовки); NEEDS_CORRECTION → RESUBMITTED после замены всех REPLACEMENT_REQUIRED документов.
- Шаги и файлы: apps/api/src/modules/application-services/applications.controller.ts; applications.service.ts (createDraft с visibleServicesWhere и facultyScoped→facultyId, updateDraft, submit: assertDeliveryAllowed/assertFormValid/assertRequiredDocuments + withNumberRetry, cancel, resubmit, list/getById со scopeWhere); application-documents.service.ts (attach документа из хранилища «Документы», remove, presignedUrl, resultUrl); application.policy.ts; переходы — @studenthub/shared-schemas APPLICATION_TRANSITIONS; web: apps/web/src/widgets/applications/ui/*.tsx, entities/application-service/api/application-service-api.ts.
- Данные на входе / выходе: serviceId, deliveryType (ELECTRONIC|PAPER), formData(Json), documentId на requirementId → Application + ApplicationDocument + ApplicationEvent (timeline).
- Внешние зависимости: PostgreSQL; MinIO (presigned через FilesModule).
- Тесты: apps/api/src/modules/application-services/applications.service.spec.ts; application-documents.service.spec.ts; application.policy.spec.ts; apps/web/e2e/applications.e2e.ts (подача студентом).
- Замечено: submit/resubmit обновляют заявку `where: { id }` без статуса (в отличие от cancel/transition с rethrowStaleStatus) и не уведомляют обработчиков о новой заявке.

### D-03 Обработка заявки деканатом/администрацией вуза

- Бизнес-цель: сотрудник в своей области (факультет/вуз) берёт заявку, проверяет документы, запрашивает исправление или отклоняет, готовит и выдаёт результат в срок SLA.
- Роли: DEAN (scope факультета), UNIVERSITY_MODERATOR и UNIVERSITY_ADMIN (scope вуза); PLATFORM_ADMIN — только чтение всех; студент получает уведомления.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /dean/applications, /university-admin/applications (widgets/applications: dean-applications-view, staff-workspace, result-modal); GET /applications/queue-stats, POST /applications/:id/{take,assign,request-correction,start-preparation,reject,results,mark-ready,issue,deliver}, GET /applications/:id/assignees, POST /applications/:id/documents/:docId/{accept,request-replacement}.
- Завершение: READY/READY_FOR_PICKUP → DELIVERED/ISSUED либо REJECTED; результат-документ выдан в кабинет студента (Document issuedByUniversity).
- Шаги и файлы: apps/api/src/modules/application-services/application-process.service.ts (take/assign/assignees, transition с оптимистичной блокировкой по статусу + ApplicationEvent, addResult → documents.issueToOwner с проверкой isOwnedBy, markReady/issue/deliver, queueStats); application-documents.service.ts (review accept/request-replacement → NEEDS_CORRECTION); application.policy.ts (canProcess); уведомления — очередь notifications, job APPLICATION_UPDATED (type APP_UPDATE, dedupeKey по id события) + realtime applicationStatusChanged владельцу.
- Данные на входе / выходе: комментарий/причина, AddResultDto (type, documentId | fileId+documentType, documentNumber, note), MarkReadyDto → Application (startedAt/readyAt/issuedAt, assignedToId), ApplicationResult, ApplicationEvent.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (notifications), WebSocket (RealtimeGateway), MinIO (файл результата).
- Тесты: apps/api/src/modules/application-services/application-process.service.spec.ts; application-documents.service.spec.ts; application.policy.spec.ts; apps/web/e2e/applications.e2e.ts (декан «Взять в работу»).
- Замечено: у UNIVERSITY_MODERATOR по ApplicationPolicy есть право process, но в UNIVERSITY_MODERATOR_NAV и под /moderator/university нет экрана заявок; просрочка SLA только фильтр/счётчик, без уведомлений/cron.

### D-04 Справка об обучении: выпуск с кодом проверки и отзыв

- Бизнес-цель: платформа сама формирует PDF-справку из данных студента с QR/кодом проверки вместо загрузки скана сотрудником; при ошибке — отзыв, после которого проверка показывает «отозван».
- Роли: DEAN, UNIVERSITY_MODERATOR, UNIVERSITY_ADMIN (право process на заявку); STUDENT получает документ.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): result-modal / staff-workspace в /dean/applications, /university-admin/applications; POST /applications/:id/results/certificate?locale=, POST /applications/:id/results/certificate/revoke.
- Завершение: запись DocumentExport (kind=certificate, shortId) → PDF → Document студента + ApplicationResult; отзыв — revokedAt в журнале + ApplicationEvent RESULT_REVOKED (файл у студента остаётся).
- Шаги и файлы: apps/api/src/modules/application-services/application-process.service.ts (issueStudyCertificate: проверка IN_PREPARATION и hasActiveDocument → users.academicSubject → exports.register (сбой журнала отменяет выдачу) → renderAndIssue; при ошибке рендера revokeByShortId; revokeStudyCertificate → revokeByDocumentNumber); study-certificate-pdf.ts, study-certificate-labels.ts; apps/api/src/common/export/export-registry.service.ts; export-branding.service.ts; apps/api/src/common/qr/qr-raster.ts.
- Данные на входе / выходе: id заявки, locale (ru/kk/en), reason → { documentId, verificationCode } / { revoked }.
- Внешние зависимости: PostgreSQL, MinIO (файл PDF), генерация PDF/QR, APP_PUBLIC_URL (ссылка в бланке).
- Тесты: apps/api/src/modules/application-services/application-process.service.spec.ts (issueStudyCertificate); apps/api/src/common/export/export-registry.service.spec.ts; revokeStudyCertificate тестами не покрыт.
- Замечено: revokeStudyCertificate не пишет уведомление студенту и не проверяет статус заявки (можно отозвать после DELIVERED — вероятно, намеренно).

### D-05 Обращения группы для старосты (только чтение)

- Бизнес-цель: староста видит заявки студентов своей группы, чтобы напоминать и помогать, без права обработки.
- Роли: STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /starosta/group-requests (widgets/applications/ui/starosta-group-requests-view.tsx); GET /applications/group-requests (@Roles STAROSTA).
- Завершение: отображён список заявок группы с фильтрами.
- Шаги и файлы: apps/api/src/modules/application-services/applications.controller.ts (groupRequests); applications.service.ts listGroupRequests; apps/web/src/entities/application-service/api/application-service-api.ts.
- Данные на входе / выходе: ApplicationQueryDto (фильтры, пагинация) → ApplicationListItem[] без черновиков (where student.groupId = groupId из JWT).
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/application-services/applications.service.spec.ts (describe listGroupRequests).

### D-06 Проверка подлинности документа по QR/коду

- Бизнес-цель: третья сторона (банк, работодатель, посольство) без аккаунта сверяет справку по короткому коду из бланка: действительна / отозвана / не официальный документ.
- Роли: гость (публично); любой вошедший.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /verify/[code] (публичный путь в apps/web/src/middleware.ts) → views/verify-document/ui/verify-document-view.tsx; GET /verify/:code (@Public, throttle 20/мин).
- Завершение: показаны тип (certificate или «не официальный документ»), номер, выдавший вуз, ФИО в маске, дата, статус VALID/REVOKED; иначе 404 одинаковый для любых «чужих» кодов.
- Шаги и файлы: apps/api/src/common/export/export-verify.controller.ts; apps/api/src/common/export/export-registry.service.ts (findByShortId, maskName); apps/web/src/app/verify/[code]/page.tsx.
- Данные на входе / выходе: code (8 символов без похожих) → { code, kind, number, issuer, subject(маска), issuedAt, revokedAt, status }.
- Внешние зависимости: PostgreSQL (DocumentExport).
- Тесты: apps/api/src/common/export/export-registry.service.spec.ts (генерация кода, без findByShortId); контроллер и страница проверки — нет.
- Замечено: в журнале DocumentExport лежат и рабочие выгрузки (резюме, отчёты, чаты, данные пользователя) — их коды тоже резолвятся публично (скупо, с пометкой «не официальный»).

### D-07 Личное хранилище документов: загрузка, страницы, правка, архив, удаление

- Бизнес-цель: защищённое хранилище личных документов (паспорт, дипломы, справки) для переиспользования в заявках и ответах на запросы вуза; полный номер наружу не отдаётся.
- Роли: все вошедшие (основной пользователь — STUDENT/STAROSTA; пункт «Документы» в навигации у всех ролей).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /documents (views/documents: documents-view → overview-panel, documents-list, upload-wizard, doc-modal, document-actions); POST /documents/upload (multipart), POST /documents/upload/presign + PUT в MinIO + POST /documents/upload/confirm, POST /documents, POST /documents/:id/files, PATCH /documents/:id/files/order, GET /documents, GET /documents/overview, GET/PATCH /documents/:id, POST /documents/:id/{archive,unarchive}, DELETE /documents/:id.
- Завершение: Document (status UPLOADED…) с прикреплёнными File (страницы), маска номера numberMasked; архив/мягкое удаление с DocumentEvent.
- Шаги и файлы: apps/api/src/modules/documents/documents.controller.ts; documents.service.ts (uploadFile/presignFile/confirmFile — только PDF/JPG/PNG, attachFiles, reorderFiles, create с assertType → DocumentTypesService.resolveUsable, mask/last4, list/overview, setArchived, remove, logEvent); apps/web/src/entities/document/api/document-api.ts; entities/document/ui/document-file-viewer.tsx.
- Данные на входе / выходе: файл (PDF/JPG/PNG), CreateDocumentDto (category, type, title, number, issuedAt, expiresAt) → DocumentDto (numberMasked, files, status).
- Внешние зависимости: MinIO (бакет documents, presigned PUT/GET), PostgreSQL.
- Тесты: apps/api/src/modules/documents/documents.service.spec.ts; apps/web/e2e/applications.e2e.ts (загрузка удостоверения через мастер).
- Замечено: upload-wizard.tsx берёт типы из статического DOCUMENT_TYPES — выключенные вузом типы падают на сервере BAD_REQUEST, а custom-типы вуза студенту недоступны (GET /document-types только UNIVERSITY_ADMIN).

### D-08 Доступ к документу третьим лицам и журнал просмотров

- Бизнес-цель: владелец открывает документ деканату/вузу/конкретному человеку на срок и с причиной, может отозвать; каждое открытие файла фиксируется.
- Роли: владелец (выдаёт/отзывает); получатели — USER (любой пользователь), DEPARTMENT (только DEAN этого факультета), UNIVERSITY (UNIVERSITY_ADMIN/MODERATOR, DEAN того же вуза).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /documents (вкладка «Управление доступом» = DocumentsList preset="shared"; AccessModal в document-actions.tsx); GET/POST /documents/:id/access, DELETE /documents/:id/access/:accessId, GET /documents/:id/events, GET /documents/:id/files/:fileId/url?download=1.
- Завершение: DocumentAccess создан/отозван (revokedAt); presigned-URL выдан владельцу (событие DOWNLOAD) или держателю активного гранта (событие VIEW); чужому — 404.
- Шаги и файлы: apps/api/src/modules/documents/documents.service.ts (grantAccess, listAccess, revokeAccess, getFileUrl, hasActiveGrant, listEvents); apps/web/src/views/documents/ui/{document-actions,documents-list}.tsx.
- Данные на входе / выходе: GrantAccessDto (granteeType UNIVERSITY|DEPARTMENT|USER, granteeId, reason, expiresAt) → список грантов с active; DocumentEvent (GRANT/REVOKE/VIEW/DOWNLOAD).
- Внешние зависимости: MinIO (presigned GET), PostgreSQL.
- Тесты: apps/api/src/modules/documents/documents.service.spec.ts (describe «доступ (15.11)»).
- Замечено: у получателя гранта нет ни эндпоинта, ни экрана «документы, открытые мне» — воспользоваться грантом можно только зная id документа и файла; уведомления о выдаче гранта нет.

### D-09 Запросы документов от вуза: адресация, ответ студента, проверка комплекта

- Бизнес-цель: деканат/студофис/преподаватель запрашивают у студентов комплект документов (чек-лист), студенты отвечают из своего хранилища, сотрудник проверяет по позициям.
- Роли: DEAN (свой факультет/группы/студенты), UNIVERSITY_MODERATOR (весь вуз), TEACHER (группы своих дисциплин, только ACADEMIC-типы) — создают и проверяют; STUDENT/STAROSTA — отвечают.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /documents (вкладка «Запросы университета»: requests-panel → staff-requests / student-requests); POST /document-requests, GET /document-requests/authored, GET /document-requests/manage/:id, GET /document-requests/submissions/:submissionId, GET /document-requests/submission-items/:itemId/files/:fileId/url, PATCH /document-requests/submission-items/:itemId/review, POST /document-requests/submissions/:submissionId/finalize, GET /document-requests, GET /document-requests/:id, PUT /document-requests/:id/submission, POST /document-requests/:id/submit.
- Завершение: DocumentSubmission → SUBMITTED → ACCEPTED | REJECTED | PARTIAL; студент уведомлён о результате.
- Шаги и файлы: apps/api/src/modules/documents/document-requests.controller.ts; document-requests.service.ts (createRequest + assertTargetsInScope (WRONG_SCOPE) + resolveTargetStudentIds → очередь DOCUMENT_REQUEST; saveSubmission (документы только свои), submitSubmission (все обязательные позиции), reviewItem, finalizeSubmission → DOCUMENT_RESULT; getSubmissionFileUrl с событием VIEW); apps/web/src/entities/document-request/api/document-request-api.ts.
- Данные на входе / выходе: title, dueAt, items[{documentType, required}], targets[{UNIVERSITY|FACULTY|GROUP|USER, targetId}] → DocumentRequest(+Item/Target); ответ items[{requestItemId, documentId}] → DocumentSubmission(+Item), вердикт ACCEPTED|REJECTED + rejectionReason.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (notifications), MinIO (presigned).
- Тесты: apps/api/src/modules/documents/document-requests.service.spec.ts.
- Замечено: статус запроса CLOSED нигде не выставляется и dueAt не применяется; saveSubmission не проверяет статус комплекта — после ACCEPTED студент может подменить документ, а комплект останется ACCEPTED; о сдаче комплекта сотрудник не уведомляется.

### D-10 Каталог типов документов вуза

- Бизнес-цель: вуз поверх 25 статических типов из @studenthub/shared-config включает/выключает типы, задаёт срок хранения (retentionDays) и добавляет собственные типы.
- Роли: UNIVERSITY_ADMIN.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /university-admin/document-types (views/document-types: document-types-admin-view, create-document-type-modal); GET /document-types, POST /document-types, PATCH /document-types/:typeId, DELETE /document-types/:typeId.
- Завершение: эффективный каталог (статика + правки DocumentType) возвращён и используется при создании документов/запросов (resolveUsable) и архивации (retentionDays).
- Шаги и файлы: apps/api/src/modules/documents/document-types.controller.ts (@Roles UNIVERSITY_ADMIN); document-types.service.ts (effective, resolveUsable, retentionDays, updateType, addCustom, remove); apps/web/src/entities/document-type/api/document-type-api.ts.
- Данные на входе / выходе: { code, category, name } / { enabled, retentionDays } → EffectiveDocumentType[].
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/documents/document-types.service.spec.ts.
- Замечено: эффективный каталог не отдаётся студентам и сотрудникам (см. D-07) — UI загрузки его не учитывает.

### D-11 Истечение срока документов и архивирование по сроку хранения

- Бизнес-цель: предупредить владельца о скором истечении документа, пометить просроченные и убрать их в архив по retentionDays вуза.
- Роли: система; уведомления — владелец документа.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): cron sweepDocumentExpiry ('30 3 * * *') в apps/api/src/modules/cleanup/cleanup.service.ts под cron-lock.
- Завершение: status → EXPIRING / EXPIRED, затем ARCHIVED (archivedAt) при expiresAt + retentionDays; DocumentEvent EXPIRE/ARCHIVE; уведомление DOCUMENT_EXPIRING.
- Шаги и файлы: apps/api/src/modules/documents/documents.service.ts (sweepExpiry → sweepStage, sweepRetention — одна пачка за прогон); document-types.service.ts retentionDays; apps/api/src/common/redis/cron-lock.service.ts.
- Данные на входе / выходе: Document.expiresAt, DocumentType.retentionDays → статусы, события, задачи в очереди notifications.
- Внешние зависимости: PostgreSQL, Redis (cron-lock, BullMQ).
- Тесты: apps/api/src/modules/documents/documents.service.spec.ts (sweepExpiry); apps/api/src/modules/cleanup/cleanup.service.spec.ts.

### D-12 Спец-режим доступа платформенного админа к документу

- Бизнес-цель: по обоснованному поводу (жалоба, запрос органов) админ платформы открывает чужой документ только с обязательной причиной и полным следом в аудите.
- Роли: PLATFORM_ADMIN.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /platform-admin/document-access (views/platform-documents/ui/platform-documents-view.tsx); GET /documents/:id/platform, POST /documents/:id/platform-access.
- Завершение: метаданные документа / пачка presigned-URL (1..50 файлов) выданы; DocumentEvent VIEW (platformMode) + AuditLog DOCUMENT_PLATFORM_VIEW / DOCUMENT_PLATFORM_DOWNLOAD (одна запись на пачку с metadata.fileIds).
- Шаги и файлы: apps/api/src/modules/documents/documents.controller.ts (@Roles PLATFORM_ADMIN); documents.service.ts (platformGet, platformFileUrls — чужой файл в пачке = отказ целиком); dto/platform-access.dto.ts; apps/api/src/common/audit/audit.service.ts.
- Данные на входе / выходе: docId, { fileIds[], reason } → DocumentDto / { urls: Record<fileId, url> }.
- Внешние зависимости: MinIO (presigned), PostgreSQL.
- Тесты: apps/api/src/modules/documents/documents.service.spec.ts (platformFileUrls).
- Замечено: GET /documents/:id/platform открывает метаданные без причины (причина обязательна только для файлов).

### D-13 Выгрузка своих персональных данных

- Бизнес-цель: по праву субъекта ПДн дать человеку машиночитаемый архив всего, что о нём хранит платформа (без ключей доступа и чужих данных).
- Роли: любой вошедший пользователь (все роли, включая EMPLOYER).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /settings → блок «Приватность» (widgets/account-settings/ui/account-settings-panels.tsx, mutation exportMyData); GET /me/export?locale= (throttle 3/час).
- Завершение: JSON-файл отдан с Content-Disposition; AuditLog personal_data_export + запись DocumentExport (kind=my-data, shortId).
- Шаги и файлы: apps/api/src/modules/data-export/data-export.controller.ts; data-export.service.ts (exportPersonalData → collect: ~20 разделов по userId, потолок SECTION_LIMIT=5000 + флаг truncated, AUDIT_LIMIT=2000; маска номера документа; без passwordHash/2FA/refresh/инвайт-токенов); apps/api/src/common/export/{export-branding,export-registry}.service.ts; apps/web/src/entities/user/api/user-api.ts exportMyData (requestFile).
- Данные на входе / выходе: locale → { generatedAt, platform, subject, notice, account, sections{rows,count,truncated} }.
- Внешние зависимости: PostgreSQL; throttler storage (Redis).
- Тесты: apps/api/src/modules/data-export/data-export.service.spec.ts.
- Замечено: выгрузка собирается синхронно в памяти запроса (до 5000 строк × ~20 разделов) — без очереди и фоновой сборки.

### D-14 Подача жалобы на контент или пользователя

- Бизнес-цель: участник сообщества сообщает о нарушении (пост, комментарий, сторис, сообщение, человек); срочные жалобы сразу доходят до команды платформы.
- Роли: STUDENT, STAROSTA, TEACHER (@Roles на POST /complaints); получатели сигнала — команда платформы в Telegram.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): лента — features/report-content/ui/report-modal.tsx из widgets/feed-list/ui/post-tile-menu.tsx (POST) и post-lightbox.tsx (COMMENT); POST /complaints (throttle 10/час).
- Завершение: Complaint PENDING с priority, выведенным из типа цели (USER — HIGH), и universityId цели; AuditLog complaint_created; при HIGH — TelegramNotifyService.notifyStaff с кнопкой «беру».
- Шаги и файлы: apps/api/src/modules/complaints/complaints.controller.ts; complaints.service.ts (create → getTarget (истёкшая сторис = NOT_FOUND; на сообщение — только участник чата, иначе 404), complaintPriorityFor из @studenthub/shared-schemas, announceIfUrgent); apps/api/src/common/telegram/telegram-notify.service.ts; apps/web/src/entities/complaint/api/complaint-api.ts.
- Данные на входе / выходе: CreateComplaintSchema { targetType, targetId, reason } → Complaint.
- Внешние зависимости: PostgreSQL, Telegram Bot API, throttler storage.
- Тесты: apps/api/src/modules/complaints/complaints.service.spec.ts (create, приоритет, жалоба на сообщение, уведомление команды).
- Замечено: веб даёт пожаловаться только на POST и COMMENT (MESSAGE/USER/STORY — ни в вебе, ни в iOS/Android), а пункт «Пожаловаться» показывается любой роли, хотя DEAN/админам/EMPLOYER сервер ответит 403.

### D-15 Разбор жалоб модератором: решение, блокировка, предупреждение, повторный разбор

- Бизнес-цель: модерация в своём scope разбирает очередь жалоб и применяет меру: снять контент, заблокировать (со сроком или бессрочно), предупредить автора или отклонить; автор жалобы узнаёт итог.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR (все вузы), UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR (свой вуз); снимать контент можно только у автора ниже по роли.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /moderator/university/complaints, /moderator/platform/complaints, /university-admin/complaints, /platform-admin/complaints (views/moderation: complaints-queue-view, complaint-detail-modal); мини-апп screens/complaints.tsx; GET /complaints, GET /complaints/:id, GET /complaints/:id/messages, PATCH /complaints/:id/{take,resolve,reopen}.
- Завершение: Complaint RESOLVED/DISMISSED (resolvedById, resolution); побочный эффект (soft delete поста/комментария/сообщения, физическое удаление сторис через StoriesService.removeByModeration, users.setBlocked с разрывом сессий, ModerationWarning + уведомление MODERATION_WARNING); уведомление автору COMPLAINT_RESOLVED; опционально закрытие дублей; AuditLog.
- Шаги и файлы: apps/api/src/modules/complaints/complaints.service.ts (list/getById со scopeWhere и findScoped → WRONG_SCOPE, take — атомарно по reviewingById: null, resolve, closeDuplicates, reopen (побочные действия не откатываются), getMessageContext — чат по жалобе с аудитом moderator_chat_access, softDeleteTarget, ownerOf c includeDeleted); apps/api/src/modules/users/users.service.ts (setBlocked, warn); cron liftExpiredBlocks в apps/api/src/modules/cleanup/cleanup.service.ts снимает временные блокировки.
- Данные на входе / выходе: ResolveComplaintSchema { action DELETE_CONTENT|BLOCK_USER|WARN_USER|DISMISS, comment, blockDays, applyToDuplicates } → Complaint; ComplaintListQuery (status, priority, sort) → Paginated.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (notifications), Telegram (квитирование из уведомления).
- Тесты: apps/api/src/modules/complaints/complaints.service.spec.ts (scope, resolve, reopen, take, getMessageContext); apps/api/test/complaints.e2e-spec.ts (доступ к чату по жалобе, чужой вуз); apps/api/src/modules/users/users.service.spec.ts (warn).
- Замечено: resolve проверяет статус чтением, а пишет `update where: { id }` без статуса — два одновременных решения выполнят меру (блок/предупреждение) дважды; resolve не проверяет, кто взял жалобу через take.

### D-16 Разбор обращений в поддержку платформы и заведение жалобы из обращения

- Бизнес-цель: команда платформы отвечает на обращения пользователей (текст/голос), тегирует, склеивает, эскалирует и закрывает их; из обращения можно завести жалобу от имени автора.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR (разбор); любой пользователь — автор обращения.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /platform-admin/support, /moderator/platform/support (views/support-desk: support-desk-view, support-thread-modal); мини-апп screens/support.tsx; GET /support, GET /support/tags, GET /support/:id, POST /support/:id/{reply,voice,merge,escalate}, PATCH /support/:id/{assign,tags,close}; POST /complaints/from-support; cron closeStaleTickets ('0 5 * * *').
- Завершение: обращение закрыто (переписка остаётся) или жалоба заведена с автором = автор обращения и текстом из первого сообщения.
- Шаги и файлы: API живёт в модуле chats — apps/api/src/modules/chats/support.controller.ts, support.service.ts; apps/api/src/modules/complaints/complaints.service.ts createFromSupport; apps/web/src/entities/support-ticket/api/support-ticket-api.ts; apps/web/src/views/support-desk/ui/tag-label.ts.
- Данные на входе / выходе: text / audio multipart / tags[≤3] / intoId → SupportThread, SupportMessage; { chatId, targetId } → Complaint.
- Внешние зависимости: PostgreSQL, MinIO (голосовые), Telegram (дежурство/эскалация).
- Тесты: apps/api/src/modules/chats/support.service.spec.ts; apps/api/src/modules/complaints/complaints.service.spec.ts (createFromSupport).
- Замечено: POST /complaints/from-support вызывается только из мини-аппа (apps/mini-app/src/api/complaints.ts) — в веб-support-desk такого действия нет.

### D-17 Дашборд модератора вуза и журнал действий модерации

- Бизнес-цель: модератор вуза видит состояние очереди (сколько ждёт, что горит, на что жалуются, что сделано) и журнал своих действий.
- Роли: UNIVERSITY_MODERATOR (дашборд); журнал — PLATFORM_ADMIN, PLATFORM_MODERATOR, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR (по scope).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /moderator/university (views/moderator-dashboard/ui/university-moderator-dashboard.tsx), /moderator/university/audit, /moderator/platform/audit (views/moderation/ui/audit-view.tsx); GET /complaints, GET /users, GET /audit.
- Завершение: отрисованы счётчики очереди, разбивка по типам цели, график по дням и лента действий.
- Шаги и файлы: apps/web/src/views/moderator-dashboard/ui/university-moderator-dashboard.tsx (агрегаты считаются на клиенте по первым 200 записям); apps/web/src/entities/audit/api/audit-api.ts; apps/api/src/common/audit/audit.controller.ts (API не из группы D).
- Данные на входе / выходе: страницы жалоб/пользователей/аудита → клиентские агрегаты.
- Внешние зависимости: PostgreSQL.
- Тесты: нет.
- Замечено: отдельного агрегирующего эндпоинта нет — при очереди больше 200 записей цифры дашборда неполные.

### D-18 Саморегистрация работодателя, подтверждение email и профиль компании

- Бизнес-цель: внешняя компания сама заводит аккаунт (единственное исключение из «только по инвайтам»), подтверждает корпоративный email и ведёт профиль компании.
- Роли: гость → EMPLOYER (владелец компании).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /employer/signup, /employer/verify?token= (views/employer: employer-signup-view, employer-verify-view; публичные пути в middleware.ts), /employer/company (employer-company-view); POST /career/companies/signup (@Public, 5/15 мин), POST /career/companies/verify-email (@Public, 10/15 мин), POST /career/companies/resend-verification (@Public, 3/15 мин), GET|PATCH /career/companies/me (EMPLOYER).
- Завершение: Company PENDING_EMAIL + User EMPLOYER (без scope вуза, profileVisibility=PRIVATE) → после перехода по ссылке Company ACTIVE, токен погашен; AuditLog.
- Шаги и файлы: apps/api/src/modules/career/companies.controller.ts; companies.service.ts (signup — занятый email даёт тот же ответ без создания, токен 32 байта хранится хэшем, срок сутки → очередь EMAIL job SEND_COMPANY_VERIFICATION; resendVerification — одинаковый 202 для любого адреса; verifyEmail; myCompany/updateMyCompany с assertOwner; uniqueSlug); apps/web/src/entities/company/api/*.
- Данные на входе / выходе: EmployerSignupDto (email, password, firstName, lastName, companyName, website) → { email }; { token } → { companyId }; UpdateCompanyDto → карточка компании.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (очередь email), SMTP (письмо со ссылкой), throttler storage.
- Тесты: apps/api/src/modules/career/companies.service.spec.ts; apps/api/test/career.e2e-spec.ts («регистрация и подтверждение email»).

### D-19 Допуск компании к студентам вуза: заявка, решение, отзыв с каскадом

- Бизнес-цель: компания получает доступ к студентам конкретного вуза только с его одобрения; отзыв действует немедленно и снимает её вакансии в этом вузе.
- Роли: EMPLOYER (заявка); UNIVERSITY_ADMIN, PLATFORM_ADMIN (решение); UNIVERSITY_MODERATOR, PLATFORM_MODERATOR, DEAN (только чтение очереди).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /employer/access (employer-access-view); /career/companies (views/career/ui/career-companies-view.tsx, вуз — query-параметр для платформенных ролей); GET /career/companies/me/access, GET /career/companies/me/universities, POST /career/companies/me/access, GET /career/university/companies, PATCH /career/university/companies/:id.
- Завершение: CompanyUniversityAccess REQUESTED → APPROVED (опц. expiresAt) | REJECTED | REVOKED; при REVOKED в той же транзакции все VacancyUniversityReview компании в этом вузе (PENDING/APPROVED) → REJECTED с причиной; кэш допусков сброшен; AuditLog company_access_*.
- Шаги и файлы: apps/api/src/modules/career/companies.service.ts (requestAccess — только ACTIVE-компания и ACTIVE-вуз, повтор из REJECTED/REVOKED; universityAccessList; decideAccess с canTransitionAccess и resolveUniversityScope); university-companies.controller.ts; career-access.service.ts (allowedUniversityIds из БД на каждый запрос + Redis-кэш 60 с, invalidate); career-scope.ts.
- Данные на входе / выходе: { universityId, message } → заявка; DecideCompanyAccessDto { status, reason, expiresAt, universityId? } → решение.
- Внешние зависимости: PostgreSQL, Redis (кэш допусков).
- Тесты: apps/api/src/modules/career/companies.service.spec.ts; career-access.service.spec.ts; career-scope.spec.ts; career-roles.spec.ts; apps/api/test/career.e2e-spec.ts («допуск компании к вузу», «отзыв допуска закрывает вакансии»).
- Замечено: ни заявка компании, ни решение вуза никого не уведомляют (нет enqueue — ни админу вуза, ни работодателю); истечение expiresAt не каскадирует на одобренные вакансии (см. D-20).

### D-20 Вакансии: создание, публикация на модерацию вузам, витрина студенту

- Бизнес-цель: компания публикует вакансию, каждый допустивший вуз модерирует её отдельно; студент видит только одобренные своим вузом вакансии с процентом совпадения с профилем.
- Роли: EMPLOYER (CRUD и переходы); UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, PLATFORM_ADMIN, PLATFORM_MODERATOR (решение), DEAN (чтение очереди); STUDENT/STAROSTA/TEACHER/DEAN/админы вуза/платформенные роли — витрина.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /employer/vacancies (employer-vacancies-view); /career/vacancy-review (career-vacancy-review-view); /career/vacancies (career-vacancies-view, vacancy-detail-modal); GET|POST /career/employer/vacancies, PATCH /career/employer/vacancies/:id, POST /career/employer/vacancies/:id/{publish,pause,close}; GET /career/university/vacancies, PATCH /career/university/vacancies/:id; GET /career/vacancies, GET /career/vacancies/:id.
- Завершение: Vacancy DRAFT → PUBLISHED (ревью PENDING по каждому вузу с активным допуском; повторная публикация сбрасывает решения) → PAUSED/CLOSED; VacancyUniversityReview APPROVED|REJECTED; на витрине — PUBLISHED + APPROVED этим вузом + дедлайн не истёк.
- Шаги и файлы: apps/api/src/modules/career/vacancies.controller.ts; vacancies.service.ts (create/update/assertSalaryRange, publish, setStatus, search с resolveUniversityScope, byIdForStudent, reviewQueue, decide, matchProfile/matchVacancy); apps/web/src/entities/vacancy/api/*; apps/web/src/views/career/lib/salary-text.ts.
- Данные на входе / выходе: VacancyInput (title, description, employmentType, workFormat, experienceLevel, city, salaryMin/Max, skills, deadline) → Vacancy; DecideVacancyDto { status, reason } → ревью; VacancySearchDto → Paginated с match%.
- Внешние зависимости: PostgreSQL, Redis (кэш допусков).
- Тесты: apps/api/src/modules/career/vacancies.service.spec.ts; apps/api/test/career.e2e-spec.ts («публикация и модерация вакансии»).
- Замечено: PATCH опубликованной и одобренной вакансии не сбрасывает ревью в PENDING — новый текст сразу виден студентам без модерации; search/apply не проверяют активность допуска, поэтому после истечения expiresAt одобренные вакансии остаются на витрине; о решении вуза компания не уведомляется.

### D-21 Отклики на вакансии и воронка кандидатов

- Бизнес-цель: студент откликается на одобренную вакансию, компания ведёт его по воронке, студент видит каждый шаг и может отозвать отклик.
- Роли: STUDENT, STAROSTA (отклик, отзыв, история); EMPLOYER (воронка, смена статуса, история).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/applications (career-applications-view), /career/vacancies (кнопка отклика); /employer/candidates (employer-candidates-view); GET|POST /career/applications, GET /career/applications/:id/history, POST /career/applications/:id/withdraw; GET /career/employer/applications, PATCH /career/employer/applications/:id.
- Завершение: CareerApplication SUBMITTED → VIEWED → SHORTLISTED → INTERVIEW → OFFER → HIRED | REJECTED | WITHDRAWN; каждый переход — CareerApplicationEvent; студенту уведомление APPLICATION_UPDATED (с причиной отказа).
- Шаги и файлы: apps/api/src/modules/career/applications.controller.ts; applications.service.ts (apply — только PUBLISHED+APPROVED вузом студента и до дедлайна, один отклик на вакансию, universityId фиксируется; listMine; withdraw; history для автора/компании; pipeline; changeStatus с правилами переходов); apps/web/src/entities/career-application/api/*.
- Данные на входе / выходе: { vacancyId, coverLetter } → { id }; ChangeApplicationStatusDto { status, reason } → событие + уведомление.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (notifications).
- Тесты: apps/api/src/modules/career/applications.service.spec.ts; apps/api/test/career.e2e-spec.ts («отклики и воронка», «отзыв допуска закрывает вакансии, но не отклики»).
- Замечено: pipeline/changeStatus не проверяют активный допуск вуза — после отзыва компания по-прежнему видит ФИО, аватар и навыки кандидатов этого вуза, что расходится с «ключевым правилом» Карьеры в PROJECT.md §8.3; о новом отклике компания не уведомляется.

### D-22 Карьерный профиль студента, согласия на передачу данных и карточка кандидата

- Бизнес-цель: студент заполняет карьерный профиль (видимость, статус поиска, ожидания), видит готовность и сам решает, какие поля (GPA, телефон, email) можно отдать всем или конкретной компании; работодатель видит только разрешённое.
- Роли: STUDENT, STAROSTA (профиль и согласия); EMPLOYER (карточка кандидата при активном допуске).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/profile (career-profile-view), /career (career-view — готовность); GET|PATCH /career/profile, POST /career/profile/consents, GET /career/profile/candidates/:id (EMPLOYER).
- Завершение: CareerProfile сохранён (смена видимости — отдельное событие аудита); CareerConsent выдано/погашено (не удаляется, повтор не плодит записи); карточка отдана с gpa/phone/email только при согласии, иначе null; каждое открытие — AuditLog.
- Шаги и файлы: apps/api/src/modules/career/career-profile.controller.ts; career-profile.service.ts (myProfile + careerReadiness, updateMyProfile, setConsent, cardForEmployer → CareerAccessService.assertCanAccessUniversity, allowedFields); apps/web/src/entities/career-profile/api/*.
- Данные на входе / выходе: UpdateCareerProfileDto (visibility HIDDEN|EMPLOYERS, employmentStatus, desiredPositions, employmentTypes, workFormats, relocationReady, desiredSalaryMin/Max, about) → профиль + readiness; SetCareerConsentDto { field GPA|PHONE|EMAIL, companyId?, granted } → список согласий.
- Внешние зависимости: PostgreSQL, Redis (кэш допусков).
- Тесты: apps/api/src/modules/career/career-profile.service.spec.ts; apps/api/test/career.e2e-spec.ts («карточка кандидата и согласия»).
- Замечено: GET /career/profile/candidates/:id не вызывается ни одним клиентом (web, iOS, Android, мини-апп) — согласия студент выдаёт, но работодательский экран карточки кандидата их не использует.

### D-23 Резюме из профиля: PDF и публичная ссылка

- Бизнес-цель: собрать резюме из профиля, портфолио и подтверждённых вузом сертификатов; скачать PDF или опубликовать по ссылке (с контактами по желанию).
- Роли: STUDENT, STAROSTA; гость — просмотр по ссылке.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/resume (career-resume-view), /r/resume/[slug] (public-resume-view, публичный путь в middleware.ts); GET|PATCH /career/resume, GET /career/resume/pdf, GET /career/resume/public/:slug (@Public, 30/мин).
- Завершение: Resume (title, includeContacts, publicSlug 9 байт base64url + publishedAt либо снят); PDF отдан и зарегистрирован в DocumentExport; публичный JSON без таймзоны.
- Шаги и файлы: apps/api/src/modules/career/resume.controller.ts; resume.service.ts (mine, update, pdf → exports.register, publicBySlug, assemble: User + careerProfile.about + portfolioItems (take 50) + documents CERTIFICATE/VERIFIED (take 30)); resume-pdf.ts; apps/web/src/entities/resume/api/*.
- Данные на входе / выходе: UpdateResumeDto { title, published, includeContacts } → настройки; slug → собранное резюме; locale → PDF.
- Внешние зависимости: PostgreSQL, генерация PDF (export-branding).
- Тесты: apps/api/src/modules/career/resume.service.spec.ts.

### D-24 Карьерные мероприятия вуза

- Бизнес-цель: показать студентам и сотрудникам ярмарки, воркшопы, дни собеседований, презентации компаний и хакатоны своего вуза с отметкой об участии.
- Роли: STUDENT, STAROSTA, TEACHER, DEAN, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, PLATFORM_ADMIN, PLATFORM_MODERATOR.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/events (views/career/ui/career-events-view.tsx); GET /career/events.
- Завершение: список Event с careerKind ≠ null и признаком участия; регистрация — общим модулем событий.
- Шаги и файлы: apps/api/src/modules/career/career-events.controller.ts; career-events.service.ts (list по universityId, фильтр kind); apps/web/src/entities/career-event/api/*.
- Данные на входе / выходе: CareerEventListQuery { kind, page, limit } → Paginated событий.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/career/career-events.service.spec.ts.
- Замечено: Event.careerKind выставляет только сид (prisma/seed/steps/80-career.mjs) — ни API модуля events, ни UI не позволяют создать карьерное мероприятие.

### D-25 Карьерная аналитика и отчёт карьерного центра

- Бизнес-цель: вуз видит воронку трудоустройства, очередь модерации, разрыв навыков и периодический отчёт (выгрузка XLSX/CSV); компания — метрики своего подбора.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, DEAN (вуз, только агрегаты); EMPLOYER (своя компания).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/analytics (views/career/ui/career-analytics-view.tsx); GET /career/analytics/university, GET /career/analytics/university/report, GET /career/analytics/university/report/export?format=xlsx|csv, GET /career/analytics/company.
- Завершение: агрегаты (из Redis-кэша или пересчитаны); файл отчёта с записью в DocumentExport.
- Шаги и файлы: apps/api/src/modules/career/career-analytics.controller.ts; career-analytics.service.ts (computeUniversity, reachedStages, queue, weekly, skillsGap, forCompany, cached); career-report.service.ts (totals, timing, stages, outcomes, faculties, graduates (take 10 000), companies, vacancyCuts, salary, deadVacancies, students, exportReport); career-report.export.ts; apps/api/src/common/export/spreadsheet.builder.ts.
- Данные на входе / выходе: universityId (для платформенных ролей), period → агрегаты/строки отчёта.
- Внешние зависимости: PostgreSQL, Redis (кэш), генерация XLSX.
- Тесты: apps/api/src/modules/career/career-analytics.service.spec.ts; career-report.service.spec.ts; apps/api/src/common/export/spreadsheet.builder.spec.ts.
- Замечено: GET /career/analytics/company реализован (fetchCompanyCareerAnalytics в entities/career-event), но ни один экран его не вызывает — у работодателя метрик подбора в UI нет.

### D-26 Рабочее место модератора: зона /moderator и смежные разделы

- Бизнес-цель: дать модераторам платформы и вуза отдельную оболочку с их разделами (жалобы, поддержка, посты, люди, статистика, журнал, чаты) без доступа к остальным зонам.
- Роли: PLATFORM_MODERATOR (/moderator/platform), UNIVERSITY_MODERATOR (/moderator/university).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): apps/web/src/app/moderator/{platform,university}/layout.tsx (RoleGuard + AppShell); страницы complaints, audit, support (только platform), stats (только platform), posts (views/feed FeedView), users (widgets/users-table: блокировка/разблокировка — PATCH /users/:id/block|unblock), chats (views/chats), [...section] → views/role-landing SectionStub.
- Завершение: модератор работает в своём сайдбаре (UNIVERSITY_MODERATOR_NAV / PLATFORM_MODERATOR_NAV в widgets/app-shell/model/nav.ts); неизвестный раздел — заглушка.
- Шаги и файлы: apps/web/src/app/moderator/**; apps/web/src/widgets/app-shell/model/nav.ts; apps/web/src/shared/session/role-guard.tsx; API разделов — модули других групп (posts, users, chats, audit, platform stats).
- Данные на входе / выходе: см. D-15, D-16, D-17; остальное — в группах соответствующих модулей.
- Внешние зависимости: нет собственных.
- Тесты: нет (apps/web/e2e/access.e2e.ts зону /moderator не проверяет).
- Замечено: у UNIVERSITY_MODERATOR в оболочке нет раздела «Заявки», хотя ApplicationPolicy даёт ему право process (см. D-03).
