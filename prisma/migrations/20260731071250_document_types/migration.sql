-- CreateTable
CREATE TABLE "document_types" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "custom" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT,
    "label" TEXT,
    "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retention_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_types_university_id_type_id_key" ON "document_types"("university_id", "type_id");

-- AddForeignKey
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

