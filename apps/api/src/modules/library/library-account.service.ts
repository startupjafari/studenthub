import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { AccountLibraryDebt } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { LibrarySettingsService } from './library-settings.service'
import { LibraryLoansService, UNSETTLED_DEBT_WHERE } from './library-loans.service'
import { formatDay, todayIn } from './library-dates'
import { lockBookQueue, lockReader, releaseCopy, type HeldFor } from './library-holds'

// Библиотека и удаление аккаунта (Фаза 21.C1, docs/PERSONAL_DATA.md §5).
//
// Решение владельца: пока за человеком числится книга, аккаунт не удаляется — `409
// LIBRARY_DEBTS_OPEN` со списком книг. Долг — то же, что у справки «задолженностей нет»
// (UNSETTLED_DEBT_WHERE): книга на руках или утерянная, за которую ещё не рассчитались.
// Утерянная без отметки о погашении — такой же долг, как книга на руках: обезличь мы её
// снимок, и долг стало бы не с кого спрашивать.
//
// Без долгов удаление в ОДНОЙ транзакции с анонимизацией профиля (UserService.softDeleteSelf):
// брони снимаются, отложенный экземпляр уходит следующему в очереди, а снимок ФИО, группы и
// номера билета в выдачах и журнале удостоверений заменяется надгробием. Раньше брони
// снимались после транзакции и best-effort — сбой оставлял человека в очереди.

/** Имя в снимках удалённого — то же, что у самой учётной записи после удаления. */
export const DELETED_PERSON_NAME = 'Удалённый пользователь'

/** Больше книг одновременно у читателя не бывает: предел выдачи вуза меньше. */
const MAX_DEBTS = 100
/** Броней у читателя не больше предела вуза; страница — с запасом. */
const RESERVATION_PAGE = 100

const DEBT_SELECT = {
  id: true,
  universityId: true,
  status: true,
  bookTitle: true,
  inventoryNumber: true,
  dueAt: true,
} satisfies Prisma.LoanSelect

/** Что сделала транзакция удаления: кому из очереди отложили книги — уведомить после неё. */
export interface ForgottenReader {
  reservationsCancelled: number
  held: { held: HeldFor; title: string; timezone: string }[]
}

@Injectable()
export class LibraryAccountService {
  private readonly logger = new Logger(LibraryAccountService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LibrarySettingsService,
    private readonly loans: LibraryLoansService,
  ) {}

