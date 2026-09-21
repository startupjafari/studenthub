-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "support_tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
