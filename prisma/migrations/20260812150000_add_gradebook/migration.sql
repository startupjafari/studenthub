-- 20260812150000_add_gradebook/
-- Домен «Журнал оценок» (docs/ACADEMIC_CORE.md, задача 7): grade_columns (контрольные точки
-- дисциплины) и grades (оценки студентов). Аддитивно; тип колонки строкой (SSOT — shared-schemas).
-- Требует таблицу courses (миграция 20260812120000_add_courses).

-- CreateTable
CREATE TABLE "grade_columns" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "max_score" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" TEXT NOT NULL,
    "column_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grade_columns_course_id_idx" ON "grade_columns"("course_id");

-- CreateIndex
CREATE INDEX "grades_student_id_idx" ON "grades"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_column_id_student_id_key" ON "grades"("column_id", "student_id");

-- AddForeignKey
ALTER TABLE "grade_columns" ADD CONSTRAINT "grade_columns_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_columns" ADD CONSTRAINT "grade_columns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "grade_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
