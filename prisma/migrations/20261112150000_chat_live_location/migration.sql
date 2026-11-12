-- AlterTable
ALTER TABLE "chat_locations" ADD COLUMN     "accuracy" DOUBLE PRECISION,
ADD COLUMN     "heading" DOUBLE PRECISION,
ADD COLUMN     "live_until" TIMESTAMP(3),
ADD COLUMN     "live_updated_at" TIMESTAMP(3);
