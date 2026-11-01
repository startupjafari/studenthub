import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, StoryAudience } from '@prisma/client'
import { Role, isHigherRole } from '@studenthub/shared-types'
import {
  STORY_IMAGE_MIMES,
  STORY_REACTION_EMOJIS,
  STORY_TTL_HOURS,
  STORY_VIDEO_MIMES,
  StoryElementSchema,
  type CreateStoryInput,
  type StoryElementInput,
  type StoriesFeedQueryInput,
  type StoryReactionInput,
  type StoryViewersQueryInput,
  type StoryVoteInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { FileService } from '../files/file.service'
import { MediaService } from '../media/media.service'
import { MEDIA_FILE_SELECT, type MediaInfo } from '../media/media.types'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import type { EnvVars } from '../../config/env.schema'

// Кто какую аудиторию может выбрать (docs/PROJECT.md §2.2, строка «Сторисы — создание»).
// Набор повторяет посты минус PERSONAL/SUBJECT, которых у сторис нет: модераторы контент
// не создают, работодатель публикуется только вакансиями.
const ALLOWED_AUDIENCES: Record<Role, StoryAudience[]> = {
  [Role.PLATFORM_ADMIN]: [StoryAudience.ALL],
  [Role.PLATFORM_MODERATOR]: [],
  [Role.UNIVERSITY_ADMIN]: [
    StoryAudience.UNIVERSITY,
    StoryAudience.FACULTY,
    StoryAudience.GROUP,
    StoryAudience.TEACHERS,
  ],
  [Role.UNIVERSITY_MODERATOR]: [],
  [Role.DEAN]: [StoryAudience.FACULTY, StoryAudience.GROUP],
  [Role.TEACHER]: [StoryAudience.GROUP],
  [Role.STAROSTA]: [StoryAudience.GROUP],
  [Role.STUDENT]: [StoryAudience.GROUP],
  [Role.EMPLOYER]: [],
  [Role.SECURITY_GUARD]: [],
  [Role.LIBRARIAN]: [],
}

// Потолок выдачи ленты колец. Это не пагинация, а предохранитель (BACKEND_RULES §5.3):
// живых сторис за сутки в одном вузе столько не бывает, но findMany без take запрещён.
const FEED_TAKE = 200
// Потолки служебных выборок на запрос: блокировки и скрытые авторы смотрящего.
const BLOCKS_TAKE = 1000
const MUTES_TAKE = 1000

// Размер батча удаления в кроне (как BATCH_SIZE в CleanupService).
const CLEANUP_BATCH = 500

// Реакции из белого списка (StoryReactionSchema). Строки с произвольным текстом, поставленные
// до списка, в сводке не считаются — как у постов; через сутки они уходят вместе со сторис.
const REACTION_EMOJI_WHERE = { emoji: { in: [...STORY_REACTION_EMOJIS] } }

const AUTHOR_SELECT = {
  select: { id: true, firstName: true, lastName: true, role: true, avatarUrl: true },
}

const STORY_SELECT = {
  id: true,
  authorId: true,
  audience: true,
  universityId: true,
  facultyId: true,
  groupId: true,
  text: true,
  background: true,
  linkUrl: true,
  linkLabel: true,
  elements: true,
  expiresAt: true,
  createdAt: true,
  author: AUTHOR_SELECT,
  // Вместе с вариантами медиа-системы: заглушка, srcset, постер и HLS собираются без N+1.
  file: { select: MEDIA_FILE_SELECT },
  poll: {
    select: {
      id: true,
      question: true,
      options: { select: { id: true, text: true, order: true }, orderBy: { order: 'asc' } },
    },
  },
} satisfies Prisma.StorySelect

// Поля для проверки прав на удаление — без тяжёлых relation'ов.
const STORY_SCOPE_SELECT = {
  id: true,
  authorId: true,
  fileId: true,
  universityId: true,
  facultyId: true,
  author: { select: { role: true } },
} satisfies Prisma.StorySelect

type StoryRow = Prisma.StoryGetPayload<{ select: typeof STORY_SELECT }>

/**
 * Элемент кадра в выдаче. У упоминания — имя: хранится только userId, имя берётся при
 * выдаче (переименование видно сразу), удалённый или заблокированный человек пропадает.
 */
export type StoryElementView =
  | Exclude<StoryElementInput, { type: 'mention' }>
  | (Extract<StoryElementInput, { type: 'mention' }> & { name: string })

/** Элементы из JSON-колонки: то, что не проходит схему (старый клиент, ручная правка), отбрасывается. */
function parseElements(raw: Prisma.JsonValue | null): StoryElementInput[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const parsed = StoryElementSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

/** Ид упомянутых — без повторов: один человек может стоять на кадре дважды. */
function mentionIds(elements: readonly StoryElementInput[]): string[] {
  return [...new Set(elements.flatMap((e) => (e.type === 'mention' ? [e.userId] : [])))]
}

/** Кто видит сторис с такой аудиторией — то же правило, что visibilityWhere, для одной записи. */
export function audienceIncludes(
  user: {
    id: string
    role: Role
    universityId: string | null
    facultyId: string | null
    groupId: string | null
  },
  story: {
    authorId: string
    audience: StoryAudience
    universityId?: string | null
    facultyId?: string | null
    groupId?: string | null
  },
): boolean {
  if (story.authorId === user.id) return true
  switch (story.audience) {
    case StoryAudience.ALL:
      return true
    case StoryAudience.UNIVERSITY:
      return !!user.universityId && user.universityId === story.universityId
    case StoryAudience.TEACHERS:
      return (
        user.role === Role.TEACHER &&
        !!user.universityId &&
        user.universityId === story.universityId
      )
    case StoryAudience.FACULTY:
      return !!user.facultyId && user.facultyId === story.facultyId
    case StoryAudience.GROUP:
      return !!user.groupId && user.groupId === story.groupId
    default:
      return false
  }
}

/** Сторис глазами конкретного зрителя: агрегаты и личные признаки считаются на сервере. */
export interface StoryCard {
  id: string
  audience: StoryAudience
  text: string | null
  background: string | null
  linkUrl: string | null
  linkLabel: string | null
  /** Тексты, эмодзи и упоминания поверх кадра (редактор §3.4). */
  elements: StoryElementView[]
  createdAt: Date
  expiresAt: Date
  author: StoryRow['author']
  /**
   * Presigned-ссылка живёт 15 минут (BACKEND_RULES §8); у текстовой сторис медиа нет.
   * Поля описания медиа (заглушка, srcset, постер, HLS) — рядом с `url`.
   */
  media:
    | (MediaInfo & {
        id: string
        mime: string
        url: string
      })
    | null
  poll: {
    id: string
    question: string
    options: { id: string; text: string; order: number; votes: number }[]
    totalVotes: number
    myOptionId: string | null
  } | null
  reactions: { emoji: string; count: number; mine: boolean }[]
  /** Смотрел ли сторис сам зритель — по этому признаку лента рисует кольцо. */
  seen: boolean
  /** Число просмотров. Только автору: кто смотрел — его дело, а не зрителей (§14.7). */
  viewsCount: number | null
  canDelete: boolean
}

/** Кольцо в ленте: автор и его живые сторисы по возрастанию времени. */
export interface StoryRing {
  author: StoryRow['author']
  stories: StoryCard[]
  hasUnseen: boolean
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly files: FileService,
    private readonly media: MediaService,
    private readonly queue: QueueService,
  ) {}

  /** Медиа сторис для клиента: файл, ссылка на оригинал и описание вариантов. */
  private storyMedia(
    file: NonNullable<StoryRow['file']>,
    url: string,
    described: Map<string, MediaInfo>,
  ): NonNullable<StoryCard['media']> {
    const info = described.get(file.id)
    return {
      status: info?.status ?? file.mediaStatus,
      placeholder: info?.placeholder ?? file.placeholder,
      width: file.width,
      height: file.height,
      durationMs: info?.durationMs ?? file.durationMs,
      sources: info?.sources ?? [],
      poster: info?.poster ?? [],
      hls: info?.hls ?? null,
      expiresAt: info?.expiresAt ?? null,
      id: file.id,
      mime: file.mime,
      url,
    }
  }

  // ── Видимость ───────────────────────────────────────────────────────────────

  /**
   * Зритель видит живые (`expiresAt > now`) сторисы: ALL + свои + свой вуз
   * (UNIVERSITY, а TEACHERS — только преподавателю) + свой факультет + свою группу.
   * Истёкшие не видны никому, даже автору: сутки прошли — сторис больше нет, а крон
   * лишь убирает строку, которая уже перестала существовать для продукта.
   */
  private visibilityWhere(viewer: JwtPayload): Prisma.StoryWhereInput {
    const or: Prisma.StoryWhereInput[] = [{ audience: StoryAudience.ALL }, { authorId: viewer.sub }]
    if (viewer.universityId) {
      or.push({ audience: StoryAudience.UNIVERSITY, universityId: viewer.universityId })
      if (viewer.role === Role.TEACHER) {
        or.push({ audience: StoryAudience.TEACHERS, universityId: viewer.universityId })
      }
    }
    if (viewer.facultyId) {
      or.push({ audience: StoryAudience.FACULTY, facultyId: viewer.facultyId })
    }
    if (viewer.groupId) {
      or.push({ audience: StoryAudience.GROUP, groupId: viewer.groupId })
    }
    return { expiresAt: { gt: new Date() }, OR: or }
  }

  /**
   * Авторы, чьи сторисы смотрящему не показываются: блокировка в любую сторону. Сторисы
   * раньше блокировок не знали вовсе — заблокированный продолжал видеть сторис того, кто
   * его заблокировал. Список читается раз на запрос; в `where` уходит `notIn`, потому что
   * у UserBlock нет отношений, по которым Prisma построила бы фильтр.
   */
  private async blockedAuthorIds(viewerId: string): Promise<string[]> {
    const rows = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
      take: BLOCKS_TAKE,
    })
    return rows.map((r) => (r.blockerId === viewerId ? r.blockedId : r.blockerId))
  }

  /** Видимость по аудитории плюс блокировки (см. visibilityWhere и blockedAuthorIds). */
  private async visibleWhere(viewer: JwtPayload): Promise<Prisma.StoryWhereInput> {
    const blocked = await this.blockedAuthorIds(viewer.sub)
    const base = this.visibilityWhere(viewer)
    return blocked.length > 0 ? { AND: [base, { authorId: { notIn: blocked } }] } : base
  }

  private async findVisibleOrThrow<S extends Prisma.StorySelect>(
    viewer: JwtPayload,
    id: string,
    select: S,
  ): Promise<Prisma.StoryGetPayload<{ select: S }>> {
    const story = await this.prisma.story.findFirst({
      where: { AND: [{ id }, await this.visibleWhere(viewer)] },
      select,
    })
    if (!story) {
      throw new AppException('NOT_FOUND', 'Сторис не найдена')
    }
    return story as Prisma.StoryGetPayload<{ select: S }>
  }

  /**
   * Бросает NOT_FOUND, если сторис не видна зрителю; видна — возвращает автора. Нужна
   * жалобам (пожаловаться можно только на то, что видишь, иначе жалоба подтверждает
   * существование чужой сторис по id) и чатам — перед ответом на сторис и пересылкой.
   */
  async assertVisibleToViewer(viewer: JwtPayload, id: string): Promise<{ authorId: string }> {
    return this.findVisibleOrThrow(viewer, id, { authorId: true })
  }

  // ── Лента колец ─────────────────────────────────────────────────────────────

  async feed(viewer: JwtPayload, query: StoriesFeedQueryInput): Promise<StoryRing[]> {
    const visible = await this.visibleWhere(viewer)
    // Скрытые авторы уходят только из ленты колец: в их профиле сторисы остаются видны —
    // скрытие убирает шум из ленты, а не закрывает доступ.
    let where: Prisma.StoryWhereInput = visible
    if (query.authorId) {
      where = { AND: [{ authorId: query.authorId }, visible] }
    } else {
      const muted = await this.mutedAuthorIds(viewer.sub)
      if (muted.length > 0) where = { AND: [visible, { authorId: { notIn: muted } }] }
    }
    const rows = await this.prisma.story.findMany({
      where,
      select: STORY_SELECT,
      // Свежие первыми: потолок обязан отрезать старое, а не новое. Внутри кольца
      // порядок обратный (toRings), потому что смотрят сторисы от ранней к поздней.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FEED_TAKE,
    })
    const cards = await this.decorate(viewer, rows)
    return this.toRings(viewer, cards)
  }

  async getById(viewer: JwtPayload, id: string): Promise<StoryCard> {
    const story = await this.findVisibleOrThrow(viewer, id, STORY_SELECT)
    const [card] = await this.decorate(viewer, [story])
    return card as StoryCard
  }

  /**
   * Дописывает странице личные признаки зрителя и агрегаты: просмотры, реакции, голоса.
   *
   * Всё считается запросами по списку id, а не отношением в `select`. Отношение вернуло бы
   * ВСЕ реакции и ВСЕ голоса каждой сторис целиком — на популярной это тысячи строк ради
   * одного числа на экране, — а заодно отдало бы наружу, кто именно реагировал.
   */
  private async decorate(viewer: JwtPayload, rows: StoryRow[]): Promise<StoryCard[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const myIds = rows.filter((row) => row.authorId === viewer.sub).map((row) => row.id)
    const pollIds = rows.flatMap((row) => (row.poll ? [row.poll.id] : []))
    const fileIds = rows.flatMap((row) => (row.file ? [row.file.id] : []))
    const elementsByStory = new Map(rows.map((row) => [row.id, parseElements(row.elements)]))
    const names = await this.mentionNames(viewer, [
      ...new Set([...elementsByStory.values()].flatMap(mentionIds)),
    ])

    const [seen, viewCounts, reactionCounts, myReactions, voteCounts, myVotes, urls, described] =
      await Promise.all([
        this.prisma.storyView.findMany({
          where: { userId: viewer.sub, storyId: { in: ids } },
          select: { storyId: true },
          take: ids.length,
        }),
        myIds.length > 0
          ? this.prisma.storyView.groupBy({
              by: ['storyId'],
              where: { storyId: { in: myIds } },
              _count: { _all: true },
            })
          : Promise.resolve([]),
        this.prisma.storyReaction.groupBy({
          by: ['storyId', 'emoji'],
          where: { storyId: { in: ids }, ...REACTION_EMOJI_WHERE },
          _count: { _all: true },
        }),
        this.prisma.storyReaction.findMany({
          where: { userId: viewer.sub, storyId: { in: ids }, ...REACTION_EMOJI_WHERE },
          select: { storyId: true, emoji: true },
          // Уникальность [storyId, userId, emoji] и белый список дают точный потолок: раньше
          // стояло «4 на сторис», и пятая своя реакция приходила с mine: false.
          take: ids.length * STORY_REACTION_EMOJIS.length,
        }),
        pollIds.length > 0
          ? this.prisma.storyPollVote.groupBy({
              by: ['optionId'],
              where: { pollId: { in: pollIds } },
              _count: { _all: true },
            })
          : Promise.resolve([]),
        pollIds.length > 0
          ? this.prisma.storyPollVote.findMany({
              where: { userId: viewer.sub, pollId: { in: pollIds } },
              select: { pollId: true, optionId: true },
              take: pollIds.length,
            })
          : Promise.resolve([]),
        this.files.getPresignedUrls(fileIds),
        this.media.describe(rows.flatMap((row) => (row.file ? [row.file] : []))),
      ])

    const seenIds = new Set(seen.map((row) => row.storyId))
    const viewsByStory = new Map(viewCounts.map((row) => [row.storyId, row._count._all]))
    const mineByStory = new Set(myReactions.map((row) => `${row.storyId}:${row.emoji}`))
    const votesByOption = new Map(voteCounts.map((row) => [row.optionId, row._count._all]))
    const myVoteByPoll = new Map(myVotes.map((row) => [row.pollId, row.optionId]))
    const reactionsByStory = new Map<string, { emoji: string; count: number; mine: boolean }[]>()
    for (const row of reactionCounts) {
      const list = reactionsByStory.get(row.storyId) ?? []
      list.push({
        emoji: row.emoji,
        count: row._count._all,
        mine: mineByStory.has(`${row.storyId}:${row.emoji}`),
      })
      reactionsByStory.set(row.storyId, list)
    }

    return rows.map((row) => {
      const url = row.file ? urls.get(row.file.id) : undefined
      const options = (row.poll?.options ?? []).map((option) => ({
        ...option,
        votes: votesByOption.get(option.id) ?? 0,
      }))
      return {
        id: row.id,
        audience: row.audience,
        text: row.text,
        background: row.background,
        linkUrl: row.linkUrl,
        linkLabel: row.linkLabel,
        elements: (elementsByStory.get(row.id) ?? []).flatMap((e): StoryElementView[] => {
          if (e.type !== 'mention') return [e]
          const name = names.get(e.userId)
          return name ? [{ ...e, name }] : []
        }),
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        author: row.author,
        // Файл мог исчезнуть между выборкой и подписью — тогда это текстовая сторис,
        // а не битая картинка: ссылки, ведущей в никуда, клиент не получит.
        media: row.file && url ? this.storyMedia(row.file, url, described) : null,
        poll: row.poll
          ? {
              id: row.poll.id,
              question: row.poll.question,
              options,
              totalVotes: options.reduce((sum, option) => sum + option.votes, 0),
              myOptionId: myVoteByPoll.get(row.poll.id) ?? null,
            }
          : null,
        reactions: reactionsByStory.get(row.id) ?? [],
        seen: seenIds.has(row.id),
        viewsCount: row.authorId === viewer.sub ? (viewsByStory.get(row.id) ?? 0) : null,
        canDelete: row.authorId === viewer.sub || this.canModerate(viewer, row, row.author.role),
      }
    })
  }

  /**
   * Имена упомянутых для подписи на кадре. Удалённые и заблокированные (в любую сторону со
   * зрителем) не подписываются — их упоминание на кадре просто не рисуется.
   */
  private async mentionNames(viewer: JwtPayload, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const blocked = new Set(await this.blockedAuthorIds(viewer.sub))
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids.filter((id) => !blocked.has(id)) }, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      take: ids.length,
    })
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]))
  }

  /**
   * Группирует сторисы по авторам в порядке показа: сначала свои (чтобы было видно, что
   * выложил сам), затем непросмотренные кольца, затем просмотренные — внутри каждой
   * части по свежести последней сторис.
   */
  private toRings(viewer: JwtPayload, cards: StoryCard[]): StoryRing[] {
    const byAuthor = new Map<string, StoryRing>()
    for (const card of cards) {
      const ring = byAuthor.get(card.author.id) ?? {
        author: card.author,
        stories: [],
        hasUnseen: false,
      }
      ring.stories.push(card)
      ring.hasUnseen ||= !card.seen
      byAuthor.set(card.author.id, ring)
    }
    // Выборка пришла свежими вперёд (так режет потолок), а смотрят от ранней к поздней.
    for (const ring of byAuthor.values()) {
      ring.stories.reverse()
    }
    const rank = (ring: StoryRing): number => {
      if (ring.author.id === viewer.sub) return 0
      return ring.hasUnseen ? 1 : 2
    }
    const lastAt = (ring: StoryRing): number =>
      ring.stories[ring.stories.length - 1]?.createdAt.getTime() ?? 0
    return [...byAuthor.values()].sort(
      (a, b) =>
        rank(a) - rank(b) || lastAt(b) - lastAt(a) || a.author.id.localeCompare(b.author.id),
    )
  }

  // ── Создание ────────────────────────────────────────────────────────────────

  async create(
    actor: JwtPayload,
    input: CreateStoryInput,
    ctx: RequestContext,
  ): Promise<StoryCard> {
    const audience = input.audience as StoryAudience
    const target = await this.resolveTarget(actor, audience, input)
    if (input.fileId) await this.assertOwnMedia(actor.sub, input.fileId)
    const elements = input.elements ?? []
    const mentioned = mentionIds(elements).filter((id) => id !== actor.sub)
    await this.assertMentionable(actor, audience, target, mentioned)
    const expiresAt = new Date(Date.now() + STORY_TTL_HOURS * 60 * 60 * 1000)

    const created = await this.prisma.$transaction(async (tx) => {
      // Занятость файла — под локом файла и в той же транзакции, что и вставка: проверка
      // снаружи пропускала два одновременных POST с одним fileId (оба видели «свободен»),
      // и удаление первой сторис гасило медиа второй. Второй запрос ждёт лок, видит
      // закоммиченную первую сторис и получает CONFLICT. Уникального индекса на fileId нет —
      // лок заменяет его без миграции.
      if (input.fileId) {
        await advisoryXactLock(tx, `story-file:${input.fileId}`)
        const used = await tx.story.count({ where: { fileId: input.fileId } })
        if (used > 0) {
          throw new AppException('CONFLICT', 'Файл уже прикреплён к другой сторис')
        }
      }
      const story = await tx.story.create({
        data: {
          authorId: actor.sub,
          audience,
          fileId: input.fileId ?? null,
          text: input.text ?? null,
          background: input.background ?? null,
          linkUrl: input.linkUrl ?? null,
          linkLabel: input.linkLabel ?? null,
          ...(elements.length > 0 ? { elements: elements as Prisma.InputJsonValue } : {}),
          expiresAt,
          ...target,
        },
        select: { id: true },
      })
      // Опрос создаётся в той же транзакции: сторис с вопросом и без вариантов —
      // сломанный экран, а не «почти готовая» запись.
      if (input.poll) {
        await tx.storyPoll.create({
          data: {
            storyId: story.id,
            question: input.poll.question,
            options: {
              create: input.poll.options.map((text, index) => ({ text, order: index })),
            },
          },
        })
      }
      return story
    })

    await this.audit.record({
      userId: actor.sub,
      action: 'story_created',
      entity: 'Story',
      entityId: created.id,
      metadata: { audience },
      ...ctx,
    })
    await this.notifyMentioned(actor, created.id, mentioned)
    return this.getById(actor, created.id)
  }

  // ── Просмотр, реакции, голос ────────────────────────────────────────────────

  /**
   * Отмечает сторис просмотренной. Идемпотентно: повторный показ не меняет момент
   * первого просмотра — иначе список зрителей у автора переставлялся бы сам собой.
   * Свой просмотр не пишется: автор не зритель собственной сторис.
   */
  async markViewed(viewer: JwtPayload, id: string): Promise<{ seen: true }> {
    const story = await this.findVisibleOrThrow(viewer, id, { id: true, authorId: true })
    if (story.authorId === viewer.sub) return { seen: true }
    await this.prisma.storyView.upsert({
      where: { storyId_userId: { storyId: id, userId: viewer.sub } },
      update: {},
      create: { storyId: id, userId: viewer.sub },
    })
    return { seen: true }
  }

  async addReaction(actor: JwtPayload, id: string, input: StoryReactionInput): Promise<void> {
    await this.findVisibleOrThrow(actor, id, { id: true })
    await this.prisma.storyReaction.upsert({
      where: { storyId_userId_emoji: { storyId: id, userId: actor.sub, emoji: input.emoji } },
      update: {},
      create: { storyId: id, userId: actor.sub, emoji: input.emoji },
    })
  }

  async removeReaction(actor: JwtPayload, id: string, emoji: string): Promise<void> {
    await this.prisma.storyReaction.deleteMany({ where: { storyId: id, userId: actor.sub, emoji } })
  }

  /**
   * Голос в опросе. Выбор одиночный, поэтому повторный голос ПЕРЕЗАПИСЫВАЕТ прежний
   * (unique [pollId, userId]): переголосовать в сторис можно, пока она жива.
   */
  async vote(actor: JwtPayload, id: string, input: StoryVoteInput): Promise<StoryCard> {
    const story = await this.findVisibleOrThrow(actor, id, {
      id: true,
      poll: { select: { id: true, options: { select: { id: true } } } },
    })
    if (!story.poll) {
      throw new AppException('BAD_REQUEST', 'В этой сторис нет опроса')
    }
    if (!story.poll.options.some((option) => option.id === input.optionId)) {
      throw new AppException('BAD_REQUEST', 'Вариант не принадлежит этому опросу')
    }
    await this.prisma.storyPollVote.upsert({
      where: { pollId_userId: { pollId: story.poll.id, userId: actor.sub } },
      update: { optionId: input.optionId },
      create: { pollId: story.poll.id, optionId: input.optionId, userId: actor.sub },
    })
    return this.getById(actor, id)
  }

  /** Список зрителей — только автору сторис (§14.7): кто смотрел, видит лишь он. */
  // ── Для чатов: ответ на сторис и пересылка ─────────────────────────────────

  /**
   * Видна ли сторис другому человеку — получателю пересылки. Права берутся из его записи,
   * а не из токена отправителя: иначе пересылка открывала бы сторис вне её аудитории.
   */
  async isVisibleToUser(userId: string, id: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isBlocked: false },
      select: { id: true, role: true, universityId: true, facultyId: true, groupId: true },
    })
    if (!user) return false
    const viewer: JwtPayload = {
      sub: user.id,
      role: user.role as Role,
      universityId: user.universityId,
      facultyId: user.facultyId,
      groupId: user.groupId,
    }
    const story = await this.prisma.story.findFirst({
      where: { AND: [{ id }, await this.visibleWhere(viewer)] },
      select: { id: true },
    })
    return story !== null
  }

  // ── Скрытие сторис пользователя ─────────────────────────────────────────────

  private async mutedAuthorIds(viewerId: string): Promise<string[]> {
    const rows = await this.prisma.storyMute.findMany({
      where: { userId: viewerId },
      select: { mutedUserId: true },
      take: MUTES_TAKE,
    })
    return rows.map((r) => r.mutedUserId)
  }

  /** Скрыть сторис автора из ленты колец. Повтор — та же строка, ответ тот же. */
  async mute(viewer: JwtPayload, authorId: string): Promise<void> {
    if (authorId === viewer.sub) {
      throw new AppException('BAD_REQUEST', 'Свои сторисы скрыть нельзя')
    }
    const author = await this.prisma.user.findFirst({
      where: { id: authorId, deletedAt: null },
      select: { id: true },
    })
    if (!author) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    await this.prisma.storyMute.upsert({
      where: { userId_mutedUserId: { userId: viewer.sub, mutedUserId: authorId } },
      create: { userId: viewer.sub, mutedUserId: authorId },
      update: {},
    })
  }

  /** Вернуть сторис автора в ленту. Нечего возвращать — тоже успех. */
  async unmute(viewer: JwtPayload, authorId: string): Promise<void> {
    await this.prisma.storyMute.deleteMany({
      where: { userId: viewer.sub, mutedUserId: authorId },
    })
  }

  async viewers(actor: JwtPayload, id: string, query: StoryViewersQueryInput) {
    const story = await this.findVisibleOrThrow(actor, id, { id: true, authorId: true })
    if (story.authorId !== actor.sub) {
      throw new AppException('FORBIDDEN', 'Список зрителей видит только автор')
    }
    const rows = await this.prisma.storyView.findMany({
      where: { storyId: id },
      select: { id: true, createdAt: true, user: AUTHOR_SELECT },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = rows.length > query.limit
    const page = hasNext ? rows.slice(0, query.limit) : rows
    // Реакции зрителей страницы — одним запросом: автор видит, кто как отреагировал.
    const reactions = page.length
      ? await this.prisma.storyReaction.findMany({
          where: { storyId: id, userId: { in: page.map((r) => r.user.id) } },
          select: { userId: true, emoji: true },
          orderBy: { createdAt: 'asc' },
          // Не больше одной реакции каждого эмодзи от зрителя (уникальный индекс).
          take: page.length * STORY_REACTION_EMOJIS.length,
        })
      : []
    const byUser = new Map<string, string[]>()
    for (const r of reactions) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.emoji])
    return new Paginated(
      page.map((r) => ({ ...r, reactions: byUser.get(r.user.id) ?? [] })),
      { cursor: hasNext ? page[page.length - 1]?.id : undefined, hasNext },
    )
  }

  // ── Удаление ────────────────────────────────────────────────────────────────

  /**
   * Удаление автором или модератором scope (docs/PROJECT.md §2.2, «Сторисы — удаление
   * чужих»). Физическое: мягкого удаления у модели нет, а каскад снимает опрос,
   * просмотры и реакции. Медиа уходит следом — объект без сторис никому не принадлежит.
   */
  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const story = await this.prisma.story.findUnique({ where: { id }, select: STORY_SCOPE_SELECT })
    if (!story) {
      throw new AppException('NOT_FOUND', 'Сторис не найдена')
    }
    if (story.authorId !== actor.sub) {
      this.assertModerator(actor, story, story.author.role)
    }
    await this.prisma.story.delete({ where: { id } })
    if (story.fileId) await this.deleteMedia(story.fileId)
    await this.audit.record({
      userId: actor.sub,
      action: 'story_deleted',
      entity: 'Story',
      entityId: id,
      ...ctx,
    })
  }

  /**
   * Снос сторис по решению модератора (ComplaintsService): права на решение проверены
   * там, здесь только исполнение. Исчезнувшая к этому моменту сторис — не ошибка:
   * жалобу разбирают и после того, как автор удалил контент сам.
   */
  async removeByModeration(id: string): Promise<void> {
    const story = await this.prisma.story.findUnique({ where: { id }, select: { fileId: true } })
    if (!story) return
    await this.prisma.story.delete({ where: { id } })
    if (story.fileId) await this.deleteMedia(story.fileId)
    this.logger.log(`Сторис ${id} удалена по решению модерации`)
  }

  /**
   * Крон `deleteExpiredStories` (каждые 30 минут, BACKEND_RULES §9.3): удаляет
   * истёкшие сторисы батчами вместе с медиа. TTL бакета `stories-media` снимает сами
   * объекты и без нас, но записи File и Story убрать может только эта задача.
   */
  async deleteExpired(): Promise<number> {
    const now = new Date()
    let total = 0
    for (;;) {
      const batch = await this.prisma.story.findMany({
        where: { expiresAt: { lte: now } },
        select: { id: true, fileId: true },
        take: CLEANUP_BATCH,
      })
      if (batch.length === 0) break
      const { count } = await this.prisma.story.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      })
      total += count
      for (const row of batch) {
        if (row.fileId) await this.deleteMedia(row.fileId)
      }
      if (batch.length < CLEANUP_BATCH) break
    }
    if (total > 0) this.logger.log(`deleteExpiredStories: удалено сторис ${total}`)
    return total
  }

  // ── Внутреннее ──────────────────────────────────────────────────────────────

  /**
   * Снос медиа отдельной операцией, а не каскадом: объект в MinIO удаляет FileService,
   * и он же считает оставшиеся ссылки. Ошибка здесь не отменяет удаление сторис —
   * забытый объект уберёт ночная чистка сирот, а воскресшая сторис не уберётся никак.
   */
  private async deleteMedia(fileId: string): Promise<void> {
    try {
      await this.files.delete(fileId)
    } catch (error) {
      this.logger.error(
        `Не удалось удалить медиа сторис ${fileId}: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`,
      )
    }
  }

  /** Модерация сторис: платформа — любую; админ/мод вуза — свой вуз; декан — свой факультет. */
  // Чужую сторис снимает только роль СТРОГО выше автора — как посты (posts.service).
  private canModerate(
    actor: JwtPayload,
    story: { universityId: string | null; facultyId: string | null },
    authorRole: Role,
  ): boolean {
    if (!isHigherRole(actor.role, authorRole)) return false
    if (isPlatform(actor.role)) return true
    if (actor.role === Role.DEAN) {
      return Boolean(story.facultyId) && story.facultyId === actor.facultyId
    }
    if (actor.role === Role.UNIVERSITY_ADMIN || actor.role === Role.UNIVERSITY_MODERATOR) {
      return Boolean(story.universityId) && story.universityId === actor.universityId
    }
    return false
  }

  private assertModerator(
    actor: JwtPayload,
    story: { universityId: string | null; facultyId: string | null },
    authorRole: Role,
  ): void {
    if (this.canModerate(actor, story, authorRole)) return
    if (!isHigherRole(actor.role, authorRole)) {
      throw new AppException('FORBIDDEN', 'Чужой контент снимает только роль выше автора')
    }
    if (
      actor.role === Role.DEAN ||
      actor.role === Role.UNIVERSITY_ADMIN ||
      actor.role === Role.UNIVERSITY_MODERATOR
    ) {
      throw new AppException('WRONG_SCOPE', 'Сторис вне вашего scope')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  /**
   * Медиа обязано принадлежать автору и лежать в бакете сторис. Что файл не занят другой
   * сторис, проверяет `create` — под локом, в транзакции вставки: это важно не для порядка,
   * а для удаления — на один объект ссылались бы две записи, и снос первой погасил бы
   * картинку у второй.
   */
  /**
   * Отметить на кадре можно только того, кто эту сторис увидит, и с кем нет блокировки ни в
   * одну сторону: иначе упоминание было бы уведомлением о сторис, которую человеку не
   * откроют, или способом писать тому, кто закрылся. Удалённые и заблокированные платформой —
   * тоже нет. Ошибка — одна на весь список: какой именно человек не подходит, не сообщаем.
   */
  private async assertMentionable(
    actor: JwtPayload,
    audience: StoryAudience,
    target: { universityId?: string; facultyId?: string; groupId?: string },
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return
    const [users, blocks] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids }, deletedAt: null, isBlocked: false },
        select: { id: true, role: true, universityId: true, facultyId: true, groupId: true },
        take: ids.length,
      }),
      this.prisma.userBlock.findMany({
        where: {
          OR: [
            { blockerId: actor.sub, blockedId: { in: ids } },
            { blockedId: actor.sub, blockerId: { in: ids } },
          ],
        },
        select: { id: true },
        take: 1,
      }),
    ])
    const story = { authorId: actor.sub, audience, ...target }
    const ok =
      blocks.length === 0 &&
      users.length === ids.length &&
      users.every((u) => audienceIncludes({ ...u, role: u.role as Role }, story))
    if (!ok) {
      throw new AppException('BAD_REQUEST', 'Отметить можно только тех, кто увидит сторис', [
        { field: 'elements', message: 'Отметка недоступна' },
      ])
    }
  }

  /** Уведомить отмеченных. Сбой очереди не отменяет публикацию: сторис уже вышла. */
  private async notifyMentioned(actor: JwtPayload, storyId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    try {
      const author = await this.prisma.user.findUnique({
        where: { id: actor.sub },
        select: { firstName: true, lastName: true },
      })
      const dedupeKey = `story-mention:${storyId}`
      await this.queue.enqueue(
        QUEUES.NOTIFICATIONS,
        NOTIFICATION_JOBS.STORY_MENTION,
        {
          recipientIds: ids,
          type: 'POST',
          titleKey: 'stories.mention.title',
          bodyKey: 'stories.mention.body',
          params: { name: `${author?.firstName ?? ''} ${author?.lastName ?? ''}`.trim() },
          data: { storyId, url: `/stories/${storyId}` },
          dedupeKey,
        },
        { jobId: dedupeKey },
      )
    } catch (error) {
      this.logger.warn({ err: error, storyId }, 'Уведомление об отметке в сторис не поставлено')
    }
  }

  /**
   * Медиа сторис: свой файл из бакета сторис, допустимый формат и размер. Длительность видео
   * сверяется, если обработка её уже узнала; свежую загрузку ограничивает клиент.
   */
  private async assertOwnMedia(ownerId: string, fileId: string): Promise<void> {
    const bucket = this.config.get('MINIO_BUCKET_STORIES', { infer: true })
    // Таблица File принадлежит модулю files (§2.1) — читаем её через его сервис.
    const file = await this.files.findOrThrow(fileId)
    if (file.ownerId !== ownerId || file.bucket !== bucket) {
      throw new AppException('BAD_REQUEST', 'Файл недоступен для прикрепления')
    }
    const image = (STORY_IMAGE_MIMES as readonly string[]).includes(file.mime)
    const video = (STORY_VIDEO_MIMES as readonly string[]).includes(file.mime)
    if (!image && !video) {
      throw new AppException('BAD_REQUEST', 'Формат файла не подходит для сторис')
    }
    const maxMb = this.config.get(image ? 'STORY_IMAGE_MAX_MB' : 'STORY_VIDEO_MAX_MB', {
      infer: true,
    })
    if (file.size > maxMb * 1024 * 1024) {
      throw new AppException('BAD_REQUEST', `Файл больше ${maxMb} МБ`)
    }
    const maxSeconds = this.config.get('STORY_VIDEO_MAX_SECONDS', { infer: true })
    if (video && file.durationMs !== null && file.durationMs > maxSeconds * 1000) {
      throw new AppException('BAD_REQUEST', `Видео длиннее ${maxSeconds} с`)
    }
  }

  /** Проверяет аудиторию по роли и вычисляет scope-цель сторис (защита от IDOR). */
  private async resolveTarget(
    actor: JwtPayload,
    audience: StoryAudience,
    input: { facultyId?: string; groupId?: string },
  ): Promise<{ universityId?: string; facultyId?: string; groupId?: string }> {
    if (!ALLOWED_AUDIENCES[actor.role].includes(audience)) {
      throw new AppException('FORBIDDEN', 'Эта аудитория недоступна вашей роли')
    }
    switch (audience) {
      case StoryAudience.ALL:
        return {}
      case StoryAudience.UNIVERSITY:
      case StoryAudience.TEACHERS:
        return { universityId: this.requireOwnUniversity(actor) }
      case StoryAudience.FACULTY: {
        const facultyId = input.facultyId ?? actor.facultyId
        if (!facultyId) throw new AppException('BAD_REQUEST', 'Не указан факультет')
        const universityId = await this.assertFacultyInScope(actor, facultyId)
        return { facultyId, universityId }
      }
      case StoryAudience.GROUP: {
        const groupId = input.groupId ?? actor.groupId
        if (!groupId) throw new AppException('BAD_REQUEST', 'Не указана группа')
        const scope = await this.assertGroupInScope(actor, groupId)
        return { groupId, facultyId: scope.facultyId, universityId: scope.universityId }
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
      if (actor.facultyId !== group.facultyId) {
        throw new AppException('WRONG_SCOPE', 'Чужой факультет')
      }
    } else if (universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Группа другого университета')
    }
    if (actor.role === Role.TEACHER) await this.assertTeachesGroup(actor.sub, groupId)
    return { facultyId: group.facultyId, universityId }
  }

  /**
   * Преподаватель адресует группе только там, где ведёт занятия (§2 «работает со своими
   * группами»): раньше хватало совпадения вуза, и сторис уходили в ленту любой группы.
   * Основание — как у материалов (materials.service): дисциплина группы или пара
   * действующего расписания.
   */
  private async assertTeachesGroup(teacherId: string, groupId: string): Promise<void> {
    const course = await this.prisma.course.findFirst({
      where: { teacherId, groupId },
      select: { id: true },
    })
    if (course) return
    const pair = await this.prisma.pair.findFirst({
      where: { teacherId, groupId, schedule: { is: { isActive: true } } },
      select: { id: true },
    })
    if (pair) return
    throw new AppException('WRONG_SCOPE', 'Вы не ведёте занятий в этой группе')
  }
}
