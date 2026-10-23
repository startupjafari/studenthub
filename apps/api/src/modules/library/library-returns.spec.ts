import { Role } from '@studenthub/shared-types'
import { LibraryLoansService } from './library-loans.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Возврат, продление, утеря и отмена выдачи (Фаза 20.5).

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const librarian: JwtPayload = {
  sub: 'lib-1',
  role: Role.LIBRARIAN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function loanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loan-1',
    universityId: 'uni-1',
    status: 'OPEN',
    issuedAt: new Date('2026-10-01T05:00:00Z'),
    dueAt: new Date('2099-01-10T18:59:59.999Z'),
    renewals: 0,
    returnedAt: null,
    cancelledAt: null,
    cancelReason: null,
    disputedAt: null,
    lostSettledAt: null,
    readerId: 'stu-1',
    readerName: 'Оспанов Нурлан',
    readerGroup: 'ИТ-23-1',
    readerCard: '42',
    bookTitle: 'Русская литература',
    inventoryNumber: '101',
    copyId: 'copy-1',
    copy: { book: { id: 'book-1', title: 'Русская литература', authors: '', coverFileId: null } },
    issuedBy: null,
    ...overrides,
  }
}

function setup({ queued = null as null | Record<string, unknown>, queueCount = 0 } = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    loan: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(loanRow({ status: 'RETURNED' })),
      count: jest.fn().mockResolvedValue(0),
    },
    bookCopy: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'AVAILABLE' }),
    },
    reservation: {
      findFirst: jest.fn().mockResolvedValue(queued),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const prisma = {
    loan: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'loan-1', readerId: 'stu-1', bookTitle: 'Русская литература' }),
      findUnique: jest.fn().mockResolvedValue(loanRow()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(loanRow({ status: 'LOST' })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve(loanRow({ ...data, renewals: 1 }))),
    },
    bookCopy: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'copy-1',
        universityId: 'uni-1',
        status: 'ON_LOAN',
        inventoryNumber: '101',
        book: { id: 'book-1', title: 'Русская литература', archivedAt: null },
      }),
    },
    reservation: {
      count: jest.fn().mockResolvedValue(queueCount),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    university: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }) },
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const notifier = { send: jest.fn().mockResolvedValue(true) }
  const rules = {
    enabled: true,
    defaultLoanDays: 14,
    maxLoanDays: 120,
    maxActiveLoans: 5,
    reservationHoldDays: 3,
    maxRenewals: 1,
  }
  const settings = {
    requireEnabled: jest.fn().mockResolvedValue(rules),
    get: jest.fn().mockResolvedValue(rules),
  }
  const service = new LibraryLoansService(
    prisma as never,
    audit as never,
    { getPresignedUrls: jest.fn().mockResolvedValue(new Map()) } as never,
    {} as never,
    settings as never,
    notifier as never,
    { get: jest.fn() } as never,
  )
  return { service, prisma, tx, audit, notifier }
}

describe('Возврат', () => {
  it('невыданный экземпляр не принять — 409 notOnLoan', async () => {
    const { service, prisma } = setup()
    prisma.loan.findFirst.mockResolvedValue(null)
    await expect(
      service.returnCopy(librarian, { copyCode: 'ABCD2345', condition: 'GOOD' }, ctx),
    ).rejects.toMatchObject({ details: [expect.objectContaining({ field: 'notOnLoan' })] })
  })

  it('без очереди — экземпляр на полку, состояние записано, читателю уведомление', async () => {
    const { service, tx, notifier } = setup()
    const result = await service.returnCopy(
      librarian,
      { copyCode: 'ABCD2345', condition: 'WORN' },
      ctx,
    )
    expect(tx.loan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loan-1', status: 'OPEN' },
        data: expect.objectContaining({
          status: 'RETURNED',
          returnCondition: 'WORN',
          returnedToId: 'lib-1',
        }),
      }),
    )
    expect(tx.bookCopy.update).toHaveBeenCalledWith({
      where: { id: 'copy-1' },
      data: { status: 'AVAILABLE' },
    })
    expect(result.heldFor).toBeNull()
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: ['stu-1'], titleKey: 'library.loanReturned.title' }),
    )
  })

  it('есть очередь — экземпляр под бронь первому, тому «бронь готова»', async () => {
    const { service, tx, notifier } = setup({
      queued: {
        id: 'res-1',
        readerId: 'stu-2',
        reader: { firstName: 'Айгерим', lastName: 'Ахметова', group: { name: 'ИТ-23-2' } },
      },
    })
    const result = await service.returnCopy(
      librarian,
      { copyCode: 'ABCD2345', condition: 'GOOD' },
      ctx,
    )
    expect(tx.bookCopy.update).toHaveBeenCalledWith({
      where: { id: 'copy-1' },
      data: { status: 'RESERVED' },
    })
    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-1' },
        data: expect.objectContaining({ status: 'READY', copyId: 'copy-1' }),
      }),
    )
    expect(result.heldFor).toMatchObject({ name: 'Ахметова Айгерим', group: 'ИТ-23-2' })
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['stu-2'],
        titleKey: 'library.reservationReady.title',
      }),
    )
  })
})

