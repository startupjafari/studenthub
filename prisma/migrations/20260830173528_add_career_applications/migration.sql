-- CreateTable
CREATE TABLE "career_applications" (
    "id" TEXT NOT NULL,
    "vacancy_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "cover_letter" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_application_events" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "comment" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_application_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "career_applications_student_id_status_idx" ON "career_applications"("student_id", "status");

-- CreateIndex
CREATE INDEX "career_applications_company_id_status_idx" ON "career_applications"("company_id", "status");

-- CreateIndex
CREATE INDEX "career_applications_vacancy_id_status_idx" ON "career_applications"("vacancy_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "career_applications_vacancy_id_student_id_key" ON "career_applications"("vacancy_id", "student_id");

-- CreateIndex
CREATE INDEX "career_application_events_application_id_created_at_idx" ON "career_application_events"("application_id", "created_at");

-- AddForeignKey
ALTER TABLE "career_applications" ADD CONSTRAINT "career_applications_vacancy_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_applications" ADD CONSTRAINT "career_applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_application_events" ADD CONSTRAINT "career_application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "career_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
