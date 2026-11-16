import { Role } from '@studenthub/shared-types'
import { LibraryReportsService } from './library-reports.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Отчёты и инвентаризация (Фаза 20.12).

const librarian: JwtPayload = {
  sub: 'lib-1',
  role: Role.LIBRARIAN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup(copyStatus = 'AVAILABLE', inventoriedAt: Date | null = null) {
  const prisma = {
    bookCopy: {
      findUnique: jest.fn().mockResolvedValue({ inventoriedAt, book: { authors: 'Пушкин' } }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(3).mockResolvedValueOnce(4),
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const loans = {
    findCopy: jest.fn().mockResolvedValue({
      id: 'copy-1',
      status: copyStatus,
      inventoryNumber: '101',
      book: { id: 'book-1', title: 'Евгений Онегин', archivedAt: null },
    }),
    timezoneOf: jest.fn().mockResolvedValue('Asia/Almaty'),
  }
  const service = new LibraryReportsService(prisma as never, {} as never, loans as never)
  return { service, prisma }
}

describe('Инвентаризация', () => {
  it('скан отмечает экземпляр на месте', async () => {
    const { service, prisma } = setup()
    const result = await service.scan(librarian, { copyCode: 'ABCD2345', since: '2026-10-20' })
    expect(prisma.bookCopy.update).toHaveBeenCalledWith({
      where: { id: 'copy-1' },
      data: { inventoriedAt: expect.any(Date) },
    })
    expect(result).toMatchObject({ alreadyChecked: false, warning: null })
  })

  it('выданный экземпляр на полке — предупреждение onLoan', async () => {
    const { service } = setup('ON_LOAN')
    await expect(service.scan(librarian, { inventoryNumber: '101' })).resolves.toMatchObject({
      warning: 'onLoan',
    })
  })

  it('уже отмеченный с начала инвентаризации — alreadyChecked', async () => {
    const { service } = setup('AVAILABLE', new Date('2026-10-21T06:00:00Z'))
    await expect(
      service.scan(librarian, { copyCode: 'ABCD2345', since: '2026-10-20' }),
    ).resolves.toMatchObject({ alreadyChecked: true })
  })

  it('отчёт: отмечено = ожидается − не найдено', async () => {
    const { service } = setup()
    const report = await service.inventory(librarian, { since: '2026-10-20', page: 1, limit: 20 })
    expect(report).toMatchObject({ expected: 10, checked: 7, onLoan: 4, total: 3 })
  })
})

// Фаза 21.C5: выдачи без скана QR — отдельной цифрой в сводке.
describe('Сводка', () => {
  it('выдачи без телефона за 30 дней — отдельно от всех выдач', async () => {
    const loanCount = jest
      .fn()
      .mockImplementation(({ where }: { where: { withoutPhone?: boolean } }) =>
        Promise.resolve(where.withoutPhone ? 2 : 9),
      )
    const prisma = {
      book: { count: jest.fn().mockResolvedValue(5) },
      bookCopy: { groupBy: jest.fn().mockResolvedValue([]) },
      loan: { count: loanCount },
      reservation: { groupBy: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ withLoans: 1, debtors: 0 }]),
    }
    const service = new LibraryReportsService(prisma as never, {} as never, {} as never)
    const summary = await service.summary(librarian)
    expect(loanCount).toHaveBeenCalledWith({
      where: {
        universityId: 'uni-1',
        withoutPhone: true,
        issuedAt: { gte: expect.any(Date) },
        status: { not: 'CANCELLED' },
      },
    })
    expect(summary.loans.withoutPhoneLast30).toBe(2)
    expect(summary.loans.issuedLast30).toBe(9)
  })
})
