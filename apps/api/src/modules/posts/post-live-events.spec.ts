import { PostAudience } from '@prisma/client'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { RealtimeGateway } from '../../common/realtime'
import {
  POST_COUNTERS_WINDOW_MS,
  PostLiveEvents,
  postRooms,
  type PostRoomsTarget,
} from './post-live-events'

function row(over: Partial<PostRoomsTarget> = {}): PostRoomsTarget {
  return {
    id: 'p1',
    authorId: 'a1',
    audience: PostAudience.GROUP,
    universityId: 'uni-1',
    groupId: 'grp-1',
    targetUserId: null,
    status: 'PUBLISHED',
    ...over,
  }
}

// Отправка счётчиков после таймера читает БД — даём докрутиться её промисам.
async function elapse(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms)
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

function setup() {
  const prisma = {
    post: { findUnique: jest.fn().mockResolvedValue(row()) },
    comment: { count: jest.fn().mockResolvedValue(4) },
    reaction: { groupBy: jest.fn().mockResolvedValue([]) },
  }
  const realtime = {
    emitEventToAll: jest.fn(),
    emitEventToRooms: jest.fn(),
  }
  const live = new PostLiveEvents(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
  )
  return { live, prisma, realtime }
}

// ── Адресация по аудитории (§9.2d) ─────────────────────────────────────────────
describe('postRooms', () => {
  it('ALL — всем подключённым', () => {
    expect(postRooms(row({ audience: PostAudience.ALL }))).toBe('all')
  })

  it.each([
    PostAudience.UNIVERSITY,
    PostAudience.FACULTY,
    PostAudience.SUBJECT,
    PostAudience.TEACHERS,
  ])('%s — комната вуза и автор', (audience) => {
    expect(postRooms(row({ audience }))).toEqual(['university:uni-1', 'user:a1'])
  })

  it('GROUP — комната группы и автор', () => {
    expect(postRooms(row())).toEqual(['group:grp-1', 'user:a1'])
  })

  it('PERSONAL — адресат и автор, без комнаты вуза', () => {
    expect(postRooms(row({ audience: PostAudience.PERSONAL, targetUserId: 'u9' }))).toEqual([
      'user:u9',
      'user:a1',
    ])
  })

  it('COMPANY — никому: пост страницы компании в ленту не попадает', () => {
    expect(postRooms(row({ audience: PostAudience.COMPANY }))).toEqual([])
  })
})

describe('PostLiveEvents', () => {
  afterEach(() => jest.useRealTimers())

  it('published: сигнал с аудиторией и автором, без текста', () => {
    const { live, realtime } = setup()
    live.published(row())
    expect(realtime.emitEventToRooms).toHaveBeenCalledWith(
      ['group:grp-1', 'user:a1'],
      REALTIME_EVENTS.feedPostCreated,
      'p1',
      { audience: PostAudience.GROUP, authorId: 'a1' },
    )
  })

  it('published для ALL — рассылка всем', () => {
    const { live, realtime } = setup()
    live.published(row({ audience: PostAudience.ALL }))
    expect(realtime.emitEventToAll).toHaveBeenCalledWith(REALTIME_EVENTS.feedPostCreated, 'p1', {
      audience: PostAudience.ALL,
      authorId: 'a1',
    })
  })

  it('changed по черновику не шлёт ничего: его видит только автор', async () => {
    const { live, prisma, realtime } = setup()
    prisma.post.findUnique.mockResolvedValue(row({ status: 'DRAFT' }))
    await live.changed('p1', 'edited')
    expect(realtime.emitEventToRooms).not.toHaveBeenCalled()
  })

  it('сбой рассылки не пробрасывается — действие уже записано', async () => {
    const { live, realtime } = setup()
    realtime.emitEventToRooms.mockImplementation(() => {
      throw new Error('socket down')
    })
    await expect(live.changed('p1', 'deleted')).resolves.toBeUndefined()
  })

  it('счётчики склеиваются: серия лайков → один сигнал с итоговыми числами', async () => {
    jest.useFakeTimers()
    const { live, prisma, realtime } = setup()
    prisma.reaction.groupBy.mockResolvedValue([
      { emoji: '🔥', _count: { _all: 2 } },
      { emoji: '👍', _count: { _all: 5 } },
    ])
    live.countersChanged('p1')
    live.countersChanged('p1')
    live.countersChanged('p1')
    expect(realtime.emitEventToRooms).not.toHaveBeenCalled()
    await elapse(POST_COUNTERS_WINDOW_MS)
    expect(realtime.emitEventToRooms).toHaveBeenCalledTimes(1)
    const [, type, entityId, data] = realtime.emitEventToRooms.mock.calls[0]
    expect(type).toBe(REALTIME_EVENTS.feedPostChanged)
    expect(entityId).toBe('p1')
    // Только числа — без признака «моя реакция»: он у каждого зрителя свой.
    expect(data).toEqual({
      kind: 'counters',
      reactions: [
        { emoji: '👍', count: 5 },
        { emoji: '🔥', count: 2 },
      ],
      comments: 4,
    })
    live.onModuleDestroy()
  })

  it('комментарий: число сразу в обсуждение, счётчики — со склейкой', async () => {
    jest.useFakeTimers()
    const { live, realtime } = setup()
    await live.commentsChanged('p1')
    expect(realtime.emitEventToRooms).toHaveBeenCalledWith(
      ['group:grp-1', 'user:a1'],
      REALTIME_EVENTS.postCommentsChanged,
      'p1',
      { count: 4 },
    )
    await elapse(POST_COUNTERS_WINDOW_MS)
    expect(realtime.emitEventToRooms).toHaveBeenLastCalledWith(
      ['group:grp-1', 'user:a1'],
      REALTIME_EVENTS.feedPostChanged,
      'p1',
      expect.objectContaining({ kind: 'counters', comments: 4 }),
    )
    live.onModuleDestroy()
  })
})
