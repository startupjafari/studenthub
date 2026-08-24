-- Приоритет жалобы в очереди модерации (docs/PROJECT.md §11).
-- Значение выводится из категории цели, поэтому существующие строки заполняются тем же
-- правилом, что применяет API при создании: человек и личные сообщения — HIGH,
-- публичный контент — MEDIUM, комментарий — LOW.
CREATE TYPE "ComplaintPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

ALTER TABLE "complaints"
  ADD COLUMN "priority" "ComplaintPriority" NOT NULL DEFAULT 'MEDIUM';

UPDATE "complaints"
SET "priority" = CASE
  WHEN "target_type" IN ('USER', 'MESSAGE') THEN 'HIGH'::"ComplaintPriority"
  WHEN "target_type" = 'COMMENT' THEN 'LOW'::"ComplaintPriority"
  ELSE 'MEDIUM'::"ComplaintPriority"
END;

CREATE INDEX "complaints_status_priority_idx" ON "complaints"("status", "priority");
