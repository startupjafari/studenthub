-- CreateTable
CREATE TABLE "company_invites" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'RECRUITER',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invited_by_id" TEXT NOT NULL,
    "accepted_by_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_invites_token_hash_key" ON "company_invites"("token_hash");

-- CreateIndex
CREATE INDEX "company_invites_company_id_status_idx" ON "company_invites"("company_id", "status");

-- CreateIndex
CREATE INDEX "company_invites_email_idx" ON "company_invites"("email");

-- AddForeignKey
ALTER TABLE "company_invites" ADD CONSTRAINT "company_invites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

