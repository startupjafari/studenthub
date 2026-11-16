import { Injectable, Logger } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import type { LibraryClearance, LibraryDebts } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { LibrarySettingsService } from './library-settings.service'
import { LibraryNotifier } from './library-notifier'
import { LOAN_SELECT, LibraryLoansService, UNSETTLED_DEBT_WHERE } from './library-loans.service'
import { READER_ROLES, readerLibrary } from './library-scope'

// Долги библиотеки при выпуске и отчислении (Фаза 20.11, docs/PROJECT.md §3.11). Смену
// статуса книги не блокируют — декан видит, что за студентом числится, и решает сам; это
// предупреждение и список, а не запрет. Студенту — справка «задолженностей нет». Долг — книга
// на руках или утерянная, за которую ещё не рассчитались (UNSETTLED_DEBT_WHERE).

/** Сколько долгов показываем — больше предела выдачи у читателя на руках не бывает. */
const MAX_OPEN = 50
/** Библиотекарей у вуза единицы; потолок — как у уведомления «выдача оспорена». */
const MAX_LIBRARIANS = 50

@Injectable()
export class LibraryDebtsService {
  private readonly logger = new Logger(LibraryDebtsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LibrarySettingsService,
    private readonly loans: LibraryLoansService,
    private readonly notifier: LibraryNotifier,
  ) {}

  /**
   * Отчислили читателя, за которым числятся книги (на руках или утерянные с непогашенным
   * долгом), — библиотекарям его вуза уведомление в тот же момент (Фаза 21.C3). Декан видит
   * долги в форме и решает сам, но книги собирает библиотека, и раньше она узнавала об уходе
   * должника только по просрочке. Зовёт UserService после смены статуса; без долгов —
   * ничего. Возвращает, сколько книг за читателем.
   */
  async notifyExpelledDebtor(readerId: string, now = new Date()): Promise<number> {
    const reader = await this.prisma.user.findFirst({
      where: { id: readerId, deletedAt: null },
      select: { role: true, universityId: true, firstName: true, lastName: true },
    })
    if (!reader?.universityId || !READER_ROLES.includes(reader.role)) return 0
    const universityId = reader.universityId
    const debts = await this.prisma.loan.count({
      where: { readerId, universityId, ...UNSETTLED_DEBT_WHERE },
    })
    if (debts === 0) return 0
    const librarians = await this.prisma.user.findMany({
      where: { universityId, role: Role.LIBRARIAN, deletedAt: null, isBlocked: false },
      select: { id: true },
      take: MAX_LIBRARIANS,
    })
    await this.notifier.send({
      recipientIds: librarians.map((l) => l.id),
      job: NOTIFICATION_JOBS.LIBRARY_LOAN,
      titleKey: 'library.debtorExpelled.title',
      bodyKey: 'library.debtorExpelled.body',
      params: { name: `${reader.lastName} ${reader.firstName}`, count: debts },
      // Выдачи вуза: книги отчисленного помечены там «отчислен».
      url: '/library/loans',
      // Время в ключе: отчисленного, восстановленного и снова отчисленного нужно сообщить
      // второй раз, а повтор того же job'а очередь отбросит по jobId.
      dedupeKey: `library-debtor-expelled:${readerId}:${now.getTime()}`,
    })
    this.logger.log(`Отчислен читатель ${readerId} с долгами в библиотеке: ${debts}`)
    return debts
  }

  /** Книги за студентом: декан — своего факультета, админ вуза и библиотекарь — своего вуза. */
  async debts(actor: JwtPayload, userId: string): Promise<LibraryDebts> {
    const reader = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        role: true,
        universityId: true,
        facultyId: true,
        firstName: true,
        lastName: true,
      },
    })
    if (!reader || !READER_ROLES.includes(reader.role)) {
      throw new AppException('NOT_FOUND', 'Студент не найден')
    }
    const inScope =
      actor.role === Role.DEAN
        ? reader.facultyId !== null && reader.facultyId === actor.facultyId
        : actor.role === Role.UNIVERSITY_ADMIN || actor.role === Role.LIBRARIAN
          ? reader.universityId !== null && reader.universityId === actor.universityId
          : false
    if (!inScope || !reader.universityId) {
      throw new AppException('WRONG_SCOPE', 'Студент вне вашей области')
    }
    const universityId = reader.universityId
    const [settings, rows, activeReservations] = await Promise.all([
      this.settings.get(universityId),
      this.prisma.loan.findMany({
        where: { readerId: reader.id, universityId, ...UNSETTLED_DEBT_WHERE },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: MAX_OPEN,
        select: LOAN_SELECT,
      }),
      this.prisma.reservation.count({
        where: { readerId: reader.id, status: { in: ['QUEUED', 'READY'] } },
      }),
    ])
    return {
      readerId: reader.id,
      readerName: `${reader.lastName} ${reader.firstName}`,
      enabled: settings.enabled,
      clear: rows.length === 0,
      loans: await this.loans.toItems(rows, await this.loans.timezoneOf(universityId)),
      activeReservations,
    }
  }

  /**
   * Справка студенту: ни книг на руках, ни непогашенных утерянных — «задолженностей нет»,
   * иначе — что вернуть или возместить.
   */
  async clearance(actor: JwtPayload): Promise<LibraryClearance> {
    const universityId = readerLibrary(actor)
    const reader = await this.prisma.user.findFirst({
      where: { id: actor.sub, deletedAt: null },
      select: {
        firstName: true,
        lastName: true,
        middleName: true,
        studentCardNumber: true,
        group: { select: { name: true } },
        faculty: { select: { name: true } },
        university: { select: { name: true } },
      },
    })
    if (!reader) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    const rows = await this.prisma.loan.findMany({
      where: { readerId: actor.sub, universityId, ...UNSETTLED_DEBT_WHERE },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: MAX_OPEN,
      select: LOAN_SELECT,
    })
    return {
      clear: rows.length === 0,
      checkedAt: new Date().toISOString(),
      reader: {
        name: [reader.lastName, reader.firstName, reader.middleName].filter(Boolean).join(' '),
        group: reader.group?.name ?? null,
        faculty: reader.faculty?.name ?? null,
        studentCardNumber: reader.studentCardNumber,
      },
      university: reader.university?.name ?? '',
      loans: await this.loans.toItems(rows, await this.loans.timezoneOf(universityId)),
    }
  }
}
