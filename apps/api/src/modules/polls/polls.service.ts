import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  DEFAULT_PAGE_LIMIT,
  PROFILE_LIST_LIMITS,
  isPageRequested,
  type CommentsQueryInput,
  type ContentCommentInput,
  type CreatePollInput,
  type PollsListQueryInput,
  type UpdatePollInput,
  type VotePollInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { NEWEST_FIRST, encodeKeyset, keysetFrom, olderThan } from '../../common/http/keyset-cursor'
import { QueueService, QUEUES, NOTIFICATION_JOBS } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { advisoryXactLock, advisoryXactLockShared } from '../../common/prisma/advisory-lock'
import type { RequestContext } from '../auth/auth.service'
import type { NotificationJobData } from '../notifications/notification-job.type'
import {
  PROFILE_CONTENT_OWNER_SELECT,
  UserService,
  type ProfileContentOwner,
} from '../users/users.service'
import {
  CONTENT_AUTHOR_SELECT,
  assertContentModerator,
  isContentModerator,
} from '../profile-content/content-moderation'

// Потолки на выборки (BACKEND_RULES §7.2). Голоса одного пользователя ограничены числом
// вариантов опроса, поэтому здесь потолок — честная граница, а не обрезка данных.
const POLL_OPTIONS_LIMIT = 100
// Опросы автора без пагинации (прежний ответ массивом) — общий потолок списков профиля:
// дойдя до него, бейдж вкладки берёт итог из countVisibleByUser (GET /profile/:id/counts).
const POLLS_LEGACY_LIMIT = PROFILE_LIST_LIMITS.polls
// Комментарии без пагинации (прежний ответ массивом) — последние столько, по порядку написания.
const COMMENTS_LEGACY_LIMIT = 200

/**
 * Лок опроса. Голоса и отмена голоса берут его разделяемым — друг другу не мешают; правка
 * берёт исключительным. Правка разрешена только без голосов и пересоздаёт варианты, а
 * удаление вариантов каскадом сносит голоса: без лока голос, пришедший между проверкой
 * «голосов нет» и транзакцией правки, молча пропадал.
 */
function pollLockKey(pollId: string): string {
  return `poll:${pollId}`
}

// Минимум для проверки видимости опроса (canSee): без вариантов, счётчиков и имени автора.
const POLL_ACCESS_SELECT = {
  id: true,
  userId: true,
  status: true,
  visibility: true,
  user: { select: PROFILE_CONTENT_OWNER_SELECT },
} satisfies Prisma.PollSelect

// Что голос сверяет под локом опроса: правка могла успеть заменить варианты или настройки.
const POLL_VOTE_STATE_SELECT = {
  status: true,
  multiple: true,
  allowRevote: true,
  closesAt: true,
  options: { select: { id: true } },
} satisfies Prisma.PollSelect

