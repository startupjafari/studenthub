-- CreateTable
CREATE TABLE "document_exports" (
    "id" TEXT NOT NULL,
    "short_id" TEXT NOT NULL,
    "user_id" TEXT,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "params" JSONB,
    "rows" INTEGER,
    "subject_name" TEXT,
    "document_number" TEXT,
    "issuer_name" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "document_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_exports_short_id_key" ON "document_exports"("short_id");

-- CreateIndex
CREATE INDEX "document_exports_user_id_idx" ON "document_exports"("user_id");

-- CreateIndex
CREATE INDEX "document_exports_created_at_idx" ON "document_exports"("created_at");

