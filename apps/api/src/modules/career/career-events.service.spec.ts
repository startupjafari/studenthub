import { Role } from '@studenthub/shared-types'
import { CareerEventsService } from './career-events.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { CareerEventListQueryInput } from '@studenthub/shared-schemas'

const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

const platformAdmin: JwtPayload = {
  sub: 'adm-1',
  role: Role.PLATFORM_ADMIN,
  universityId: null,
  facultyId: null,
  groupId: null,
}

function query(over: Partial<CareerEventListQueryInput> = {}): CareerEventListQueryInput {
  return { page: 1, limit: 20, past: false, ...over } as CareerEventListQueryInput
}

/** Событие в форме, которую возвращает Prisma с select'ом сервиса. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    careerKind: 'CAREER_FAIR',
    title: 'Ярмарка вакансий',
    description: null,
    location: 'Главный корпус',
    isOnline: false,
    startsAt: new Date('2026-10-01T09:00:00.000Z'),
    endsAt: new Date('2026-10-01T15:00:00.000Z'),
    organizer: { id: 'org-1', firstName: 'Асем', lastName: 'Ким' },
    participants: [],
    _count: { participants: 12 },
    ...over,
  }
}

describe('CareerEventsService', () => {
  let prisma: {
    event: { findMany: jest.Mock; count: jest.Mock }
  }
  let service: CareerEventsService

  beforeEach(() => {
    prisma = {
      event: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    }
    service = new CareerEventsService(prisma as unknown as PrismaService)
  })

  it('берёт университет из токена и отбирает только карьерные события', async () => {
    await service.list(student, query())

    const where = prisma.event.findMany.mock.calls[0][0].where
    expect(where.universityId).toBe('uni-1')
    // careerKind не задан фильтром — значит любые события с признаком карьерного.
    expect(where.careerKind).toEqual({ not: null })
  })

  it('фильтр kind сужает выборку до одного вида', async () => {
    await service.list(student, query({ kind: 'HACKATHON' }))

    expect(prisma.event.findMany.mock.calls[0][0].where.careerKind).toBe('HACKATHON')
  })

  it('по умолчанию показывает будущие, с past=true — прошедшие в обратном порядке', async () => {
    await service.list(student, query())
    const future = prisma.event.findMany.mock.calls[0][0]
    expect(future.where.startsAt).toHaveProperty('gte')
    expect(future.orderBy).toEqual({ startsAt: 'asc' })

    await service.list(student, query({ past: true }))
    const past = prisma.event.findMany.mock.calls[1][0]
    expect(past.where.startsAt).toHaveProperty('lt')
    expect(past.orderBy).toEqual({ startsAt: 'desc' })
  })

  it('чужой университет в параметре — WRONG_SCOPE, а не тихая подмена', async () => {
    await expect(service.list(student, query({ universityId: 'uni-2' }))).rejects.toBeInstanceOf(
      AppException,
    )
    expect(prisma.event.findMany).not.toHaveBeenCalled()
  })

  it('платформенной роли без выбранного вуза показывать нечего — WRONG_SCOPE', async () => {
    await expect(service.list(platformAdmin, query())).rejects.toBeInstanceOf(AppException)
  })

  it('платформенная роль смотрит вуз из параметра', async () => {
    await service.list(platformAdmin, query({ universityId: 'uni-7' }))

    expect(prisma.event.findMany.mock.calls[0][0].where.universityId).toBe('uni-7')
  })

  it('признак registered считается по своей записи, а не по счётчику участников', async () => {
    prisma.event.findMany.mockResolvedValue([
      row({ id: 'ev-registered', participants: [{ id: 'p-1' }] }),
      row({ id: 'ev-free', participants: [] }),
    ])
    prisma.event.count.mockResolvedValue(2)

    const result = await service.list(student, query())

    expect(result.items).toEqual([
      expect.objectContaining({ id: 'ev-registered', registered: true, participantsCount: 12 }),
      expect.objectContaining({ id: 'ev-free', registered: false, participantsCount: 12 }),
    ])
    // Сырые поля Prisma наружу не уходят.
    expect(result.items[0]).not.toHaveProperty('participants')
    expect(result.items[0]).not.toHaveProperty('_count')
    expect(result.meta).toEqual({ total: 2 })
  })

  it('пагинация переводится в skip/take', async () => {
    await service.list(student, query({ page: 3, limit: 15 }))

    const args = prisma.event.findMany.mock.calls[0][0]
    expect(args.skip).toBe(30)
    expect(args.take).toBe(15)
  })

  it('своя запись ищется по текущему пользователю', async () => {
    await service.list(student, query())

    expect(prisma.event.findMany.mock.calls[0][0].select.participants.where).toEqual({
      userId: 'stu-1',
    })
  })
})
