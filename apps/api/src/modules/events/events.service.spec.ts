import { Role } from '@studenthub/shared-types'
import { EventsService } from './events.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    event: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'e-new' }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    eventParticipant: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    eventComment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'c-new' }),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    university: { findUnique: jest.fn().mockResolvedValue(null) },
    faculty: { findUnique: jest.fn() },
    group: { findUnique: jest.fn() },
    $transaction: jest.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  // true — job поставлен: по нему remindDue решает, ставить ли отметку reminderSentAt.
  const queue = { enqueue: jest.fn().mockResolvedValue(true) }
  const service = new EventsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
  )
  return { service, prisma, queue, audit }
}

const user = (role: Role, scope: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: scope.sub ?? 'u1',
  role,
  universityId: scope.universityId ?? null,
  facultyId: scope.facultyId ?? null,
  groupId: scope.groupId ?? null,
})

describe('EventsService.create — аудитория по роли (10.2)', () => {
  it('студент → GROUP своей группы: ок', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uni1' },
    })
    const res = await service.create(
      user(Role.STUDENT, { groupId: 'g1', facultyId: 'f1', universityId: 'uni1' }),
      { audience: 'GROUP', title: 'T', description: 'D', startsAt: '2026-09-01T10:00:00.000Z' },
      ctx,
    )
    expect(res.id).toBe('e-new')
  })

  it('студент → UNIVERSITY: FORBIDDEN', async () => {
    const { service } = setup()
    const err = await service
      .create(
        user(Role.STUDENT, { universityId: 'uni1', groupId: 'g1' }),
        {
          audience: 'UNIVERSITY',
          title: 'T',
          description: 'D',
          startsAt: '2026-09-01T10:00:00.000Z',
        },
        ctx,
      )
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('модератор вуза создавать не может', async () => {
    const { service } = setup()
    const err = await service
      .create(
        user(Role.UNIVERSITY_MODERATOR, { universityId: 'uni1' }),
        {
          audience: 'UNIVERSITY',
          title: 'T',
          description: 'D',
          startsAt: '2026-09-01T10:00:00.000Z',
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('студент → GROUP чужой группы: WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uni1' },
    })
    const err = await service
      .create(
        user(Role.STUDENT, { groupId: 'g1', facultyId: 'f1', universityId: 'uni1' }),
        {
          audience: 'GROUP',
          title: 'T',
          description: 'D',
          startsAt: '2026-09-01T10:00:00.000Z',
          groupId: 'gX',
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })
})

describe('EventsService — управление и регистрация', () => {
  it('изменять чужое событие нельзя (не организатор, не админ)', async () => {
    const { service, prisma } = setup()
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1',
      organizerId: 'other',
      universityId: 'uni1',
      facultyId: 'f1',
      groupId: null,
    })
    const err = await service
      .update(user(Role.STUDENT, { sub: 'u1' }), 'e1', { title: 'x' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('организатор может изменить своё событие', async () => {
    const { service, prisma } = setup()
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1',
      organizerId: 'u1',
      startsAt: new Date(),
      endsAt: null,
    })
    prisma.event.update.mockResolvedValue({ id: 'e1' })
    const res = await service.update(user(Role.STUDENT, { sub: 'u1' }), 'e1', { title: 'x' }, ctx)
    expect(res.id).toBe('e1')
  })

  it('перенос начала сбрасывает отметку о напоминании, правка текста — нет', async () => {
    const { service, prisma } = setup()
    const startsAt = new Date('2026-11-01T10:00:00.000Z')
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1',
      organizerId: 'u1',
      startsAt,
      endsAt: null,
    })
    prisma.event.update.mockResolvedValue({ id: 'e1' })
    const organizer = user(Role.STUDENT, { sub: 'u1' })

    await service.update(organizer, 'e1', { title: 'x' }, ctx)
    expect(prisma.event.update.mock.calls[0][0].data).not.toHaveProperty('reminderSentAt')

    await service.update(organizer, 'e1', { startsAt: '2026-11-02T10:00:00.000Z' } as never, ctx)
    expect(prisma.event.update.mock.calls[1][0].data.reminderSentAt).toBeNull()
  })

  it('регистрация идемпотентна (P2002 не ошибка)', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue({
      id: 'e1',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: null,
      participants: [],
      organizer: {},
      _count: { participants: 0 },
    })
    const p2002 = Object.assign(new Error('dup'), { code: 'P2002' })
    Object.setPrototypeOf(
      p2002,
      (await import('@prisma/client')).Prisma.PrismaClientKnownRequestError.prototype,
    )
    prisma.eventParticipant.create.mockRejectedValue(p2002)
    const res = await service.register(user(Role.STUDENT, { sub: 'u1', groupId: 'g1' }), 'e1')
    expect(res.registered).toBe(true)
  })
})

