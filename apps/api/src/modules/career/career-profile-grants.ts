import { Prisma } from '@prisma/client'

/** Клиент Prisma или транзакция — открытие профиля пишется и в транзакции отклика. */
type GrantClient = Pick<Prisma.TransactionClient, 'careerProfileGrant'>

/**
 * Открыть скрытый карьерный профиль студента одной компании (21.D1).
 *
 * Одна строка на пару «студент ↔ компания» (`@@unique([userId, companyId])`): повторное
 * открытие снимает отметку о закрытии и обновляет дату. Две вкладки, открывающие
 * одновременно, сталкиваются на уникальном ключе — проигравшая получает P2002, а нужное
 * состояние уже записано победившей, поэтому P2002 здесь не ошибка.
 */
export async function grantProfileToCompany(
  client: GrantClient,
  userId: string,
  companyId: string,
): Promise<void> {
  try {
    await client.careerProfileGrant.upsert({
      where: { userId_companyId: { userId, companyId } },
      create: { userId, companyId },
      update: { revokedAt: null, grantedAt: new Date() },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return
    throw e
  }
}
