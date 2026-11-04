import { Role } from '@studenthub/shared-types'
import { generateFloor, type FloorPlanDoc } from '@studenthub/campus-core'
import { CampusService } from './campus.service'
import { CampusPublishService } from './campus-publish.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { AppException } from '../../common/exceptions/app.exception'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const ROOM = '11111111-1111-4111-8111-111111111111'

function viewer(role: Role, universityId: string | null = 'uni-1'): JwtPayload {
  return { sub: 'u-1', role, universityId, facultyId: null, groupId: null }
}

const CAMPUS = {
  id: 'c-1',
  universityId: 'uni-1',
  name: 'Главный',
  description: null,
  publishedVersionId: null,
  deletedAt: null,
}

function setup() {
  const model = () => ({
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest
      .fn()
      .mockImplementation(async ({ data }: { data: object }) => ({ id: 'new', ...data })),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest
      .fn()
      .mockImplementation(async ({ data }: { data: object }) => ({ id: 'upd', ...data })),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete: jest.fn().mockResolvedValue({}),
  })
  const prisma = {
    campus: model(),
    campusBuilding: model(),
    campusFloor: model(),
    campusFloorPlan: model(),
    campusFloorPlanSnapshot: model(),
    campusSitePlan: model(),
    campusVersion: model(),
    campusVersionFloor: model(),
    campusSpaceIndex: model(),
    room: model(),
    $transaction: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
  }
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma))
  prisma.campus.findFirst.mockResolvedValue(CAMPUS)
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') }
  const service = new CampusService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    redis as never,
  )
  const publishing = new CampusPublishService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    service,
  )
  return { service, publishing, prisma, audit, redis }
}

const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: AppException) => e,
  )

const FLOOR = (doc: FloorPlanDoc, revision = 3) => ({
  id: 'f-1',
  buildingId: 'b-1',
  level: 1,
  label: '1',
  kind: 'regular',
  elevationMm: 0,
  heightMm: 3300,
  plan: { floorId: 'f-1', revision, format: 1, document: doc },
})

const BUILDING = (doc: FloorPlanDoc) => ({
  id: 'b-1',
  name: 'Корпус А',
  code: 'А',
  outline: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  transform: { x: 0, y: 0, rotationDeg: 0 },
  floors: [FLOOR(doc)],
})

describe('CampusService — права и вуз', () => {
  it('админ вуза создаёт кампус своего вуза; платформе вуз обязателен', async () => {
    const { service, prisma, audit } = setup()
    await service.create(viewer(Role.UNIVERSITY_ADMIN), { name: 'Главный' }, ctx)
    expect(prisma.campus.create.mock.calls[0][0].data.universityId).toBe('uni-1')
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'campus_created' }))
    const e = await err(service.create(viewer(Role.PLATFORM_ADMIN, null), { name: 'X' }, ctx))
    expect(e?.code).toBe('VALIDATION_ERROR')
  })

  it('модератор вуза правит, студент и декан — нет', async () => {
    const { service } = setup()
    expect(await err(service.tree(viewer(Role.UNIVERSITY_MODERATOR), 'c-1'))).toBeNull()
    expect((await err(service.tree(viewer(Role.STUDENT), 'c-1')))?.code).toBe('FORBIDDEN')
    expect((await err(service.tree(viewer(Role.DEAN), 'c-1')))?.code).toBe('FORBIDDEN')
  })

  it('кампус чужого вуза — WRONG_SCOPE, работодателю — FORBIDDEN', async () => {
    const { service } = setup()
    expect((await err(service.tree(viewer(Role.UNIVERSITY_ADMIN, 'uni-2'), 'c-1')))?.code).toBe(
      'WRONG_SCOPE',
    )
    expect((await err(service.list(viewer(Role.EMPLOYER))))?.code).toBe('FORBIDDEN')
  })

  it('список: зрителю — только опубликованные кампусы своего вуза', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.STUDENT))
    expect(prisma.campus.findMany.mock.calls[0][0].where).toMatchObject({
      universityId: 'uni-1',
      publishedVersionId: { not: null },
    })
    await service.list(viewer(Role.UNIVERSITY_ADMIN))
    expect(prisma.campus.findMany.mock.calls[1][0].where.publishedVersionId).toBeUndefined()
  })
})