describe('EventsService.remindDue — окно и дедуп (10.4)', () => {
  it('шлёт job участникам и помечает reminderSentAt', async () => {
    const { service, prisma, queue } = setup()
    prisma.event.findMany
      .mockResolvedValueOnce([
        { id: 'e1', title: 'Событие', startsAt: new Date(1_000_000), updatedAt: new Date(7) },
      ])
      .mockResolvedValueOnce([])
    prisma.eventParticipant.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }])
    const n = await service.remindDue()
    expect(n).toBe(1)
    const job = queue.enqueue.mock.calls[0][2]
    expect(job.type).toBe('EVENT')
    // Время начала и момент правки в ключе: перенесённое событие напомнит о себе заново.
    expect(job.dedupeKey).toBe('event-reminder:e1:1000000:7')
    // Напоминание ведёт в карточку этого события, а не в общий список.
    expect(job.data.url).toBe('/events/e1')
    expect(new Set(job.recipientIds)).toEqual(new Set(['u2', 'u3']))
    expect(prisma.event.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reminderSentAt: expect.any(Date) }),
      }),
    )
  })

  // Отметка без job'а теряла напоминание навсегда: следующий тик событие уже не выбирал.
  it('очередь недоступна — reminderSentAt не ставится, прогон останавливается', async () => {
    const { service, prisma, queue } = setup()
    prisma.event.findMany.mockResolvedValueOnce([
      { id: 'e1', title: 'Первое', startsAt: new Date(1_000_000), updatedAt: new Date(0) },
      { id: 'e2', title: 'Второе', startsAt: new Date(2_000_000), updatedAt: new Date(0) },
    ])
    prisma.eventParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'u2' }])
    queue.enqueue.mockResolvedValue(false)
    await expect(service.remindDue()).resolves.toBe(0)
    expect(queue.enqueue).toHaveBeenCalledTimes(1)
    expect(prisma.event.updateMany).not.toHaveBeenCalled()
  })

  it('окно запроса — (now, now+70м], reminderSentAt null, с потолком', async () => {
    const { service, prisma } = setup()
    const now = new Date('2026-10-17T12:00:00.000Z')
    jest.useFakeTimers().setSystemTime(now)
    await service.remindDue()
    jest.useRealTimers()
    const args = prisma.event.findMany.mock.calls[0][0]
    expect(args.where).toEqual({
      reminderSentAt: null,
      startsAt: { gt: now, lte: new Date('2026-10-17T13:10:00.000Z') },
    })
    expect(args.take).toBe(500)
  })
})

// ── E-F22: окно, а не щель шириной в тик — сценарии на мини-БД ───────────────
describe('EventsService.remindDue — пропущенный тик, поздние и перенесённые события', () => {
  const T0 = new Date('2026-10-17T12:00:00.000Z').getTime()
  const min = (n: number) => new Date(T0 + n * 60_000)

  interface StoredEvent {
    id: string
    title: string
    startsAt: Date
    updatedAt: Date
    reminderSentAt: Date | null
  }

  interface FindArgs {
    where: { reminderSentAt: null; startsAt: { gt: Date; lte: Date }; id?: { gt: string } }
    take: number
  }

  interface MarkArgs {
    where: { reminderSentAt: null; OR: Array<{ id: string; startsAt: Date }> }
    data: { reminderSentAt: Date }
  }

  /**
   * Мини-БД: findMany/updateMany понимают ровно те условия, что строит remindDue, — тики
   * можно гонять подряд и смотреть, что уходит в очередь. Участники — по одному на событие.
   */
  function store(rows: Array<Omit<StoredEvent, 'reminderSentAt' | 'title' | 'updatedAt'>>) {
    const base = setup()
    const db: StoredEvent[] = rows.map((r) => ({
      ...r,
      title: r.id,
      updatedAt: new Date(0),
      reminderSentAt: null,
    }))
    base.prisma.event.findMany.mockImplementation(async ({ where, take }: FindArgs) =>
      db
        .filter(
          (e) =>
            e.reminderSentAt === where.reminderSentAt &&
            e.startsAt > where.startsAt.gt &&
            e.startsAt <= where.startsAt.lte &&
            (!where.id || e.id > where.id.gt),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, take)
        .map(({ id, title, startsAt, updatedAt }) => ({ id, title, startsAt, updatedAt })),
    )
    base.prisma.event.updateMany.mockImplementation(async ({ where, data }: MarkArgs) => {
      let count = 0
      for (const e of db) {
        const hit = where.OR.some(
          (c) => c.id === e.id && c.startsAt.getTime() === e.startsAt.getTime(),
        )
        if (hit && e.reminderSentAt === where.reminderSentAt) {
          e.reminderSentAt = data.reminderSentAt
          count += 1
        }
      }
      return { count }
    })
    base.prisma.eventParticipant.findMany.mockImplementation(
      async ({ where }: { where: { eventId: string } }) =>
        db.some((e) => e.id === where.eventId)
          ? [{ id: `p-${where.eventId}`, userId: `u-${where.eventId}` }]
          : [],
    )
    // Тик крона в момент T0 + n минут.
    const tick = async (n: number) => {
      jest.useFakeTimers().setSystemTime(min(n))
      try {
        return await base.service.remindDue()
      } finally {
        jest.useRealTimers()
      }
    }
    const keys = () => base.queue.enqueue.mock.calls.map((c) => c[2].dedupeKey as string)
    // Строка мини-БД по id: перенос в тестах правит её на месте, как update в настоящей БД.
    const row = (id: string): StoredEvent => {
      const found = db.find((e) => e.id === id)
      if (!found) throw new Error(`нет события ${id}`)
      return found
    }
    return { ...base, db, row, tick, keys }
  }

  it('пропущенный тик: событие напоминает о себе на следующем, пока не началось', async () => {
    // Тик в T0 (событие за 65 минут) пропущен — деплой. Раньше в T0+15 (за 50 минут) оно
    // было вне [55, 70] и не напоминало никогда.
    const s = store([{ id: 'e1', startsAt: min(65) }])
    expect(await s.tick(15)).toBe(1)
    expect(s.keys()).toEqual([`event-reminder:e1:${min(65).getTime()}:0`])
    expect(s.row('e1').reminderSentAt).toEqual(min(15))
  })

  it('событие, созданное за 40 минут до начала, получает напоминание на ближайшем тике', async () => {
    const s = store([])
    expect(await s.tick(0)).toBe(0)
    s.db.push({
      id: 'late',
      title: 'late',
      startsAt: min(45),
      updatedAt: new Date(0),
      reminderSentAt: null,
    })
    expect(await s.tick(15)).toBe(1)
    expect(s.keys()).toEqual([`event-reminder:late:${min(45).getTime()}:0`])
  })

  it('уже начавшемуся событию не напоминает', async () => {
    const s = store([{ id: 'e1', startsAt: min(10) }])
    expect(await s.tick(15)).toBe(0)
    expect(s.queue.enqueue).not.toHaveBeenCalled()
  })

  it('два тика подряд (и два инстанса по очереди) — одно напоминание', async () => {
    const s = store([{ id: 'e1', startsAt: min(65) }])
    await s.tick(0)
    await s.tick(15)
    await s.tick(30)
    expect(s.keys()).toEqual([`event-reminder:e1:${min(65).getTime()}:0`])
  })

  it('перенесённое после напоминания событие напоминает о новом времени заново', async () => {
    const s = store([{ id: 'e1', startsAt: min(65) }])
    await s.tick(0)
    // Организатор перенёс на полчаса позже: update сбрасывает reminderSentAt.
    s.row('e1').startsAt = min(95)
    s.row('e1').reminderSentAt = null
    await s.tick(15)
    await s.tick(30)
    expect(s.keys()).toEqual([
      `event-reminder:e1:${min(65).getTime()}:0`,
      `event-reminder:e1:${min(95).getTime()}:0`,
    ])
  })

  // Ключ только по времени начала совпадал с уже доставленным — напоминание отбрасывалось.
  it('перенос туда и обратно на уже напомненное время напоминает заново', async () => {
    const s = store([{ id: 'e1', startsAt: min(65) }])
    await s.tick(0)
    // Перенесли на позже и вернули обратно: update сбрасывает отметку и двигает updatedAt.
    s.row('e1').startsAt = min(65)
    s.row('e1').updatedAt = min(5)
    s.row('e1').reminderSentAt = null
    await s.tick(15)
    expect(s.keys()).toEqual([
      `event-reminder:e1:${min(65).getTime()}:0`,
      `event-reminder:e1:${min(65).getTime()}:${min(5).getTime()}`,
    ])
  })

  it('перенос посреди прогона: отметка о старом времени не глушит напоминание о новом', async () => {
    const s = store([{ id: 'e1', startsAt: min(65) }])
    // Перенос ложится между чтением участников и отметкой.
    s.prisma.eventParticipant.findMany.mockImplementationOnce(async () => {
      s.row('e1').startsAt = min(50)
      s.row('e1').reminderSentAt = null
      return [{ id: 'p-e1', userId: 'u-e1' }]
    })
    await s.tick(0)
    expect(s.row('e1').reminderSentAt).toBeNull()
    await s.tick(15)
    expect(s.keys()).toEqual([
      `event-reminder:e1:${min(65).getTime()}:0`,
      `event-reminder:e1:${min(50).getTime()}:0`,
    ])
  })

  it('отменённое (удалённое) событие не напоминает', async () => {
    const s = store([
      { id: 'e1', startsAt: min(65) },
      { id: 'e2', startsAt: min(60) },
    ])
    // remove удаляет событие вместе с регистрациями.
    s.db.splice(0, 1)
    await s.tick(0)
    expect(s.keys()).toEqual([`event-reminder:e2:${min(60).getTime()}:0`])
  })

  it('больше пачки событий: всё разослано, каждое — один раз', async () => {
    const s = store(
      Array.from({ length: 501 }, (_, i) => ({
        id: `e${String(i).padStart(3, '0')}`,
        startsAt: min(60),
      })),
    )
    expect(await s.tick(0)).toBe(501)
    expect(new Set(s.keys()).size).toBe(501)
    expect(s.prisma.event.findMany.mock.calls[1][0].where.id).toEqual({ gt: 'e499' })
  })
})

