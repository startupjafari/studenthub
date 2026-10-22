import type { Prisma } from '@prisma/client'
import { addDays, endOfDay, todayIn } from './library-dates'

// Очередь броней (Фаза 20.5/20.8): освободившийся экземпляр — после возврата, отмены выдачи,
// отмены или истечения готовой брони — откладывается первому в очереди на эту книгу. Нет
// очереди — экземпляр возвращается на полку. Вызывается внутри транзакции того, кто
// освобождает экземпляр: иначе двое освободивших отдали бы его двум читателям.

export interface HeldFor {
  reservationId: string
  readerId: string
  name: string
  group: string | null
  holdUntil: Date
}

export async function releaseCopy(
  tx: Prisma.TransactionClient,
  copy: { id: string; bookId: string },
  hold: { holdDays: number; timezone: string },
  now = new Date(),
): Promise<HeldFor | null> {
  const next = await tx.reservation.findFirst({
    where: { bookId: copy.bookId, status: 'QUEUED' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      readerId: true,
      reader: { select: { firstName: true, lastName: true, group: { select: { name: true } } } },
    },
  })
  if (!next) {
    await tx.bookCopy.update({ where: { id: copy.id }, data: { status: 'AVAILABLE' } })
    return null
  }
  // Готовая бронь держится до конца N-го дня по часам вуза.
  const holdUntil = endOfDay(addDays(todayIn(hold.timezone, now), hold.holdDays), hold.timezone)
  await tx.bookCopy.update({ where: { id: copy.id }, data: { status: 'RESERVED' } })
  await tx.reservation.update({
    where: { id: next.id },
    data: { status: 'READY', copyId: copy.id, readyAt: now, holdUntil },
  })
  return {
    reservationId: next.id,
    readerId: next.readerId,
    name: `${next.reader.lastName} ${next.reader.firstName}`,
    group: next.reader.group?.name ?? null,
    holdUntil,
  }
}
