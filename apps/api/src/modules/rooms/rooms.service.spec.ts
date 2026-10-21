import { Role } from '@studenthub/shared-types'
import { RoomService } from './rooms.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { UniversityService } from '../universities/universities.service'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    room: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    university: { findUnique: jest.fn().mockResolvedValue({ id: 'uni-1' }) },
    pair: { count: jest.fn().mockResolvedValue(0) },
    exam: { count: jest.fn().mockResolvedValue(0) },
    scheduleChange: { count: jest.fn().mockResolvedValue(0) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
    $transaction: jest.fn(),
  }
  // Колбэк-транзакция (удаление): в tx — тот же мок; пакетная (список) — пустая страница.
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : [[], 0],
  )
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const universities = { invalidateStats: jest.fn().mockResolvedValue(undefined) }
  const service = new RoomService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    universities as unknown as UniversityService,
  )
  return { service, prisma, audit, universities }
}

const ROOM = {
  id: 'room-1',
  name: '305',
  capacity: 30,
  universityId: 'uni-1',
  kind: 'AUDITORIUM',
  building: null,
  floor: null,
  openHours: null,
  phone: null,
  info: null,
  qrCode: null,
  qrIssuedAt: null,
  createdAt: new Date(),
}

function viewer(role: Role, universityId: string | null = 'uni-1'): JwtPayload {
  return { sub: 'u-1', role, universityId, facultyId: null, groupId: null }
}

describe('RoomService — list: поиск и страницы', () => {
  it('search — подстрока названия без учёта регистра, вуз — из JWT', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.UNIVERSITY_ADMIN), {
      page: 2,
      limit: 100,
      // Чужой вуз в query у вуз-роли игнорируется: scope только из токена.
      universityId: 'uni-2',
      search: 'лаб',
    })
    const where = { universityId: 'uni-1', name: { contains: 'лаб', mode: 'insensitive' } }
    expect(prisma.room.findMany.mock.calls[0][0]).toMatchObject({ where, skip: 100, take: 100 })
    // Счётчик — по тому же фильтру, иначе пагинация показала бы пустые страницы.
    expect(prisma.room.count).toHaveBeenCalledWith({ where })
  })

  it('поиск складывается с фильтром назначения', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.PLATFORM_ADMIN), {
      page: 1,
      limit: 20,
      universityId: 'uni-9',
      kind: 'LAB',
      search: '2',
    })
    expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({
      universityId: 'uni-9',
      kind: 'LAB',
      name: { contains: '2', mode: 'insensitive' },
    })
  })

  it('без search фильтра по названию нет', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.TEACHER), { page: 1, limit: 20 })
    expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({ universityId: 'uni-1' })
  })

  it('последний ключ сортировки — id: одноимённые помещения не прыгают между страницами', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.UNIVERSITY_ADMIN), { page: 1, limit: 20 })
    expect(prisma.room.findMany.mock.calls[0][0].orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }])

    await service.list(viewer(Role.UNIVERSITY_ADMIN), {
      page: 1,
      limit: 20,
      sort: 'floor',
      order: 'desc',
    })
    expect(prisma.room.findMany.mock.calls[1][0].orderBy).toEqual([
      { floor: { sort: 'desc', nulls: 'last' } },
      { name: 'asc' },
      { id: 'asc' },
    ])
  })
})

describe('RoomService — кэш статистики вуза', () => {
  // Счётчик «аудиторий» на дашборде иначе отставал до пяти минут.
  it('create сбрасывает кэш статистики вуза', async () => {
    const { service, prisma, universities } = setup()
    prisma.room.create.mockResolvedValue(ROOM)
    await service.create(viewer(Role.UNIVERSITY_ADMIN), { name: '305' } as never, ctx)
    expect(universities.invalidateStats).toHaveBeenCalledWith('uni-1')
  })

  it('remove сбрасывает кэш статистики вуза', async () => {
    const { service, prisma, universities, audit } = setup()
    prisma.room.findUnique.mockResolvedValue(ROOM)
    await service.remove(viewer(Role.UNIVERSITY_ADMIN), 'room-1', ctx)
    expect(prisma.room.delete).toHaveBeenCalledWith({ where: { id: 'room-1' } })
    expect(universities.invalidateStats).toHaveBeenCalledWith('uni-1')
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'room_deleted' }))
  })
})

