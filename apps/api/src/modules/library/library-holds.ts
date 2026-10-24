import type { Prisma } from '@prisma/client'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { isTerminalAcademicStatus } from '../users/academic-status'
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

/**
 * Лок читателя — берут выдача и бронь, пока считают его книги и брони: две одновременные
 * выдачи или брони иначе обе видят «на одну меньше предела» и вместе его превышают. Берётся
 * раньше лока книги — один порядок у всех, кто берёт оба.
 */
export function lockReader(tx: Prisma.TransactionClient, readerId: string): Promise<void> {
  return advisoryXactLock(tx, `library:reader:${readerId}`)
}

/** Готовая бронь держится до конца N-го дня по часам вуза. */
function holdUntilOf(hold: { holdDays: number; timezone: string }, now: Date): Date {
  return endOfDay(addDays(todayIn(hold.timezone, now), hold.holdDays), hold.timezone)
}

const NEXT_SELECT = {
  id: true,
  readerId: true,
  reader: {
    select: {
      firstName: true,
      lastName: true,
      academicStatus: true,
      group: { select: { name: true } },
    },
  },
} satisfies Prisma.ReservationSelect

type NextRow = Prisma.ReservationGetPayload<{ select: typeof NEXT_SELECT }>

/** Сколько броней очереди смотреть за раз, пропуская тех, кому выдача закрыта. */
const QUEUE_PAGE = 20

/**
 * Первый в очереди, кому книгу можно выдать (§3.11): не заблокирован и не удалён, без
 * просрочки и непогашенной утери, не отчислен, не выпущен и не переведён. Такому читателю
 * экземпляр не откладывается — выдача дала бы `409`, и книга пролежала бы на полке броней
 * весь срок. Его бронь остаётся в очереди и дождётся следующего экземпляра, когда долг
 * закроют. Очередь архивной книги не обслуживается: её брони сняты при архивации.
 */
async function nextInQueue(
  tx: Prisma.TransactionClient,
  bookId: string,
  now: Date,
): Promise<NextRow | null> {
  const where: Prisma.ReservationWhereInput = {
    bookId,
    status: 'QUEUED',
    book: { archivedAt: null },
    reader: {
      deletedAt: null,
      isBlocked: false,
      loansAsReader: {
        none: {
          OR: [
            { status: 'OPEN', dueAt: { lt: now } },
            { status: 'LOST', lostSettledAt: null },
          ],
        },
      },
    },
  }
  for (let skip = 0; ; skip += QUEUE_PAGE) {
    const page = await tx.reservation.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take: QUEUE_PAGE,
      select: NEXT_SELECT,
    })
    // Учебный статус — свободная строка в двух представлениях, его сверяем здесь.
    const next = page.find((r) => !isTerminalAcademicStatus(r.reader.academicStatus))
    if (next) return next
    if (page.length < QUEUE_PAGE) return null
  }
}

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
  const next = await nextInQueue(tx, copy.bookId, now)
  if (!next) {
    await tx.bookCopy.update({ where: { id: copy.id }, data: { status: 'AVAILABLE' } })
    return null
  }
  const holdUntil = holdUntilOf(hold, now)
  await tx.bookCopy.update({ where: { id: copy.id }, data: { status: 'RESERVED' } })
  await tx.reservation.update({
    where: { id: next.id },
    // Отметку уведомления ставит notifyHeld, когда очередь примет «бронь готова».
    data: { status: 'READY', copyId: copy.id, readyAt: now, holdUntil, readyNotifiedAt: null },
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
    const next = await nextInQueue(tx, bookId, now)
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
      data: { status: 'READY', copyId: copy.id, readyAt: now, holdUntil, readyNotifiedAt: null },
    })
    held.push(heldOf(next, holdUntil))
  }
  return held
}
