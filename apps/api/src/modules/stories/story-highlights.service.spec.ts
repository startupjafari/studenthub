import { Prisma, StoryAudience } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { StoryHighlightsService } from './story-highlights.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const tx = {
    storyHighlight: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue({ position: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'h-new' }),
    },
    storyHighlightItem: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue({ position: 2 }),
      create: jest.fn().mockResolvedValue({ id: 'i-new' }),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
  }
  const prisma = {
    story: { findFirst: jest.fn() },
    storyHighlight: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'h-1' }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'h-1',
        title: 'Лето',
        ownerId: 'o-1',
        coverItemId: null,
        owner: { id: 'o-1', firstName: 'A', lastName: 'B', role: Role.STUDENT, avatarUrl: null },
      }),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    storyHighlightItem: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'o-1' }) },
    userBlock: { count: jest.fn().mockResolvedValue(0) },
    // Компания владельца допущена в вуз зрителя (PARTNER_UNIVERSITIES) — по умолчанию нет.
    companyMember: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as []),
    ),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn(() => 'story-highlights') }
  const files = {
    copyToBucket: jest.fn().mockResolvedValue({ id: 'copy-1' }),
    delete: jest.fn().mockResolvedValue(undefined),
  }
  const stories = {
    friendIdsAmong: jest.fn().mockResolvedValue(new Set()),
    elementViews: jest.fn().mockResolvedValue(new Map()),
    mediaFor: jest.fn().mockResolvedValue(new Map()),
  }
  const service = new StoryHighlightsService(
    prisma as never,
    audit as never,
    config as never,
    files as never,
    stories as never,
  )
  return { service, prisma, tx, audit, files, stories }
}

function viewer(sub: string, scope: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub,
    role: Role.STUDENT,
    universityId: scope.universityId ?? 'uni-1',
    facultyId: scope.facultyId ?? 'fac-1',
    groupId: scope.groupId ?? 'grp-1',
  }
}

function item(over: Record<string, unknown> = {}) {
  return {
    id: 'i-1',
    audience: StoryAudience.ALL,
    universityId: null,
    facultyId: null,
    groupId: null,
    audienceUserIds: [],
    text: 'привет',
    background: 'ocean',
    linkUrl: null,
    linkLabel: null,
    elements: null,
    storyCreatedAt: new Date('2026-10-01'),
    file: null,
    ...over,
  }
}

const story = {
  id: 's-1',
  audience: StoryAudience.GROUP,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: 'grp-1',
  audienceUserIds: [],
  fileId: 'f-1',
  text: 'подпись',
  background: null,
  linkUrl: null,
  linkLabel: null,
  elements: null,
  createdAt: new Date('2026-11-01T10:00:00Z'),
}

