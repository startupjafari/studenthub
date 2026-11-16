import { LibraryAccountService, DELETED_PERSON_NAME } from './library-account.service'
import { UNSETTLED_DEBT_WHERE } from './library-loans.service'

// Библиотека и удаление аккаунта (Фаза 21.C1).

const rules = { reservationHoldDays: 3 }

function loanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loan-1',
    universityId: 'uni-1',
    status: 'OPEN',
    bookTitle: 'Война и мир',
    inventoryNumber: '0012',
    // 20.11.2026 23:59:59 по Алматы (UTC+5).
    dueAt: new Date('2026-11-20T18:59:59.999Z'),
    ...overrides,
  }
}

function setup({
  debts = [] as ReturnType<typeof loanRow>[],
  reservations = [] as Record<string, unknown>[],
  queueHead = null as null | Record<string, unknown>,
} = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    loan: {
      findMany: jest.fn().mockResolvedValue(debts),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    libraryIdAccessLog: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    reservation: {
      // Первая страница броней читателя, дальше — очередь книги (nextInQueue) и пусто.
      findMany: jest
        .fn()
        .mockResolvedValueOnce(reservations)
        .mockResolvedValueOnce(queueHead ? [queueHead] : [])
        .mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    bookCopy: { update: jest.fn().mockResolvedValue({}) },
  }
  const prisma = { loan: { findMany: jest.fn().mockResolvedValue(debts) } }
  const settings = { get: jest.fn().mockResolvedValue(rules) }
  const loans = {
    timezoneOf: jest.fn().mockResolvedValue('Asia/Almaty'),
    notifyHeld: jest.fn().mockResolvedValue(true),
  }
  const service = new LibraryAccountService(prisma as never, settings as never, loans as never)
  return { service, tx, prisma, loans }
}

describe('LibraryAccountService — долги читателя', () => {
  it('книги на руках и утерянные непогашенные, срок — днём по часам вуза', async () => {
    const { service, prisma } = setup({
      debts: [
        loanRow({ dueAt: new Date('2020-01-01T00:00:00Z') }),
        loanRow({ id: 'loan-2', status: 'LOST', inventoryNumber: '0013' }),
      ],
    })
    const debts = await service.debtsOf('stu-1')
    expect(prisma.loan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { readerId: 'stu-1', ...UNSETTLED_DEBT_WHERE } }),
    )
    expect(debts).toEqual([
      {
        loanId: 'loan-1',
        status: 'OPEN',
        bookTitle: 'Война и мир',
        inventoryNumber: '0012',
        dueDate: '2020-01-01',
        overdue: true,
      },
      {
        loanId: 'loan-2',
        status: 'LOST',
        bookTitle: 'Война и мир',
        inventoryNumber: '0013',
        dueDate: '2026-11-20',
        // Утерянная — долг, но не просрочка.
        overdue: false,
      },
    ])
  })

  it('assertNoDebts: книга на руках — 409 LIBRARY_DEBTS_OPEN со строкой на книгу', async () => {
    const { service } = setup({
      debts: [loanRow(), loanRow({ id: 'loan-2', status: 'LOST', inventoryNumber: '0013' })],
    })
    await expect(service.assertNoDebts('stu-1')).rejects.toMatchObject({
      code: 'LIBRARY_DEBTS_OPEN',
      details: [
        { field: 'libraryDebts', message: '«Война и мир», инв. № 0012 — вернуть до 20.11.2026' },
        {
          field: 'libraryDebts',
          message: '«Война и мир», инв. № 0013 — утеряна, долг не погашен',
        },
      ],
    })
  })

  it('assertNoDebts: без книг — молча', async () => {
    const { service } = setup()
    await expect(service.assertNoDebts('stu-1')).resolves.toBeUndefined()
  })
})

