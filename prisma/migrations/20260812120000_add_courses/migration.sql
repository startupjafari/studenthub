-- 20260812120000_add_courses/
-- Домен «Дисциплины» (docs/ACADEMIC_CORE.md, задача 2): terms (семестр как сущность),
-- subjects (справочник дисциплин вуза), courses (преподавание дисциплины группе в семестре,
-- с кредитами). Миграция аддитивная: новые таблицы, существующие не трогаются. Связывание
-- pairs/materials с courses — отдельной миграцией позже.

-- CreateTable
CREATE TABLE "terms" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" INTEGER,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "teacher_id" TEXT,
    "term_id" TEXT,
    "credits" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terms_university_id_idx" ON "terms"("university_id");

-- CreateIndex
CREATE UNIQUE INDEX "terms_university_id_name_key" ON "terms"("university_id", "name");

-- CreateIndex
CREATE INDEX "subjects_university_id_idx" ON "subjects"("university_id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_university_id_name_key" ON "subjects"("university_id", "name");

-- CreateIndex
CREATE INDEX "courses_group_id_idx" ON "courses"("group_id");

-- CreateIndex
CREATE INDEX "courses_teacher_id_idx" ON "courses"("teacher_id");

-- CreateIndex
CREATE INDEX "courses_term_id_idx" ON "courses"("term_id");

-- CreateIndex
CREATE INDEX "courses_subject_id_idx" ON "courses"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_subject_id_group_id_term_id_key" ON "courses"("subject_id", "group_id", "term_id");

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
