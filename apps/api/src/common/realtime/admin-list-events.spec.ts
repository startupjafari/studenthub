import { Role } from '@studenthub/shared-types'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { AdminListEvents } from './admin-list-events'
import type { PrismaService } from '../prisma/prisma.service'
import type { RealtimeGateway } from './realtime.gateway'

// Адресация живых админ-списков (§9.2d): сигнал уходит в личные комнаты тех, кто ведёт
// список, серия изменений одного списка склеивается в одну рассылку.

function setup(staff: string[] = ['s1']) {
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue(staff.map((id) => ({ id }))) },
  }
  const realtime = { emitEventToUsers: jest.fn(), emitEventToRoom: jest.fn() }
  const events = new AdminListEvents(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
  )
  return { events, prisma, realtime }
}

/** Дождаться окна склейки и асинхронной доставки. */
async function flush() {
  jest.advanceTimersByTime(1000)
  // Запрос адресатов и рассылка — несколько микрозадач после срабатывания таймера.
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('AdminListEvents', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('инвайт вуза — админам вуза и выдавшему, сигнал без содержимого', async () => {
    const { events, prisma, realtime } = setup(['ua'])
    events.invite({ id: 'inv-1', universityId: 'uni', createdById: 'dean-1' })
    await flush()

    const where = prisma.user.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([{ universityId: 'uni', role: { in: [Role.UNIVERSITY_ADMIN] } }])
    expect(where).toMatchObject({ deletedAt: null, isBlocked: false })
    expect(prisma.user.findMany.mock.calls[0][0].take).toBeGreaterThan(0)
    expect(realtime.emitEventToUsers).toHaveBeenCalledWith(
      ['ua', 'dean-1'],
      REALTIME_EVENTS.adminListChanged,
      'inv-1',
      { list: 'invites' },
    )
    // Не в комнату вуза: там студенты.
    expect(realtime.emitEventToRoom).not.toHaveBeenCalled()
  })

  it('платформенный инвайт — админам платформы', async () => {
    const { events, prisma } = setup()
    events.invite({ id: 'inv-1', universityId: null, createdById: 'pa' })
    await flush()
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toEqual([
      { role: { in: [Role.PLATFORM_ADMIN] } },
    ])
  })

  it('массовый отзыв при удалении scope — один сигнал админам вуза и всем выдавшим', async () => {
    const { events, prisma, realtime } = setup(['ua'])
    events.invitesRevoked({ scopeId: 'grp-1', universityId: 'uni', issuerIds: ['dean-1', 'st-1'] })
    await flush()
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toEqual([
      { universityId: 'uni', role: { in: [Role.UNIVERSITY_ADMIN] } },
    ])
    expect(realtime.emitEventToUsers).toHaveBeenCalledTimes(1)
    expect(realtime.emitEventToUsers).toHaveBeenCalledWith(
      ['ua', 'dean-1', 'st-1'],
      REALTIME_EVENTS.adminListChanged,
      'grp-1',
      { list: 'invites' },
    )
  })

  it('жалоба вуза — команде платформы и админу с модератором вуза', async () => {
    const { events, prisma, realtime } = setup()
    events.complaint({ id: 'c1', universityId: 'uni' })
    await flush()
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toEqual([
      { role: { in: [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR] } },
      { universityId: 'uni', role: { in: [Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR] } },
    ])
    expect(realtime.emitEventToUsers.mock.calls[0][3]).toEqual({ list: 'complaints' })
  })

  it('заявка вуза — только админам платформы', async () => {
    const { events, prisma, realtime } = setup()
    events.demoRequest('d1')
    await flush()
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toEqual([
      { role: { in: [Role.PLATFORM_ADMIN] } },
    ])
    expect(realtime.emitEventToUsers.mock.calls[0][3]).toEqual({ list: 'demoRequests' })
  })

  it('серия изменений одного списка — одна рассылка, выдавшие из серии не теряются', async () => {
    const { events, prisma, realtime } = setup(['ua'])
    events.invite({ id: 'inv-1', universityId: 'uni', createdById: 'dean-1' })
    events.invite({ id: 'inv-2', universityId: 'uni', createdById: 'dean-2' })
    events.invite({ id: 'inv-3', universityId: 'uni', createdById: 'dean-1' })
    await flush()
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
    expect(realtime.emitEventToUsers).toHaveBeenCalledTimes(1)
    expect(realtime.emitEventToUsers.mock.calls[0][0]).toEqual(['ua', 'dean-1', 'dean-2'])
    expect(realtime.emitEventToUsers.mock.calls[0][2]).toBe('inv-3')
  })

  it('разные вузы не склеиваются', async () => {
    const { events, realtime } = setup()
    events.user({ id: 'u1', universityId: 'uni-a' })
    events.user({ id: 'u2', universityId: 'uni-b' })
    await flush()
    expect(realtime.emitEventToUsers).toHaveBeenCalledTimes(2)
  })

  it('сбой запроса адресатов не роняет процесс', async () => {
    const { events, prisma, realtime } = setup()
    prisma.user.findMany.mockRejectedValueOnce(new Error('db down'))
    events.supportTicket('t1')
    await flush()
    expect(realtime.emitEventToUsers).not.toHaveBeenCalled()
  })
})
