-- Результаты заявки (PR4, §10). Аддитивно: одна новая таблица.

-- CreateTable
CREATE TABLE "application_results" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "document_id" TEXT,
    "document_number" TEXT,
    "note" TEXT,
    "issued_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_results_application_id_idx" ON "application_results"("application_id");

-- AddForeignKey
ALTER TABLE "application_results" ADD CONSTRAINT "application_results_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_results" ADD CONSTRAINT "application_results_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
