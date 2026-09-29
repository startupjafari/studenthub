-- CreateEnum
CREATE TYPE "DemoRequestStatus" AS ENUM ('PENDING_EMAIL', 'NEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DemoRejectionReason" AS ENUM ('NOT_ELIGIBLE', 'DUPLICATE', 'INSUFFICIENT_INFO', 'NO_CAPACITY', 'OTHER');

-- CreateTable
CREATE TABLE "university_demo_requests" (
    "id" TEXT NOT NULL,
    "university_name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "website" TEXT,
    "students_estimate" INTEGER,
    "contact_name" TEXT NOT NULL,
    "contact_role" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "comment" TEXT,
    "status" "DemoRequestStatus" NOT NULL DEFAULT 'PENDING_EMAIL',
    "email_verification_hash" TEXT,
    "email_verification_expires_at" TIMESTAMP(3),
    "consent_at" TIMESTAMP(3) NOT NULL,
    "consent_version" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "rejection_reason" "DemoRejectionReason",
    "review_note" TEXT,
    "university_id" TEXT,
    "invite_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "university_demo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "university_onboarding" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "profile_confirmed_at" TIMESTAMP(3),
    "skipped_steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dismissed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "university_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "university_demo_requests_email_verification_hash_key" ON "university_demo_requests"("email_verification_hash");

-- CreateIndex
CREATE INDEX "university_demo_requests_status_created_at_idx" ON "university_demo_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "university_demo_requests_email_idx" ON "university_demo_requests"("email");

-- CreateIndex
CREATE INDEX "university_demo_requests_university_id_idx" ON "university_demo_requests"("university_id");

-- CreateIndex
CREATE INDEX "university_demo_requests_reviewed_by_id_idx" ON "university_demo_requests"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "university_demo_requests_invite_id_idx" ON "university_demo_requests"("invite_id");

-- CreateIndex
CREATE UNIQUE INDEX "university_onboarding_university_id_key" ON "university_onboarding"("university_id");

-- AddForeignKey
ALTER TABLE "university_demo_requests" ADD CONSTRAINT "university_demo_requests_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_demo_requests" ADD CONSTRAINT "university_demo_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_demo_requests" ADD CONSTRAINT "university_demo_requests_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_onboarding" ADD CONSTRAINT "university_onboarding_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
