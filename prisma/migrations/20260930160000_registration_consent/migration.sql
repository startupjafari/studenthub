-- AlterTable
ALTER TABLE "users" ADD COLUMN     "consent_at" TIMESTAMP(3),
ADD COLUMN     "consent_by_guardian" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consent_version" TEXT;
