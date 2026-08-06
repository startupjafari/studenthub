-- AlterTable
ALTER TABLE "files" ADD COLUMN     "application_id" TEXT;

-- CreateTable
CREATE TABLE "application_requests" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "faculty_id" TEXT NOT NULL,
    "type" "AppType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "from_status" "ApplicationStatus",
    "to_status" "ApplicationStatus" NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_requests_student_id_idx" ON "application_requests"("student_id");

-- CreateIndex
CREATE INDEX "application_requests_faculty_id_status_idx" ON "application_requests"("faculty_id", "status");

-- CreateIndex
CREATE INDEX "application_requests_status_idx" ON "application_requests"("status");

-- CreateIndex
CREATE INDEX "application_requests_deleted_at_idx" ON "application_requests"("deleted_at");

-- CreateIndex
CREATE INDEX "application_requests_created_at_idx" ON "application_requests"("created_at");

-- CreateIndex
CREATE INDEX "application_status_history_application_id_created_at_idx" ON "application_status_history"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "application_status_history_changed_by_id_idx" ON "application_status_history"("changed_by_id");

-- CreateIndex
CREATE INDEX "files_application_id_idx" ON "files"("application_id");

-- AddForeignKey
ALTER TABLE "application_requests" ADD CONSTRAINT "application_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_requests" ADD CONSTRAINT "application_requests_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

