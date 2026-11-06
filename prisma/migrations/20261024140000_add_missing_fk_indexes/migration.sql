-- Индексы на внешние ключи, у которых их не было (BACKEND_RULES §5.1: @@index на каждый FK).
--
-- Без индекса на ссылающейся колонке каждое удаление строки-родителя (пользователя, файла,
-- документа, аудитории) заставляет RI-триггер Postgres сканировать всю дочернюю таблицу:
-- уборка надгробий аккаунтов, уборка сида по 2000 пользователей и удаление File пачками шли
-- по seq scan миллионов строк attendance, submissions и т. д.
--
-- CREATE INDEX без CONCURRENTLY: Prisma выполняет миграцию в транзакции, где CONCURRENTLY
-- запрещён. Запись в эти таблицы блокируется на время построения; самая крупная — attendance.

-- CreateIndex
CREATE INDEX "scheduled_messages_sender_id_idx" ON "scheduled_messages"("sender_id");

-- CreateIndex
CREATE INDEX "complaints_reviewing_by_id_idx" ON "complaints"("reviewing_by_id");

-- CreateIndex
CREATE INDEX "moderation_warnings_issued_by_id_idx" ON "moderation_warnings"("issued_by_id");

-- CreateIndex
CREATE INDEX "moderation_warnings_complaint_id_idx" ON "moderation_warnings"("complaint_id");

-- CreateIndex
CREATE INDEX "content_comments_author_id_idx" ON "content_comments"("author_id");

-- CreateIndex
CREATE INDEX "bookmarks_article_id_idx" ON "bookmarks"("article_id");

-- CreateIndex
CREATE INDEX "albums_cover_file_id_idx" ON "albums"("cover_file_id");

-- CreateIndex
CREATE INDEX "document_submission_items_request_item_id_idx" ON "document_submission_items"("request_item_id");

-- CreateIndex
CREATE INDEX "application_documents_requirement_id_idx" ON "application_documents"("requirement_id");

-- CreateIndex
CREATE INDEX "application_results_document_id_idx" ON "application_results"("document_id");

-- CreateIndex
CREATE INDEX "submissions_graded_by_id_idx" ON "submissions"("graded_by_id");

-- CreateIndex
CREATE INDEX "attendance_marked_by_id_idx" ON "attendance"("marked_by_id");

-- CreateIndex
CREATE INDEX "grade_columns_created_by_id_idx" ON "grade_columns"("created_by_id");

-- CreateIndex
CREATE INDEX "exams_created_by_id_idx" ON "exams"("created_by_id");

-- CreateIndex
CREATE INDEX "exams_room_id_idx" ON "exams"("room_id");

-- CreateIndex
CREATE INDEX "deanery_appointments_assigned_to_id_idx" ON "deanery_appointments"("assigned_to_id");
