-- AlterTable
ALTER TABLE "platform_state" ADD COLUMN     "digest_hour" INTEGER,
ADD COLUMN     "duty_user_id" TEXT,
ADD COLUMN     "muted_notifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "quiet_from" INTEGER,
ADD COLUMN     "quiet_to" INTEGER;
