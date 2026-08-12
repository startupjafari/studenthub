-- Домен «Услуги университета» (переработка «Заявок», PR1). Аддитивно: только новые таблицы,
-- существующие (application_requests и др.) не изменяются — потери данных нет.

-- CreateTable
CREATE TABLE "application_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_kk" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_services" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "university_id" TEXT,
    "code" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_kk" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description_ru" TEXT,
    "description_kk" TEXT,
    "description_en" TEXT,
    "instructions_ru" TEXT,
    "instructions_kk" TEXT,
    "instructions_en" TEXT,
    "sla_hours" INTEGER NOT NULL DEFAULT 24,
    "delivery_modes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requires_pickup" BOOLEAN NOT NULL DEFAULT false,
    "faculty_scoped" BOOLEAN NOT NULL DEFAULT true,
    "processing_mode" TEXT NOT NULL DEFAULT 'MANUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requirements" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "document_type" TEXT,
    "title_ru" TEXT NOT NULL,
    "title_kk" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "allow_storage" BOOLEAN NOT NULL DEFAULT true,
    "allow_upload" BOOLEAN NOT NULL DEFAULT true,
    "max_files" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_form_fields" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label_ru" TEXT NOT NULL,
    "label_kk" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "placeholder_ru" TEXT,
    "placeholder_kk" TEXT,
    "placeholder_en" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "validation" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "student_id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "faculty_id" TEXT,
    "service_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "delivery_type" TEXT,
    "form_data" JSONB NOT NULL DEFAULT '{}',
    "assigned_to_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3),
    "issued_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "pickup_location" TEXT,
    "pickup_instructions" TEXT,
    "pickup_code" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_events" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "comment" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_categories_code_key" ON "application_categories"("code");

-- CreateIndex
CREATE INDEX "application_categories_active_sort_order_idx" ON "application_categories"("active", "sort_order");

-- CreateIndex
CREATE INDEX "application_services_category_id_active_idx" ON "application_services"("category_id", "active");

-- CreateIndex
CREATE INDEX "application_services_university_id_active_idx" ON "application_services"("university_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "application_services_university_id_code_key" ON "application_services"("university_id", "code");

-- CreateIndex
CREATE INDEX "service_requirements_service_id_active_idx" ON "service_requirements"("service_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "service_requirements_service_id_code_key" ON "service_requirements"("service_id", "code");

-- CreateIndex
CREATE INDEX "service_form_fields_service_id_active_idx" ON "service_form_fields"("service_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "service_form_fields_service_id_code_key" ON "service_form_fields"("service_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "applications_number_key" ON "applications"("number");

-- CreateIndex
CREATE UNIQUE INDEX "applications_pickup_code_key" ON "applications"("pickup_code");

-- CreateIndex
CREATE INDEX "applications_student_id_status_idx" ON "applications"("student_id", "status");

-- CreateIndex
CREATE INDEX "applications_faculty_id_status_idx" ON "applications"("faculty_id", "status");

-- CreateIndex
CREATE INDEX "applications_university_id_status_idx" ON "applications"("university_id", "status");

-- CreateIndex
CREATE INDEX "applications_service_id_idx" ON "applications"("service_id");

-- CreateIndex
CREATE INDEX "applications_assigned_to_id_idx" ON "applications"("assigned_to_id");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "applications_due_at_idx" ON "applications"("due_at");

-- CreateIndex
CREATE INDEX "applications_submitted_at_idx" ON "applications"("submitted_at");

-- CreateIndex
CREATE INDEX "applications_created_at_idx" ON "applications"("created_at");

-- CreateIndex
CREATE INDEX "applications_deleted_at_idx" ON "applications"("deleted_at");

-- CreateIndex
CREATE INDEX "application_events_application_id_created_at_idx" ON "application_events"("application_id", "created_at");

-- AddForeignKey
ALTER TABLE "application_services" ADD CONSTRAINT "application_services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "application_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_services" ADD CONSTRAINT "application_services_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requirements" ADD CONSTRAINT "service_requirements_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "application_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_form_fields" ADD CONSTRAINT "service_form_fields_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "application_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "application_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
