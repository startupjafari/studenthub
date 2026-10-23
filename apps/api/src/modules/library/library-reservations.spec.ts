import { Role } from '@studenthub/shared-types'
import { LibraryReservationsService } from './library-reservations.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Брони библиотеки (Фаза 20.8).

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

const rules = {
  enabled: true,
  defaultLoanDays: 14,
  maxLoanDays: 120,
  maxActiveLoans: 5,
  maxActiveReservations: 3,
  reservationHoldDays: 3,
  maxRenewals: 1,
}

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    universityId: 'uni-1',
    bookId: 'book-1',
    readerId: 'stu-1',
    status: 'QUEUED',
    createdAt: new Date('2026-10-22T05:00:00Z'),
    readyAt: null,
    holdUntil: null,
    closedAt: null,
    copyId: null,
    book: { id: 'book-1', title: 'Русская литература', authors: '', coverFileId: null },
    copy: null,
    reader: { id: 'stu-1', firstName: 'Нурлан', lastName: 'Оспанов', group: { name: 'ИТ-23-1' } },
    ...overrides,
  }
}

function setup({
  blockers = [] as string[],
  counts = { active: 0, sameBook: 0, borrowed: 0, inCirculation: 2 },
  availableCopy = null as null | { id: string },
  queueHead = null as null | Record<string, unknown>,
} = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    reservation: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'res-1' }),
      findFirst: jest.fn().mockResolvedValueOnce(queueHead).mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ copyId: 'copy-9' }),
    },
    bookCopy: {
      findFirst: jest.fn().mockResolvedValue(availableCopy),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  let reservationCount = 0
  const order = [counts.active, counts.sameBook]
  const prisma = {
    book: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'book-1',
        universityId: 'uni-1',
        title: 'Русская литература',
        archivedAt: null,
      }),
    },
    reservation: {
      count: jest.fn().mockImplementation(() => Promise.resolve(order[reservationCount++] ?? 0)),
      findUnique: jest.fn().mockResolvedValue({
        readerId: 'stu-1',
        universityId: 'uni-1',
        bookId: 'book-1',
        copyId: 'copy-9',
        book: { title: 'Русская литература' },
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(reservationRow()),
      findMany: jest.fn().mockResolvedValue([]),
    },
    loan: { count: jest.fn().mockResolvedValue(counts.borrowed) },
    bookCopy: { count: jest.fn().mockResolvedValue(counts.inCirculation) },
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const notifier = { send: jest.fn().mockResolvedValue(undefined) }
  const loans = {
    readerOf: jest.fn().mockResolvedValue({ id: 'stu-1', academicStatus: 'Обучается' }),
    eligibility: jest.fn().mockResolvedValue({ blockers }),
    blockerConflict: jest
      .fn()
      .mockImplementation((b: string) =>
        Object.assign(new Error(b), { code: 'CONFLICT', details: [{ field: b }] }),
      ),
    timezoneOf: jest.fn().mockResolvedValue('Asia/Almaty'),
    notifyHeld: jest.fn().mockResolvedValue(undefined),
  }
  const settings = {
    requireEnabled: jest.fn().mockResolvedValue(rules),
    get: jest.fn().mockResolvedValue(rules),
  }
  const service = new LibraryReservationsService(
    prisma as never,
    audit as never,
    { getPresignedUrls: jest.fn().mockResolvedValue(new Map()) } as never,
    settings as never,
    loans as never,
    notifier as never,
  )
  return { service, prisma, tx, loans, notifier }
}

describe('Бронь', () => {
  it('должнику бронь закрыта — 409 overdue', async () => {
    const { service } = setup({ blockers: ['overdue'] })
    await expect(service.reserve(student, 'book-1', ctx)).rejects.toMatchObject({
      details: [{ field: 'overdue' }],
    })
  })

  it('утерянная книга с непогашенным долгом закрывает бронь — 409 lost', async () => {
    const { service } = setup({ blockers: ['lost'] })
    await expect(service.reserve(student, 'book-1', ctx)).rejects.toMatchObject({
      details: [{ field: 'lost' }],
    })
  })

  it('предел броней — 409 reservationLimit', async () => {
    const { service } = setup({
      counts: { active: 3, sameBook: 0, borrowed: 0, inCirculation: 2 },
    })
    await expect(service.reserve(student, 'book-1', ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'reservationLimit' })],
    })
  })

  it('книга без экземпляров в обороте — 409 noCopies', async () => {
    const { service } = setup({
      counts: { active: 0, sameBook: 0, borrowed: 0, inCirculation: 0 },
    })
    await expect(service.reserve(student, 'book-1', ctx)).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'noCopies' })],
    })
  })

  it('есть свободный экземпляр — бронь сразу готова, экземпляр отложен', async () => {
    const { service, tx } = setup({
      availableCopy: { id: 'copy-1' },
      queueHead: {
        id: 'res-1',
        readerId: 'stu-1',
        reader: { firstName: 'Нурлан', lastName: 'Оспанов', group: null },
      },
    })
    await service.reserve(student, 'book-1', ctx)
    expect(tx.$executeRaw).toHaveBeenCalled()
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
  })

  it('свободных нет — бронь остаётся в очереди', async () => {
    const { service, tx } = setup({
      queueHead: {
        id: 'res-0',
        readerId: 'stu-0',
        reader: { firstName: 'А', lastName: 'Б', group: null },
      },
    })
    await service.reserve(student, 'book-1', ctx)
    expect(tx.reservation.create).toHaveBeenCalled()
    expect(tx.reservation.update).not.toHaveBeenCalled()
  })
})

describe('Отмена и истечение', () => {
  it('отмена готовой брони — экземпляр уходит следующему в очереди', async () => {
    const { service, tx, loans } = setup({
      queueHead: {
        id: 'res-2',
        readerId: 'stu-2',
        reader: { firstName: 'Айгерим', lastName: 'Ахметова', group: null },
      },
    })
    await service.cancelMine(student, 'res-1', ctx)
    expect(tx.reservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    )
    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-2' },
        data: expect.objectContaining({ status: 'READY', copyId: 'copy-9' }),
      }),
    )
    expect(loans.notifyHeld).toHaveBeenCalledWith(
      expect.objectContaining({ readerId: 'stu-2' }),
      'Русская литература',
      'Asia/Almaty',
    )
  })

  it('чужую бронь не отменить — 404', async () => {
    const { service } = setup()
    await expect(
      service.cancelMine({ ...student, sub: 'stu-9' }, 'res-1', ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('истёкшая готовая бронь → EXPIRED, читателю уведомление, экземпляр — на полку', async () => {
    const { service, prisma, tx, notifier } = setup()
    prisma.reservation.findMany.mockResolvedValueOnce([{ id: 'res-1' }])
    const expired = await service.expireDue(new Date('2026-10-30T00:00:00Z'))
    expect(expired).toBe(1)
    expect(tx.reservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-1', status: 'READY' },
        data: expect.objectContaining({ status: 'EXPIRED' }),
      }),
    )
    expect(tx.bookCopy.update).toHaveBeenCalledWith({
      where: { id: 'copy-9' },
      data: { status: 'AVAILABLE' },
    })
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({ titleKey: 'library.reservationExpired.title' }),
    )
  })
})
