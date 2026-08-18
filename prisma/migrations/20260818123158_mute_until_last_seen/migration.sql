-- AlterTable
ALTER TABLE "chat_members" ADD COLUMN     "muted_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_seen_at" TIMESTAMP(3);
