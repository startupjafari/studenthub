-- AlterTable
ALTER TABLE "chat_members" ADD COLUMN     "cleared_at" TIMESTAMP(3),
ADD COLUMN     "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: создатель группы становится админом своего членства.
UPDATE "chat_members" cm
SET "is_admin" = true
FROM "chats" c
WHERE cm."chat_id" = c."id"
  AND c."created_by_id" IS NOT NULL
  AND cm."user_id" = c."created_by_id";
