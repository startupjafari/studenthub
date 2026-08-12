-- 20260812180000_add_deanery_appointments/
-- Домен «Запись в деканат» (docs/ACADEMIC_CORE.md, задача 16): deanery_appointments — запись
-- студента на приём. Аддитивно; тип/статус строкой (SSOT — shared-schemas). applicationId —
-- мягкая ссылка (без FK). Требует таблицы users/faculties.

-- CreateTable
CREATE TABLE "deanery_appointments" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "faculty_id" TEXT NOT NULL,
    "assigned_to_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "topic" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "application_id" TEXT,
    "staff_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deanery_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deanery_appointments_faculty_id_status_idx" ON "deanery_appointments"("faculty_id", "status");

-- CreateIndex
CREATE INDEX "deanery_appointments_student_id_idx" ON "deanery_appointments"("student_id");

-- AddForeignKey
ALTER TABLE "deanery_appointments" ADD CONSTRAINT "deanery_appointments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deanery_appointments" ADD CONSTRAINT "deanery_appointments_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deanery_appointments" ADD CONSTRAINT "deanery_appointments_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