describe('Продление', () => {
  it('сверх maxRenewals — 409 renewals', async () => {
    const { service, prisma } = setup()
    prisma.loan.findUnique.mockResolvedValue(loanRow({ renewals: 1 }))
    await expect(service.renew(librarian, 'loan-1', {}, ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'renewals' })],
    })
  })

  it('при очереди броней — 409 queue', async () => {
    const { service } = setup({ queueCount: 2 })
    await expect(service.renew(librarian, 'loan-1', {}, ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'queue' })],
    })
  })

  it('срок не позже текущего — 422', async () => {
    const { service } = setup()
    await expect(
      service.renew(librarian, 'loan-1', { dueDate: '2099-01-05' }, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('продлевает и сбрасывает отметки напоминаний', async () => {
    const { service, prisma } = setup()
    prisma.loan.findUnique.mockResolvedValue(loanRow({ dueAt: new Date(Date.now() + 86_400_000) }))
    await service.renew(librarian, 'loan-1', {}, ctx)
    expect(prisma.loan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          renewals: { increment: 1 },
          dueSoonSentAt: null,
          dueTodaySentAt: null,
          overdueSentAt: null,
        }),
      }),
    )
  })
})

describe('Утеря и отмена', () => {
  it('утеря — выдача LOST, экземпляр LOST', async () => {
    const { service, tx } = setup()
    tx.loan.findUniqueOrThrow.mockResolvedValue(loanRow({ status: 'LOST' }))
    await service.markLost(librarian, 'loan-1', ctx)
    expect(tx.loan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'LOST' }) }),
    )
    expect(tx.bookCopy.update).toHaveBeenCalledWith({
      where: { id: 'copy-1' },
      data: { status: 'LOST' },
    })
  })

  it('долг по утерянной погашен — отметка, кто погасил, и аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.loan.findUnique.mockResolvedValue(loanRow({ status: 'LOST' }))
    const settledAt = new Date('2026-10-23T06:00:00Z')
    prisma.loan.findUniqueOrThrow.mockResolvedValue(
      loanRow({ status: 'LOST', lostSettledAt: settledAt }),
    )
    const item = await service.settleLost(librarian, 'loan-1', ctx)
    expect(prisma.loan.updateMany).toHaveBeenCalledWith({
      where: { id: 'loan-1', status: 'LOST', lostSettledAt: null },
      data: { lostSettledAt: expect.any(Date), lostSettledById: 'lib-1' },
    })
    expect(item.lostSettledAt).toBe(settledAt.toISOString())
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'library_loan_lost_settled', entityId: 'loan-1' }),
    )
  })

  it('погасить можно только утерянную — 409 notLost', async () => {
    const { service, prisma } = setup()
    await expect(service.settleLost(librarian, 'loan-1', ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'notLost' })],
    })
    expect(prisma.loan.updateMany).not.toHaveBeenCalled()
  })

  it('погашенный долг второй раз не погасить — 409 settled', async () => {
    const { service, prisma, audit } = setup()
    prisma.loan.findUnique.mockResolvedValue(loanRow({ status: 'LOST' }))
    prisma.loan.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.settleLost(librarian, 'loan-1', ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'settled' })],
    })
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('выдача чужого вуза — 404', async () => {
    const { service, prisma } = setup()
    prisma.loan.findUnique.mockResolvedValue(loanRow({ status: 'LOST', universityId: 'uni-2' }))
    await expect(service.settleLost(librarian, 'loan-1', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('отмена — с причиной в выдаче и аудите, экземпляр освобождается', async () => {
    const { service, tx, audit } = setup()
    tx.loan.findUniqueOrThrow.mockResolvedValue(loanRow({ status: 'CANCELLED' }))
    await service.cancel(librarian, 'loan-1', { reason: 'Выдали не тому читателю' }, ctx)
    expect(tx.loan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Выдали не тому читателю',
        }),
      }),
    )
    expect(tx.bookCopy.update).toHaveBeenCalledWith({
      where: { id: 'copy-1' },
      data: { status: 'AVAILABLE' },
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'library_loan_cancelled',
        metadata: expect.objectContaining({ reason: 'Выдали не тому читателю' }),
      }),
    )
  })

  it('закрытую выдачу не отменить — 409', async () => {
    const { service, prisma } = setup()
    prisma.loan.findUnique.mockResolvedValue(loanRow({ status: 'RETURNED' }))
    await expect(
      service.cancel(librarian, 'loan-1', { reason: 'ошибка' }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('Отмена возврата', () => {
  const reason = 'Приняли не ту книгу'
  // Вернули час назад: окно отмены ещё открыто.
  const returned = (over: Record<string, unknown> = {}) =>
    loanRow({
      status: 'RETURNED',
      returnedAt: new Date(Date.now() - 3_600_000),
      returnedToId: 'lib-1',
      ...over,
    })

  it('выдача снова открыта с прежним сроком, экземпляр — выдан; аудит и уведомление', async () => {
    const { service, prisma, tx, audit, notifier } = setup()
    prisma.loan.findUnique.mockResolvedValue(returned())
    tx.loan.findUniqueOrThrow.mockResolvedValue(loanRow())
    const item = await service.cancelReturn(librarian, 'loan-1', { reason }, ctx)
    // Под локом очереди книги — тем же, что у возврата и броней.
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(tx.bookCopy.updateMany).toHaveBeenCalledWith({
      where: { id: 'copy-1', status: 'AVAILABLE' },
      data: { status: 'ON_LOAN' },
    })
    expect(tx.loan.updateMany).toHaveBeenCalledWith({
      where: { id: 'loan-1', status: 'RETURNED' },
      data: { status: 'OPEN', returnedAt: null, returnedToId: null, returnCondition: null },
    })
    // Срок не трогаем — он остаётся прежним.
    expect(tx.loan.updateMany.mock.calls[0][0].data).not.toHaveProperty('dueAt')
    expect(item.status).toBe('OPEN')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'library_loan_return_cancelled',
        metadata: expect.objectContaining({ reason, returnedToId: 'lib-1' }),
      }),
    )
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['stu-1'],
        titleKey: 'library.loanReturnCancelled.title',
      }),
    )
  })

  it.each([
    ['ON_LOAN', 'reissued'],
    ['RESERVED', 'heldForReservation'],
    ['LOST', 'withdrawn'],
    ['WRITTEN_OFF', 'withdrawn'],
  ])('экземпляр в статусе %s — 409 %s, ничего не меняется', async (status, field) => {
    const { service, prisma, tx, audit } = setup()
    prisma.loan.findUnique.mockResolvedValue(returned())
    tx.bookCopy.findUniqueOrThrow.mockResolvedValue({ status })
    await expect(service.cancelReturn(librarian, 'loan-1', { reason }, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [expect.objectContaining({ field })],
    })
    expect(tx.loan.updateMany).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('экземпляр после возврата выдавали другому — 409 reissued', async () => {
    const { service, prisma, tx } = setup()
    prisma.loan.findUnique.mockResolvedValue(returned())
    tx.loan.count.mockResolvedValue(1)
    await expect(service.cancelReturn(librarian, 'loan-1', { reason }, ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'reissued' })],
    })
    expect(tx.bookCopy.updateMany).not.toHaveBeenCalled()
  })

  it('экземпляр выдали в ту же секунду — 409 reissued, выдача не открывается', async () => {
    const { service, prisma, tx } = setup()
    prisma.loan.findUnique.mockResolvedValue(returned())
    tx.bookCopy.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.cancelReturn(librarian, 'loan-1', { reason }, ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'reissued' })],
    })
    expect(tx.loan.updateMany).not.toHaveBeenCalled()
  })

  it('больше суток после возврата — 409 returnWindow', async () => {
    const { service, prisma } = setup()
    prisma.loan.findUnique.mockResolvedValue(
      returned({ returnedAt: new Date(Date.now() - 25 * 3_600_000) }),
    )
    await expect(service.cancelReturn(librarian, 'loan-1', { reason }, ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'returnWindow' })],
    })
  })

  it('открытую выдачу «отменить возврат» нельзя — 409 notReturned', async () => {
    const { service } = setup()
    await expect(service.cancelReturn(librarian, 'loan-1', { reason }, ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'notReturned' })],
    })
  })

  it('выдача чужого вуза — 404', async () => {
    const { service, prisma } = setup()
    prisma.loan.findUnique.mockResolvedValue(returned({ universityId: 'uni-2' }))
    await expect(service.cancelReturn(librarian, 'loan-1', { reason }, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('отменяет только библиотекарь', async () => {
    const { service } = setup()
    await expect(
      service.cancelReturn(
        { ...librarian, role: Role.UNIVERSITY_ADMIN },
        'loan-1',
        { reason },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('«Бронь готова»', () => {
  const held = {
    reservationId: 'res-1',
    readerId: 'stu-2',
    name: 'Ахметова Айгерим',
    group: null,
    holdUntil: new Date('2026-10-25T18:59:59.999Z'),
  }

  it('очередь приняла — отметка в брони', async () => {
    const { service, prisma } = setup()
    await expect(service.notifyHeld(held, 'Русская литература', 'Asia/Almaty')).resolves.toBe(true)
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1', status: 'READY', readyNotifiedAt: null },
      data: { readyNotifiedAt: expect.any(Date) },
    })
  })

  it('очередь не приняла — отметки нет, догонит cron', async () => {
    const { service, prisma, notifier } = setup()
    notifier.send.mockResolvedValue(false)
    await expect(service.notifyHeld(held, 'Русская литература', 'Asia/Almaty')).resolves.toBe(false)
    expect(prisma.reservation.updateMany).not.toHaveBeenCalled()
  })
})