// ── Онлайн-встреча (Ф14.5) ───────────────────────────────────────────────────
describe('EventsService — ссылка на встречу', () => {
  const starts = new Date('2026-09-01T10:00:00.000Z')
  const meetingRow = (over: Record<string, unknown> = {}) => ({
    organizerId: 'org-1',
    startsAt: starts,
    endsAt: new Date('2026-09-01T11:00:00.000Z'),
    meetingProvider: 'ZOOM',
    meetingUrl: 'https://u.zoom.us/j/123',
    meetingPasscode: '4821',
    participants: [],
    ...over,
  })

  it('ссылки нет у того, кто не зарегистрировался', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue(meetingRow())
    const err = await service.meeting(user(Role.STUDENT, { sub: 'u1' }), 'e1').catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('участник получает ссылку, код доступа и окно подключения', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue(meetingRow({ participants: [{ id: 'p1' }] }))
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:50:00.000Z'))

    const meeting = await service.meeting(user(Role.STUDENT, { sub: 'u1' }), 'e1')

    expect(meeting.url).toBe('https://u.zoom.us/j/123')
    expect(meeting.passcode).toBe('4821')
    // Окно открывается за 15 минут до начала и держится полчаса после конца.
    expect(meeting.joinableFrom).toBe('2026-09-01T09:45:00.000Z')
    expect(meeting.joinableUntil).toBe('2026-09-01T11:30:00.000Z')
    expect(meeting.joinable).toBe(true)
    jest.useRealTimers()
  })

  it('до открытия окна ссылка есть, но подключаться рано', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue(meetingRow({ participants: [{ id: 'p1' }] }))
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T08:00:00.000Z'))

    const meeting = await service.meeting(user(Role.STUDENT, { sub: 'u1' }), 'e1')

    expect(meeting.joinable).toBe(false)
    jest.useRealTimers()
  })

  it('организатору регистрация не нужна', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue(meetingRow({ organizerId: 'u1' }))
    const meeting = await service.meeting(user(Role.TEACHER, { sub: 'u1' }), 'e1')
    expect(meeting.provider).toBe('ZOOM')
  })

  it('у события без встречи — NOT_FOUND, а не пустая ссылка', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue(
      meetingRow({ meetingUrl: null, meetingProvider: null, participants: [{ id: 'p1' }] }),
    )
    const err = await service.meeting(user(Role.STUDENT, { sub: 'u1' }), 'e1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('событие без конца закрывает окно через два часа после начала', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue(
      meetingRow({ endsAt: null, participants: [{ id: 'p1' }] }),
    )
    const meeting = await service.meeting(user(Role.STUDENT, { sub: 'u1' }), 'e1')
    expect(meeting.joinableUntil).toBe('2026-09-01T12:30:00.000Z')
  })
})

