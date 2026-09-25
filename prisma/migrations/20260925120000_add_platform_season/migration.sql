-- AlterTable
ALTER TABLE "platform_state" ADD COLUMN     "season_off" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "season_override" TEXT;
