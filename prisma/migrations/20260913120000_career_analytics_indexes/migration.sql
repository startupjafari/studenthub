-- Индексы под метрики карьерного центра вуза: сводка фильтрует отклики по вузу и
-- статусу, ряд «отклики по неделям» — по вузу и дате создания. Без них каждый показ
-- обзора читает career_applications целиком.
-- CreateIndex
CREATE INDEX "career_applications_university_id_status_idx" ON "career_applications"("university_id", "status");

-- CreateIndex
CREATE INDEX "career_applications_university_id_created_at_idx" ON "career_applications"("university_id", "created_at");
