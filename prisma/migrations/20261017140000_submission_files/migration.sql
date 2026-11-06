-- Файлы в сдаче задания (аудит C-F06): задание с типом сдачи «Файл» было невозможно сдать —
-- у сдачи не было вложений. Колонка добавляется пустой, существующие строки не меняются.
-- Удаление сдачи уносит строки files каскадом; объекты в MinIO снимает cleanOrphanFiles.

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "submission_id" TEXT;

-- CreateIndex
CREATE INDEX "files_submission_id_idx" ON "files"("submission_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
