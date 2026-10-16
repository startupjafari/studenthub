# Вопросы владельцу

Здесь — всё, что требует решения человека: применение миграций к непустой БД, новые
зависимости, изменение контрактов API/shared-schemas, изменения .env, спорные продуктовые решения.

(пока пусто)

## Q1. Применить миграцию `20261017120000_attendance_pair_restrict` (FIX-C-F11, P0)

Удаление пары больше не стирает посещаемость: сервис отказывает с 409, а на уровне БД FK
посещаемость → пара меняется с CASCADE на RESTRICT. Данные не меняются, только ограничение:

```sql
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_pair_id_fkey";
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Применить: `set -a && . apps/api/.env && set +a && pnpm exec prisma migrate deploy` (локально), на проде — через обычный деплой миграций.
Продуктовый вопрос: пару с отметками сейчас можно только перенести (день/время). Нужен ли «архив пары» (мягкое удаление с переносом предмета/группы в Attendance)?
