-- CreateTable
CREATE TABLE "document_requests" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_request_items" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_request_targets" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,

    CONSTRAINT "document_request_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_submissions" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_submission_items" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "request_item_id" TEXT NOT NULL,
    "document_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "document_submission_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_requests_university_id_status_idx" ON "document_requests"("university_id", "status");

-- CreateIndex
CREATE INDEX "document_requests_created_by_id_idx" ON "document_requests"("created_by_id");

-- CreateIndex
CREATE INDEX "document_request_items_request_id_idx" ON "document_request_items"("request_id");

-- CreateIndex
CREATE INDEX "document_request_targets_request_id_idx" ON "document_request_targets"("request_id");

-- CreateIndex
CREATE INDEX "document_request_targets_target_type_target_id_idx" ON "document_request_targets"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "document_submissions_student_id_idx" ON "document_submissions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_submissions_request_id_student_id_key" ON "document_submissions"("request_id", "student_id");

-- CreateIndex
CREATE INDEX "document_submission_items_document_id_idx" ON "document_submission_items"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_submission_items_submission_id_request_item_id_key" ON "document_submission_items"("submission_id", "request_item_id");

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_targets" ADD CONSTRAINT "document_request_targets_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submissions" ADD CONSTRAINT "document_submissions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submissions" ADD CONSTRAINT "document_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_items" ADD CONSTRAINT "document_submission_items_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "document_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_items" ADD CONSTRAINT "document_submission_items_request_item_id_fkey" FOREIGN KEY ("request_item_id") REFERENCES "document_request_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_items" ADD CONSTRAINT "document_submission_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