describe('CampusService — корпуса и этажи', () => {
  it('корпус с самопересекающимся контуром — VALIDATION_ERROR с полем outline', async () => {
    const { service } = setup()
    const e = await err(
      service.createBuilding(
        viewer(Role.UNIVERSITY_ADMIN),
        'c-1',
        {
          name: 'А',
          outline: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
          transform: { x: 0, y: 0, rotationDeg: 0 },
          floors: { count: 1, firstLevel: 1, heightMm: 3300 },
        },
        ctx,
      ),
    )
    expect(e?.code).toBe('VALIDATION_ERROR')
    expect(e?.details?.[0]?.field).toBe('outline')
  })

  it('корпус создаёт этажи с наружными стенами по контуру', async () => {
    const { service, prisma } = setup()
    await service.createBuilding(
      viewer(Role.UNIVERSITY_ADMIN),
      'c-1',
      {
        name: 'А',
        outline: [
          { x: 0, y: 0 },
          { x: 20000, y: 0 },
          { x: 20000, y: 10000 },
          { x: 0, y: 10000 },
        ],
        transform: { x: 0, y: 0, rotationDeg: 0 },
        floors: { count: 3, firstLevel: 1, heightMm: 3300 },
      },
      ctx,
    )
    expect(prisma.campusFloor.create).toHaveBeenCalledTimes(3)
    const floor2 = prisma.campusFloor.create.mock.calls[1][0].data
    expect(floor2).toMatchObject({ level: 2, elevationMm: 3300 })
    expect(Object.keys(floor2.plan.create.document.walls)).toHaveLength(4)
  })
})

describe('CampusService — план этажа с ревизией', () => {
  const floorRow = {
    id: 'f-1',
    building: { id: 'b-1', outline: [], campus: { id: 'c-1', universityId: 'uni-1' } },
  }

  it('чужая правка между чтением и записью — 409 с текущей ревизией', async () => {
    const { service, prisma } = setup()
    prisma.campusFloor.findFirst.mockResolvedValue(floorRow)
    prisma.campusFloorPlan.findUnique.mockResolvedValue({
      floorId: 'f-1',
      revision: 7,
      format: 1,
      document: {},
    })
    prisma.campusFloorPlan.updateMany.mockResolvedValue({ count: 0 })
    const e = await err(
      service.savePlan(viewer(Role.UNIVERSITY_ADMIN), 'f-1', {
        baseRevision: 5,
        document: generateFloor({ roomsPerSide: 2 }),
      }),
    )
    expect(e?.code).toBe('CONFLICT')
    expect(e?.details?.[0]).toEqual({ field: 'baseRevision', message: '7' })
  })

  it('успешная запись — ревизия +1 и снимок черновика, если прошлого давно не было', async () => {
    const { service, prisma } = setup()
    prisma.campusFloor.findFirst.mockResolvedValue(floorRow)
    prisma.campusFloorPlan.findUnique.mockResolvedValue({
      floorId: 'f-1',
      revision: 5,
      format: 1,
      document: {},
    })
    prisma.campusFloorPlanSnapshot.findFirst.mockResolvedValue(null)
    const r = await service.savePlan(viewer(Role.UNIVERSITY_ADMIN), 'f-1', {
      baseRevision: 5,
      document: generateFloor({ roomsPerSide: 2 }),
    })
    expect(r.revision).toBe(6)
    expect(prisma.campusFloorPlan.updateMany.mock.calls[0][0].where).toEqual({
      floorId: 'f-1',
      revision: 5,
    })
    expect(prisma.campusFloorPlanSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'autosave', revision: 5 }),
      }),
    )
  })

  it('сломанный документ (висячая ссылка) не сохраняется', async () => {
    const { service, prisma } = setup()
    prisma.campusFloor.findFirst.mockResolvedValue(floorRow)
    const doc = generateFloor({ roomsPerSide: 2 })
    const wall = Object.keys(doc.walls)[0]!
    doc.walls[wall] = { ...doc.walls[wall]!, a: 'missing' }
    const e = await err(
      service.savePlan(viewer(Role.UNIVERSITY_ADMIN), 'f-1', { baseRevision: 1, document: doc }),
    )
    expect(e?.code).toBe('VALIDATION_ERROR')
    expect(e?.details?.[0]?.message).toBe('BROKEN_REF')
    expect(prisma.campusFloorPlan.updateMany).not.toHaveBeenCalled()
  })

  it('мягкая блокировка: этаж правит другой — видно кто; «забрать» — перехват', async () => {
    const { service, prisma, redis } = setup()
    prisma.campusFloor.findFirst.mockResolvedValue(floorRow)
    redis.get.mockResolvedValue(JSON.stringify({ userId: 'other', since: '2026-11-04T00:00:00Z' }))
    expect(await service.presence(viewer(Role.UNIVERSITY_ADMIN), 'f-1')).toEqual({
      mine: false,
      holder: { userId: 'other', since: '2026-11-04T00:00:00Z' },
    })
    expect(redis.set).not.toHaveBeenCalled()
    expect((await service.presence(viewer(Role.UNIVERSITY_ADMIN), 'f-1', true)).mine).toBe(true)
    expect(redis.set).toHaveBeenCalledWith('campus:editing:f-1', expect.any(String), 'EX', 60)
  })
})

