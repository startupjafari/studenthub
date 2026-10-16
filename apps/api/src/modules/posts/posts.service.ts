import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PostAudience, Prisma } from '@prisma/client'
import { Role, isHigherRole } from '@studenthub/shared-types'
import {
  POST_REACTION_EMOJIS,
  type UpdatePostInput,
  type CreateCommentInput,
  type CreatePostInput,
  type FeedFilterValue,
  type FeedQueryInput,
  type PostReactionSummary,
  type ReactionInput,
  type RepostInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileService } from '../files/file.service'
import { MediaService } from '../media/media.service'
import { MEDIA_FILE_SELECT, type MediaFile, type MediaInfo } from '../media/media.types'
import { signingWindow } from '../../common/minio/stable-sign'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import type { EnvVars } from '../../config/env.schema'

// Иерархия ролей для закрепления (задача 8.6): закрепить может только роль СТРОГО выше автора.
const ROLE_RANK: Record<Role, number> = {
  [Role.STUDENT]: 0,
  [Role.STAROSTA]: 1,
  [Role.TEACHER]: 2,
  [Role.DEAN]: 3,
  [Role.UNIVERSITY_MODERATOR]: 4,
  [Role.UNIVERSITY_ADMIN]: 5,
  [Role.PLATFORM_MODERATOR]: 6,
  [Role.PLATFORM_ADMIN]: 7,
  // Работодатель постов не создаёт и не закрепляет — ранг ниже студенческого.
  [Role.EMPLOYER]: -1,
}

// Разрешённые аудитории по роли автора (docs/PROJECT.md §2.2 — модераторы посты не создают).
const ALLOWED_AUDIENCES: Record<Role, PostAudience[]> = {
  [Role.PLATFORM_ADMIN]: [PostAudience.ALL, PostAudience.PERSONAL],
  [Role.PLATFORM_MODERATOR]: [],
  [Role.UNIVERSITY_ADMIN]: [
    PostAudience.UNIVERSITY,
    PostAudience.FACULTY,
    PostAudience.GROUP,
    PostAudience.TEACHERS,
    PostAudience.PERSONAL,
  ],
  [Role.UNIVERSITY_MODERATOR]: [],
  [Role.DEAN]: [PostAudience.FACULTY, PostAudience.GROUP, PostAudience.PERSONAL],
  [Role.TEACHER]: [PostAudience.GROUP, PostAudience.SUBJECT, PostAudience.PERSONAL],
  [Role.STAROSTA]: [PostAudience.GROUP, PostAudience.PERSONAL],
  [Role.STUDENT]: [PostAudience.GROUP, PostAudience.PERSONAL],
  // Работодатель в ленте платформы не публикует: его канал — вакансии.
  [Role.EMPLOYER]: [],
}

// Базовый приоритет в ленте по аудитории (docs/PROJECT.md §3.3).
const AUDIENCE_PRIORITY: Record<PostAudience, number> = {
  [PostAudience.ALL]: 50,
  [PostAudience.UNIVERSITY]: 40,
  [PostAudience.FACULTY]: 35,
  [PostAudience.TEACHERS]: 32,
  [PostAudience.GROUP]: 30,
  [PostAudience.SUBJECT]: 25,
  [PostAudience.PERSONAL]: 20,
}

const AUTHOR_SELECT = {
  select: { id: true, firstName: true, lastName: true, role: true, avatarUrl: true },
}

// Реакции из белого списка (ReactionSchema). Строки с произвольным текстом, поставленные до
// списка, не считаются нигде: ни в сводке, ни в построчном `reactions`.
const REACTION_EMOJI_WHERE = { emoji: { in: [...POST_REACTION_EMOJIS] } }

// Поля поста без реакций и счётчика комментариев — то, что читает лента.
//
// `_count` отношением Prisma превращает в LEFT JOIN с агрегатом по ВСЕЙ таблице
// комментариев. Планировщик из-за него перестаёт брать индекс порядка ленты: агрегат
// нужно посчитать до сортировки, поэтому вместо прохода по индексу с ранней остановкой
// снова получается bitmap-скан постов, хеш-соединение и сортировка. Замер на 90 тыс.
// постов и 500 тыс. комментариев: 115 мс со счётчиком против 0,04 мс без него.
//
// Поэтому в ленте счётчики берутся отдельным groupBy по двум десяткам id страницы —
// ровно так же, как закладки и реакции (см. decorate). Одиночному посту это не нужно:
// там агрегат считается по одному id и стоит ничего, а select проще держать общим.
const POST_SELECT_CORE = {
  id: true,
  audience: true,
  title: true,
  content: true,
  authorId: true,
  universityId: true,
  facultyId: true,
  groupId: true,
  targetUserId: true,
  subject: true,
  priority: true,
  pinnedAt: true,
  originalPostId: true,
  views: true,
  status: true,
  scheduledAt: true,
  publishedAt: true,
  createdAt: true,
  author: AUTHOR_SELECT,
  // Поля описания медиа с вариантами: ссылки и srcset подписываются пачкой на всю выдачу
  // (decorate). Наружу из этих строк уходит только публичная часть (toPostMedia).
  media: { select: MEDIA_FILE_SELECT },
  original: {
    select: { id: true, title: true, content: true, author: AUTHOR_SELECT },
  },
} satisfies Prisma.PostSelect

/**
 * Построчные реакции «кто что поставил» — устаревшее поле ответа: его читает Android-клиент
 * (считает строки по эмодзи и ищет свою по userId). Новые клиенты берут `reactionSummary`
 * и просят ленту без строк (`reactions=summary`). Убрать поле можно, когда мобильные
 * клиенты перейдут на сводку.
 */