const POLL_SELECT = {
  id: true,
  userId: true,
  question: true,
  multiple: true,
  anonymous: true,
  allowRevote: true,
  resultsVisibility: true,
  visibility: true,
  status: true,
  closesAt: true,
  createdAt: true,
  options: { select: { id: true, text: true, order: true }, orderBy: { order: 'asc' } },
  // Поля видимости профиля автора — вместе с опросом, без отдельного запроса за автором.
  // Наружу из них уходят только id/имя/аватар (toView).
  user: {
    select: {
      ...PROFILE_CONTENT_OWNER_SELECT,
      firstName: true,
      lastName: true,
      avatarUrl: true,
    },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.PollSelect

const POLL_COMMENT_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  authorId: true,
  author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
} satisfies Prisma.ContentCommentSelect

type PollRow = Prisma.PollGetPayload<{ select: typeof POLL_SELECT }>
type PollAccess = Prisma.PollGetPayload<{ select: typeof POLL_ACCESS_SELECT }>
type PollComment = Prisma.ContentCommentGetPayload<{ select: typeof POLL_COMMENT_SELECT }>

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

export interface PollView {
  id: string
  question: string
  multiple: boolean
  anonymous: boolean
  allowRevote: boolean
  resultsVisibility: string
  visibility: string
  status: string
  closesAt: string | null
  createdAt: string
  closed: boolean
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  options: { id: string; text: string; order: number; votes: number }[]
  totalVotes: number
  // Уникальные проголосовавшие (при мультивыборе отличается от суммы голосов).
  participants: number
  commentCount: number
  myVotes: string[]
  canSeeResults: boolean
  canVote: boolean
}

@Injectable()
export class PollsService {
  private readonly logger = new Logger(PollsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async create(actor: JwtPayload, dto: CreatePollInput): Promise<PollView> {
    const poll = await this.prisma.poll.create({
      data: {
        userId: actor.sub,
        question: dto.question,
        multiple: dto.multiple,
        anonymous: dto.anonymous,
        allowRevote: dto.allowRevote,
        resultsVisibility: dto.resultsVisibility,
        visibility: dto.visibility,
        status: dto.status,
        closesAt: dto.closesAt ?? null,
        options: { create: dto.options.map((text, i) => ({ text, order: i })) },
      },
      select: POLL_SELECT,
    })
    return this.toView(poll, actor, {}, [], 0)
  }

  /**
   * Опросы пользователя, видимые смотрящему (черновики — только автору). Первым шагом —
   * видимость профиля, как у статей и медиа: закрытый профиль скрывает и опросы, а опрос с
   * видимостью ALL раньше отдавался по прямому запросу любому вошедшему (§14.7).
   *
   * Статус и visibility — условием в запросе, до `take`: раньше бралась сотня опросов автора
   * подряд и фильтровалась в памяти, так что черновики и опросы «для группы» съедали выдачу,
   * а бейдж вкладки занижал число. Без `limit`/`cursor` — прежний массив (до сотни видимых),
   * с ними — страница, свежие сверху.
   */
  async listByUser(
    viewer: JwtPayload,
    userId: string,
    query: PollsListQueryInput = {},
  ): Promise<PollView[] | Paginated<PollView>> {
    const paged = isPageRequested(query)
    let where: Prisma.PollWhereInput = { userId }
    if (viewer.sub !== userId) {
      const author = await this.prisma.user.findUnique({
        where: { id: userId },
        select: PROFILE_CONTENT_OWNER_SELECT,
      })
      if (!author || !(await this.users.canViewProfileContentOf(viewer, author))) {
        return paged ? new Paginated<PollView>([], { hasNext: false }) : []
      }
      where = { userId, ...this.viewerVisibilityWhere(viewer, author) }
    }
    if (!paged) {
      const polls = await this.prisma.poll.findMany({
        where,
        select: POLL_SELECT,
        orderBy: NEWEST_FIRST,
        take: POLLS_LEGACY_LIMIT,
      })
      return this.withResults(polls, viewer)
    }
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT
    // Курсор несёт момент и id (keyset-cursor.ts): удалённый опрос не обрывает листание.
    const after = query.cursor
      ? await keysetFrom(query.cursor, (cursorId) =>
          this.prisma.poll.findUnique({
            where: { id: cursorId },
            select: { createdAt: true, id: true },
          }),
        )
      : null
    if (query.cursor && !after) return new Paginated<PollView>([], { hasNext: false })
    const rows = await this.prisma.poll.findMany({
      where: after ? { AND: [where, olderThan(after)] } : where,
      select: POLL_SELECT,
      orderBy: NEWEST_FIRST,
      take: limit + 1,
    })
    const hasNext = rows.length > limit
    const items = hasNext ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    return new Paginated(await this.withResults(items, viewer), {
      cursor: hasNext && last ? encodeKeyset(last) : undefined,
      hasNext,
    })
  }

  /**
   * Сколько опросов автора видит смотрящий — итог для бейджа вкладки, по тому же условию,
   * что listByUser. Видимость профиля автора (закрытый, удалённый) проверяет вызывающий:
   * счётчики вкладок считаются пачкой, и автор у него уже выбран.
   */
  async countVisibleByUser(viewer: JwtPayload, author: ProfileContentOwner): Promise<number> {
    const where: Prisma.PollWhereInput =
      viewer.sub === author.id
        ? { userId: author.id }
        : { userId: author.id, ...this.viewerVisibilityWhere(viewer, author) }
    return this.prisma.poll.count({ where })
  }

  async get(viewer: JwtPayload, id: string): Promise<PollView> {
    const poll = await this.prisma.poll.findUnique({ where: { id }, select: POLL_SELECT })
    if (!poll || !(await this.canSee(viewer, poll))) {
      throw new AppException('NOT_FOUND', 'Опрос не найден')
    }
    const views = await this.withResults([poll], viewer)
    return views[0] ?? this.toView(poll, viewer, {}, [], 0)
  }

  async vote(actor: JwtPayload, id: string, dto: VotePollInput): Promise<PollView> {
    const poll = await this.prisma.poll.findUnique({ where: { id }, select: POLL_ACCESS_SELECT })
    // Свой черновик тоже не голосуется — поэтому статус проверяем и для автора.
    if (!poll || poll.status !== 'PUBLISHED' || !(await this.canSee(actor, poll))) {
      throw new AppException('NOT_FOUND', 'Опрос не найден')
    }
    const optionIds = Array.from(new Set(dto.optionIds))

    await this.prisma.$transaction(async (tx) => {
      await advisoryXactLockShared(tx, pollLockKey(id))
      // Проверка «уже голосовал» и запись — под локом на (опрос, голосующий): иначе два
      // параллельных запроса оба видели «голоса нет» и записывали по варианту каждый.
      await advisoryXactLock(tx, `poll-vote:${id}:${actor.sub}`)
      // Варианты и настройки — перечитанные под локом опроса: правка, закончившаяся между
      // чтением выше и этой транзакцией, могла заменить варианты или снять опрос с публикации.
      const current = await tx.poll.findUnique({ where: { id }, select: POLL_VOTE_STATE_SELECT })
      if (!current || current.status !== 'PUBLISHED') {
        throw new AppException('NOT_FOUND', 'Опрос не найден')
      }
      if (this.isClosed(current)) throw new AppException('CONFLICT', 'Опрос завершён')
      const validIds = new Set(current.options.map((o) => o.id))
      if (!optionIds.every((o) => validIds.has(o))) {
        throw new AppException('BAD_REQUEST', 'Некорректные варианты ответа')
      }
      if (!current.multiple && optionIds.length !== 1) {
        throw new AppException('BAD_REQUEST', 'Нужно выбрать один вариант')
      }
      const existing = await tx.pollVote.count({ where: { pollId: id, userId: actor.sub } })
      if (existing > 0 && !current.allowRevote) {
        throw new AppException('CONFLICT', 'Вы уже проголосовали')
      }
      await tx.pollVote.deleteMany({ where: { pollId: id, userId: actor.sub } })
      await tx.pollVote.createMany({
        data: optionIds.map((optionId) => ({ pollId: id, optionId, userId: actor.sub })),
      })
    })
    return this.get(actor, id)
  }

  /**
   * Отмена голоса — те же условия, что у голоса: опрос виден смотрящему (закрытый профиль,
   * узкая видимость), опубликован, не закрыт, автор разрешил переголосование.
   */
  async cancelVote(actor: JwtPayload, id: string): Promise<PollView> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      select: { ...POLL_ACCESS_SELECT, allowRevote: true, closesAt: true },
    })
    if (!poll || poll.status !== 'PUBLISHED' || !(await this.canSee(actor, poll))) {
      throw new AppException('NOT_FOUND', 'Опрос не найден')
    }
    if (!poll.allowRevote) throw new AppException('FORBIDDEN', 'Отмена голоса недоступна')
    // После закрытия итоги не меняются — ни новым голосом, ни отменой старого.
    if (this.isClosed(poll)) throw new AppException('CONFLICT', 'Опрос завершён')
    await this.prisma.$transaction(async (tx) => {
      await advisoryXactLockShared(tx, pollLockKey(id))
      await tx.pollVote.deleteMany({ where: { pollId: id, userId: actor.sub } })
    })
    return this.get(actor, id)
  }

  async update(actor: JwtPayload, id: string, dto: UpdatePollInput): Promise<PollView> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      select: { id: true, userId: true },
    })
    if (!poll) throw new AppException('NOT_FOUND', 'Опрос не найден')
    if (poll.userId !== actor.sub)
      throw new AppException('FORBIDDEN', 'Можно менять только свои опросы')

    await this.prisma.$transaction(async (tx) => {
      // Исключительный лок опроса: идущие голоса успевают записаться, новые ждут конца правки.
      // Голоса считаем уже под ним — проверка до транзакции пропускала голос, пришедший между
      // ней и удалением вариантов, и удаление каскадом его стирало.
      await advisoryXactLock(tx, pollLockKey(id))
      const votes = await tx.pollVote.count({ where: { pollId: id } })
      if (votes > 0) throw new AppException('CONFLICT', 'Нельзя изменять опрос после голосов')
      await tx.pollOption.deleteMany({ where: { pollId: id } })
      await tx.poll.update({
        where: { id },
        data: {
          question: dto.question,
          multiple: dto.multiple,
          anonymous: dto.anonymous,
          allowRevote: dto.allowRevote,
          resultsVisibility: dto.resultsVisibility,
          visibility: dto.visibility,
          status: dto.status,
          closesAt: dto.closesAt ?? null,
          options: { create: dto.options.map((text, i) => ({ text, order: i })) },
        },
      })
    })
    return this.get(actor, id)
  }

  /**
   * Удаление опроса: своего — автором, чужого — модератором scope по правилам контента
   * профиля (content-moderation.ts: роль строго выше автора, вуз/факультет автора), с
   * записью в аудит.
   */
  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      select: { userId: true, user: { select: CONTENT_AUTHOR_SELECT } },
    })
    if (!poll) throw new AppException('NOT_FOUND', 'Опрос не найден')
    const moderated = poll.userId !== actor.sub
    if (moderated) {
      if (!isContentModerator(actor.role)) {
        throw new AppException('FORBIDDEN', 'Можно удалять только свои опросы')
      }
      assertContentModerator(actor, poll.user)
    }
    await this.prisma.poll.delete({ where: { id } })
    if (moderated) {
      await this.recordModeration(actor, ctx, 'poll_deleted', 'Poll', id, { authorId: poll.userId })
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Чужой контент снят модератором — решение модератора пишется в аудит (BACKEND_RULES §13). */
  private async recordModeration(
    actor: JwtPayload,
    ctx: RequestContext,
    action: string,
    entity: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(`${entity} ${entityId} снят модератором ${actor.sub}`)
    await this.audit.record({ userId: actor.sub, action, entity, entityId, metadata, ...ctx })
  }

  private isClosed(poll: { closesAt: Date | null }): boolean {
    return poll.closesAt !== null && poll.closesAt.getTime() < Date.now()
  }

  /**
   * Опрос виден смотрящему: автору — всегда (и черновик); остальным — опубликованный, по
   * visibility опроса и по видимости профиля автора (закрытый профиль, удалённый аккаунт).
   */
  private async canSee(viewer: JwtPayload, poll: PollAccess): Promise<boolean> {
    if (viewer.sub === poll.userId) return true
    if (poll.status !== 'PUBLISHED') return false
    const allowed = this.allowedVisibilities(viewer, poll.user)
    if (allowed && !allowed.includes(poll.visibility)) return false
    return this.users.canViewProfileContentOf(viewer, poll.user)
  }

  /**
   * Значения visibility, открытые чужому смотрящему относительно автора; null — все
   * (платформенные роли). Одна логика для одиночной проверки (canSee) и для списка
   * (viewerVisibilityWhere), как viewerVisibilityWhere/articleScopeOk у статей.
   */
  private allowedVisibilities(viewer: JwtPayload, author: ProfileContentOwner): string[] | null {
    if (isPlatform(viewer.role)) return null
    const vis = ['ALL']
    if (author.universityId && viewer.universityId === author.universityId) vis.push('UNIVERSITY')
    if (author.facultyId && viewer.facultyId === author.facultyId) vis.push('FACULTY')
    if (author.groupId && viewer.groupId === author.groupId) vis.push('GROUP')
    return vis
  }

  /** Условие списка для чужого смотрящего: только опубликованные и видимые ему. */
  private viewerVisibilityWhere(
    viewer: JwtPayload,
    author: ProfileContentOwner,
  ): Prisma.PollWhereInput {
    const allowed = this.allowedVisibilities(viewer, author)
    return allowed ? { status: 'PUBLISHED', visibility: { in: allowed } } : { status: 'PUBLISHED' }
  }

  /** Опрос, видимый смотрящему, — лёгкой выборкой, без результатов; иначе NOT_FOUND. */
  private async findVisible(viewer: JwtPayload, id: string): Promise<PollAccess> {
    const poll = await this.prisma.poll.findUnique({ where: { id }, select: POLL_ACCESS_SELECT })
    if (!poll || !(await this.canSee(viewer, poll))) {
      throw new AppException('NOT_FOUND', 'Опрос не найден')
    }
    return poll
  }

  /** Догружает счётчики голосов и голоса смотрящего, собирает представления. */
  private async withResults(polls: PollRow[], viewer: JwtPayload): Promise<PollView[]> {
    if (polls.length === 0) return []
    const ids = polls.map((p) => p.id)
    const grouped = await this.prisma.pollVote.groupBy({
      by: ['optionId'],
      where: { pollId: { in: ids } },
      _count: { _all: true },
    })
    const countByOption = new Map(grouped.map((g) => [g.optionId, g._count._all]))
    const mine = await this.prisma.pollVote.findMany({
      where: { pollId: { in: ids }, userId: viewer.sub },
      select: { pollId: true, optionId: true },
      // Свои голоса: не больше, чем вариантов в каждом из запрошенных опросов.
      take: ids.length * POLL_OPTIONS_LIMIT,
    })
    const mineByPoll = new Map<string, string[]>()
    for (const v of mine) {
      const arr = mineByPoll.get(v.pollId) ?? []
      arr.push(v.optionId)
      mineByPoll.set(v.pollId, arr)
    }
    // Уникальные участники: при мультивыборе это НЕ сумма голосов, а число различных
    // пользователей. Раньше считалось через findMany(distinct) — то есть весь список
    // голосовавших вытягивался в память ради одного числа: у опроса на 5000 человек это
    // 5000 строк на каждый показ ленты. COUNT(DISTINCT ...) считает то же самое в БД.
    const voterRows = await this.prisma.$queryRaw<{ poll_id: string; voters: bigint }[]>`
      SELECT poll_id, COUNT(DISTINCT user_id) AS voters
      FROM poll_votes
      WHERE poll_id IN (${Prisma.join(ids)})
      GROUP BY poll_id
    `
    const participantsByPoll = new Map<string, number>(
      voterRows.map((r) => [r.poll_id, Number(r.voters)]),
    )
    return polls.map((p) =>
      this.toView(
        p,
        viewer,
        Object.fromEntries(countByOption),
        mineByPoll.get(p.id) ?? [],
        participantsByPoll.get(p.id) ?? 0,
      ),
    )
  }

  private toView(
    poll: PollRow,
    viewer: JwtPayload,
    countByOption: Record<string, number>,
    myVotes: string[],
    participants: number,
  ): PollView {
    const closed = this.isClosed(poll)
    const voted = myVotes.length > 0
    const isOwner = poll.userId === viewer.sub
    const canSeeResults =
      isOwner ||
      (poll.resultsVisibility === 'AFTER_VOTE' && (voted || closed)) ||
      (poll.resultsVisibility === 'AFTER_END' && closed)
    const totalVotes = poll.options.reduce((sum, o) => sum + (countByOption[o.id] ?? 0), 0)
    const canVote = poll.status === 'PUBLISHED' && !closed && (!voted || poll.allowRevote)

    return {
      id: poll.id,
      question: poll.question,
      multiple: poll.multiple,
      anonymous: poll.anonymous,
      allowRevote: poll.allowRevote,
      resultsVisibility: poll.resultsVisibility,
      visibility: poll.visibility,
      status: poll.status,
      closesAt: poll.closesAt ? poll.closesAt.toISOString() : null,
      createdAt: poll.createdAt.toISOString(),
      closed,
      author: {
        id: poll.user.id,
        firstName: poll.user.firstName,
        lastName: poll.user.lastName,
        avatarUrl: poll.user.avatarUrl,
      },
      options: poll.options.map((o) => ({
        id: o.id,
        text: o.text,
        order: o.order,
        votes: canSeeResults ? (countByOption[o.id] ?? 0) : 0,
      })),
      // Явку (общее число голосов/участников) прячем вместе с результатами: при
      // AFTER_VOTE/AFTER_END до раскрытия автор не хочет показывать оборот голосования.
      totalVotes: canSeeResults ? totalVotes : 0,
      participants: canSeeResults ? participants : 0,
      commentCount: poll._count.comments,
      myVotes,
      canSeeResults,
      canVote,
    }
  }

  // ── Комментарии к опросам ──────────────────────────────────────────────────────

  /**
   * Комментарии опроса. С `limit`/`cursor` — страница, свежие сверху (`meta.cursor` — самый
   * старый на странице, по нему просят более ранние; `meta.total` — всего комментариев). Без
   * них — прежний массив, но последние 200 по порядку написания: раньше отдавались первые 200,
   * и в длинном обсуждении только что написанный комментарий пропадал после перезагрузки.
   */
  async listComments(
    viewer: JwtPayload,
    id: string,
    query: CommentsQueryInput = {},
  ): Promise<PollComment[] | Paginated<PollComment>> {
    await this.findVisible(viewer, id)
    const where: Prisma.ContentCommentWhereInput = { pollId: id }
    if (!isPageRequested(query)) {
      const latest = await this.prisma.contentComment.findMany({
        where,
        select: POLL_COMMENT_SELECT,
        orderBy: NEWEST_FIRST,
        take: COMMENTS_LEGACY_LIMIT,
      })
      return latest.reverse()
    }
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT
    // Курсор несёт момент и id (keyset-cursor.ts): комментарий стирается навсегда, и
    // Prisma-курсор на стёртую строку обрывал бы листание.
    const after = query.cursor
      ? await keysetFrom(query.cursor, (cursorId) =>
          this.prisma.contentComment.findUnique({
            where: { id: cursorId },
            select: { createdAt: true, id: true },
          }),
        )
      : null
    const total = await this.prisma.contentComment.count({ where })
    if (query.cursor && !after) return new Paginated<PollComment>([], { hasNext: false, total })
    const rows = await this.prisma.contentComment.findMany({
      where: after ? { AND: [where, olderThan(after)] } : where,
      select: POLL_COMMENT_SELECT,
      orderBy: NEWEST_FIRST,
      take: limit + 1,
    })
    const hasNext = rows.length > limit
    const items = hasNext ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    return new Paginated(items, {
      cursor: hasNext && last ? encodeKeyset(last) : undefined,
      hasNext,
      total,
    })
  }

  async addComment(viewer: JwtPayload, id: string, input: ContentCommentInput) {
    const poll = await this.findVisible(viewer, id)
    const comment = await this.prisma.contentComment.create({
      data: { authorId: viewer.sub, pollId: id, content: input.content },
      select: POLL_COMMENT_SELECT,
    })
    await this.notifyOwnerOfComment(viewer, poll.userId, id, comment)
    return comment
  }

  /**
   * Уведомить автора опроса о новом комментарии. Свой комментарий и личная блокировка в любую
   * сторону — без уведомления. `collapseKey` — одна строка на опрос в колокольчике автора, а не
   * строка на каждый комментарий; `commentId` в `data` — чтобы повтор job'а узнавался.
   * Комментарий уже записан: сбой очереди не должен отвечать клиенту ошибкой (повтор отправки
   * дал бы дубль) — пишем в лог.
   */
  private async notifyOwnerOfComment(
    commenter: JwtPayload,
    ownerId: string,
    pollId: string,
    comment: PollComment,
  ): Promise<void> {
    if (ownerId === commenter.sub) return
    try {
      const blocked = await this.prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: ownerId, blockedId: commenter.sub },
            { blockerId: commenter.sub, blockedId: ownerId },
          ],
        },
        select: { id: true },
      })
      if (blocked) return
      const name = `${comment.author.firstName} ${comment.author.lastName}`.trim() || 'Пользователь'
      const job: NotificationJobData = {
        recipientIds: [ownerId],
        type: 'POST',
        titleKey: 'comments.new.title',
        bodyKey: 'comments.poll.body',
        params: { name },
        data: { pollId, commentId: comment.id, url: `/profile/${ownerId}` },
        dedupeKey: `poll-comment:${comment.id}`,
        collapseKey: `poll-comments:${pollId}`,
      }
      await this.queue.enqueue(QUEUES.NOTIFICATIONS, NOTIFICATION_JOBS.COMMENT_ADDED, job, {
        jobId: `poll-comment:${comment.id}`,
      })
    } catch (error) {
      this.logger.warn(
        `Уведомление о комментарии ${comment.id} к опросу ${pollId} не поставлено: ${(error as Error).message}`,
      )
    }
  }

  /** Удалить комментарий: автор, владелец опроса или модератор scope (с записью в аудит). */
  async deleteComment(
    viewer: JwtPayload,
    id: string,
    commentId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const c = await this.prisma.contentComment.findUnique({
      where: { id: commentId },
      select: {
        authorId: true,
        pollId: true,
        author: { select: CONTENT_AUTHOR_SELECT },
        poll: { select: { userId: true, user: { select: CONTENT_AUTHOR_SELECT } } },
      },
    })
    if (!c || c.pollId !== id) throw new AppException('NOT_FOUND', 'Комментарий не найден')
    const moderated = c.authorId !== viewer.sub && c.poll?.userId !== viewer.sub
    if (moderated) {
      if (!isContentModerator(viewer.role)) {
        throw new AppException('FORBIDDEN', 'Нет прав на удаление')
      }
      assertContentModerator(viewer, c.author, c.poll?.user)
    }
    await this.prisma.contentComment.delete({ where: { id: commentId } })
    if (moderated) {
      await this.recordModeration(
        viewer,
        ctx,
        'content_comment_deleted',
        'ContentComment',
        commentId,
        { pollId: id, authorId: c.authorId },
      )
    }
  }
}
