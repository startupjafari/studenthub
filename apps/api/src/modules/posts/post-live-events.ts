import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { PostAudience, Prisma } from '@prisma/client'
import { POST_REACTION_EMOJIS, REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeCoalescer, RealtimeGateway } from '../../common/realtime'

// Живая лента (эпик «всё живое по сокету», docs/PROJECT.md §9.2d). Новый пост, правка,
// удаление, лайки и комментарии чужих людей раньше появлялись только после перезагрузки.
// Здесь — только сигналы: id поста, вид изменения и счётчики. Текст и авторы не уходят:
// клиент перечитывает пост своим запросом, а сервер отдаёт его по правам зрителя.

/** Поля поста, по которым решается, в какие комнаты слать сигнал. */
export const POST_ROOMS_SELECT = {
  id: true,
  authorId: true,
  audience: true,
  universityId: true,
  groupId: true,
  targetUserId: true,
  status: true,
} satisfies Prisma.PostSelect

export type PostRoomsTarget = Prisma.PostGetPayload<{ select: typeof POST_ROOMS_SELECT }>

/** Окно склейки счётчиков: популярный пост шлёт «счётчики изменились» не чаще раза в 2 с. */
export const POST_COUNTERS_WINDOW_MS = 2000

/** Вид изменения поста, кроме счётчиков (у них свой путь со склейкой). */
export type PostChangeKind = 'edited' | 'deleted'

/** Сводка реакций для сигнала — только числа, без признака «моя»: он у каждого свой. */
export interface PostReactionTotal {
  emoji: string
  count: number
}

/** Реакции из белого списка — как сводка ленты (REACTION_EMOJI_WHERE в posts.service). */
const REACTION_EMOJI_WHERE = { emoji: { in: [...POST_REACTION_EMOJIS] } }

/**
 * Комнаты сигнала по аудитории поста. `'all'` — всем подключённым: пост «для всех» видит
 * каждый. Комнату адресата не проверяем на права поштучно — сигнал без содержимого, а кому
 * пост не виден, тот перечитает прежнюю ленту.
 *
 * Личная комната автора добавлена ко всем: учитель, пишущий в группу, в комнате группы не
 * сидит, а лайки и комментарии под своим постом он ждёт живыми больше всех. Пост страницы
 * компании в ленту не попадает — по нему не шлём ничего.
 */
export function postRooms(post: PostRoomsTarget): string[] | 'all' {
  const author = `user:${post.authorId}`
  switch (post.audience) {
    case PostAudience.ALL:
      return 'all'
    case PostAudience.UNIVERSITY:
    case PostAudience.FACULTY:
    case PostAudience.SUBJECT:
    case PostAudience.TEACHERS:
      return post.universityId ? [`university:${post.universityId}`, author] : [author]
    case PostAudience.GROUP:
      return post.groupId ? [`group:${post.groupId}`, author] : [author]
    case PostAudience.PERSONAL:
      return post.targetUserId ? [`user:${post.targetUserId}`, author] : [author]
    default:
      // COMPANY и всё, что появится позже, — молча: лучше не прислать, чем прислать лишним.
      return []
  }
}

@Injectable()
export class PostLiveEvents implements OnModuleDestroy {
  private readonly logger = new Logger(PostLiveEvents.name)
  private readonly counters = new RealtimeCoalescer(POST_COUNTERS_WINDOW_MS)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleDestroy(): void {
    this.counters.clear()
  }

  /**
   * Пост вышел к читателям: создан сразу опубликованным, опубликован из черновика или
   * кроном отложенных. Черновики и ещё не наступившие отложенные сюда не попадают — их
   * видит только автор.
   */
  published(post: PostRoomsTarget): void {
    this.send(post, REALTIME_EVENTS.feedPostCreated, {
      audience: post.audience,
      authorId: post.authorId,
    })
  }

  /** Пост отредактирован или удалён (удаление мягкое — строка для адресации на месте). */
  async changed(postId: string, kind: PostChangeKind): Promise<void> {
    const post = await this.load(postId)
    if (post) this.send(post, REALTIME_EVENTS.feedPostChanged, { kind })
  }

  /**
   * Под постом добавили или удалили комментарий: обсуждению — новое число сразу, карточкам
   * ленты — счётчики со склейкой.
   */
  async commentsChanged(postId: string): Promise<void> {
    try {
      const post = await this.load(postId)
      if (!post) return
      const count = await this.prisma.comment.count({ where: { postId, deletedAt: null } })
      this.send(post, REALTIME_EVENTS.postCommentsChanged, { count })
    } catch (error) {
      this.warn(postId, error)
    }
    this.countersChanged(postId)
  }

  /**
   * Счётчики поста изменились (реакция, комментарий). Склейка по посту: первое изменение
   * ставит таймер, итог читается из БД в момент отправки — клиент получает последние
   * числа, а не сумму промежуточных.
   */
  countersChanged(postId: string): void {
    this.counters.schedule(postId, () => {
      void this.sendCounters(postId)
    })
  }

  private async sendCounters(postId: string): Promise<void> {
    try {
      const post = await this.load(postId)
      if (!post) return
      const [grouped, comments] = await Promise.all([
        this.prisma.reaction.groupBy({
          by: ['emoji'],
          where: { postId, ...REACTION_EMOJI_WHERE },
          _count: { _all: true },
        }),
        this.prisma.comment.count({ where: { postId, deletedAt: null } }),
      ])
      // Порядок — как в белом списке и в сводке ленты: клиент заменяет числа на месте.
      const rank = (emoji: string) => (POST_REACTION_EMOJIS as readonly string[]).indexOf(emoji)
      const reactions: PostReactionTotal[] = grouped
        .map((row) => ({ emoji: row.emoji, count: row._count._all }))
        .sort((a, b) => rank(a.emoji) - rank(b.emoji))
      this.send(post, REALTIME_EVENTS.feedPostChanged, { kind: 'counters', reactions, comments })
    } catch (error) {
      this.warn(postId, error)
    }
  }

  /**
   * Пост для адресации. Черновик и отложенный видит только автор: правка его текста — не
   * новость для комнаты, и сигнал выдал бы сам факт черновика. Мягко удалённый пост читаем
   * как есть — по нему и уходит `deleted`.
   */
  private async load(postId: string): Promise<PostRoomsTarget | null> {
    try {
      const post = await this.prisma.post.findUnique({
        where: { id: postId },
        select: POST_ROOMS_SELECT,
      })
      return post?.status === 'PUBLISHED' ? post : null
    } catch (error) {
      this.warn(postId, error)
      return null
    }
  }

  /** Отправка best-effort: действие уже записано, сбой рассылки его не отменяет. */
  private send(post: PostRoomsTarget, type: string, data: unknown): void {
    try {
      const rooms = postRooms(post)
      if (rooms === 'all') this.realtime.emitEventToAll(type, post.id, data)
      else this.realtime.emitEventToRooms(rooms, type, post.id, data)
    } catch (error) {
      this.warn(post.id, error)
    }
  }

  private warn(postId: string, error: unknown): void {
    this.logger.warn(
      `Пост ${postId}: не удалось разослать живое обновление — ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