const POST_SELECT_BASE = {
  ...POST_SELECT_CORE,
  reactions: { where: REACTION_EMOJI_WHERE, select: { emoji: true, userId: true } },
} satisfies Prisma.PostSelect

const POST_SELECT = {
  ...POST_SELECT_BASE,
  _count: { select: { comments: { where: { deletedAt: null } } } },
} satisfies Prisma.PostSelect

type LegacyReaction = { emoji: string; userId: string }
/** Строка выдачи до оформления: без счётчика комментариев, построчные реакции — по запросу. */
type FeedRow = Prisma.PostGetPayload<{ select: typeof POST_SELECT_CORE }> & {
  reactions?: LegacyReaction[]
}

/** Медиа поста в ответе: превью, описание вариантов и подписанная ссылка на оригинал. */
type PostMediaView = Pick<
  MediaFile,
  'id' | 'mime' | 'width' | 'height' | 'mediaStatus' | 'placeholder' | 'durationMs'
> &
  Pick<MediaInfo, 'status' | 'sources' | 'poster' | 'hls' | 'expiresAt'> & {
    /** Нет — файл исчез между выборкой и подписью; клиент спросит ссылку отдельно. */
    url?: string
  }

/**
 * Пост в ответе API с личными признаками зрителя. Сохранён ли пост и какие реакции свои —
 * вопрос про ПАРУ «зритель + пост», поэтому признаки не лежат в select: включать закладки
 * отношением значило бы отдать наружу, КТО ещё сохранил пост. Считаются отдельными
 * запросами на страницу выдачи.
 */
type ViewerPost = Omit<FeedRow, 'media'> & {
  media: PostMediaView[]
  reactionSummary: PostReactionSummary[]
  _count: { comments: number }
  bookmarked: boolean
}

// Поля scope для проверки прав (без тяжёлых relation'ов).
const POST_SCOPE_SELECT = {
  id: true,
  authorId: true,
  audience: true,
  universityId: true,
  facultyId: true,
  groupId: true,
} satisfies Prisma.PostSelect

const COMMENT_SELECT = {
  id: true,
  postId: true,
  parentId: true,
  content: true,
  createdAt: true,
  author: AUTHOR_SELECT,
} satisfies Prisma.CommentSelect

// Scope-цель поста, вычисленная из audience (проставляется в data при создании).
interface PostTarget {
  universityId?: string
  facultyId?: string
  groupId?: string
  targetUserId?: string
  subject?: string
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

// Роли, которые снимают и закрепляют чужие посты в своём scope (см. assertModerator).
const MODERATOR_ROLES: ReadonlySet<Role> = new Set([
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
])

// Ни один пост не подходит: scope роли не заполнен (декан без факультета и т. п.).
const NOTHING: Prisma.PostWhereInput = { id: { in: [] } }

/**
 * Медиа поста в ответе: превью (как раньше), описание вариантов и подписанная ссылка на
 * оригинал. Собирается явно, а не разбором строки: в строке лежат бакет и ключи вариантов,
 * наружу им незачем.
 */
function toPostMedia(
  file: MediaFile,
  url: string | undefined,
  info: MediaInfo | undefined,
  expiresAt: string,
): PostMediaView {
  return {
    id: file.id,
    mime: file.mime,
    width: file.width,
    height: file.height,
    mediaStatus: file.mediaStatus,
    placeholder: file.placeholder,
    durationMs: file.durationMs,
    status: info?.status ?? file.mediaStatus,
    sources: info?.sources ?? [],
    poster: info?.poster ?? [],
    hls: info?.hls ?? null,
    // Срок — у подписанной ссылки на оригинал; без неё — срок вариантов, как в MediaInfo.
    expiresAt: url ? expiresAt : (info?.expiresAt ?? null),
    ...(url ? { url } : {}),
  }
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly files: FileService,
    private readonly media: MediaService,
  ) {}

  // ── Видимость (задача 8.2) ──────────────────────────────────────────────────

  /**
   * Пользователь видит: ALL + свои посты + свой вуз (UNIVERSITY/SUBJECT/TEACHERS-для-препода)
   * + свой факультет + свою группу + адресованное лично (docs/PROJECT.md §3.3).
   *
   * `moderation` добавляет scope модерации роли (moderationWhere) — для действий с постом
   * по id: открыть, медиа, комментарии, реакция, закладка. Иначе модератор, нашедший пост
   * на экране модерации, получал бы NOT_FOUND на его медиа и обсуждение. Личная лента и
   * всё, что выносит пост к новым читателям (репост, пересылка в чат), идут без флага —
   * по видимости самого зрителя.
   */
  private visibilityWhere(
    viewer: JwtPayload,
    opts: { moderation?: boolean } = {},
  ): Prisma.PostWhereInput {
    const or: Prisma.PostWhereInput[] = [
      { audience: PostAudience.ALL },
      { authorId: viewer.sub },
      { audience: PostAudience.PERSONAL, targetUserId: viewer.sub },
    ]
    if (viewer.universityId) {
      or.push({ audience: PostAudience.UNIVERSITY, universityId: viewer.universityId })
      or.push({ audience: PostAudience.SUBJECT, universityId: viewer.universityId })
      if (viewer.role === Role.TEACHER) {
        or.push({ audience: PostAudience.TEACHERS, universityId: viewer.universityId })
      }
    }
    if (viewer.facultyId) {
      or.push({ audience: PostAudience.FACULTY, facultyId: viewer.facultyId })
    }
    if (viewer.groupId) {
      or.push({ audience: PostAudience.GROUP, groupId: viewer.groupId })
    }
    const moderated = opts.moderation ? this.moderationWhere(viewer) : null
    if (moderated) or.push(moderated)
    // Черновики/отложенные (status ≠ PUBLISHED) видит только автор; остальным — лишь опубликованные.
    return {
      deletedAt: null,
      OR: or,
      AND: [{ OR: [{ status: 'PUBLISHED' }, { authorId: viewer.sub }] }],
    }
  }