describe('EventsService.create — встреча (Ф14.5)', () => {
  it('ссылка делает событие онлайновым, провайдер считается по хосту', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uni1' },
    })
    await service.create(
      user(Role.STUDENT, { groupId: 'g1', facultyId: 'f1', universityId: 'uni1' }),
      {
        audience: 'GROUP',
        title: 'T',
        description: 'D',
        startsAt: '2026-09-01T10:00:00.000Z',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
      },
      ctx,
    )
    const data = prisma.event.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      isOnline: true,
      meetingProvider: 'GOOGLE_MEET',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      meetingPasscode: null,
    })
  })

  it('null в правке стирает и ссылку, и провайдер, и код', async () => {
    const { service, prisma } = setup()
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1',
      organizerId: 'u1',
      startsAt: new Date('2026-09-01T10:00:00.000Z'),
      endsAt: null,
      universityId: 'uni1',
      facultyId: 'f1',
    })
    prisma.event.update.mockResolvedValue({ id: 'e1' })
    await service.update(user(Role.TEACHER, { sub: 'u1' }), 'e1', { meetingUrl: null }, ctx)
    expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({
      meetingUrl: null,
      meetingProvider: null,
      meetingPasscode: null,
    })
  })
})

describe('EventsService — комментарии (§3.5)', () => {
  const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

  it('чужое (невидимое) событие — NOT_FOUND и для чтения, и для записи', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue(null)
    const viewer = user(Role.STUDENT, { groupId: 'g1' })
    await expect(service.listComments(viewer, 'e1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(service.addComment(viewer, 'e1', { content: 'Вопрос' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(prisma.eventComment.create).not.toHaveBeenCalled()
  })

  it('отдаёт последние комментарии по порядку написания', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue({ organizerId: 'org', universityId: null })
    const author = { id: 'a', role: Role.STUDENT, universityId: null, facultyId: null }
    prisma.eventComment.findMany.mockResolvedValue([
      { id: 'c3', author },
      { id: 'c2', author },
    ])
    const rows = (await service.listComments(
      user(Role.STUDENT, { groupId: 'g1' }),
      'e1',
    )) as Array<{ id: string }>
    expect(rows.map((r) => r.id)).toEqual(['c2', 'c3'])
    expect(prisma.eventComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: 'e1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    )
  })

  it('автор удаляет свой комментарий мягко и без записи в аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.eventComment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'u1',
      author: { role: Role.STUDENT, universityId: 'uni-1', facultyId: null },
    })
    await service.removeComment(user(Role.STUDENT, { sub: 'u1' }), 'e1', 'c1', ctx)
    expect(prisma.eventComment.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { deletedAt: expect.any(Date) },
    })
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('организатор удаляет чужой комментарий — с записью в аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.eventComment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'someone',
      author: { role: Role.STUDENT, universityId: 'uni-1', facultyId: null },
    })
    prisma.event.findUnique.mockResolvedValue({ organizerId: 'org-1', universityId: 'uni-1' })
    await service.removeComment(user(Role.TEACHER, { sub: 'org-1' }), 'e1', 'c1', ctx)
    expect(prisma.eventComment.update).toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event_comment_deleted' }),
    )
  })

  it('модератор вуза удаляет комментарий под событием своего вуза', async () => {
    const { service, prisma } = setup()
    prisma.eventComment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'someone',
      author: { role: Role.STUDENT, universityId: 'uni-1', facultyId: null },
    })
    prisma.event.findUnique.mockResolvedValue({ organizerId: 'org-1', universityId: 'uni-1' })
    await service.removeComment(
      user(Role.UNIVERSITY_MODERATOR, { sub: 'mod-1', universityId: 'uni-1' }),
      'e1',
      'c1',
      ctx,
    )
    expect(prisma.eventComment.update).toHaveBeenCalled()
  })

  it('посторонний чужой комментарий не удалит', async () => {
    const { service, prisma } = setup()
    prisma.eventComment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'someone',
      author: { role: Role.STUDENT, universityId: 'uni-1', facultyId: null },
    })
    prisma.event.findUnique.mockResolvedValue({ organizerId: 'org-1', universityId: 'uni-1' })
    await expect(
      service.removeComment(user(Role.STUDENT, { sub: 'u9' }), 'e1', 'c1', ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prisma.eventComment.update).not.toHaveBeenCalled()
  })

  // E-F08: модерация комментариев — по правилам постов: роль строго выше автора, scope —
  // событие или сам автор. Организатор ведёт обсуждение своего события без проверки ранга.
  it('модератор вуза не снимает комментарий админа вуза (ранг)', async () => {
    const { service, prisma, audit } = setup()
    prisma.eventComment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'adm',
      author: { role: Role.UNIVERSITY_ADMIN, universityId: 'uni-1', facultyId: null },
    })
    prisma.event.findUnique.mockResolvedValue({ organizerId: 'org-1', universityId: 'uni-1' })
    await expect(
      service.removeComment(
        user(Role.UNIVERSITY_MODERATOR, { sub: 'mod-1', universityId: 'uni-1' }),
        'e1',
        'c1',
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prisma.eventComment.update).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('модератор вуза снимает комментарий своего студента под событием платформы', async () => {
    const { service, prisma, audit } = setup()
    prisma.eventComment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'stud',
      author: { role: Role.STUDENT, universityId: 'uni-1', facultyId: 'f1' },
    })
    prisma.event.findUnique.mockResolvedValue({
      organizerId: 'root',
      universityId: null,
      facultyId: null,
    })
    await service.removeComment(
      user(Role.UNIVERSITY_MODERATOR, { sub: 'mod-1', universityId: 'uni-1' }),
      'e1',
      'c1',
      ctx,
    )
    expect(prisma.eventComment.update).toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event_comment_deleted' }),
    )
  })

  it('модератор чужого вуза → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.eventComment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'stud',
      author: { role: Role.STUDENT, universityId: 'uni-1', facultyId: 'f1' },
    })
    prisma.event.findUnique.mockResolvedValue({
      organizerId: 'org-1',
      universityId: 'uni-1',
      facultyId: 'f1',
    })
    await expect(
      service.removeComment(
        user(Role.UNIVERSITY_ADMIN, { sub: 'adm-2', universityId: 'uni-2' }),
        'e1',
        'c1',
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('декан снимает комментарий под событием своего факультета, чужого — нет', async () => {
    const { service, prisma } = setup()
    prisma.eventComment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'stud',
      author: { role: Role.STUDENT, universityId: 'uni-1', facultyId: 'f9' },
    })
    prisma.event.findUnique.mockResolvedValue({
      organizerId: 'org-1',
      universityId: 'uni-1',
      facultyId: 'f1',
    })
    await service.removeComment(
      user(Role.DEAN, { sub: 'dean-1', universityId: 'uni-1', facultyId: 'f1' }),
      'e1',
      'c1',
      ctx,
    )
    expect(prisma.eventComment.update).toHaveBeenCalledTimes(1)
    await expect(
      service.removeComment(
        user(Role.DEAN, { sub: 'dean-2', universityId: 'uni-1', facultyId: 'f2' }),
        'e1',
        'c1',
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('организатор-преподаватель снимает комментарий декана под своим событием', async () => {
    const { service, prisma } = setup()
    prisma.eventComment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'dean-1',
      author: { role: Role.DEAN, universityId: 'uni-1', facultyId: 'f1' },
    })
    prisma.event.findUnique.mockResolvedValue({ organizerId: 'org-1', universityId: 'uni-1' })
    await service.removeComment(user(Role.TEACHER, { sub: 'org-1' }), 'e1', 'c1', ctx)
    expect(prisma.eventComment.update).toHaveBeenCalled()
  })
})

