import { LibraryRemindersService } from './library-reminders.service'

// Напоминания о сроке выдачи (Фаза 20.7): пояс вуза, дневные часы, отметки в выдаче.

// 22.10.2026 12:00 по Алматы (UTC+5).
const NOON = new Date('2026-10-22T07:00:00Z')

function setup(loansByKind: Partial<Record<string, unknown[]>> = {}) {
  const prisma = {
    librarySettings: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ universityId: 'uni-1', university: { timezone: 'Asia/Almaty' } }]),
    },
    loan: {
      findMany: jest.fn().mockImplementation(({ where }) => {
        const w = JSON.stringify(where)
        const kind = w.includes('dueSoonSentAt')
          ? 'dueSoon'
          : w.includes('dueTodaySentAt')
            ? 'dueToday'
            : 'overdue'
        // Вторая страница курсора — пусто.
        return Promise.resolve(w.includes('"gt":"loan') ? [] : (loansByKind[kind] ?? []))
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }
  const notifier = { send: jest.fn().mockResolvedValue(true) }
  return {
    service: new LibraryRemindersService(prisma as never, notifier as never),
    prisma,
    notifier,
  }
}

const loan = (id: string, dueAt: string) => ({
  id,
  readerId: 'stu-1',
  bookTitle: 'Русская литература',
  dueAt: new Date(dueAt),
})

describe('Напоминания библиотеки', () => {
  it('ночью по часам вуза не шлёт ничего', async () => {
    const { service, prisma } = setup({ overdue: [loan('loan-1', '2026-10-10T18:59:59.999Z')] })
    // 03:00 по Алматы.
    const counts = await service.remindDue(new Date('2026-10-21T22:00:00Z'))
    expect(counts).toEqual({ dueSoon: 0, dueToday: 0, overdue: 0 })
    expect(prisma.loan.findMany).not.toHaveBeenCalled()
  })

  it('«скоро» — окно до конца послезавтра по поясу вуза, отметка ставится', async () => {
    const { service, prisma, notifier } = setup({
      dueSoon: [loan('loan-1', '2026-10-24T18:59:59.999Z')],
    })
    const counts = await service.remindDue(NOON)
    expect(counts.dueSoon).toBe(1)
    const soonQuery = prisma.loan.findMany.mock.calls[0][0]
    expect(soonQuery.where.dueAt.lte.toISOString()).toBe('2026-10-24T18:59:59.999Z')
    expect(soonQuery.where.dueAt.gt.toISOString()).toBe('2026-10-22T18:59:59.999Z')
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['stu-1'],
        titleKey: 'library.dueSoon.title',
        params: { title: 'Русская литература', date: '24.10.2026' },
        dedupeKey: 'library-dueSoon:loan-1',
      }),
    )
    expect(prisma.loan.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['loan-1'] } },
      data: { dueSoonSentAt: expect.any(Date) },
    })
  })

  it('просрочка повторяется раз в неделю — ключ дедупа с днём', async () => {
    const { service, notifier } = setup({ overdue: [loan('loan-2', '2026-10-10T18:59:59.999Z')] })
    await service.remindDue(NOON)
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        titleKey: 'library.overdue.title',
        params: { title: 'Русская литература', date: '10.10.2026' },
        dedupeKey: expect.stringMatching(/^library-overdue:loan-2:\d{4}-\d{2}-\d{2}$/),
      }),
    )
  })

  it('очередь не приняла уведомление — отметка не ставится, прогон останавливается', async () => {
    const { service, prisma, notifier } = setup({
      dueSoon: [loan('loan-1', '2026-10-24T18:59:59.999Z')],
      overdue: [loan('loan-2', '2026-10-10T18:59:59.999Z')],
    })
    notifier.send.mockResolvedValue(false)
    const counts = await service.remindDue(NOON)
    expect(counts).toEqual({ dueSoon: 0, dueToday: 0, overdue: 0 })
    expect(prisma.loan.updateMany).not.toHaveBeenCalled()
    // Redis лежит — дальше по выборке не идём, каждая попытка ждала бы таймаут.
    expect(notifier.send).toHaveBeenCalledTimes(1)
  })

  it('отмечаются только поставленные: сорвавшиеся догонит следующий тик', async () => {
    const { service, prisma, notifier } = setup({
      dueSoon: [
        loan('loan-1', '2026-10-24T18:59:59.999Z'),
        loan('loan-3', '2026-10-24T18:59:59.999Z'),
      ],
    })
    notifier.send.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const counts = await service.remindDue(NOON)
    expect(counts.dueSoon).toBe(1)
    expect(prisma.loan.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.loan.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['loan-1'] } },
      data: { dueSoonSentAt: expect.any(Date) },
    })
  })
})
