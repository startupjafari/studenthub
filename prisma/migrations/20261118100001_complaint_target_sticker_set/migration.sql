-- Жалоба на личный набор стикеров. Отдельной миграцией: новое значение enum в Postgres
-- нельзя использовать в той же транзакции, где оно добавлено.

-- AlterEnum
ALTER TYPE "ComplaintTargetType" ADD VALUE 'STICKER_SET';