// ── E-F21: частичная правка встречи, уведомления о переносе/отмене, конец события ─────
describe('EventsService.update — встреча правится частично', () => {
  const current = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    organizerId: 'u1',
    startsAt: new Date(Date.now() + 86_400_000),
    endsAt: null,
    universityId: null,
    facultyId: null,
    meetingUrl: 'https://u.zoom.us/j/123',
    meetingPasscode: '4821',
    ...over,
  })
  const organizer = user(Role.TEACHER, { sub: 'u1' })

  it('только код доступа — ссылка и провайдер остаются', async () => {
    const { service, prisma } = setup()
    prisma.event.findUnique.mockResolvedValue(current())
    prisma.event.update.mockResolvedValue({ id: 'e1' })
    await service.update(organizer, 'e1', { meetingPasscode: '9999' }, ctx)
    expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({
      isOnline: true,
      meetingUrl: 'https://u.zoom.us/j/123',
      meetingProvider: 'ZOOM',
      meetingPasscode: '9999',
    })
  })

  it('только новая ссылка — код доступа остаётся, провайдер пересчитан', async () => {
    const { service, prisma } = setup()
    prisma.event.findUnique.mockResolvedValue(current())
    prisma.event.update.mockResolvedValue({ id: 'e1' })
    await service.update(organizer, 'e1', { meetingUrl: 'https://meet.google.com/abc' }, ctx)
    expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({
      meetingUrl: 'https://meet.google.com/abc',
      meetingProvider: 'GOOGLE_MEET',
      meetingPasscode: '4821',
    })
  })

  it('null у кода стирает только код; null у ссылки — всю встречу', async () => {
    const { service, prisma } = setup()
    prisma.event.findUnique.mockResolvedValue(current())
    prisma.event.update.mockResolvedValue({ id: 'e1' })
    await service.update(organizer, 'e1', { meetingPasscode: null }, ctx)
    expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({
      meetingUrl: 'https://u.zoom.us/j/123',
      meetingPasscode: null,
    })
    await service.update(organizer, 'e1', { meetingUrl: null, meetingPasscode: '1' }, ctx)
    expect(prisma.event.update.mock.calls[1][0].data).toMatchObject({
      meetingUrl: null,
      meetingProvider: null,
      meetingPasscode: null,
    })
  })

  it('код без ссылки не сохраняется; правка без полей встречи её не трогает', async () => {
    const { service, prisma } = setup()
    prisma.event.findUnique.mockResolvedValue(current({ meetingUrl: null, meetingPasscode: null }))
    prisma.event.update.mockResolvedValue({ id: 'e1' })
    await service.update(organizer, 'e1', { meetingPasscode: '1234' }, ctx)
    expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({
      meetingUrl: null,
      meetingPasscode: null,
    })
    await service.update(organizer, 'e1', { title: 'Новое название' }, ctx)
    expect(prisma.event.update.mock.calls[1][0].data).not.toHaveProperty('meetingUrl')
    expect(prisma.event.update.mock.calls[1][0].data).not.toHaveProperty('meetingPasscode')
  })
})

