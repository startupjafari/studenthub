-- 20260812190000_add_portfolio/
-- Домен «Портфолио» (docs/ACADEMIC_CORE.md, задача 21): portfolio_items — записи студенческого
-- портфолио (образование/опыт/проект/сертификат/достижение) с периодом, ссылкой и приватностью.
-- Аддитивно; вид и видимость строкой (SSOT — shared-schemas).

-- CreateTable
CREATE TABLE "portfolio_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROJECT',
    "title" TEXT NOT NULL,
    "organization" TEXT,
    "description" TEXT,
    "url" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "visibility" TEXT NOT NULL DEFAULT 'UNIVERSITY',
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_items_user_id_kind_idx" ON "portfolio_items"("user_id", "kind");

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
