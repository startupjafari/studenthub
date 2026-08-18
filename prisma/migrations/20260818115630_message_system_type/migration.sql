-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "system_meta" JSONB,
ADD COLUMN     "system_type" TEXT;
