import { Role } from '@studenthub/shared-types'
import { DocumentJournalService, journalVia } from './document-journal.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function admin(over: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'adm-1',
    role: Role.UNIVERSITY_ADMIN,
    universityId: 'uni-1',
    facultyId: null,
    groupId: null,
    ...over,
  }
}

const QUERY = { page: 1, limit: 20 }

function event(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    createdAt: new Date('2026-10-20T10:00:00Z'),
    action: 'VIEW',
    actorId: 'dean-1',
    requestId: null,
    metadata: { fileId: 'f1', accessId: 'a1', granteeType: 'DEPARTMENT', reason: 'секрет' },
    document: {
      id: 'd1',
      category: 'PERSONAL',
      type: 'PASSPORT',
      deletedAt: null,
      ownerId: 'stu-1',
      owner: { firstName: 'Асем', lastName: 'Абишева' },
    },
    ...over,
  }
}

function setup() {
  const prisma = {
    documentEvent: {
      findMany: jest.fn().mockResolvedValue([event()]),
      count: jest.fn().mockResolvedValue(1),
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'dean-1', firstName: 'Дана', lastName: 'Ахметова', role: Role.DEAN },
        ]),
    },
    documentRequest: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const service = new DocumentJournalService(prisma as unknown as PrismaService)
  return { service, prisma }
}

describe('DocumentJournalService', () => {
  it('только админ вуза и только с вузом в токене', async () => {
    const { service, prisma } = setup()
    for (const actor of [
      admin({ role: Role.DEAN }),
      admin({ role: Role.PLATFORM_ADMIN, universityId: null }),
      admin({ universityId: null }),
    ]) {
      const err = await service.list(actor, QUERY).catch((e) => e)
      expect(err.code).toBe('FORBIDDEN')
    }
    expect(prisma.documentEvent.findMany).not.toHaveBeenCalled()
  })

  it('scope — вуз документа из токена: чужой вуз в выборку не попадает', async () => {
    const { service, prisma } = setup()
    await service.list(admin(), QUERY)
    const where = prisma.documentEvent.findMany.mock.calls[0][0].where
    expect(where.AND[0]).toEqual({ document: { universityId: 'uni-1' } })
    expect(prisma.documentEvent.count).toHaveBeenCalledWith({ where })
  })

  it('без содержимого: ни названия, ни номера, ни metadata события', async () => {
    const { service, prisma } = setup()
    const page = await service.list(admin(), QUERY)
    // В выборке документа нет ни title, ни number/numberLast4, ни файлов.
    const docSelect = prisma.documentEvent.findMany.mock.calls[0][0].select.document.select
    expect(Object.keys(docSelect).sort()).toEqual(
      ['category', 'deletedAt', 'id', 'owner', 'ownerId', 'type'].sort(),
    )
    const [row] = page.items
    expect(row).toEqual({
      id: 'e1',
      createdAt: '2026-10-20T10:00:00.000Z',
      action: 'VIEW',
      actor: { id: 'dean-1', name: 'Ахметова Дана', role: Role.DEAN },
      owner: { id: 'stu-1', name: 'Абишева Асем' },
      document: { id: 'd1', category: 'PERSONAL', type: 'PASSPORT', deleted: false },
      via: 'GRANT',
      granteeType: 'DEPARTMENT',
      request: null,
    })
    expect(JSON.stringify(page)).not.toContain('секрет')
    expect(page.meta).toEqual({ total: 1 })
  })

  it('фильтры: действие, период, пользователь (актор или владелец), страница', async () => {
    const { service, prisma } = setup()
    const from = new Date('2026-10-01')
    const to = new Date('2026-10-31')
    await service.list(admin(), {
      page: 3,
      limit: 50,
      action: 'DELETE',
      from,
      to,
      userId: 'stu-9',
    })
    const args = prisma.documentEvent.findMany.mock.calls[0][0]
    expect(args.where.AND).toEqual([
      { document: { universityId: 'uni-1' } },
      { action: 'DELETE' },
      { createdAt: { gte: from, lte: to } },
      { OR: [{ actorId: 'stu-9' }, { document: { ownerId: 'stu-9' } }] },
    ])
    expect(args.skip).toBe(100)
    expect(args.take).toBe(50)
  })

  it('возврат из архива — своим действием; фильтр «Архивирование» включает и его', async () => {
    const { service, prisma } = setup()
    prisma.documentEvent.findMany.mockResolvedValue([
      event({ action: 'ARCHIVE', actorId: 'stu-1', metadata: { archived: false } }),
      event({ id: 'e2', action: 'UNARCHIVE', actorId: 'stu-1', metadata: {} }),
    ])
    const page = await service.list(admin(), { ...QUERY, action: 'ARCHIVE' })
    expect(prisma.documentEvent.findMany.mock.calls[0][0].where.AND[1]).toEqual({
      action: { in: ['ARCHIVE', 'UNARCHIVE'] },
    })
    expect(page.items.map((i) => i.action)).toEqual(['UNARCHIVE', 'UNARCHIVE'])
  })

  it('поиск по ФИО ищет людей только в своём вузе; никого — пустая страница без выборки', async () => {
    const { service, prisma } = setup()
    prisma.user.findMany.mockResolvedValueOnce([])
    const page = await service.list(admin(), { ...QUERY, q: 'Абишева Асем' })
    expect(prisma.user.findMany.mock.calls[0][0].where.universityId).toBe('uni-1')
    expect(prisma.user.findMany.mock.calls[0][0].where.AND).toHaveLength(2)
    expect(page.items).toEqual([])
    expect(prisma.documentEvent.findMany).not.toHaveBeenCalled()
  })

  it('название запроса — только из своего вуза', async () => {
    const { service, prisma } = setup()
    prisma.documentEvent.findMany.mockResolvedValue([
      event({ action: 'SUBMIT', actorId: 'stu-1', requestId: 'r1', metadata: {} }),
    ])
    prisma.documentRequest.findMany.mockResolvedValue([{ id: 'r1', title: 'Справки к стипендии' }])
    const page = await service.list(admin(), QUERY)
    expect(prisma.documentRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['r1'] }, universityId: 'uni-1' } }),
    )
    expect(page.items[0]).toMatchObject({
      via: 'REQUEST',
      request: { id: 'r1', title: 'Справки к стипендии' },
    })
  })
})

describe('journalVia', () => {
  const e = (over: Record<string, unknown>) => ({
    action: 'VIEW',
    actorId: 'x',
    requestId: null,
    metadata: null,
    ...over,
  })
  it('распознаёт путь доступа по пометкам события', () => {
    expect(journalVia(e({ metadata: { platformMode: true } }), 'o')).toBe('PLATFORM')
    expect(journalVia(e({ metadata: { viaApplication: 'app' } }), 'o')).toBe('APPLICATION')
    expect(journalVia(e({ requestId: 'r' }), 'o')).toBe('REQUEST')
    expect(journalVia(e({ action: 'EXPIRE', actorId: 'o' }), 'o')).toBe('SYSTEM')
    expect(journalVia(e({ action: 'DOWNLOAD', actorId: 'o' }), 'o')).toBe('OWNER')
    expect(journalVia(e({}), 'o')).toBe('GRANT')
    expect(journalVia(e({ action: 'UPLOAD', metadata: { issuedTo: 'o' } }), 'o')).toBe('STAFF')
  })
})
