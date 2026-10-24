import { Prisma } from '@prisma/client'
import { AppException } from '../exceptions/app.exception'

/**
 * Условная смена статуса: `update` с текущим статусом в `where` не находит строку, если её
 * успели перевести (P2025). Это гонка «проверка → запись»: отзыв студентом и действие
 * сотрудника, выполненные одновременно, раньше проходили оба, а в истории оставался неверный
 * `fromStatus`. Отвечаем CONFLICT — клиент перечитает заявку и увидит настоящий статус.
 */
export function rethrowStaleStatus(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
    throw new AppException('CONFLICT', 'Статус уже изменился — обновите страницу')
  }
  throw e
}
