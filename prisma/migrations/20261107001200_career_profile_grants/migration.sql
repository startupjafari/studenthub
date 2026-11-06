-- CreateTable
CREATE TABLE "career_profile_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_profile_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "career_profile_grants_company_id_idx" ON "career_profile_grants"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "career_profile_grants_user_id_company_id_key" ON "career_profile_grants"("user_id", "company_id");

-- AddForeignKey
ALTER TABLE "career_profile_grants" ADD CONSTRAINT "career_profile_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_profile_grants" ADD CONSTRAINT "career_profile_grants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

