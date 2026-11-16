-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "current_version_id" TEXT,
    "published_version_id" TEXT,
    "published_at" TIMESTAMP(3),
    "published_by_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "file_id" TEXT NOT NULL,
    "file_name" TEXT,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validation" JSONB NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_template_generations" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "student_id" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_template_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_current_version_id_key" ON "document_templates"("current_version_id");

-- CreateIndex
CREATE INDEX "document_templates_university_id_status_idx" ON "document_templates"("university_id", "status");

-- CreateIndex
CREATE INDEX "document_templates_university_id_updated_at_idx" ON "document_templates"("university_id", "updated_at");

-- CreateIndex
CREATE INDEX "document_templates_created_by_id_idx" ON "document_templates"("created_by_id");

-- CreateIndex
CREATE INDEX "document_templates_published_version_id_idx" ON "document_templates"("published_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_versions_file_id_key" ON "document_template_versions"("file_id");

-- CreateIndex
CREATE INDEX "document_template_versions_created_by_id_idx" ON "document_template_versions"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_versions_template_id_version_key" ON "document_template_versions"("template_id", "version");

-- CreateIndex
CREATE INDEX "document_template_generations_template_id_created_at_idx" ON "document_template_generations"("template_id", "created_at");

-- CreateIndex
CREATE INDEX "document_template_generations_version_id_idx" ON "document_template_generations"("version_id");

-- CreateIndex
CREATE INDEX "document_template_generations_student_id_idx" ON "document_template_generations"("student_id");

-- CreateIndex
CREATE INDEX "document_template_generations_university_id_created_at_idx" ON "document_template_generations"("university_id", "created_at");

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "document_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_generations" ADD CONSTRAINT "document_template_generations_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_generations" ADD CONSTRAINT "document_template_generations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