describe('StoryHighlightsService — видимость', () => {
  it('блокировка в любую сторону — подборок нет вовсе', async () => {
    const { service, prisma } = setup()
    prisma.userBlock.count.mockResolvedValue(1)
    expect(await service.list(viewer('v-1'), 'o-1')).toEqual([])
    expect(prisma.storyHighlight.findMany).not.toHaveBeenCalled()
  })

  it('чужому — только подборки с видимыми ему сторис; FRIENDS — лишь другу', async () => {
    const { service, prisma, stories } = setup()
    await service.list(viewer('v-1'), 'o-1')
    let where = prisma.storyHighlight.findMany.mock.calls[0][0].where
    const audiences = where.items.some.OR.map((c: { audience: string }) => c.audience)
    expect(audiences).toEqual(
      expect.arrayContaining(['ALL', 'SELECTED', 'UNIVERSITY', 'FACULTY', 'GROUP']),
    )
    expect(audiences).not.toContain('FRIENDS')

    stories.friendIdsAmong.mockResolvedValue(new Set(['v-1']))
    await service.list(viewer('v-1'), 'o-1')
    where = prisma.storyHighlight.findMany.mock.calls[1][0].where
    expect(where.items.some.OR).toContainEqual({ audience: 'FRIENDS' })
  })

  it('подборки работодателя — студенту вуза, допустившего компанию, и только при живом допуске', async () => {
    const { service, prisma } = setup()
    await service.list(viewer('v-1'), 'o-1')
    let where = prisma.storyHighlight.findMany.mock.calls[0][0].where
    expect(where.items.some.OR).not.toContainEqual({ audience: 'PARTNER_UNIVERSITIES' })
    // Допуск проверяется по компании владельца на каждый запрос, со вузом зрителя.
    expect(prisma.companyMember.count.mock.calls[0][0].where).toMatchObject({
      userId: 'o-1',
      company: { universityAccess: { some: { universityId: 'uni-1', status: 'APPROVED' } } },
    })

    prisma.companyMember.count.mockResolvedValue(1)
    await service.list(viewer('v-1'), 'o-1')
    where = prisma.storyHighlight.findMany.mock.calls[1][0].where
    expect(where.items.some.OR).toContainEqual({ audience: 'PARTNER_UNIVERSITIES' })
  })

  it('выбранная обложка, невидимая зрителю, заменяется первой видимой сторис', async () => {
    const { service, prisma } = setup()
    prisma.storyHighlight.findMany.mockResolvedValue([
      {
        id: 'h-1',
        title: 'Лето',
        cover: item({ id: 'secret', audience: StoryAudience.GROUP, groupId: 'grp-9' }),
        items: [item({ id: 'open' })],
        _count: { items: 1 },
      },
    ])
    const [summary] = await service.list(viewer('v-1'), 'o-1')
    expect(summary?.cover?.itemId).toBe('open')
    expect(summary?.itemsCount).toBe(1)
  })

  it('подборка без единой видимой сторис для чужого — NOT_FOUND', async () => {
    const { service } = setup()
    const err = await service.get(viewer('v-1'), 'h-1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('элементы — снимок с датой исходной сторис; владелец может править', async () => {
    const { service, prisma } = setup()
    prisma.storyHighlightItem.findMany.mockResolvedValue([item()])
    const detail = await service.get(viewer('o-1'), 'h-1')
    expect(detail.canEdit).toBe(true)
    expect(detail.items[0]).toMatchObject({ id: 'i-1', createdAt: new Date('2026-10-01') })
  })
})

describe('StoryHighlightsService — изменение', () => {
  it('создание: медиа копируется, аудитория и содержимое — снимком, подборка первой', async () => {
    const { service, prisma, tx, files } = setup()
    prisma.story.findFirst.mockResolvedValue(story)
    prisma.storyHighlightItem.findMany.mockResolvedValue([item()])
    await service.create(viewer('o-1'), { title: 'Лето', storyId: 's-1' }, ctx)

    expect(prisma.story.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 's-1',
      authorId: 'o-1',
    })
    expect(files.copyToBucket).toHaveBeenCalledWith('f-1', 'story-highlights', 'o-1')
    expect(tx.storyHighlight.create.mock.calls[0][0].data.position).toBe(-1)
    expect(tx.storyHighlightItem.create.mock.calls[0][0].data).toMatchObject({
      highlightId: 'h-new',
      sourceStoryId: 's-1',
      audience: 'GROUP',
      groupId: 'grp-1',
      fileId: 'copy-1',
      storyCreatedAt: story.createdAt,
      position: 0,
    })
  })

  it('чужая или истёкшая сторис — NOT_FOUND, ничего не копируется', async () => {
    const { service, prisma, files } = setup()
    prisma.story.findFirst.mockResolvedValue(null)
    const err = await service
      .create(viewer('o-1'), { title: 'Лето', storyId: 's-9' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(files.copyToBucket).not.toHaveBeenCalled()
  })

  it('повтор той же сторис — CONFLICT, а копия медиа сразу удаляется', async () => {
    const { service, prisma, tx, files } = setup()
    prisma.story.findFirst.mockResolvedValue(story)
    tx.storyHighlightItem.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    )
    const err = await service.addItem(viewer('o-1'), 'h-1', 's-1').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(files.delete).toHaveBeenCalledWith('copy-1')
  })

  it('добавление встаёт в конец подборки', async () => {
    const { service, prisma, tx } = setup()
    prisma.story.findFirst.mockResolvedValue(story)
    prisma.storyHighlightItem.findMany.mockResolvedValue([item()])
    await service.addItem(viewer('o-1'), 'h-1', 's-1')
    expect(tx.storyHighlightItem.create.mock.calls[0][0].data.position).toBe(3)
  })

  it('чужую подборку не изменить — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.storyHighlight.findFirst.mockResolvedValue(null)
    const err = await service.addItem(viewer('v-1'), 'h-1', 's-1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.storyHighlight.findFirst.mock.calls[0][0].where).toEqual({
      id: 'h-1',
      ownerId: 'v-1',
    })
  })

  it('убрана последняя сторис — подборка удаляется, копия медиа тоже', async () => {
    const { service, prisma, files } = setup()
    prisma.storyHighlightItem.findFirst.mockResolvedValue({ id: 'i-1', fileId: 'copy-1' })
    prisma.storyHighlight.deleteMany.mockResolvedValue({ count: 1 })
    expect(await service.removeItem(viewer('o-1'), 'h-1', 'i-1')).toEqual({ deleted: true })
    expect(prisma.storyHighlight.deleteMany).toHaveBeenCalledWith({
      where: { id: 'h-1', items: { none: {} } },
    })
    expect(files.delete).toHaveBeenCalledWith('copy-1')
  })

  it('обложка — только сторис этой же подборки', async () => {
    const { service, prisma } = setup()
    prisma.storyHighlightItem.findFirst.mockResolvedValue(null)
    const err = await service.update(viewer('o-1'), 'h-1', { coverItemId: 'i-9' }).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.storyHighlight.update).not.toHaveBeenCalled()
  })

  it('порядок обязан перечислить ровно свои подборки', async () => {
    const { service, prisma } = setup()
    prisma.storyHighlight.findMany.mockResolvedValue([{ id: 'h-1' }, { id: 'h-2' }])
    const err = await service.reorder(viewer('o-1'), ['h-1', 'h-3']).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')

    await service.reorder(viewer('o-1'), ['h-2', 'h-1'])
    expect(prisma.storyHighlight.update).toHaveBeenCalledWith({
      where: { id: 'h-2' },
      data: { position: 0 },
    })
  })
})