  /**
   * Scope модерации — посты, которые роль вправе снимать (assertModerator): платформа —
   * любые, админ и модератор вуза — своего вуза, декан — своего факультета. Без личных:
   * они адресованы одному человеку, и читать их наперёд модератору незачем. Только
   * опубликованные — черновик ещё никому не показан.
   *
   * null — роль не модерирует. Пустой scope (декан без факультета) не значит «вся платформа».
   */
  private moderationWhere(viewer: JwtPayload): Prisma.PostWhereInput | null {
    if (!MODERATOR_ROLES.has(viewer.role)) return null
    let scope: Prisma.PostWhereInput = {}
    if (viewer.role === Role.DEAN) {
      scope = viewer.facultyId ? { facultyId: viewer.facultyId } : NOTHING
    } else if (!isPlatform(viewer.role)) {
      scope = viewer.universityId ? { universityId: viewer.universityId } : NOTHING
    }
    return {
      deletedAt: null,
      status: 'PUBLISHED',
      audience: { not: PostAudience.PERSONAL },
      ...scope,
    }
  }

  // Where-условие таба ленты. Всегда применяется через AND поверх visibilityWhere.
  // «Преподаватели» = посты ОТ преподавателей (audience TEACHERS адресован преподавателям и
  // студентам не виден — как таб бесполезен); «Важное» = закреплённые.
  private feedFilterWhere(
    filter: FeedFilterValue | undefined,
    viewerId: string,
  ): Prisma.PostWhereInput | null {
    switch (filter) {
      case 'GROUP':
        return { audience: PostAudience.GROUP }
      case 'UNIVERSITY':
        return { audience: PostAudience.UNIVERSITY }
      case 'TEACHERS':
        return { author: { role: Role.TEACHER } }
      case 'IMPORTANT':
        return { pinnedAt: { not: null } }
      case 'SAVED':
        // Полка зрителя, а не «популярное»: фильтр по ЕГО закладке. Пересечение с
        // видимостью остаётся — сохранённый пост, который человек больше не имеет права
        // видеть (ушёл из группы), в полке не появится.
        return { bookmarks: { some: { userId: viewerId } } }
      default:
        return null
    }
  }

  private async findVisibleOrThrow<S extends Prisma.PostSelect>(
    viewer: JwtPayload,
    id: string,
    select: S,
    opts: { moderation?: boolean } = {},
  ): Promise<Prisma.PostGetPayload<{ select: S }>> {
    const post = await this.prisma.post.findFirst({
      where: { id, ...this.visibilityWhere(viewer, opts) },
      select,
    })
    if (!post) {
      throw new AppException('NOT_FOUND', 'Пост не найден')
    }
    return post as Prisma.PostGetPayload<{ select: S }>
  }

  // ── Лента (задача 8.3) — cursor-пагинация + приоритет ──────────────────────

  /**
   * Дописывает выдаче всё, что считается по списку id или зависит от зрителя: закладку,
   * счётчик комментариев, доступность цитаты оригинала, сводку реакций и подписанные ссылки
   * на медиа. Запросы индексные, по двум десяткам id страницы, и идут параллельно.
   *
   * Счётчик комментариев здесь, а не отношением в select: `_count` внутри выборки заставляет
   * Postgres считать агрегат по всей таблице комментариев ДО сортировки, и ради этого
   * планировщик бросает индекс порядка ленты (см. комментарий у POST_SELECT_CORE). У
   * одиночного поста счётчик уже пришёл в select (`counted`) — второй раз его не считаем.
   *
   * Удалённые комментарии не считаются: в обсуждении их не видно, и счётчик «5» над
   * тремя видимыми комментариями выглядел ошибкой. Карточка поста считает так же.
   */
  private async decorate(
    viewer: JwtPayload,
    rows: Array<FeedRow & { _count?: { comments: number } }>,
    { counted = false }: { counted?: boolean } = {},
  ): Promise<ViewerPost[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const [saved, counts, originals, reactions, mediaView] = await Promise.all([
      this.prisma.postBookmark.findMany({
        where: { userId: viewer.sub, postId: { in: ids } },
        select: { postId: true },
        take: ids.length,
      }),
      counted
        ? Promise.resolve([])
        : this.prisma.comment.groupBy({
            by: ['postId'],
            where: { postId: { in: ids }, deletedAt: null },
            _count: { _all: true },
          }),
      this.availableOriginals(viewer, rows),
      this.reactionSummaries(viewer.sub, ids),
      this.signMedia(rows.flatMap((row) => row.media)),
    ])
    const savedIds = new Set(saved.map((row) => row.postId))
    const countByPost = new Map(counts.map((row) => [row.postId, row._count._all]))
    return rows.map((row) => ({
      ...row,
      media: row.media.map(mediaView),
      reactionSummary: reactions.get(row.id) ?? [],
      original: row.original && originals.has(row.original.id) ? row.original : null,
      _count: counted && row._count ? row._count : { comments: countByPost.get(row.id) ?? 0 },
      bookmarked: savedIds.has(row.id),
    }))
  }

