-- CreateTable
CREATE TABLE "vacancies" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL,
    "work_format" TEXT NOT NULL,
    "experience_level" TEXT NOT NULL,
    "city" TEXT,
    "salary_min" INTEGER,
    "salary_max" INTEGER,
    "salary_currency" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacancy_university_reviews" (
    "id" TEXT NOT NULL,
    "vacancy_id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacancy_university_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vacancies_company_id_status_idx" ON "vacancies"("company_id", "status");

-- CreateIndex
CREATE INDEX "vacancies_status_published_at_idx" ON "vacancies"("status", "published_at");

-- CreateIndex
CREATE INDEX "vacancies_deleted_at_idx" ON "vacancies"("deleted_at");

-- CreateIndex
CREATE INDEX "vacancy_university_reviews_university_id_status_idx" ON "vacancy_university_reviews"("university_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vacancy_university_reviews_vacancy_id_university_id_key" ON "vacancy_university_reviews"("vacancy_id", "university_id");

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_university_reviews" ADD CONSTRAINT "vacancy_university_reviews_vacancy_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_university_reviews" ADD CONSTRAINT "vacancy_university_reviews_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
