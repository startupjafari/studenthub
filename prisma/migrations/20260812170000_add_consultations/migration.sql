-- 20260812170000_add_consultations/
-- Домен «Консультации» (docs/ACADEMIC_CORE.md, задача 15): consultation_slots — интервалы приёма
-- преподавателя, запись студента. Аддитивно; статус строкой (SSOT — shared-schemas).

-- CreateTable
CREATE TABLE "consultation_slots" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "student_id" TEXT,
    "topic" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consultation_slots_teacher_id_starts_at_idx" ON "consultation_slots"("teacher_id", "starts_at");

-- CreateIndex
CREATE INDEX "consultation_slots_student_id_idx" ON "consultation_slots"("student_id");

-- CreateIndex
CREATE INDEX "consultation_slots_status_idx" ON "consultation_slots"("status");

-- AddForeignKey
ALTER TABLE "consultation_slots" ADD CONSTRAINT "consultation_slots_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_slots" ADD CONSTRAINT "consultation_slots_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