  /**
   * Сводка реакций выдачи — как у сторис: сколько каждой (groupBy по id страницы) и какие из
   * них свои (отдельный запрос за зрителя). Раньше лента везла отношением ВСЕ строки реакций
   * каждого поста вместе с userId: объявление вуза с тысячами лайков — тысячи объектов на
   * страницу ради одного числа на экране.
   */
  private async reactionSummaries(
    viewerId: string,
    ids: string[],
  ): Promise<Map<string, PostReactionSummary[]>> {
    const [counts, mine] = await Promise.all([
      this.prisma.reaction.groupBy({
        by: ['postId', 'emoji'],
        where: { postId: { in: ids }, ...REACTION_EMOJI_WHERE },
        _count: { _all: true },
      }),
      this.prisma.reaction.findMany({
        where: { userId: viewerId, postId: { in: ids }, ...REACTION_EMOJI_WHERE },
        select: { postId: true, emoji: true },
        // Уникальность [postId, userId, emoji] и белый список дают точный потолок.
        take: ids.length * POST_REACTION_EMOJIS.length,
      }),
    ])
    const mineKeys = new Set(mine.map((row) => `${row.postId}:${row.emoji}`))
    // Порядок — как в белом списке: groupBy его не гарантирует, а сводка не должна прыгать.
    const rank = (emoji: string) => (POST_REACTION_EMOJIS as readonly string[]).indexOf(emoji)
    const byPost = new Map<string, PostReactionSummary[]>()
    for (const row of [...counts].sort((a, b) => rank(a.emoji) - rank(b.emoji))) {
      const list = byPost.get(row.postId) ?? []
      list.push({
        emoji: row.emoji,
        count: row._count._all,
        mine: mineKeys.has(`${row.postId}:${row.emoji}`),
      })
      byPost.set(row.postId, list)
    }
    return byPost
  }

  /**
   * Ссылки на медиа выдачи и их варианты — одной пачкой, как у сторис. Раньше клиент
   * спрашивал ссылку на каждую плитку отдельно (`GET /posts/:id/media/:fileId/url`): страница
   * из двадцати постов давала до восьмидесяти запросов, каждый с проверкой видимости, и лента
   * упиралась в лимит 100 запросов в минуту. Видимость здесь уже проверила выборка самой
   * выдачи; отдельная ручка осталась для продления истёкшей ссылки.
   */
  private async signMedia(files: MediaFile[]): Promise<(file: MediaFile) => PostMediaView> {
    const now = Date.now()
    const [urls, described] = await Promise.all([
      this.files.getPresignedUrls(files.map((file) => file.id)),
      this.media.describe(files, now),
    ])
    const expiresAt = signingWindow(now).expiresAt.toISOString()
    return (file) => toPostMedia(file, urls.get(file.id), described.get(file.id), expiresAt)
  }

  /**
   * Какие оригиналы репостов зритель вправе прочитать в цитате: не удалённые, опубликованные
   * и открываемые им по id (то же право, что у getById, — клиент догружает исходник им же).
   * Один индексный запрос на страницу, и только если на ней есть репосты.
   *
   * Цитата неподходящего оригинала обнуляется (`original: null`), а `originalPostId`
   * остаётся — клиент рисует «Публикация недоступна». Раньше цитата уходила любому зрителю
   * репоста: снятый модератором пост жил дальше во всех репостах, а пост для преподавателей
   * доходил до студентов через репост в группу.
   */
  private async availableOriginals(
    viewer: JwtPayload,
    rows: Array<{ original: { id: string } | null }>,
  ): Promise<Set<string>> {
    const ids = [...new Set(rows.flatMap((row) => (row.original ? [row.original.id] : [])))]
    if (ids.length === 0) return new Set()
    const visible = await this.prisma.post.findMany({
      where: {
        AND: [
          { id: { in: ids } },
          { status: 'PUBLISHED' },
          this.visibilityWhere(viewer, { moderation: true }),
        ],
      },
      select: { id: true },
      take: ids.length,
    })
    return new Set(visible.map((row) => row.id))
  }

