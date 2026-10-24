-- CreateEnum
CREATE TYPE "VisitorDocumentType" AS ENUM ('ID_CARD', 'PASSPORT', 'DRIVER_LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "PassDenyReason" AS ENUM ('STATUS', 'BLOCKED', 'OTHER_UNIVERSITY', 'INVALID_QR', 'EXPIRED_QR', 'REUSED_QR');

-- CreateTable
CREATE TABLE "security_visitors" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "document_type" "VisitorDocumentType",
    "document_last4" TEXT,
    "phone" TEXT,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exited_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_by_name" TEXT NOT NULL,
    "exited_by_id" TEXT,

    CONSTRAINT "security_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_passes" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "guard_id" TEXT,
    "guard_name" TEXT NOT NULL,
    "student_id" TEXT,
    "student_name" TEXT,
    "student_group" TEXT,
    "allowed" BOOLEAN NOT NULL,
    "deny_reason" "PassDenyReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_passes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_visitors_university_id_entered_at_idx" ON "security_visitors"("university_id", "entered_at");

-- CreateIndex
CREATE INDEX "security_visitors_university_id_exited_at_idx" ON "security_visitors"("university_id", "exited_at");

-- CreateIndex
CREATE INDEX "security_visitors_created_by_id_idx" ON "security_visitors"("created_by_id");

-- CreateIndex
CREATE INDEX "security_visitors_exited_by_id_idx" ON "security_visitors"("exited_by_id");

-- CreateIndex
CREATE INDEX "security_passes_university_id_created_at_idx" ON "security_passes"("university_id", "created_at");

-- CreateIndex
CREATE INDEX "security_passes_guard_id_created_at_idx" ON "security_passes"("guard_id", "created_at");

-- CreateIndex
CREATE INDEX "security_passes_student_id_idx" ON "security_passes"("student_id");

-- AddForeignKey
ALTER TABLE "security_visitors" ADD CONSTRAINT "security_visitors_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_visitors" ADD CONSTRAINT "security_visitors_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_visitors" ADD CONSTRAINT "security_visitors_exited_by_id_fkey" FOREIGN KEY ("exited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_passes" ADD CONSTRAINT "security_passes_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_passes" ADD CONSTRAINT "security_passes_guard_id_fkey" FOREIGN KEY ("guard_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_passes" ADD CONSTRAINT "security_passes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
