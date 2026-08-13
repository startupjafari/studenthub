import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  ContentCommentInput,
  CreatePollInput,
  UpdatePollInput,
  VotePollInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

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
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      universityId: true,
      facultyId: true,
      groupId: true,
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

  constructor(private readonly prisma: PrismaService) {}

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

  /** Опросы пользователя, видимые смотрящему (черновики — только автору). */
  async listByUser(viewer: JwtPayload, userId: string): Promise<PollView[]> {
    const isOwner = viewer.sub === userId
    const polls = await this.prisma.poll.findMany({
      where: { userId },
      select: POLL_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const visible = polls.filter(
      (p) => isOwner || (p.status === 'PUBLISHED' && this.visibleTo(viewer, p)),
    )
    return this.withResults(visible, viewer)
  }

  async get(viewer: JwtPayload, id: string): Promise<PollView> {
    const poll = await this.prisma.poll.findUnique({ where: { id }, select: POLL_SELECT })
    if (!poll) throw new AppException('NOT_FOUND', 'Опрос не найден')
    const isOwner = viewer.sub === poll.userId
    if (!isOwner && (poll.status !== 'PUBLISHED' || !this.visibleTo(viewer, poll))) {
      throw new AppException('NOT_FOUND', 'Опрос не найден')
    }
    const views = await this.withResults([poll], viewer)
    return views[0] ?? this.toView(poll, viewer, {}, [], 0)
  }

  async vote(actor: JwtPayload, id: string, dto: VotePollInput): Promise<PollView> {
    const poll = await this.prisma.poll.findUnique({ where: { id }, select: POLL_SELECT })
    if (!poll) throw new AppException('NOT_FOUND', 'Опрос не найден')
    if (
      poll.status !== 'PUBLISHED' ||
      (actor.sub !== poll.userId && !this.visibleTo(actor, poll))
    ) {
      throw new AppException('NOT_FOUND', 'Опрос не найден')
    }
    if (this.isClosed(poll)) throw new AppException('CONFLICT', 'Опрос завершён')

    const optionIds = Array.from(new Set(dto.optionIds))
    const validIds = new Set(poll.options.map((o) => o.id))
    if (!optionIds.every((o) => validIds.has(o))) {
      throw new AppException('BAD_REQUEST', 'Некорректные варианты ответа')
    }
    if (!poll.multiple && optionIds.length !== 1) {
      throw new AppException('BAD_REQUEST', 'Нужно выбрать один вариант')
    }

    const existing = await this.prisma.pollVote.findMany({
      where: { pollId: id, userId: actor.sub },
      select: { id: true },
    })
    if (existing.length > 0 && !poll.allowRevote) {
      throw new AppException('CONFLICT', 'Вы уже проголосовали')
    }

    await this.prisma.$transaction([
      this.prisma.pollVote.deleteMany({ where: { pollId: id, userId: actor.sub } }),
      this.prisma.pollVote.createMany({
        data: optionIds.map((optionId) => ({ pollId: id, optionId, userId: actor.sub })),
      }),
    ])
    return this.get(actor, id)
  }

  async cancelVote(actor: JwtPayload, id: string): Promise<PollView> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      select: { id: true, allowRevote: true },
    })
    if (!poll) throw new AppException('NOT_FOUND', 'Опрос не найден')
    if (!poll.allowRevote) throw new AppException('FORBIDDEN', 'Отмена голоса недоступна')
    await this.prisma.pollVote.deleteMany({ where: { pollId: id, userId: actor.sub } })
    return this.get(actor, id)
  }

  async update(actor: JwtPayload, id: string, dto: UpdatePollInput): Promise<PollView> {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      select: { id: true, userId: true, _count: { select: { votes: true } } },
    })
    if (!poll) throw new AppException('NOT_FOUND', 'Опрос не найден')
    if (poll.userId !== actor.sub)
      throw new AppException('FORBIDDEN', 'Можно менять только свои опросы')
    if (poll._count.votes > 0)
      throw new AppException('CONFLICT', 'Нельзя изменять опрос после голосов')

    await this.prisma.$transaction([
      this.prisma.pollOption.deleteMany({ where: { pollId: id } }),
      this.prisma.poll.update({
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
      }),
    ])
    return this.get(actor, id)
  }

  async remove(actor: JwtPayload, id: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({ where: { id }, select: { userId: true } })
    if (!poll) throw new AppException('NOT_FOUND', 'Опрос не найден')
    if (poll.userId !== actor.sub)
      throw new AppException('FORBIDDEN', 'Можно удалять только свои опросы')
    await this.prisma.poll.delete({ where: { id } })
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private isClosed(poll: { closesAt: Date | null }): boolean {
    return poll.closesAt !== null && poll.closesAt.getTime() < Date.now()
  }

  private visibleTo(viewer: JwtPayload, poll: PollRow): boolean {
    if (poll.visibility === 'ALL') return true
    if (isPlatform(viewer.role)) return true
    const a = poll.user
    if (poll.visibility === 'UNIVERSITY')
      return viewer.universityId !== null && viewer.universityId === a.universityId
    if (poll.visibility === 'FACULTY')
      return viewer.facultyId !== null && viewer.facultyId === a.facultyId
    if (poll.visibility === 'GROUP') return viewer.groupId !== null && viewer.groupId === a.groupId
    return false
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
    })
    const mineByPoll = new Map<string, string[]>()
    for (const v of mine) {
      const arr = mineByPoll.get(v.pollId) ?? []
      arr.push(v.optionId)
      mineByPoll.set(v.pollId, arr)
    }
    // Уникальные участники: distinct (pollId, userId) — при мультивыборе ≠ суммы голосов.
    const voters = await this.prisma.pollVote.findMany({
      where: { pollId: { in: ids } },
      select: { pollId: true, userId: true },
      distinct: ['pollId', 'userId'],
    })
    const participantsByPoll = new Map<string, number>()
    for (const v of voters) {
      participantsByPoll.set(v.pollId, (participantsByPoll.get(v.pollId) ?? 0) + 1)
    }
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

  async listComments(viewer: JwtPayload, id: string) {
    await this.get(viewer, id) // проверка видимости (бросит NOT_FOUND, если не виден)
    return this.prisma.contentComment.findMany({
      where: { pollId: id },
      select: POLL_COMMENT_SELECT,
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
  }

  async addComment(viewer: JwtPayload, id: string, input: ContentCommentInput) {
    await this.get(viewer, id)
    return this.prisma.contentComment.create({
      data: { authorId: viewer.sub, pollId: id, content: input.content },
      select: POLL_COMMENT_SELECT,
    })
  }

  async deleteComment(viewer: JwtPayload, id: string, commentId: string): Promise<void> {
    const c = await this.prisma.contentComment.findUnique({
      where: { id: commentId },
      select: { authorId: true, pollId: true, poll: { select: { userId: true } } },
    })
    if (!c || c.pollId !== id) throw new AppException('NOT_FOUND', 'Комментарий не найден')
    if (c.authorId !== viewer.sub && c.poll?.userId !== viewer.sub) {
      throw new AppException('FORBIDDEN', 'Нет прав на удаление')
    }
    await this.prisma.contentComment.delete({ where: { id: commentId } })
  }
}