  async feed(viewer: JwtPayload, query: FeedQueryInput): Promise<Paginated<ViewerPost>> {
    const moderation = query.filter === 'MODERATION'
    const where = moderation
      ? this.moderationFeedWhere(viewer, query)
      : this.feedWhere(viewer, query)
    const rows: FeedRow[] = await this.prisma.post.findMany({
      where,
      // Построчные реакции — только клиентам, которые их читают (см. POST_SELECT_BASE).
      select: query.reactions === 'summary' ? POST_SELECT_CORE : POST_SELECT_BASE,
      // Закреплённые сверху, затем по приоритету и времени; id — стабильный tiebreaker для cursor.
      // Модерации нужен поток свежего, а не порядок чтения: там просто новые сверху.
      orderBy: moderation
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : [
            { pinnedAt: { sort: 'desc', nulls: 'last' } },
            { priority: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = rows.length > query.limit
    const page = hasNext ? rows.slice(0, query.limit) : rows
    const nextCursor = hasNext ? page[page.length - 1]?.id : undefined
    const items = await this.decorate(viewer, page)
    // Для вкладки «Посты» в профиле (authorId) отдаём общий счётчик — для бейджа на табе.
    // В общей ленте счётчик не считаем (лишний COUNT на горячем пути).
    const total = query.authorId ? await this.prisma.post.count({ where }) : undefined
    return new Paginated(items, {
      cursor: nextCursor,
      hasNext,
      ...(total !== undefined ? { total } : {}),
    })
  }

  /** Личная лента зрителя: его видимость, сужаемая табом. */
  private feedWhere(viewer: JwtPayload, query: FeedQueryInput): Prisma.PostWhereInput {
    // authorId (вкладка «Посты» в профиле) всегда пересекается с видимостью зрителя —
    // нельзя увидеть чужие посты в обход прав (IDOR-защита). Полка «Сохранённое» берёт и
    // scope модерации: сохранить пост модератор может и с экрана модерации (toggleBookmark).
    const base = this.visibilityWhere(viewer, { moderation: query.filter === 'SAVED' })
    // Черновики/отложенные показываем ТОЛЬКО на своей вкладке профиля (authorId === зритель).
    // В общей ленте и в чужом профиле — только опубликованные (скрываем и свои черновики из ленты).
    if (!query.authorId || query.authorId !== viewer.sub) {
      ;(base.AND as Prisma.PostWhereInput[]).push({ status: 'PUBLISHED' })
    }
    // Таб ленты сужает выдачу поверх видимости (через AND) — обойти права нельзя.
    const filterWhere = this.feedFilterWhere(query.filter, viewer.sub)
    if (filterWhere) (base.AND as Prisma.PostWhereInput[]).push(filterWhere)
    return query.authorId ? { AND: [{ authorId: query.authorId }, base] } : base
  }

  /**
   * Экран модерации: не личная лента, а всё, что роль вправе снимать. Личная лента
   * модератору для этого не годилась — у модератора платформы нет вуза, и он видел
   * только посты для всех (их пишет лишь админ платформы, которого он снимать не вправе),
   * а админ вуза не видел ни одного студенческого поста. Отдельным значением фильтра, а не
   * расширением видимости: обычные табы остаются личной лентой, а не потоком всего вуза.
   */
  private moderationFeedWhere(viewer: JwtPayload, query: FeedQueryInput): Prisma.PostWhereInput {
    const scope = this.moderationWhere(viewer)
    if (!scope) {
      throw new AppException('FORBIDDEN', 'Лента модерации доступна только модераторам')
    }
    return query.authorId ? { AND: [{ authorId: query.authorId }, scope] } : scope
  }

  async getById(viewer: JwtPayload, id: string): Promise<ViewerPost> {
    const post = await this.findVisibleOrThrow(viewer, id, POST_SELECT, { moderation: true })
    const [result] = await this.decorate(viewer, [post], { counted: true })
    return result as ViewerPost
  }

  /**
   * Сохранить пост или убрать из сохранённого. Переключатель, а не две ручки: клиент не
   * обязан знать текущее состояние, чтобы нажать кнопку, — иначе два быстрых нажатия подряд
   * расходились бы с сервером.
   */
  async toggleBookmark(viewer: JwtPayload, id: string): Promise<{ bookmarked: boolean }> {
    // Сохранить можно только то, что зритель имеет право видеть: иначе закладка становится
    // способом проверить существование чужого поста по id. Модератору — и в его scope.
    await this.findVisibleOrThrow(viewer, id, { id: true }, { moderation: true })
    const existing = await this.prisma.postBookmark.findUnique({
      where: { userId_postId: { userId: viewer.sub, postId: id } },
      select: { id: true },
    })
    if (existing) {
      await this.prisma.postBookmark.delete({ where: { id: existing.id } })
      return { bookmarked: false }
    }
    await this.prisma.postBookmark.create({ data: { userId: viewer.sub, postId: id } })
    return { bookmarked: true }
  }

  /**
   * Бросает NOT_FOUND, если пост не виден зрителю. Используется share-to-chat (ChatsService).
   * Без scope модерации: пересылка выносит пост к новым читателям, и право модератора
   * снимать пост не даёт права его распространять.
   */
  async assertVisibleToViewer(viewer: JwtPayload, id: string): Promise<void> {
    await this.findVisibleOrThrow(viewer, id, { id: true })
  }

  /** Инкремент просмотров поста (при открытии в лайтбоксе). Только если пост виден зрителю. */
  async incrementView(viewer: JwtPayload, id: string): Promise<{ views: number }> {
    await this.findVisibleOrThrow(viewer, id, { id: true }, { moderation: true })
    return this.prisma.post.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: { views: true },
    })
  }

  /**
   * Presigned-GET к медиа поста: доступ по видимости поста зрителю (не по владению файлом) —
   * иначе чужие посты нельзя было бы показать. Файл обязан принадлежать именно этому посту.
   */
  /**
   * Ссылка на медиа поста и его варианты (srcset, постер, HLS) — по видимости поста.
   * `url` — оригинал, как и раньше; поля описания медиа (MediaInfo) лежат рядом.
   * Лента и пост по id отдают то же самое прямо в `media[]`; ручка — для продления ссылки,
   * истёкшей, пока выдача лежала в кэше клиента.
   */
  async getMediaUrl(
    viewer: JwtPayload,
    postId: string,
    fileId: string,
  ): Promise<MediaInfo & { url: string; expiresAt: string }> {
    await this.findVisibleOrThrow(viewer, postId, { id: true }, { moderation: true })
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, postId },
      select: MEDIA_FILE_SELECT,
    })
    if (!file) throw new AppException('NOT_FOUND', 'Медиа не найдено')
    const now = Date.now()
    const [url, media] = await Promise.all([
      this.files.getPresignedUrl(fileId),
      this.media.describeOne(file, now),
    ])
    return { ...media, url, expiresAt: signingWindow(now).expiresAt.toISOString() }
  }

  // ── Создание (задачи 8.2, 8.7) ─────────────────────────────────────────────

  async create(
    actor: JwtPayload,
    input: CreatePostInput,
    ctx: RequestContext,
  ): Promise<ViewerPost> {
    const target = await this.resolveTarget(actor, input.audience as PostAudience, input)
    // Пост и привязка медиа — одной транзакцией: раньше пост публиковался, а следом
    // linkMedia отвечал 400, клиент повторял отправку — и в ленте оказывалось два поста.
    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: {
          authorId: actor.sub,
          audience: input.audience as PostAudience,
          title: input.title?.trim() || null,
          content: input.content,
          priority: this.priorityFor(actor, input.audience as PostAudience),
          ...this.resolvePublishState(input),
          ...target,
        },
        select: { id: true },
      })
      if (input.mediaIds?.length) {
        await this.linkMedia(tx, actor.sub, created.id, input.mediaIds)
      }
      return created
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'post_created',
      entity: 'Post',
      entityId: post.id,
      metadata: { audience: input.audience },
      ...ctx,
    })
    return this.getById(actor, post.id)
  }

  // Состояние публикации при создании: DRAFT — сохранить без публикации; будущий scheduledAt —
  // отложить (крон опубликует); иначе — опубликовать сейчас (проставив publishedAt).
  private resolvePublishState(input: CreatePostInput): {
    status: string
    scheduledAt: Date | null
    publishedAt: Date | null
  } {
    if (input.status === 'DRAFT') return { status: 'DRAFT', scheduledAt: null, publishedAt: null }
    if (input.scheduledAt && input.scheduledAt.getTime() > Date.now()) {
      return { status: 'SCHEDULED', scheduledAt: input.scheduledAt, publishedAt: null }
    }
    return { status: 'PUBLISHED', scheduledAt: null, publishedAt: new Date() }
  }

  /** Крон: публикует отложенные посты, у которых наступило время (status SCHEDULED → PUBLISHED). */
  async publishDueScheduled(): Promise<number> {
    const res = await this.prisma.post.updateMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    })
    if (res.count > 0) this.logger.log(`Опубликовано отложенных постов: ${res.count}`)
    return res.count
  }

  // ── Репост (задача 8.6) ─────────────────────────────────────────────────────

  async repost(
    actor: JwtPayload,
    id: string,
    input: RepostInput,
    ctx: RequestContext,
  ): Promise<ViewerPost> {
    // Репостить можно только видимый пост — по видимости самого зрителя, без scope
    // модерации: право снимать пост не даёт права выносить его к новой аудитории.
    const original = await this.findVisibleOrThrow(actor, id, {
      id: true,
      originalPostId: true,
      audience: true,
      status: true,
    })
    // Личный пост адресован одному человеку: репост переопубликовал бы чужую переписку
    // на группу или факультет (docs/BACKEND_RULES.md §14.7). Видимости для этого мало.
    if (original.audience === PostAudience.PERSONAL) {
      throw new AppException('FORBIDDEN', 'Личный пост нельзя репостить')
    }
    // Черновик и отложенный видит только автор (visibilityWhere), но их текст уехал бы наружу
    // в цитате оригинала у опубликованного репоста.
    if (original.status !== 'PUBLISHED') {
      throw new AppException('BAD_REQUEST', 'Нельзя репостить неопубликованный пост')
    }
    // Репост репоста ссылается на первоисточник — и тот обязан быть доступен самому
    // репостящему: иначе через чужой репост можно сослаться на снятый модератором пост
    // или на пост аудитории, которой он сам не видит.
    if (original.originalPostId) {
      const source = await this.prisma.post.findFirst({
        where: { id: original.originalPostId, status: 'PUBLISHED', ...this.visibilityWhere(actor) },
        select: { id: true },
      })
      if (!source) throw new AppException('NOT_FOUND', 'Исходная публикация недоступна')
    }
    const originalPostId = original.originalPostId ?? original.id
    const target = await this.resolveTarget(actor, input.audience as PostAudience, input)
    const post = await this.prisma.post.create({
      data: {
        authorId: actor.sub,
        audience: input.audience as PostAudience,
        content: input.content ?? '',
        priority: this.priorityFor(actor, input.audience as PostAudience),
        originalPostId,
        ...target,
      },
      select: { id: true },
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'post_reposted',
      entity: 'Post',
      entityId: post.id,
      metadata: { originalPostId },
      ...ctx,
    })
    return this.getById(actor, post.id)
  }

  // ── Удаление (задача 8.5) — автор или модератор scope ──────────────────────

  /**
   * Правка своей публикации: только заголовок и текст.
   *
   * Модератору правка НЕ разрешена — в отличие от удаления: удалить нарушающий пост
   * он вправе, а переписать чужой текст от чужого имени — нет.
   */
  async update(
    actor: JwtPayload,
    id: string,
    input: UpdatePostInput,
    ctx: RequestContext,
  ): Promise<ViewerPost> {
    const post = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, authorId: true },
    })
    if (!post) {
      throw new AppException('NOT_FOUND', 'Пост не найден')
    }
    if (post.authorId !== actor.sub) {
      throw new AppException('FORBIDDEN', 'Редактировать можно только свою публикацию')
    }
    const data: Prisma.PostUpdateInput = {}
    if (input.title !== undefined) data.title = input.title?.trim() || null
    if (input.content !== undefined) data.content = input.content
    await this.prisma.post.update({ where: { id }, data })
    await this.audit.record({
      userId: actor.sub,
      action: 'post_updated',
      entity: 'Post',
      entityId: id,
      ...ctx,
    })
    return this.getById(actor, id)
  }

  /**
   * Публикация черновика: DRAFT → PUBLISHED. Отдельный метод, а не поле в `update`, потому что
   * правка текста и выход поста к читателям — разные события: их надо различать в аудите, и
   * право на них не обязано совпадать.
   *
   * Отложенный пост сюда не попадает: у него есть свой срок и крон (`publishDueScheduled`),
   * а досрочная публикация по кнопке «Опубликовать» противоречила бы выставленному времени.
   */
  async publish(actor: JwtPayload, id: string, ctx: RequestContext): Promise<ViewerPost> {
    const post = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, authorId: true, status: true },
    })
    if (!post) {
      throw new AppException('NOT_FOUND', 'Пост не найден')
    }
    if (post.authorId !== actor.sub) {
      throw new AppException('FORBIDDEN', 'Публиковать можно только свою публикацию')
    }
    if (post.status !== 'DRAFT') {
      throw new AppException('BAD_REQUEST', 'Опубликовать можно только черновик')
    }
    await this.prisma.post.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), scheduledAt: null },
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'post_published',
      entity: 'Post',
      entityId: id,
      ...ctx,
    })
    return this.getById(actor, id)
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const post = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: { ...POST_SCOPE_SELECT, author: { select: { role: true } } },
    })
    if (!post) {
      throw new AppException('NOT_FOUND', 'Пост не найден')
    }
    if (post.authorId !== actor.sub) {
      this.assertModerator(actor, post, post.author.role)
    }
    await this.prisma.post.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.record({
      userId: actor.sub,
      action: 'post_deleted',
      entity: 'Post',
      entityId: id,
      ...ctx,
    })
  }

  // ── Закрепление (задача 8.6) — роль строго выше автора ─────────────────────

  async setPinned(
    actor: JwtPayload,
    id: string,
    pinned: boolean,
    ctx: RequestContext,
  ): Promise<ViewerPost> {
    const post = await this.prisma.post.findFirst({
      where: { id, deletedAt: null },
      select: { ...POST_SCOPE_SELECT, author: { select: { role: true } } },
    })
    if (!post) {
      throw new AppException('NOT_FOUND', 'Пост не найден')
    }
    if (ROLE_RANK[actor.role] <= ROLE_RANK[post.author.role]) {
      throw new AppException('FORBIDDEN', 'Закреплять может только роль выше автора')
    }
    this.assertModerator(actor, post)
    await this.prisma.post.update({
      where: { id },
      data: { pinnedAt: pinned ? new Date() : null, pinnedById: pinned ? actor.sub : null },
    })
    await this.audit.record({
      userId: actor.sub,
      action: pinned ? 'post_pinned' : 'post_unpinned',
      entity: 'Post',
      entityId: id,
      ...ctx,
    })
    return this.getById(actor, id)
  }

  // ── Реакции (задача 8.5) ────────────────────────────────────────────────────

  async addReaction(actor: JwtPayload, id: string, input: ReactionInput): Promise<void> {
    await this.findVisibleOrThrow(actor, id, { id: true }, { moderation: true })
    // Идемпотентно: повтор той же реакции не создаёт дубликат (unique [postId,userId,emoji]).
    await this.prisma.reaction.upsert({
      where: { postId_userId_emoji: { postId: id, userId: actor.sub, emoji: input.emoji } },
      update: {},
      create: { postId: id, userId: actor.sub, emoji: input.emoji },
    })
  }

  async removeReaction(actor: JwtPayload, id: string, emoji: string): Promise<void> {
    await this.prisma.reaction.deleteMany({ where: { postId: id, userId: actor.sub, emoji } })
  }

  // ── Комментарии (задача 8.5) ────────────────────────────────────────────────

  async listComments(viewer: JwtPayload, id: string) {
    await this.findVisibleOrThrow(viewer, id, { id: true }, { moderation: true })
    return this.prisma.comment.findMany({
      where: { postId: id, deletedAt: null },
      select: COMMENT_SELECT,
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
  }

  async addComment(actor: JwtPayload, id: string, input: CreateCommentInput) {
    await this.findVisibleOrThrow(actor, id, { id: true }, { moderation: true })
    let parentId = input.parentId ?? null
    if (parentId) {
      const parent = await this.prisma.comment.findFirst({
        where: { id: parentId, postId: id, deletedAt: null },
        select: { id: true, parentId: true },
      })
      if (!parent) {
        throw new AppException('BAD_REQUEST', 'Родительский комментарий не найден в этом посте')
      }
      // Максимум один уровень вложенности: ответ на ответ прикрепляем к корню ветки.
      parentId = parent.parentId ?? parent.id
    }
    return this.prisma.comment.create({
      data: { postId: id, authorId: actor.sub, parentId, content: input.content },
      select: COMMENT_SELECT,
    })
  }

  async removeComment(
    actor: JwtPayload,
    id: string,
    commentId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, postId: id, deletedAt: null },
      select: {
        id: true,
        authorId: true,
        author: { select: { role: true } },
        post: { select: POST_SCOPE_SELECT },
      },
    })
    if (!comment) {
      throw new AppException('NOT_FOUND', 'Комментарий не найден')
    }
    if (comment.authorId !== actor.sub) {
      this.assertModerator(actor, comment.post, comment.author.role)
    }
    await this.prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } })
    await this.audit.record({
      userId: actor.sub,
      action: 'comment_deleted',
      entity: 'Comment',
      entityId: commentId,
      ...ctx,
    })
  }

  // ── Внутреннее ──────────────────────────────────────────────────────────────

  private priorityFor(actor: JwtPayload, audience: PostAudience): number {
    const base = AUDIENCE_PRIORITY[audience]
    // Посты сотрудников чуть выше студенческих в равной аудитории (docs/PROJECT.md §3.3).
    return base + (ROLE_RANK[actor.role] >= ROLE_RANK[Role.TEACHER] ? 2 : 0)
  }

  // Модерация поста: платформа — любой; админ/мод вуза — свой вуз; декан — свой факультет.
  // Чужой контент снимает только роль СТРОГО выше автора (если роль автора известна): иначе
  // модератор вуза удалял посты админа вуза, а декан — посты админа в ленте факультета.
  private assertModerator(
    actor: JwtPayload,
    post: { universityId: string | null; facultyId: string | null },
    authorRole?: Role,
  ): void {
    if (authorRole && !isHigherRole(actor.role, authorRole)) {
      throw new AppException('FORBIDDEN', 'Чужой контент снимает только роль выше автора')
    }
    if (isPlatform(actor.role)) return
    if (actor.role === Role.DEAN) {
      if (post.facultyId && post.facultyId === actor.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Пост другого факультета')
    }
    if (actor.role === Role.UNIVERSITY_ADMIN || actor.role === Role.UNIVERSITY_MODERATOR) {
      if (post.universityId && post.universityId === actor.universityId) return
      throw new AppException('WRONG_SCOPE', 'Пост другого университета')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  /** Проверяет аудиторию по роли и вычисляет scope-цель поста (защита от IDOR). */
  private async resolveTarget(
    actor: JwtPayload,
    audience: PostAudience,
    input: { facultyId?: string; groupId?: string; targetUserId?: string; subject?: string },
  ): Promise<PostTarget> {
    if (!ALLOWED_AUDIENCES[actor.role].includes(audience)) {
      throw new AppException('FORBIDDEN', 'Эта аудитория недоступна вашей роли')
    }
    switch (audience) {
      case PostAudience.ALL:
        return {}
      case PostAudience.UNIVERSITY:
      case PostAudience.TEACHERS:
        return { universityId: this.requireOwnUniversity(actor) }
      case PostAudience.FACULTY: {
        const facultyId = input.facultyId ?? actor.facultyId
        if (!facultyId) throw new AppException('BAD_REQUEST', 'Не указан факультет')
        const universityId = await this.assertFacultyInScope(actor, facultyId)
        return { facultyId, universityId }
      }
      case PostAudience.GROUP: {
        const groupId = input.groupId ?? actor.groupId
        if (!groupId) throw new AppException('BAD_REQUEST', 'Не указана группа')
        const scope = await this.assertGroupInScope(actor, groupId)
        return { groupId, facultyId: scope.facultyId, universityId: scope.universityId }
      }
      case PostAudience.SUBJECT: {
        if (!input.subject) throw new AppException('BAD_REQUEST', 'Не указан предмет')
        return { subject: input.subject, universityId: this.requireOwnUniversity(actor) }
      }
      case PostAudience.PERSONAL: {
        if (!input.targetUserId) throw new AppException('BAD_REQUEST', 'Не указан получатель')
        await this.assertTargetUser(actor, input.targetUserId)
        return { targetUserId: input.targetUserId }
      }
      default:
        throw new AppException('BAD_REQUEST', 'Неизвестная аудитория')
    }
  }

  private requireOwnUniversity(actor: JwtPayload): string {
    if (!actor.universityId) {
      throw new AppException('BAD_REQUEST', 'Пользователь не привязан к университету')
    }
    return actor.universityId
  }

  private async assertFacultyInScope(actor: JwtPayload, facultyId: string): Promise<string> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { universityId: true },
    })
    if (!faculty) throw new AppException('NOT_FOUND', 'Факультет не найден')
    if (isPlatform(actor.role)) return faculty.universityId
    if (actor.role === Role.DEAN) {
      if (actor.facultyId !== facultyId) throw new AppException('WRONG_SCOPE', 'Чужой факультет')
    } else if (faculty.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Факультет другого университета')
    }
    return faculty.universityId
  }

  private async assertGroupInScope(
    actor: JwtPayload,
    groupId: string,
  ): Promise<{ facultyId: string; universityId: string }> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { facultyId: true, faculty: { select: { universityId: true } } },
    })
    if (!group) throw new AppException('NOT_FOUND', 'Группа не найдена')
    const universityId = group.faculty.universityId
    if (isPlatform(actor.role)) return { facultyId: group.facultyId, universityId }
    if (actor.role === Role.STUDENT || actor.role === Role.STAROSTA) {
      if (actor.groupId !== groupId) throw new AppException('WRONG_SCOPE', 'Чужая группа')
    } else if (actor.role === Role.DEAN) {
      if (actor.facultyId !== group.facultyId)
        throw new AppException('WRONG_SCOPE', 'Чужой факультет')
    } else if (universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Группа другого университета')
    }
    return { facultyId: group.facultyId, universityId }
  }

  private async assertTargetUser(actor: JwtPayload, targetUserId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { universityId: true },
    })
    if (!user) throw new AppException('NOT_FOUND', 'Получатель не найден')
    if (!isPlatform(actor.role) && user.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Получатель из другого университета')
    }
  }

  /**
   * Привязка своих загруженных медиа к посту. Условие `postId: null` стоит в самом
   * updateMany: проверка отдельным чтением пропускала гонку, и один файл оказывался в двух
   * постах. Не привязались все — BAD_REQUEST, и транзакция создания откатывается.
   */
  private async linkMedia(
    tx: Prisma.TransactionClient,
    ownerId: string,
    postId: string,
    mediaIds: string[],
  ): Promise<void> {
    const ids = [...new Set(mediaIds)]
    const { count } = await tx.file.updateMany({
      where: {
        id: { in: ids },
        ownerId,
        bucket: this.config.get('MINIO_BUCKET_POSTS', { infer: true }),
        postId: null,
      },
      data: { postId },
    })
    if (count !== ids.length) {
      throw new AppException('BAD_REQUEST', 'Некоторые файлы недоступны для прикрепления')
    }
  }
}
