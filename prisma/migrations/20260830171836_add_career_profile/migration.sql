-- CreateTable
CREATE TABLE "career_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'HIDDEN',
    "employment_status" TEXT NOT NULL DEFAULT 'NOT_LOOKING',
    "desired_positions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "employment_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "work_formats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relocation_ready" BOOLEAN NOT NULL DEFAULT false,
    "desired_salary_min" INTEGER,
    "desired_salary_max" INTEGER,
    "salary_currency" TEXT,
    "about" TEXT,
    "readiness_score" INTEGER,
    "readiness_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "company_id" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "career_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "career_profiles_user_id_key" ON "career_profiles"("user_id");

-- CreateIndex
CREATE INDEX "career_profiles_visibility_employment_status_idx" ON "career_profiles"("visibility", "employment_status");

-- CreateIndex
CREATE INDEX "career_consents_user_id_field_revoked_at_idx" ON "career_consents"("user_id", "field", "revoked_at");

-- CreateIndex
CREATE INDEX "career_consents_company_id_idx" ON "career_consents"("company_id");

-- AddForeignKey
ALTER TABLE "career_profiles" ADD CONSTRAINT "career_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_consents" ADD CONSTRAINT "career_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
