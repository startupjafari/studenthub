-- Удаление пары больше не стирает посещаемость каскадом (аудит C-F11): связь attendance → pairs
-- переводится в RESTRICT. Данные не меняются, пересоздаётся только внешний ключ.

-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_pair_id_fkey";

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
