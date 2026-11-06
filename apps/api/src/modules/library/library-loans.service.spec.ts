import { Role } from '@studenthub/shared-types'
import { LibraryLoansService } from './library-loans.service'
import { issueReaderTicket } from './library-ticket'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { FileService } from '../files/file.service'
import type { StudentIdService } from '../student-id/student-id.service'
import type { LibrarySettingsService } from './library-settings.service'
import type { LibraryNotifier } from './library-notifier'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const config = {
  get: jest.fn((key: string) =>
    key === 'JWT_ACCESS_SECRET' ? 'test-secret-test-secret-test-secret-1234' : undefined,
  ),
} as never

function actor(role: Role, sub = 'lib-1', universityId: string | null = 'uni-1'): JwtPayload {
  return { sub, role, universityId, facultyId: null, groupId: null }
}

const librarian = actor(Role.LIBRARIAN)
const student = actor(Role.STUDENT, 'stu-1')

function readerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stu-1',
    role: Role.STUDENT,
    universityId: 'uni-1',
    firstName: 'Нурлан',
    lastName: 'Оспанов',
    middleName: 'Бауыржанович',
    avatarUrl: null,
    avatarThumbUrl: null,
    studentCardNumber: '2023-0042',
    academicStatus: 'Обучающийся',
    course: 2,
    group: { name: 'ИТ-23-1' },
    faculty: { name: 'ФИТ' },
    ...overrides,
  }
}

function loanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loan-1',
    universityId: 'uni-1',
    status: 'OPEN',
    issuedAt: new Date('2026-10-22T05:00:00Z'),
    dueAt: new Date('2026-11-05T18:59:59.999Z'),
    renewals: 0,
    returnedAt: null,
    cancelledAt: null,
    cancelReason: null,
    disputedAt: null,
    lostSettledAt: null,
    withoutPhone: false,
    readerId: 'stu-1',
    readerName: 'Оспанов Нурлан Бауыржанович',
    readerGroup: 'ИТ-23-1',
    readerCard: '2023-0042',
    bookTitle: 'Русская литература',
    inventoryNumber: '101',
    copyId: 'copy-1',
    copy: { book: { id: 'book-1', title: 'Русская литература', authors: '', coverFileId: null } },
    issuedBy: { firstName: 'Гульнара', lastName: 'Сапарова' },
    ...overrides,
  }
}

function copyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'copy-1',
    universityId: 'uni-1',
    status: 'AVAILABLE',
    inventoryNumber: '101',
    book: { id: 'book-1', title: 'Русская литература', archivedAt: null },
    ...overrides,
  }
}

function setup({
  open = 0,
  overdue = 0,
  lost = 0,
}: { open?: number; overdue?: number; lost?: number } = {}) {
  const loanCount = jest
    .fn()
    .mockImplementation(({ where }) =>
      Promise.resolve(where.status === 'LOST' ? lost : where.dueAt ? overdue : open),
    )
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    // Читатель жив под локом (не удалён в промежутке — Фаза 21.C1).
    user: { count: jest.fn().mockResolvedValue(1) },
    bookCopy: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    // Выдача без скана — строка журнала удостоверений в той же транзакции (21.C5).
    libraryIdAccessLog: { create: jest.fn().mockResolvedValue({}) },
    loan: {
      count: loanCount,
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve(loanRow({ ...data, id: 'loan-new' }))),
    },
    reservation: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(readerRow()),
      findMany: jest.fn().mockResolvedValue([{ id: 'lib-1' }, { id: 'lib-2' }]),
      findUnique: jest.fn().mockResolvedValue({ firstName: 'Гульнара', lastName: 'Сапарова' }),
    },
    libraryIdAccessLog: { create: jest.fn().mockResolvedValue({}) },
    loan: {
      count: loanCount,
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(loanRow()),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(loanRow(data))),
    },
    bookCopy: { findUnique: jest.fn().mockResolvedValue(copyRow()) },
    reservation: { findFirst: jest.fn().mockResolvedValue(null) },
    university: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }) },
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const files = { getPresignedUrls: jest.fn().mockResolvedValue(new Map()) }
  const studentId = { verify: jest.fn().mockResolvedValue({ id: 'stu-1' }) }
  const settings = {
    requireEnabled: jest.fn().mockResolvedValue({
      enabled: true,
      defaultLoanDays: 14,
      maxLoanDays: 120,
      maxActiveLoans: 5,
    }),
  }
  const notifier = { send: jest.fn().mockResolvedValue(undefined) }
  // Отзыв справок «задолженностей нет» (Фаза 21.C4).
  const exports = { revokeMatching: jest.fn().mockResolvedValue(0) }
  const service = new LibraryLoansService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    files as unknown as FileService,
    studentId as unknown as StudentIdService,
    settings as unknown as LibrarySettingsService,
    notifier as unknown as LibraryNotifier,
    config,
    exports as never,
  )
  return { service, prisma, tx, audit, notifier, studentId, exports }
}

