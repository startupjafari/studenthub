-- CreateIndex
CREATE INDEX "complaints_resolved_by_id_idx" ON "complaints"("resolved_by_id");

-- CreateIndex
CREATE INDEX "posts_pinned_by_id_idx" ON "posts"("pinned_by_id");

-- CreateIndex
CREATE INDEX "schedule_changes_new_room_id_idx" ON "schedule_changes"("new_room_id");

-- CreateIndex
CREATE INDEX "schedule_changes_new_teacher_id_idx" ON "schedule_changes"("new_teacher_id");

