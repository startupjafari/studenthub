import type { Prisma } from '@prisma/client'

/**
 * Специальность вуза с таким названием — без учёта регистра.
 *
 * `in`, а не `equals` с `mode: 'insensitive'`: equals Prisma строит через ILIKE, где `_` и
 * `%` — шаблоны. `in` даёт точное `LOWER(name) IN (LOWER($1))`.
 *
 * `db` — клиент транзакции или PrismaService вызывающего. Функция, а не метод сервиса:
 * ей пользуется и учётная запись студента (UserService), а модуль пользователей не может
 * зависеть от модуля специальностей — тот сам зависит от него (каскад переименования),
 * а кольцо модулей запрещено (BACKEND_RULES §2.1). Запрос к таблице справочника при этом
 * остаётся в модуле, который ею владеет.
 */
export function findSpecialtyByName(
  db: Prisma.TransactionClient,
  universityId: string,
  name: string,
  exceptId?: string,
): Promise<{ id: string; name: string } | null> {
  return db.specialty.findFirst({
    where: {
      universityId,
      name: { in: [name], mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true },
  })
}

/**
 * Название специальности в написании справочника вуза.
 *
 * - пустое значение — очистка поля, возвращается как есть;
 * - справочник у вуза не заведён — свободный текст, как было до справочника;
 * - название есть в справочнике (без учёта регистра) — его написание из справочника;
 * - иначе `null`: такой специальности в вузе нет.
 */
export async function canonicalSpecialtyName(
  db: Prisma.TransactionClient,
  universityId: string,
  value: string,
): Promise<string | null> {
  const name = value.trim()
  if (!name) return name
  const match = await findSpecialtyByName(db, universityId, name)
  if (match) return match.name
  const dictionary = await db.specialty.findFirst({
    where: { universityId },
    select: { id: true },
  })
  return dictionary ? null : name
}
