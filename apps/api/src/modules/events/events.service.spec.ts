import { Role } from '@studenthub/shared-types'
import { EventsService } from './events.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

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
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    faculty: { findUnique: jest.fn() },
    group: { findUnique: jest.fn() },
    $transaction: jest.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new EventsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
  )
  return { service, prisma, queue }
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
      .mockResolvedValueOnce([{ id: 'e1', title: 'Событие', startsAt: new Date(1_000_000) }])
      .mockResolvedValueOnce([])
    prisma.eventParticipant.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }])
    const n = await service.remindDue()
    expect(n).toBe(1)
    const job = queue.enqueue.mock.calls[0][2]
    expect(job.type).toBe('EVENT')
    // Время начала в ключе: перенесённое событие напомнит о себе заново.
    expect(job.dedupeKey).toBe('event-reminder:e1:1000000')
    expect(new Set(job.recipientIds)).toEqual(new Set(['u2', 'u3']))
    expect(prisma.event.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reminderSentAt: expect.any(Date) }),
      }),
    )
  })

  it('окно запроса — [now+55м, now+70м], reminderSentAt null', async () => {
    const { service, prisma } = setup()
    prisma.event.findMany.mockResolvedValueOnce([]).mockResolvedValue([])
    await service.remindDue()
    const where = prisma.event.findMany.mock.calls[0][0].where
    expect(where.reminderSentAt).toBeNull()
    const now = Date.now()
    expect(where.startsAt.gte.getTime()).toBeGreaterThan(now + 54 * 60_000)
    expect(where.startsAt.lte.getTime()).toBeLessThan(now + 71 * 60_000)
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
