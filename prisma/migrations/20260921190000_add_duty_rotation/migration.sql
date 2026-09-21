-- AlterTable
ALTER TABLE "platform_state" ADD COLUMN     "duty_rotation" TEXT[] DEFAULT ARRAY[]::TEXT[];
