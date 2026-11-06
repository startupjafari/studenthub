import type { Prisma } from '@prisma/client'

/**
 * Транзакционный advisory-лок Postgres по строковому ключу: держится до конца транзакции.
 *
 * Нужен там, где «прочитать → решить → записать» нельзя закрыть уникальным индексом. Голос
 * в опросе — несколько строк (по одной на вариант), и индекс `(optionId, userId)` не мешает
 * двум параллельным запросам записать два разных варианта в опрос с одним ответом: обе
 * транзакции видят «голоса ещё нет». Под локом второй запрос ждёт первого и видит его голос.
 *
 * `$executeRaw`, а не `$queryRaw`: функция возвращает `void`, и разбор такого столбца
 * Prisma не поддерживает.
 */
export async function advisoryXactLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
}

/**
 * Разделяемый вариант того же лока: держатели разделяемого не мешают друг другу, но ждут
 * исключительного (`advisoryXactLock` по тому же ключу) и задерживают его. Нужен, когда
 * много частых операций (голоса в опросе) не должны пересекаться с редкой перестройкой
 * сущности (правка опроса с заменой вариантов), но между собой идут параллельно.
 */
export async function advisoryXactLockShared(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`
}