describe('EventsService — уведомления участникам о переносе и отмене', () => {
  const future = new Date('2030-03-01T10:00:00.000Z')
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    title: 'Лекция',
    organizerId: 'u1',
    startsAt: future,
    endsAt: null,
    universityId: 'uni1',
    facultyId: null,
    meetingUrl: null,
    meetingPasscode: null,
    ...over,
  })
  const organizer = user(Role.TEACHER, { sub: 'u1' })

  it('перенос начала — job участникам (кроме автора правки) с новым временем по часам вуза', async () => {
    const { service, prisma, queue } = setup()
    prisma.event.findUnique.mockResolvedValue(row())
    prisma.event.update.mockResolvedValue({ id: 'e1', title: 'Лекция' })
    prisma.university.findUnique.mockResolvedValue({ timezone: 'Asia/Almaty' })
    prisma.eventParticipant.findMany.mockResolvedValue([
      { id: 'p1', userId: 'u2' },
      { id: 'p2', userId: 'u3' },
    ])
    const moved = '2030-03-02T10:00:00.000Z'

    await service.update(organizer, 'e1', { startsAt: moved }, ctx)

    expect(prisma.eventParticipant.findMany.mock.calls[0][0].where).toEqual({
      eventId: 'e1',
      userId: { not: 'u1' },
    })
    expect(queue.enqueue).toHaveBeenCalledTimes(1)
    const [queueName, jobName, payload, opts] = queue.enqueue.mock.calls[0]
    expect(queueName).toBe('notifications')
    expect(jobName).toBe('event-rescheduled')
    const ms = new Date(moved).getTime()
    expect(payload).toMatchObject({
      recipientIds: ['u2', 'u3'],
      type: 'EVENT',
      titleKey: 'events.rescheduled.title',
      bodyKey: 'events.rescheduled.body',
      // 10:00 UTC — 15:00 в Алматы.
      params: { title: 'Лекция', date: '2030-03-02 15:00' },
      data: { eventId: 'e1', url: '/events/e1' },
      dedupeKey: expect.stringMatching(new RegExp(`^event-rescheduled:e1:${ms}:\\d+$`)),
    })
    expect(opts).toEqual({ jobId: `${payload.dedupeKey}:0` })
  })

  // У события платформы вуза нет: голые «10:00» читались по своим часам.
  it('событие платформы — время в UTC с пометкой', async () => {
    const { service, prisma, queue } = setup()
    prisma.event.findUnique.mockResolvedValue(row({ universityId: null }))
    prisma.event.update.mockResolvedValue({ id: 'e1', title: 'Лекция' })
    prisma.eventParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'u2' }])

    await service.update(organizer, 'e1', { startsAt: '2030-03-02T10:00:00.000Z' }, ctx)

    expect(queue.enqueue.mock.calls[0][2].params.date).toBe('2030-03-02 10:00 UTC')
  })

  it('без переноса начала уведомлений нет', async () => {
    const { service, prisma, queue } = setup()
    prisma.event.findUnique.mockResolvedValue(row())
    prisma.event.update.mockResolvedValue({ id: 'e1', title: 'Лекция' })
    prisma.eventParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'u2' }])

    await service.update(organizer, 'e1', { title: 'Другая лекция' }, ctx)
    await service.update(organizer, 'e1', { startsAt: future.toISOString() }, ctx)

    expect(prisma.eventParticipant.findMany).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('отмена: участники собраны ДО удаления, job — после, ведёт в общий список', async () => {
    const { service, prisma, queue } = setup()
    prisma.event.findUnique.mockResolvedValue(row())
    prisma.eventParticipant.findMany.mockResolvedValue([{ id: 'p1', userId: 'u2' }])

    await service.remove(organizer, 'e1', ctx)

    const readOrder = prisma.eventParticipant.findMany.mock.invocationCallOrder[0] ?? Infinity
    const deleteOrder = prisma.event.delete.mock.invocationCallOrder[0] ?? Infinity
    const enqueueOrder = queue.enqueue.mock.invocationCallOrder[0] ?? -Infinity
    expect(readOrder).toBeLessThan(deleteOrder)
    expect(deleteOrder).toBeLessThan(enqueueOrder)
    const [, jobName, payload, opts] = queue.enqueue.mock.calls[0]
    expect(jobName).toBe('event-cancelled')
    expect(payload).toMatchObject({
      recipientIds: ['u2'],
      titleKey: 'events.cancelled.title',
      bodyKey: 'events.cancelled.body',
      params: { title: 'Лекция' },
      data: { url: '/events' },
      dedupeKey: 'event-cancelled:e1',
    })
    expect(opts).toEqual({ jobId: 'event-cancelled:e1:0' })
  })

  it('удаление прошедшего события — уборка архива, без уведомлений', async () => {
    const { service, prisma, queue } = setup()
    prisma.event.findUnique.mockResolvedValue(row({ startsAt: new Date('2020-01-01T10:00:00Z') }))

    await service.remove(organizer, 'e1', ctx)

    expect(prisma.event.delete).toHaveBeenCalled()
    expect(prisma.eventParticipant.findMany).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('EventsService.register — регистрация закрывается с концом события', () => {
  const visible = (over: Record<string, unknown>) => ({
    id: 'e1',
    organizerId: 'org',
    universityId: null,
    facultyId: null,
    participants: [],
    ...over,
  })

  it('после окончания → CONFLICT, строка участия не создаётся', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue(
      visible({
        startsAt: new Date(Date.now() - 3 * 3_600_000),
        endsAt: new Date(Date.now() - 3_600_000),
      }),
    )
    await expect(
      service.register(user(Role.STUDENT, { sub: 'u1', groupId: 'g1' }), 'e1'),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.eventParticipant.create).not.toHaveBeenCalled()
  })

  it('без конца событие длится два часа: через три часа — CONFLICT, через час — можно', async () => {
    const { service, prisma } = setup()
    const viewer = user(Role.STUDENT, { sub: 'u1', groupId: 'g1' })
    prisma.event.findFirst.mockResolvedValueOnce(
      visible({ startsAt: new Date(Date.now() - 3 * 3_600_000), endsAt: null }),
    )
    await expect(service.register(viewer, 'e1')).rejects.toMatchObject({ code: 'CONFLICT' })

    prisma.event.findFirst.mockResolvedValueOnce(
      visible({ startsAt: new Date(Date.now() - 3_600_000), endsAt: null }),
    )
    prisma.eventParticipant.create.mockResolvedValue({ id: 'p1' })
    await expect(service.register(viewer, 'e1')).resolves.toEqual({ registered: true })
  })
})

describe('EventsService.list — «предстоящие» = ещё не закончились', () => {
  afterEach(() => jest.useRealTimers())

  it('upcoming: конец не раньше сейчас или (без конца) начало не раньше чем два часа назад', async () => {
    const { service, prisma } = setup()
    const now = new Date('2026-10-17T12:00:00.000Z')
    jest.useFakeTimers().setSystemTime(now)
    await service.list(user(Role.STUDENT, { groupId: 'g1' }), {
      filter: 'upcoming',
      page: 1,
      limit: 20,
    })
    const args = prisma.event.findMany.mock.calls[0][0]
    expect(args.where.AND[1]).toEqual({
      OR: [
        { endsAt: { gte: now } },
        { endsAt: null, startsAt: { gte: new Date('2026-10-17T10:00:00.000Z') } },
      ],
    })
    expect(args.orderBy).toEqual({ startsAt: 'asc' })
  })

  it('past — дополнение: закончились, свежие сверху', async () => {
    const { service, prisma } = setup()
    const now = new Date('2026-10-17T12:00:00.000Z')
    jest.useFakeTimers().setSystemTime(now)
    await service.list(user(Role.STUDENT, { groupId: 'g1' }), {
      filter: 'past',
      page: 1,
      limit: 20,
    })
    const args = prisma.event.findMany.mock.calls[0][0]
    expect(args.where.AND[1]).toEqual({
      OR: [
        { endsAt: { lt: now } },
        { endsAt: null, startsAt: { lt: new Date('2026-10-17T10:00:00.000Z') } },
      ],
    })
    expect(args.orderBy).toEqual({ startsAt: 'desc' })
  })
})

// ── E-F16: флаг canManage считает сервер тем же правилом, что и проверку прав ──────────
describe('EventsService — canManage в ответах', () => {
  const ev = (over: Record<string, unknown>) => ({
    id: 'e',
    organizerId: 'org',
    universityId: 'uni1',
    facultyId: null,
    participants: [],
    ...over,
  })

  it('декан — только события своего факультета; событие вуза — нет', async () => {
    const { service, prisma } = setup()
    prisma.event.findMany.mockResolvedValue([
      ev({ id: 'own', facultyId: 'f1' }),
      ev({ id: 'uni', facultyId: null }),
      ev({ id: 'other', facultyId: 'f2' }),
    ])
    const page = await service.list(
      user(Role.DEAN, { sub: 'dean', universityId: 'uni1', facultyId: 'f1' }),
      { filter: 'upcoming', page: 1, limit: 20 },
    )
    const flags = (page.items as Array<{ id: string; canManage: boolean }>).map((e) => [
      e.id,
      e.canManage,
    ])
    expect(flags).toEqual([
      ['own', true],
      ['uni', false],
      ['other', false],
    ])
  })

  it('getById: организатор и админ своего вуза — да, студент и админ чужого вуза — нет', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue(ev({}))
    const flag = async (viewer: JwtPayload) =>
      ((await service.getById(viewer, 'e')) as { canManage: boolean }).canManage
    expect(await flag(user(Role.STUDENT, { sub: 'org' }))).toBe(true)
    expect(await flag(user(Role.UNIVERSITY_ADMIN, { sub: 'a', universityId: 'uni1' }))).toBe(true)
    expect(await flag(user(Role.UNIVERSITY_ADMIN, { sub: 'a', universityId: 'uni2' }))).toBe(false)
    expect(await flag(user(Role.UNIVERSITY_MODERATOR, { sub: 'm', universityId: 'uni1' }))).toBe(
      false,
    )
    expect(await flag(user(Role.STUDENT, { sub: 's' }))).toBe(false)
  })
})

