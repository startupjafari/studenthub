-- 20260812140000_add_attendance/
-- Домен «Посещаемость» (docs/ACADEMIC_CORE.md, задача 5): attendance — отметка студента на
-- занятии (пара + дата). Аддитивно; статус строкой (SSOT — shared-schemas). Требует таблицы
-- pairs/users (существуют).

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "pair_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "note" TEXT,
    "marked_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_student_id_idx" ON "attendance"("student_id");

-- CreateIndex
CREATE INDEX "attendance_pair_id_date_idx" ON "attendance"("pair_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_pair_id_date_student_id_key" ON "attendance"("pair_id", "date", "student_id");

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