describe('CampusPublishService — публикация', () => {
  it('учебное помещение без Room — VALIDATION_ERROR, версия не создаётся', async () => {
    const { publishing, prisma } = setup()
    const doc = generateFloor({ roomsPerSide: 3 })
    const academic = Object.keys(doc.spaces).find((id) => doc.spaces[id]!.roomId)!
    const { roomId: _r, ...rest } = doc.spaces[academic]!
    doc.spaces[academic] = rest
    prisma.campusBuilding.findMany.mockResolvedValue([BUILDING(doc)])
    prisma.room.findMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })),
    )
    const e = await err(publishing.publish(viewer(Role.UNIVERSITY_ADMIN), 'c-1', {}, ctx))
    expect(e?.code).toBe('VALIDATION_ERROR')
    expect(e?.details?.some((d) => d.message === 'ROOM_REQUIRED')).toBe(true)
    expect(prisma.campusVersion.create).not.toHaveBeenCalled()
  })

  it('Room чужого вуза — ROOM_NOT_FOUND', async () => {
    const { publishing, prisma } = setup()
    prisma.campusBuilding.findMany.mockResolvedValue([BUILDING(generateFloor({ roomsPerSide: 3 }))])
    prisma.room.findMany.mockResolvedValue([])
    const e = await err(publishing.publish(viewer(Role.UNIVERSITY_ADMIN), 'c-1', {}, ctx))
    expect(e?.details?.some((d) => d.message === 'ROOM_NOT_FOUND')).toBe(true)
    // Проверка Room — только среди помещений вуза кампуса.
    expect(prisma.room.findMany.mock.calls[0][0].where.universityId).toBe('uni-1')
  })

  it('ревизия разошлась с проверенной — CONFLICT', async () => {
    const { publishing, prisma } = setup()
    prisma.campusBuilding.findMany.mockResolvedValue([BUILDING(generateFloor({ roomsPerSide: 3 }))])
    const e = await err(
      publishing.publish(
        viewer(Role.UNIVERSITY_ADMIN),
        'c-1',
        { floorRevisions: { 'f-1': 2 } },
        ctx,
      ),
    )
    expect(e?.code).toBe('CONFLICT')
  })

  it('готовая карта: версия, снимки этажей, индекс помещений, указатель на версию — под локом', async () => {
    const { publishing, prisma, audit } = setup()
    const doc = generateFloor({ roomsPerSide: 3 })
    prisma.campusBuilding.findMany.mockResolvedValue([BUILDING(doc)])
    prisma.room.findMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })),
    )
    prisma.campusVersion.findFirst.mockResolvedValue({ number: 4 })
    const r = await publishing.publish(viewer(Role.UNIVERSITY_ADMIN), 'c-1', { note: 'весна' }, ctx)
    expect(prisma.$executeRaw).toHaveBeenCalled() // advisory-лок
    expect(prisma.campusVersion.create.mock.calls[0][0].data).toMatchObject({
      number: 5,
      note: 'весна',
    })
    expect(prisma.campusVersionFloor.createMany.mock.calls[0][0].data).toHaveLength(1)
    const indexed = prisma.campusSpaceIndex.createMany.mock.calls[0][0].data
    expect(indexed).toHaveLength(Object.keys(doc.spaces).length)
    expect(prisma.campus.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c-1' } }),
    )
    expect(r.spaces).toBe(indexed.length)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campus_published' }),
    )
  })
})