describe('EventsService.listParticipants — страница по запросу', () => {
  const managed = { id: 'e1', organizerId: 'u1', universityId: null, facultyId: null }
  const organizer = user(Role.TEACHER, { sub: 'u1' })

  it('без параметров — прежний массив (до 1000, по порядку регистрации)', async () => {
    const { service, prisma } = setup()
    prisma.event.findUnique.mockResolvedValue(managed)
    prisma.eventParticipant.findMany.mockResolvedValue([{ userId: 'u2' }])
    const res = await service.listParticipants(organizer, 'e1')
    expect(Array.isArray(res)).toBe(true)
    const args = prisma.eventParticipant.findMany.mock.calls[0][0]
    expect(args).toMatchObject({ take: 1000, orderBy: { createdAt: 'asc' } })
    expect(args.select).not.toHaveProperty('id')
  })

  it('с limit/cursor — Paginated: курсор — позиция строки участия, hasNext по лишней строке', async () => {
    const { service, prisma } = setup()
    prisma.event.findUnique.mockResolvedValue(managed)
    prisma.eventParticipant.findMany.mockResolvedValue([
      { id: 'p2', userId: 'u2', createdAt: new Date(2000) },
      { id: 'p3', userId: 'u3', createdAt: new Date(3000) },
      { id: 'p4', userId: 'u4', createdAt: new Date(4000) },
    ])
    const res = await service.listParticipants(organizer, 'e1', { limit: 2, cursor: '1000.p1' })
    expect(res).toBeInstanceOf(Paginated)
    const page = res as Paginated<{ id: string }>
    expect(page.items.map((p) => p.id)).toEqual(['p2', 'p3'])
    expect(page.meta).toEqual({ cursor: '3000.p3', hasNext: true })
    const args = prisma.eventParticipant.findMany.mock.calls[0][0]
    expect(args).toMatchObject({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 3 })
    expect(args.cursor).toBeUndefined()
    // Позиция — из курсора: отменённая тем временем регистрация p1 листание не обрывает.
    expect(args.where).toEqual({
      eventId: 'e1',
      OR: [{ createdAt: { gt: new Date(1000) } }, { createdAt: new Date(1000), id: { gt: 'p1' } }],
    })
  })
})