const ticketFor = (librarianId = 'lib-1', readerId = 'stu-1') =>
  issueReaderTicket(config, readerId, librarianId, 'uni-1').ticket

describe('LibraryLoansService — сверка читателя', () => {
  it('скан студенческого: QR забирает StudentIdService, библиотекарь получает пропуск', async () => {
    const { service, studentId } = setup()
    const session = await service.resolveReader(librarian, 'qr-token', ctx)
    expect(studentId.verify).toHaveBeenCalledWith(librarian, 'qr-token', ctx)
    expect(session.ticket).toEqual(expect.any(String))
    expect(session.eligibility).toMatchObject({ canBorrow: true, blockers: [], lostLoans: 0 })
    expect(session.reader).toMatchObject({ group: 'ИТ-23-1', studentCardNumber: '2023-0042' })
  })

  it('утерянная книга без погашения — долг: читателю нельзя брать книги', async () => {
    const { service, prisma } = setup({ lost: 1 })
    const session = await service.resolveReader(librarian, 'qr-token', ctx)
    expect(session.eligibility).toMatchObject({
      canBorrow: false,
      lostLoans: 1,
      blockers: ['lost'],
    })
    // Погашенная утеря долгом не считается — в подсчёт попадают только без отметки.
    expect(prisma.loan.count).toHaveBeenCalledWith({
      where: { readerId: 'stu-1', status: 'LOST', lostSettledAt: null },
    })
  })

  it('выдаёт только библиотекарь', async () => {
    const { service } = setup()
    await expect(
      service.resolveReader(actor(Role.UNIVERSITY_ADMIN), 'qr', ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('преподаватель — не читатель', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(readerRow({ role: Role.TEACHER }))
    await expect(service.resolveReader(librarian, 'qr', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [expect.objectContaining({ field: 'reader' })],
    })
  })
})

describe('LibraryLoansService — выдача', () => {
  it('выдаёт: снимок читателя и книги, срок до конца дня по часам вуза, уведомление', async () => {
    const { service, tx, notifier, audit } = setup()
    await service.issue(
      librarian,
      { ticket: ticketFor(), copyCode: 'abcd-2345', dueDate: undefined },
      ctx,
    )
    expect(tx.bookCopy.updateMany).toHaveBeenCalledWith({
      where: { id: 'copy-1', status: 'AVAILABLE' },
      data: { status: 'ON_LOAN' },
    })
    const data = tx.loan.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      readerName: 'Оспанов Нурлан Бауыржанович',
      readerGroup: 'ИТ-23-1',
      readerCard: '2023-0042',
      bookTitle: 'Русская литература',
      issuedById: 'lib-1',
    })
    // 18:59:59.999 UTC — конец дня в Алматы.
    expect((data.dueAt as Date).toISOString()).toMatch(/T18:59:59\.999Z$/)
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: ['stu-1'], titleKey: 'library.loanIssued.title' }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'library_loan_issued' }),
    )
  })

  it.each([
    [{ overdue: 1 }, 'overdue'],
    [{ open: 5 }, 'limit'],
    [{ lost: 1 }, 'lost'],
  ])('читателю с %o не выдать: 409 %s', async (state, field) => {
    const { service } = setup(state)
    await expect(
      service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: [expect.objectContaining({ field })] })
  })

  it.each(['Отчислен', 'EXPELLED', 'GRADUATED'])(
    'статус %s — не выдать',
    async (academicStatus) => {
      const { service, prisma } = setup()
      prisma.user.findFirst.mockResolvedValue(readerRow({ academicStatus }))
      await expect(
        service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx),
      ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'status' })] })
    },
  )

  it('пропуск другого библиотекаря не действует', async () => {
    const { service } = setup()
    await expect(
      service.issue(librarian, { ticket: ticketFor('lib-2'), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [expect.objectContaining({ field: 'ticket' })],
    })
  })

  it('срок дальше максимального — 422 по полю dueDate', async () => {
    const { service } = setup()
    await expect(
      service.issue(
        librarian,
        { ticket: ticketFor(), copyCode: 'ABCD2345', dueDate: '2099-01-01' },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ field: 'dueDate' })],
    })
  })

  it('экземпляр под бронью другого читателя не выдать, своему — выдать и закрыть бронь', async () => {
    const { service, prisma, tx } = setup()
    prisma.bookCopy.findUnique.mockResolvedValue(copyRow({ status: 'RESERVED' }))
    prisma.reservation.findFirst.mockResolvedValue({ id: 'res-1', readerId: 'stu-9' })
    await expect(
      service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'reserved' })] })
    prisma.reservation.findFirst.mockResolvedValue({ id: 'res-1', readerId: 'stu-1' })
    await service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx)
    // Бронь закрывается условно: всё ещё готова, на этот экземпляр и этого читателя.
    expect(tx.reservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-1', status: 'READY', copyId: 'copy-1', readerId: 'stu-1' },
        data: expect.objectContaining({ status: 'FULFILLED', loanId: 'loan-new' }),
      }),
    )
  })

  it('бронь сняли между проверкой и выдачей — 409 reserved, выдача откатывается', async () => {
    const { service, prisma, tx } = setup()
    prisma.bookCopy.findUnique.mockResolvedValue(copyRow({ status: 'RESERVED' }))
    prisma.reservation.findFirst.mockResolvedValue({ id: 'res-1', readerId: 'stu-1' })
    tx.reservation.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'reserved' })] })
  })

  it('предел книг перепроверяется под локами читателя и книги', async () => {
    const { service, tx } = setup()
    // До транзакции у читателя 4 книги, внутри — уже 5: параллельная выдача успела раньше.
    tx.loan.count.mockImplementation(({ where }) =>
      Promise.resolve(where.status === 'OPEN' && !where.dueAt ? 5 : 0),
    )
    tx.loan.count.mockImplementationOnce(() => Promise.resolve(4))
    tx.loan.count.mockImplementationOnce(() => Promise.resolve(0))
    tx.loan.count.mockImplementationOnce(() => Promise.resolve(0))
    await expect(
      service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'limit' })] })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
    expect(tx.loan.create).not.toHaveBeenCalled()
  })

  // Фаза 21.C1: удаление аккаунта держит тот же лок читателя — выдача, ждавшая его, не
  // запишет книгу на только что удалённого.
  it('читателя удалили, пока выдача ждала лок, — 404, выдачи нет', async () => {
    const { service, tx } = setup()
    tx.user.count.mockResolvedValue(0)
    await expect(
      service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(tx.user.count).toHaveBeenCalledWith({
      where: { id: 'stu-1', deletedAt: null, isBlocked: false },
    })
    expect(tx.loan.create).not.toHaveBeenCalled()
  })

  it('книга с полки читателю из очереди — его бронь закрыта выдачей', async () => {
    const { service, tx } = setup()
    tx.reservation.findFirst.mockResolvedValue({ id: 'res-7', status: 'QUEUED', copyId: null })
    await service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx)
    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-7' },
        data: expect.objectContaining({ status: 'FULFILLED', loanId: 'loan-new' }),
      }),
    )
  })

  it('выданный экземпляр второй раз не выдать; гонку ловит условная запись', async () => {
    const { service, prisma, tx } = setup()
    prisma.bookCopy.findUnique.mockResolvedValue(copyRow({ status: 'ON_LOAN' }))
    await expect(
      service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'onLoan' })] })
    prisma.bookCopy.findUnique.mockResolvedValue(copyRow())
    tx.bookCopy.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'onLoan' })] })
  })

  it('экземпляр чужого вуза — 404', async () => {
    const { service, prisma } = setup()
    prisma.bookCopy.findUnique.mockResolvedValue(copyRow({ universityId: 'uni-2' }))
    await expect(
      service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// Фаза 21.C5: читатель без телефона — поиск по номеру билета и выдача только с отметкой.
describe('LibraryLoansService — читатель без телефона', () => {
  const cardTicket = () =>
    issueReaderTicket(config, 'stu-1', 'lib-1', 'uni-1', Date.now(), 'card').ticket

  it('поиск по номеру билета: свой вуз, читатели; просмотр — в журнал с отметкой', async () => {
    const { service, prisma } = setup()
    prisma.user.findMany.mockResolvedValue([{ id: 'stu-1' }])
    const session = await service.lookupReader(librarian, { studentCardNumber: '2023-0042' }, ctx)
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        universityId: 'uni-1',
        deletedAt: null,
        role: { in: [Role.STUDENT, Role.STAROSTA] },
        studentCardNumber: { equals: '2023-0042', mode: 'insensitive' },
      },
      select: { id: true },
      take: 2,
    })
    expect(session.via).toBe('card')
    expect(session.reader).toMatchObject({ firstName: 'Нурлан', lastName: 'Оспанов' })
    expect(prisma.libraryIdAccessLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        universityId: 'uni-1',
        librarianId: 'lib-1',
        librarianName: 'Сапарова Гульнара',
        readerId: 'stu-1',
        readerName: 'Оспанов Нурлан Бауыржанович',
        withoutPhone: true,
      }),
    })
  })

  it('номера нет — 404; номер у двоих — 409 cardAmbiguous, журнал не пишется', async () => {
    const { service, prisma } = setup()
    prisma.user.findMany.mockResolvedValueOnce([])
    await expect(
      service.lookupReader(librarian, { studentCardNumber: 'X' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
    await expect(
      service.lookupReader(librarian, { studentCardNumber: 'X' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'cardAmbiguous' })] })
    expect(prisma.libraryIdAccessLog.create).not.toHaveBeenCalled()
  })

  it('ищет только библиотекарь', async () => {
    const { service } = setup()
    await expect(
      service.lookupReader(actor(Role.UNIVERSITY_ADMIN), { studentCardNumber: 'X' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('пропуск по номеру билета без отметки — 409 noPhoneMark, выдачи нет', async () => {
    const { service, tx } = setup()
    await expect(
      service.issue(librarian, { ticket: cardTicket(), copyCode: 'ABCD2345' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'noPhoneMark' })] })
    expect(tx.loan.create).not.toHaveBeenCalled()
  })

  it('с отметкой: выдача withoutPhone, строка журнала в транзакции, аудит', async () => {
    const { service, tx, audit } = setup()
    const item = await service.issue(
      librarian,
      { ticket: cardTicket(), copyCode: 'ABCD2345', withoutPhone: true },
      ctx,
    )
    expect(tx.loan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ withoutPhone: true }) }),
    )
    expect(item.withoutPhone).toBe(true)
    expect(tx.libraryIdAccessLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        loanId: 'loan-new',
        readerId: 'stu-1',
        librarianName: 'Сапарова Гульнара',
        withoutPhone: true,
      }),
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'library_loan_issued',
        metadata: expect.objectContaining({ withoutPhone: true }),
      }),
    )
  })

  it('по скану QR отметка «без телефона» запрещена — 409 noPhoneMark', async () => {
    const { service, tx } = setup()
    await expect(
      service.issue(
        librarian,
        { ticket: ticketFor(), copyCode: 'ABCD2345', withoutPhone: true },
        ctx,
      ),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'noPhoneMark' })] })
    expect(tx.loan.create).not.toHaveBeenCalled()
  })

  it('обычная выдача по скану — без отметки и без строки журнала', async () => {
    const { service, tx } = setup()
    await service.issue(librarian, { ticket: ticketFor(), copyCode: 'ABCD2345' }, ctx)
    expect(tx.loan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ withoutPhone: false }) }),
    )
    expect(tx.libraryIdAccessLog.create).not.toHaveBeenCalled()
  })

  it('фильтр выдач без скана', async () => {
    const { service, prisma } = setup()
    Object.assign(prisma.loan, { findMany: jest.fn().mockResolvedValue([]) })
    Object.assign(prisma, {
      $transaction: jest.fn((arg: unknown) => Promise.all(arg as Promise<unknown>[])),
    })
    await service.list(librarian, { page: 1, limit: 20, filter: 'all', withoutPhone: true })
    expect(prisma.loan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ withoutPhone: true }) }),
    )
  })
})

describe('LibraryLoansService — «это не я»', () => {
  it('своя открытая выдача — отметка и уведомление библиотекарям', async () => {
    const { service, notifier, prisma } = setup()
    const item = await service.dispute(student, 'loan-1', ctx)
    expect(prisma.loan.update).toHaveBeenCalled()
    expect(item.disputedAt).not.toBeNull()
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['lib-1', 'lib-2'],
        titleKey: 'library.loanDisputed.title',
      }),
    )
  })

  it('закрытую выдачу не оспорить — 409 notOnLoan, а не «отчислен» (status)', async () => {
    const { service, prisma } = setup()
    prisma.loan.findUnique.mockResolvedValue(loanRow({ status: 'RETURNED' }))
    await expect(service.dispute(student, 'loan-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [expect.objectContaining({ field: 'notOnLoan' })],
    })
  })

  it('чужую выдачу не оспорить — 404', async () => {
    const { service, prisma } = setup()
    prisma.loan.findUnique.mockResolvedValue(loanRow({ readerId: 'stu-9' }))
    await expect(service.dispute(student, 'loan-1', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
