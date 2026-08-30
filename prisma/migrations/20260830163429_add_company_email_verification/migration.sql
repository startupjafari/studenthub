-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "email_verification_expires_at" TIMESTAMP(3),
ADD COLUMN     "email_verification_hash" TEXT;
