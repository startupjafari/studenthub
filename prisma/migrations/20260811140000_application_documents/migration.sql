-- Документы заявки (PR3): привязка требования услуги к документу студента + вердикт review.
-- Аддитивно: одна новая таблица, существующие не изменяются.

-- CreateTable
CREATE TABLE "application_documents" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "requirement_id" TEXT NOT NULL,
    "document_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'STORAGE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "review_comment" TEXT,
    "snapshot_title" TEXT,
    "reviewed_by_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_documents_application_id_idx" ON "application_documents"("application_id");

-- CreateIndex
CREATE INDEX "application_documents_document_id_idx" ON "application_documents"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_documents_application_id_requirement_id_key" ON "application_documents"("application_id", "requirement_id");

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "service_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