  /** Книги за человеком: на руках и утерянные с непогашенным долгом, по сроку. */
  async debtsOf(
    readerId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<AccountLibraryDebt[]> {
    const rows = await db.loan.findMany({
      where: { readerId, ...UNSETTLED_DEBT_WHERE },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: MAX_DEBTS,
      select: DEBT_SELECT,
    })
    if (rows.length === 0) return []
    // Вуз у читателя один, но выдачи переживают перевод — пояс берём по вузу выдачи.
    const zones = new Map<string, string>()
    for (const universityId of new Set(rows.map((r) => r.universityId))) {
      zones.set(universityId, await this.loans.timezoneOf(universityId))
    }
    const now = new Date()
    return rows.map((r) => ({
      loanId: r.id,
      status: r.status === 'LOST' ? 'LOST' : 'OPEN',
      bookTitle: r.bookTitle,
      inventoryNumber: r.inventoryNumber,
      dueDate: todayIn(zones.get(r.universityId) ?? 'Asia/Almaty', r.dueAt),
      overdue: r.status === 'OPEN' && r.dueAt < now,
    }))
  }

  /**
   * `409 LIBRARY_DEBTS_OPEN`: строка на книгу в `details[]` — человеку и клиенту без
   * предпроверки; разобранный список отдаёт `GET /users/me/deletion-check`.
   */
  debtsConflict(debts: AccountLibraryDebt[]): AppException {
    return new AppException(
      'LIBRARY_DEBTS_OPEN',
      'Удалить аккаунт нельзя: за вами числятся книги библиотеки — сначала верните их',
      debts.map((d) => ({
        field: 'libraryDebts',
        message:
          d.status === 'LOST'
            ? `«${d.bookTitle}», инв. № ${d.inventoryNumber} — утеряна, долг не погашен`
            : `«${d.bookTitle}», инв. № ${d.inventoryNumber} — вернуть до ${formatDay(d.dueDate)}`,
      })),
    )
  }

  /** Отказ, если за человеком есть книги. Без транзакции — ранняя проверка до пароля. */
  async assertNoDebts(readerId: string): Promise<void> {
    const debts = await this.debtsOf(readerId)
    if (debts.length > 0) throw this.debtsConflict(debts)
  }

  /**
   * Внутри транзакции удаления аккаунта: под локом читателя (выдача и бронь берут его же —
   * книгу не выдадут в промежутке между проверкой и удалением) —
   *
   * 1. `refuseOnDebt` — отказ при долге. Его ставит удаление по просьбе человека; уборка
   *    сроков хранения (профиль ушедшего, неподтверждённый работодатель) не спрашивает, и
   *    снимок выдачи-долга у неё остаётся (п. 3);
   * 2. действующие брони → `CANCELLED`, отложенный под готовую бронь экземпляр — следующему
   *    в очереди или на полку (releaseCopy под локом книги, как при обычной отмене);
   * 3. снимок ФИО, группы и номера билета в выдачах и имя в журнале удостоверений — на
   *    надгробие. Выдача-долг (только у уборки) остаётся с именем: долг должен быть с кого
   *    спросить, хранится он до погашения (PERSONAL_DATA §4);
   * 4. имя библиотекаря в журнале удостоверений — тоже: журнал остаётся, человек в нём нет.
   */
  async forgetReader(
    tx: Prisma.TransactionClient,
    readerId: string,
    opts: { refuseOnDebt: boolean },
  ): Promise<ForgottenReader> {
    await lockReader(tx, readerId)
    const debts = await this.debtsOf(readerId, tx)
    if (opts.refuseOnDebt && debts.length > 0) throw this.debtsConflict(debts)

    const result: ForgottenReader = { reservationsCancelled: 0, held: [] }
    const now = new Date()
    for (;;) {
      const page = await tx.reservation.findMany({
        where: { readerId, status: { in: ['QUEUED', 'READY'] } },
        // Локи книг — в одном порядке, чтобы две такие транзакции не ждали друг друга.
        orderBy: [{ bookId: 'asc' }, { id: 'asc' }],
        take: RESERVATION_PAGE,
        select: {
          id: true,
          universityId: true,
          bookId: true,
          copyId: true,
          book: { select: { title: true } },
        },
      })
      for (const row of page) {
        // Под локом книги: иначе возврат, отдающий экземпляр «первому в очереди», мог
        // прочитать эту бронь до отмены и сделать её готовой уже после.
        await lockBookQueue(tx, row.bookId)
        const { count } = await tx.reservation.updateMany({
          where: { id: row.id, status: { in: ['QUEUED', 'READY'] } },
          data: { status: 'CANCELLED', closedAt: now },
        })
        if (count === 0) continue
        result.reservationsCancelled++
        if (!row.copyId) continue
        const [settings, timezone] = await Promise.all([
          this.settings.get(row.universityId),
          this.loans.timezoneOf(row.universityId),
        ])
        const held = await releaseCopy(
          tx,
          { id: row.copyId, bookId: row.bookId },
          { holdDays: settings.reservationHoldDays, timezone },
          now,
        )
        if (held) result.held.push({ held, title: row.book.title, timezone })
      }
      if (page.length < RESERVATION_PAGE) break
    }

    const kept = debts.map((d) => d.loanId)
    await tx.loan.updateMany({
      where: { readerId, ...(kept.length > 0 ? { id: { notIn: kept } } : {}) },
      data: { readerName: DELETED_PERSON_NAME, readerGroup: null, readerCard: null },
    })
    await tx.libraryIdAccessLog.updateMany({
      where: {
        readerId,
        // `notIn` по пустому loanId в SQL даёт NULL — записи без выдачи отдельно.
        ...(kept.length > 0 ? { OR: [{ loanId: null }, { loanId: { notIn: kept } }] } : {}),
      },
      data: { readerName: DELETED_PERSON_NAME },
    })
    await tx.libraryIdAccessLog.updateMany({
      where: { librarianId: readerId },
      data: { librarianName: DELETED_PERSON_NAME },
    })
    return result
  }

  /**
   * После транзакции удаления: следующим в очереди — «бронь готова». Best-effort: удаление
   * уже сохранено, а не дошедшее уведомление догонит cron (`notifyReadyPending`).
   */
  async afterForget(result: ForgottenReader): Promise<void> {
    for (const { held, title, timezone } of result.held) {
      try {
        await this.loans.notifyHeld(held, title, timezone)
      } catch (err) {
        this.logger.warn(
          `Не удалось уведомить о готовой брони ${held.reservationId}: ${String(err)}`,
        )
      }
    }
  }
}