describe('LibraryAccountService.forgetReader', () => {
  it('удаление по просьбе: книга на руках — 409 под локом читателя, ничего не тронуто', async () => {
    const { service, tx } = setup({ debts: [loanRow()] })
    await expect(
      service.forgetReader(tx as never, 'stu-1', { refuseOnDebt: true }),
    ).rejects.toMatchObject({ code: 'LIBRARY_DEBTS_OPEN' })
    // Лок читателя — до проверки: выдача в промежутке ждёт его.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.loan.findMany.mock.invocationCallOrder[0] ?? 0,
    )
    expect(tx.reservation.updateMany).not.toHaveBeenCalled()
    expect(tx.loan.updateMany).not.toHaveBeenCalled()
  })

  it('без долгов: снимки в выдачах и журнале удостоверений — на надгробие', async () => {
    const { service, tx } = setup()
    const result = await service.forgetReader(tx as never, 'stu-1', { refuseOnDebt: true })
    expect(result).toEqual({ reservationsCancelled: 0, held: [] })
    expect(tx.loan.updateMany).toHaveBeenCalledWith({
      where: { readerId: 'stu-1' },
      data: { readerName: DELETED_PERSON_NAME, readerGroup: null, readerCard: null },
    })
    expect(tx.libraryIdAccessLog.updateMany).toHaveBeenCalledWith({
      where: { readerId: 'stu-1' },
      data: { readerName: DELETED_PERSON_NAME },
    })
    // Удалённый библиотекарь — тоже без имени в журнале.
    expect(tx.libraryIdAccessLog.updateMany).toHaveBeenCalledWith({
      where: { librarianId: 'stu-1' },
      data: { librarianName: DELETED_PERSON_NAME },
    })
  })

  it('уборка (без отказа): выдача-долг остаётся с именем, остальное обезличено', async () => {
    const { service, tx } = setup({ debts: [loanRow()] })
    await service.forgetReader(tx as never, 'stu-1', { refuseOnDebt: false })
    expect(tx.loan.updateMany).toHaveBeenCalledWith({
      where: { readerId: 'stu-1', id: { notIn: ['loan-1'] } },
      data: { readerName: DELETED_PERSON_NAME, readerGroup: null, readerCard: null },
    })
    expect(tx.libraryIdAccessLog.updateMany).toHaveBeenCalledWith({
      where: { readerId: 'stu-1', OR: [{ loanId: null }, { loanId: { notIn: ['loan-1'] } }] },
      data: { readerName: DELETED_PERSON_NAME },
    })
  })

  it('брони → CANCELLED в транзакции, отложенный экземпляр — следующему в очереди', async () => {
    const { service, tx, loans } = setup({
      reservations: [
        {
          id: 'res-q',
          universityId: 'uni-1',
          bookId: 'book-1',
          copyId: null,
          book: { title: 'Идиот' },
        },
        {
          id: 'res-r',
          universityId: 'uni-1',
          bookId: 'book-2',
          copyId: 'copy-9',
          book: { title: 'Война и мир' },
        },
      ],
      queueHead: {
        id: 'res-next',
        readerId: 'stu-2',
        reader: {
          firstName: 'Айгерим',
          lastName: 'Сейтова',
          academicStatus: null,
          group: { name: 'ИТ-23-1' },
        },
      },
    })
    const result = await service.forgetReader(tx as never, 'stu-1', { refuseOnDebt: true })
    expect(tx.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-q', status: { in: ['QUEUED', 'READY'] } },
      data: { status: 'CANCELLED', closedAt: expect.any(Date) },
    })
    expect(tx.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-r', status: { in: ['QUEUED', 'READY'] } },
      data: { status: 'CANCELLED', closedAt: expect.any(Date) },
    })
    // Экземпляр готовой брони отложен следующему (releaseCopy), а не оставлен на полке броней.
    expect(tx.bookCopy.update).toHaveBeenCalledWith({
      where: { id: 'copy-9' },
      data: { status: 'RESERVED' },
    })
    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'res-next' } }),
    )
    expect(result.reservationsCancelled).toBe(2)
    expect(result.held).toEqual([
      expect.objectContaining({
        title: 'Война и мир',
        timezone: 'Asia/Almaty',
        held: expect.objectContaining({ reservationId: 'res-next', readerId: 'stu-2' }),
      }),
    ])

    // После транзакции — «бронь готова» следующему; сбой уведомления не роняет удаление.
    loans.notifyHeld.mockRejectedValueOnce(new Error('redis down'))
    await expect(service.afterForget(result)).resolves.toBeUndefined()
    expect(loans.notifyHeld).toHaveBeenCalledWith(
      result.held[0]?.held,
      'Война и мир',
      'Asia/Almaty',
    )
  })
})
