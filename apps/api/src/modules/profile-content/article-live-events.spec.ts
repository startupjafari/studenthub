import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { RealtimeGateway } from '../../common/realtime'
import { ArticleLiveEvents, articleRooms } from './article-live-events'

const article = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  userId: 'author',
  status: 'PUBLISHED',
  visibility: 'UNIVERSITY',
  universityPageId: null,
  user: { universityId: 'uni-1', groupId: 'grp-1' },
  ...over,
})

describe('articleRooms', () => {
  it('по видимости статьи: вуз, группа, страница вуза, все', () => {
    expect(articleRooms(article())).toEqual(['university:uni-1', 'user:author'])
    expect(articleRooms(article({ visibility: 'FACULTY' }))).toEqual([
      'university:uni-1',
      'user:author',
    ])
    expect(articleRooms(article({ visibility: 'GROUP' }))).toEqual(['group:grp-1', 'user:author'])
    expect(
      articleRooms(article({ visibility: 'UNIVERSITY_PAGE', universityPageId: 'uni-2' })),
    ).toEqual(['university:uni-2', 'user:author'])
    expect(articleRooms(article({ visibility: 'ALL' }))).toBe('all')
  })

  it('черновик и статья компании — только автору', () => {
    expect(articleRooms(article({ status: 'DRAFT', visibility: 'ALL' }))).toEqual(['user:author'])
    expect(articleRooms(article({ visibility: 'COMPANY' }))).toEqual(['user:author'])
  })
})

describe('ArticleLiveEvents', () => {
  function setup() {
    const prisma = {
      profileArticle: { findUnique: jest.fn().mockResolvedValue(article()) },
      contentComment: { count: jest.fn().mockResolvedValue(3) },
    }
    const realtime = { emitEventToRooms: jest.fn(), emitEventToAll: jest.fn() }
    const live = new ArticleLiveEvents(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeGateway,
    )
    return { live, prisma, realtime }
  }

  it('шлёт post.comments.changed с id статьи и числом комментариев — без текста', async () => {
    const { live, realtime } = setup()
    await live.commentsChanged('a1')
    expect(realtime.emitEventToRooms).toHaveBeenCalledWith(
      ['university:uni-1', 'user:author'],
      REALTIME_EVENTS.postCommentsChanged,
      'a1',
      { count: 3 },
    )
  })

  it('статья «для всех» — всем подключённым', async () => {
    const { live, prisma, realtime } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue(article({ visibility: 'ALL' }))
    await live.commentsChanged('a1')
    expect(realtime.emitEventToAll).toHaveBeenCalledWith(
      REALTIME_EVENTS.postCommentsChanged,
      'a1',
      { count: 3 },
    )
  })

  it('статьи нет — молча; сбой рассылки не пробрасывается', async () => {
    const { live, prisma, realtime } = setup()
    prisma.profileArticle.findUnique.mockResolvedValueOnce(null)
    await live.commentsChanged('a1')
    expect(realtime.emitEventToRooms).not.toHaveBeenCalled()

    realtime.emitEventToRooms.mockImplementation(() => {
      throw new Error('socket down')
    })
    await expect(live.commentsChanged('a1')).resolves.toBeUndefined()
  })
})