// ── E-F12/E-F16: страница комментариев и canDelete ──────────────────────────────────
describe('EventsService.listComments — страница и canDelete', () => {
  const studentAuthor = { id: 's1', role: Role.STUDENT, universityId: 'uni1', facultyId: 'f1' }
  const adminAuthor = { id: 'adm', role: Role.UNIVERSITY_ADMIN, universityId: 'uni1' }
  const comment = (id: string, author: Record<string, unknown>) => ({
    id,
    content: 'x',
    createdAt: new Date(),
    author: { firstName: 'A', lastName: 'B', avatarThumbUrl: null, facultyId: null, ...author },
  })

  it('без параметров — прежние последние 100 по порядку написания, с canDelete', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue({
      organizerId: 'org',
      universityId: 'uni1',
      facultyId: 'f1',
    })
    prisma.eventComment.findMany.mockResolvedValue([
      comment('c2', adminAuthor),
      comment('c1', studentAuthor),
    ])
    const res = (await service.listComments(
      user(Role.STUDENT, { sub: 's1', groupId: 'g1' }),
      'e1',
    )) as Array<{ id: string; canDelete: boolean; author: Record<string, unknown> }>
    expect(prisma.eventComment.findMany.mock.calls[0][0]).toMatchObject({
      take: 100,
      orderBy: { createdAt: 'desc' },
    })
    expect(prisma.eventComment.count).not.toHaveBeenCalled()
    expect(res.map((c) => [c.id, c.canDelete])).toEqual([
      ['c1', true],
      ['c2', false],
    ])
    // Роль и scope автора нужны только для расчёта — наружу не уходят.
    expect(res[0]!.author).not.toHaveProperty('role')
    expect(res[0]!.author).not.toHaveProperty('universityId')
  })

  it('с limit/cursor — свежие сверху, курсор — самый старый на странице, total — всего', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue({
      organizerId: 'org',
      universityId: 'uni1',
      facultyId: 'f1',
    })
    prisma.eventComment.findMany.mockResolvedValue([
      { ...comment('c8', studentAuthor), createdAt: new Date(8000) },
      { ...comment('c7', adminAuthor), createdAt: new Date(7000) },
      { ...comment('c6', studentAuthor), createdAt: new Date(6000) },
    ])
    prisma.eventComment.count.mockResolvedValue(42)
    // Курсор старого вида (голый id) — позиция берётся по строке комментария.
    prisma.eventComment.findUnique.mockResolvedValue({ createdAt: new Date(9000), id: 'c9' })
    // Модератор вуза: студента снимает, админа вуза (ранг выше) — нет.
    const res = await service.listComments(
      user(Role.UNIVERSITY_MODERATOR, { sub: 'mod', universityId: 'uni1' }),
      'e1',
      { limit: 2, cursor: 'c9' },
    )
    expect(res).toBeInstanceOf(Paginated)
    const page = res as Paginated<{ id: string; canDelete: boolean }>
    expect(page.items.map((c) => [c.id, c.canDelete])).toEqual([
      ['c8', true],
      ['c7', false],
    ])
    expect(page.meta).toEqual({ cursor: '7000.c7', hasNext: true, total: 42 })
    expect(prisma.eventComment.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        AND: [
          { eventId: 'e1', deletedAt: null },
          {
            OR: [
              { createdAt: { lt: new Date(9000) } },
              { createdAt: new Date(9000), id: { lt: 'c9' } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    })
    expect(prisma.eventComment.count).toHaveBeenCalledWith({
      where: { eventId: 'e1', deletedAt: null },
    })
    // Событие для canDelete прочитано один раз на весь список.
    expect(prisma.event.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.event.findUnique).not.toHaveBeenCalled()
  })

  it('организатор видит canDelete у всех комментариев под своим событием', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue({
      organizerId: 'org',
      universityId: 'uni1',
      facultyId: null,
    })
    prisma.eventComment.findMany.mockResolvedValue([comment('c1', adminAuthor)])
    const res = await service.listComments(user(Role.TEACHER, { sub: 'org' }), 'e1', { limit: 20 })
    expect((res as Paginated<{ canDelete: boolean }>).items[0]!.canDelete).toBe(true)
  })
})

// ── Scope управления и модерации добавляется к видимости (как moderationWhere у постов) ──
describe('EventsService — админ и модераторы видят то, чем управляют', () => {
  it('админ вуза открывает событие группы своего вуза: в условии — его вуз', async () => {
    const { service, prisma } = setup()
    prisma.event.findFirst.mockResolvedValue({
      id: 'e',
      organizerId: 'org',
      universityId: 'uni1',
      facultyId: 'f1',
      participants: [],
    })
    await service.getById(user(Role.UNIVERSITY_ADMIN, { sub: 'a', universityId: 'uni1' }), 'e')
    const where = prisma.event.findFirst.mock.calls[0][0].where
    expect(where.OR).toContainEqual({ universityId: 'uni1' })
  })

  it('декан — события своего факультета, модератор платформы — все', async () => {
    const { service, prisma } = setup()
    await service.list(user(Role.DEAN, { universityId: 'uni1', facultyId: 'f1' }), {
      filter: 'upcoming',
      page: 1,
      limit: 20,
    })
    expect(prisma.event.findMany.mock.calls[0][0].where.AND[0].OR).toContainEqual({
      facultyId: 'f1',
    })

    await service.list(user(Role.PLATFORM_MODERATOR), { filter: 'upcoming', page: 1, limit: 20 })
    expect(prisma.event.findMany.mock.calls[1][0].where.AND[0].OR).toContainEqual({})
  })

  it('студенту scope модерации не добавляется', async () => {
    const { service, prisma } = setup()
    await service.list(user(Role.STUDENT, { groupId: 'g1', universityId: 'uni1' }), {
      filter: 'upcoming',
      page: 1,
      limit: 20,
    })
    const visibility = prisma.event.findMany.mock.calls[0][0].where.AND[0]
    expect(visibility.OR).not.toContainEqual({ universityId: 'uni1' })
  })
})