describe('RoomService — remove: что мешает удалению', () => {
  it('подсчёт под блокировкой строки помещения, в одной транзакции с удалением', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(ROOM)
    await service.remove(viewer(Role.UNIVERSITY_ADMIN), 'room-1', ctx)
    const lockSql = (prisma.$queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?')
    expect(lockSql).toContain('FOR UPDATE')
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.exam.count.mock.invocationCallOrder[0] as number,
    )
  })

  // SET NULL молча стирал аудиторию из будущих экзаменов и замен — студенты не знали, куда идти.
  it('предстоящие экзамены и замены → CONFLICT с перечнем, ничего не удалено', async () => {
    const { service, prisma, universities } = setup()
    prisma.room.findUnique.mockResolvedValue(ROOM)
    prisma.exam.count.mockResolvedValue(2)
    prisma.scheduleChange.count.mockResolvedValue(1)
    const err = await service
      .remove(viewer(Role.UNIVERSITY_ADMIN), 'room-1', ctx)
      .catch((e: unknown) => e)
    expect(err).toMatchObject({
      code: 'CONFLICT',
      details: [
        { field: 'exams', message: 'предстоящие экзамены (2)' },
        { field: 'changes', message: 'замены в расписании (1)' },
      ],
    })
    expect(prisma.room.delete).not.toHaveBeenCalled()
    expect(universities.invalidateStats).not.toHaveBeenCalled()
  })

  it('прошедшие экзамены и замены не считаются: отбор с начала сегодняшних суток', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(ROOM)
    await service.remove(viewer(Role.UNIVERSITY_ADMIN), 'room-1', ctx)
    const today = new Date(new Date().toISOString().slice(0, 10))
    expect(prisma.exam.count).toHaveBeenCalledWith({
      where: { roomId: 'room-1', date: { gte: today } },
    })
    expect(prisma.scheduleChange.count).toHaveBeenCalledWith({
      where: { newRoomId: 'room-1', date: { gte: today } },
    })
  })

  it('пары в расписании → CONFLICT «пары»', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(ROOM)
    prisma.pair.count.mockResolvedValue(4)
    await expect(
      service.remove(viewer(Role.UNIVERSITY_ADMIN), 'room-1', ctx),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [{ field: 'pairs', message: 'пары в расписании (4)' }],
    })
  })

  it('админ чужого вуза → WRONG_SCOPE, до транзакции', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(ROOM)
    await expect(
      service.remove(viewer(Role.UNIVERSITY_ADMIN, 'uni-2'), 'room-1', ctx),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('RoomService — создание: вуз и scope', () => {
  it('админ вуза без universityId в теле создаёт помещение в своём вузе из JWT', async () => {
    const { service, prisma, audit } = setup()
    prisma.room.create.mockResolvedValue(ROOM)
    await service.create(viewer(Role.UNIVERSITY_ADMIN), { name: '305' } as never, ctx)
    expect(prisma.room.create.mock.calls[0][0].data).toMatchObject({
      name: '305',
      universityId: 'uni-1',
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'room_created', metadata: { universityId: 'uni-1' } }),
    )
  })

  it('админ вуза с чужим universityId в теле → WRONG_SCOPE, ничего не создано', async () => {
    const { service, prisma } = setup()
    await expect(
      service.create(
        viewer(Role.UNIVERSITY_ADMIN),
        { name: '305', universityId: 'uni-2' } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
    expect(prisma.university.findUnique).not.toHaveBeenCalled()
    expect(prisma.room.create).not.toHaveBeenCalled()
  })

  it('платформа без вуза в теле и в токене → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    await expect(
      service.create(viewer(Role.PLATFORM_ADMIN, null), { name: '305' } as never, ctx),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prisma.room.create).not.toHaveBeenCalled()
  })

  it('платформа создаёт в любом вузе, но несуществующий вуз → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValueOnce(null)
    await expect(
      service.create(
        viewer(Role.PLATFORM_ADMIN, null),
        { name: '305', universityId: 'uni-404' } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.room.create).not.toHaveBeenCalled()

    prisma.room.create.mockResolvedValue({ ...ROOM, universityId: 'uni-9' })
    await service.create(
      viewer(Role.PLATFORM_ADMIN, null),
      { name: '305', universityId: 'uni-9' } as never,
      ctx,
    )
    expect(prisma.room.create.mock.calls[0][0].data.universityId).toBe('uni-9')
  })
})

describe('RoomService — правка и чтение по id', () => {
  it('null очищает поле, отсутствующее поле не трогается', async () => {
    const { service, prisma, audit } = setup()
    prisma.room.findUnique.mockResolvedValue(ROOM)
    prisma.room.update.mockResolvedValue(ROOM)
    await service.update(
      viewer(Role.UNIVERSITY_ADMIN),
      'room-1',
      { phone: null, capacity: 40 } as never,
      ctx,
    )
    const { where, data } = prisma.room.update.mock.calls[0][0]
    expect(where).toEqual({ id: 'room-1' })
    expect(data.phone).toBeNull()
    expect(data.capacity).toBe(40)
    expect(data.name).toBeUndefined()
    expect(data.building).toBeUndefined()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'room_updated', entityId: 'room-1' }),
    )
  })

  it('правка помещения чужого вуза → WRONG_SCOPE, без записи и аудита', async () => {
    const { service, prisma, audit } = setup()
    prisma.room.findUnique.mockResolvedValue(ROOM)
    await expect(
      service.update(viewer(Role.UNIVERSITY_ADMIN, 'uni-2'), 'room-1', { name: 'x' } as never, ctx),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
    expect(prisma.room.update).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('правка несуществующего помещения → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(null)
    await expect(
      service.update(viewer(Role.PLATFORM_ADMIN), 'nope', { name: 'x' } as never, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.room.update).not.toHaveBeenCalled()
  })

  it('getById: свой вуз и платформа читают, чужой вуз → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue(ROOM)
    await expect(service.getById(viewer(Role.TEACHER), 'room-1')).resolves.toBe(ROOM)
    await expect(service.getById(viewer(Role.PLATFORM_MODERATOR, null), 'room-1')).resolves.toBe(
      ROOM,
    )
    await expect(service.getById(viewer(Role.STUDENT, 'uni-2'), 'room-1')).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
  })

  it('список у аккаунта без вуза пуст по фильтру, а не «все вузы»', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.STUDENT, null), { page: 1, limit: 20, universityId: 'uni-1' })
    expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({ universityId: '__none__' })
  })

  it('платформа без фильтра по вузу видит все помещения', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.PLATFORM_ADMIN, null), { page: 1, limit: 20 })
    expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({})
  })
})

describe('RoomService.assertRoomInUniversity — проверка для расписания', () => {
  it('аудитория своего вуза проходит, чужого → WRONG_SCOPE, нет → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValueOnce({ universityId: 'uni-1' })
    await expect(service.assertRoomInUniversity('room-1', 'uni-1')).resolves.toBeUndefined()

    prisma.room.findUnique.mockResolvedValueOnce({ universityId: 'uni-2' })
    await expect(service.assertRoomInUniversity('room-1', 'uni-1')).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })

    prisma.room.findUnique.mockResolvedValueOnce(null)
    await expect(service.assertRoomInUniversity('room-1', 'uni-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
