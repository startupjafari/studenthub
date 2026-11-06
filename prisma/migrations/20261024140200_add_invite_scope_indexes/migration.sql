-- Индексы инвайтов по scope: список инвайтов вуза у админа, воронка аналитики, онбординг и
-- массовый отзыв PENDING при удалении вуза, факультета или группы (revokePendingInScope)
-- фильтруют по university_id / faculty_id / group_id, а индексов по ним не было.

-- CreateIndex
CREATE INDEX "invites_university_id_status_idx" ON "invites"("university_id", "status");

-- CreateIndex
CREATE INDEX "invites_faculty_id_status_idx" ON "invites"("faculty_id", "status");

-- CreateIndex
CREATE INDEX "invites_group_id_status_idx" ON "invites"("group_id", "status");
