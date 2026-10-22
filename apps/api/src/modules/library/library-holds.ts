import type { Prisma } from '@prisma/client'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { addDays, endOfDay, todayIn } from './library-dates'

// Очередь броней (Фаза 20.5/20.8): освободившийся экземпляр — после возврата, отмены выдачи,
// отмены или истечения готовой брони — откладывается первому в очереди на эту книгу. Нет
// очереди — экземпляр возвращается на полку. Вызывается внутри транзакции того, кто
// освобождает экземпляр: иначе двое освободивших отдали бы его двум читателям. Очередь книги
// двигается под advisory-локом книги: бронь, ставшая в очередь, и возврат, не увидевший её,
// иначе оставили бы экземпляр на полке при живой очереди.

/** Лок очереди книги — берут все, кто двигает её брони и экземпляры. */
export function lockBookQueue(tx: Prisma.TransactionClient, bookId: string): Promise<void> {
  return advisoryXactLock(tx, `library:book:${bookId}`)
}

/** Готовая бронь держится до конца N-го дня по часам вуза. */
function holdUntilOf(hold: { holdDays: number; timezone: string }, now: Date): Date {
  return endOfDay(addDays(todayIn(hold.timezone, now), hold.holdDays), hold.timezone)
}

const NEXT_SELECT = {
  id: true,
  readerId: true,
  reader: { select: { firstName: true, lastName: true, group: { select: { name: true } } } },
} satisfies Prisma.ReservationSelect

type NextRow = Prisma.ReservationGetPayload<{ select: typeof NEXT_SELECT }>

function heldOf(next: NextRow, holdUntil: Date): HeldFor {
  return {
    reservationId: next.id,
    readerId: next.readerId,
    name: `${next.reader.lastName} ${next.reader.firstName}`,
    group: next.reader.group?.name ?? null,
    holdUntil,
  }
}

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
  await lockBookQueue(tx, copy.bookId)
  const next = await tx.reservation.findFirst({
    where: { bookId: copy.bookId, status: 'QUEUED' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: NEXT_SELECT,
  })
  if (!next) {
    await tx.bookCopy.update({ where: { id: copy.id }, data: { status: 'AVAILABLE' } })
    return null
  }
  const holdUntil = holdUntilOf(hold, now)
  await tx.bookCopy.update({ where: { id: copy.id }, data: { status: 'RESERVED' } })
  await tx.reservation.update({
    where: { id: next.id },
    data: { status: 'READY', copyId: copy.id, readyAt: now, holdUntil },
  })
  return heldOf(next, holdUntil)
}

/**
 * Свободные экземпляры книги — первым в очереди: после новой брони, заведения экземпляров или
 * возврата экземпляра в оборот. Лок книги берёт сам.
 */
export async function serveQueue(
  tx: Prisma.TransactionClient,
  bookId: string,
  hold: { holdDays: number; timezone: string },
  now = new Date(),
): Promise<HeldFor[]> {
  await lockBookQueue(tx, bookId)
  const held: HeldFor[] = []
  for (;;) {
    const next = await tx.reservation.findFirst({
      where: { bookId, status: 'QUEUED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: NEXT_SELECT,
    })
    if (!next) break
    const copy = await tx.bookCopy.findFirst({
      where: { bookId, status: 'AVAILABLE' },
      orderBy: { inventoryNumber: 'asc' },
      select: { id: true },
    })
    if (!copy) break
    const holdUntil = holdUntilOf(hold, now)
    await tx.bookCopy.update({ where: { id: copy.id }, data: { status: 'RESERVED' } })
    await tx.reservation.update({
      where: { id: next.id },
      data: { status: 'READY', copyId: copy.id, readyAt: now, holdUntil },
    })
    held.push(heldOf(next, holdUntil))
  }
  return held
}
