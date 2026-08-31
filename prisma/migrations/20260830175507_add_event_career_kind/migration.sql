-- AlterTable
ALTER TABLE "events" ADD COLUMN     "career_kind" TEXT;

-- CreateIndex
CREATE INDEX "events_career_kind_starts_at_idx" ON "events"("career_kind", "starts_at");
