-- Cleanup (ЭТАП 8): удаление старой тикет-системы «Заявки» (ApplicationRequest/History,
-- File.application_id, enum'ы). Данные старых заявок одноразовые (подтверждено). Новый домен —
-- application_services/applications и т.д. (миграции 20260811130000+).

-- DropForeignKey
ALTER TABLE "application_requests" DROP CONSTRAINT "application_requests_faculty_id_fkey";
ALTER TABLE "application_requests" DROP CONSTRAINT "application_requests_student_id_fkey";
ALTER TABLE "application_status_history" DROP CONSTRAINT "application_status_history_application_id_fkey";
ALTER TABLE "application_status_history" DROP CONSTRAINT "application_status_history_changed_by_id_fkey";
ALTER TABLE "files" DROP CONSTRAINT "files_application_id_fkey";

-- DropIndex
DROP INDEX "files_application_id_idx";

-- AlterTable
ALTER TABLE "files" DROP COLUMN "application_id";

-- DropTable
DROP TABLE "application_requests";
DROP TABLE "application_status_history";

-- DropEnum
DROP TYPE "AppType";
DROP TYPE "ApplicationStatus";