describe('CampusPublishService — зрителю', () => {
  it('не опубликован — NOT_FOUND; чужой вуз — WRONG_SCOPE', async () => {
    const { publishing, prisma } = setup()
    expect((await err(publishing.published(viewer(Role.STUDENT), 'c-1')))?.code).toBe('NOT_FOUND')
    prisma.campus.findFirst.mockResolvedValue({
      ...CAMPUS,
      universityId: 'uni-2',
      publishedVersionId: 'v-1',
    })
    expect((await err(publishing.published(viewer(Role.STUDENT), 'c-1')))?.code).toBe('WRONG_SCOPE')
  })

  it('этаж студенту — без служебных и скрытых помещений', async () => {
    const { publishing, prisma } = setup()
    prisma.campus.findFirst.mockResolvedValue({ ...CAMPUS, publishedVersionId: 'v-1' })
    const doc = generateFloor({ roomsPerSide: 3 })
    const [a, b] = Object.keys(doc.spaces)
    doc.spaces[a!] = { ...doc.spaces[a!]!, visibility: 'staff' }
    doc.spaces[b!] = { ...doc.spaces[b!]!, visibility: 'hidden' }
    prisma.campusVersionFloor.findUnique.mockResolvedValue({ document: doc })
    const student = await publishing.publishedFloor(viewer(Role.STUDENT), 'c-1', 'f-1')
    expect(student.document.spaces[a!]).toBeUndefined()
    expect(student.document.spaces[b!]).toBeUndefined()
    const teacher = await publishing.publishedFloor(viewer(Role.TEACHER), 'c-1', 'f-1')
    expect(teacher.document.spaces[a!]).toBeDefined()
    expect(teacher.document.spaces[b!]).toBeUndefined()
  })

  it('поиск: студенту — только публичные помещения текущих версий своего вуза', async () => {
    const { publishing, prisma } = setup()
    prisma.campus.findMany.mockResolvedValue([
      { id: 'c-1', name: 'Главный', publishedVersionId: 'v-1' },
    ])
    prisma.campusVersion.findMany.mockResolvedValue([{ id: 'v-1', manifest: { buildings: [] } }])
    await publishing.search(viewer(Role.STUDENT), { q: '305' })
    expect(prisma.campus.findMany.mock.calls[0][0].where.universityId).toBe('uni-1')
    expect(prisma.campusSpaceIndex.findMany.mock.calls[0][0].where).toMatchObject({
      versionId: { in: ['v-1'] },
      visibility: 'public',
    })
    await publishing.search(viewer(Role.TEACHER), { q: '305' })
    expect(prisma.campusSpaceIndex.findMany.mock.calls[1][0].where.visibility).toBeUndefined()
  })

  it('«где помещение»: служебное студенту не выдаётся', async () => {
    const { publishing, prisma } = setup()
    prisma.campus.findMany.mockResolvedValue([
      { id: 'c-1', name: 'Главный', publishedVersionId: 'v-1' },
    ])
    prisma.campusVersion.findMany.mockResolvedValue([{ id: 'v-1', manifest: { buildings: [] } }])
    prisma.campusSpaceIndex.findFirst.mockResolvedValue({
      versionId: 'v-1',
      spaceId: 's',
      buildingId: 'b',
      floorId: 'f',
      roomId: ROOM,
      number: '305',
      name: null,
      kind: 'office',
      visibility: 'staff',
      centerX: 0,
      centerY: 0,
    })
    expect((await err(publishing.roomLocation(viewer(Role.STUDENT), ROOM)))?.code).toBe('NOT_FOUND')
    expect((await publishing.roomLocation(viewer(Role.TEACHER), ROOM)).spaceId).toBe('s')
  })
})
