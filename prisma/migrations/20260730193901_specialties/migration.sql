-- CreateTable
CREATE TABLE "specialties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "specialties_university_id_idx" ON "specialties"("university_id");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_university_id_name_key" ON "specialties"("university_id", "name");

-- AddForeignKey
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

