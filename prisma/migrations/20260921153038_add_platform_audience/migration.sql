-- AlterTable
ALTER TABLE "platform_state" ADD COLUMN     "banner_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "banner_university_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "maintenance_from" TIMESTAMP(3);
