import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  FriendsListQueryInput,
  FriendRequestsQueryInput,
  FriendshipStatusValue,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { QueueService, QUEUES, NOTIFICATION_JOBS } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Публичная карточка пользователя в списках друзей/заявок (без чувствительных полей).
const FRIEND_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
  avatarUrl: true,
  avatarThumbUrl: true,
  role: true,
  headline: true,
  universityId: true,
  facultyId: true,
  groupId: true,
} satisfies Prisma.UserSelect

type FriendUser = Prisma.UserGetPayload<{ select: typeof FRIEND_USER_SELECT }>

export interface FriendshipStatusResult {
  status: FriendshipStatusValue
  friendshipId?: string
}

@Injectable()
export class FriendsService {
  private readonly logger = new Logger(FriendsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /** Отправить заявку. Если есть встречная PENDING — авто-принятие. */
  async sendRequest(
    viewer: JwtPayload,
    targetId: string,
  ): Promise<{ status: 'pending' | 'accepted' }> {
    if (targetId === viewer.sub) {
      throw new AppException('BAD_REQUEST', 'Нельзя добавить в друзья самого себя')
    }
    const target = await this.prisma.user.findFirst({
      where: { id: targetId, deletedAt: null },
      select: { id: true },
    })
    if (!target) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }

    const existing = await this.findBetween(viewer.sub, targetId)
    if (existing) {
      if (existing.status === 'ACCEPTED') {
        throw new AppException('CONFLICT', 'Вы уже друзья')
      }
      // Встречная заявка (адресат — я) → принимаем.
      if (existing.addresseeId === viewer.sub) {
        await this.acceptRow(existing.id, existing.requesterId)
        return { status: 'accepted' }
      }
      throw new AppException('CONFLICT', 'Заявка уже отправлена')
    }

    try {
      const created = await this.prisma.friendship.create({
        data: { requesterId: viewer.sub, addresseeId: targetId },
        select: { id: true },
      })
      await this.notify(targetId, NOTIFICATION_JOBS.FRIEND_REQUEST, {
        title: 'Новая заявка в друзья',
        body: 'Вам отправили заявку в друзья',
        dedupeKey: `friend-request:${created.id}`,
      })
      return { status: 'pending' }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Заявка уже существует')
      }
      throw error
    }
  }

  /** Принять входящую заявку (только адресат). */
  async accept(viewer: JwtPayload, friendshipId: string): Promise<void> {
    const f = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
      select: { id: true, requesterId: true, addresseeId: true, status: true },
    })
    if (!f) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    if (f.addresseeId !== viewer.sub) {
      throw new AppException('FORBIDDEN', 'Принять заявку может только её получатель')
    }
    if (f.status !== 'PENDING') {
      throw new AppException('CONFLICT', 'Заявка уже обработана')
    }
    await this.acceptRow(f.id, f.requesterId)
  }

  /** Удалить связь: отмена исходящей / отклонение входящей / удаление из друзей (любой участник). */
  async remove(viewer: JwtPayload, friendshipId: string): Promise<void> {
    const f = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
      select: { id: true, requesterId: true, addresseeId: true },
    })
    if (!f) {
      throw new AppException('NOT_FOUND', 'Связь не найдена')
    }
    if (f.requesterId !== viewer.sub && f.addresseeId !== viewer.sub) {
      throw new AppException('FORBIDDEN', 'Нет доступа к этой связи')
    }
    await this.prisma.friendship.delete({ where: { id: f.id } })
  }

  /** Список друзей (принятые) — карточка «другого» пользователя. Cursor по id связи. */
  async listFriends(viewer: JwtPayload, query: FriendsListQueryInput): Promise<Paginated<unknown>> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: viewer.sub }, { addresseeId: viewer.sub }],
      },
      select: {
        id: true,
        respondedAt: true,
        requester: { select: FRIEND_USER_SELECT },
        addressee: { select: FRIEND_USER_SELECT },
      },
      orderBy: [{ respondedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const { items, nextCursor } = this.page(rows, query.limit)
    return new Paginated(
      items.map((r) => ({
        friendshipId: r.id,
        since: r.respondedAt,
        user: this.counterpart(viewer.sub, r.requester, r.addressee),
      })),
      { cursor: nextCursor, hasNext: nextCursor !== undefined },
    )
  }

  /** Список заявок: входящие (мне) или исходящие (мои). */
  async listRequests(
    viewer: JwtPayload,
    query: FriendRequestsQueryInput,
  ): Promise<Paginated<unknown>> {
    const where: Prisma.FriendshipWhereInput =
      query.direction === 'outgoing'
        ? { status: 'PENDING', requesterId: viewer.sub }
        : { status: 'PENDING', addresseeId: viewer.sub }
    const rows = await this.prisma.friendship.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        requester: { select: FRIEND_USER_SELECT },
        addressee: { select: FRIEND_USER_SELECT },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const { items, nextCursor } = this.page(rows, query.limit)
    return new Paginated(
      items.map((r) => ({
        friendshipId: r.id,
        createdAt: r.createdAt,
        user: this.counterpart(viewer.sub, r.requester, r.addressee),
      })),
      { cursor: nextCursor, hasNext: nextCursor !== undefined },
    )
  }

  /** Счётчики для бейджей: друзей всего + входящих заявок. */
  async counts(viewer: JwtPayload): Promise<{ friends: number; incomingRequests: number }> {
    const [friends, incomingRequests] = await this.prisma.$transaction([
      this.prisma.friendship.count({
        where: {
          status: 'ACCEPTED',
          OR: [{ requesterId: viewer.sub }, { addresseeId: viewer.sub }],
        },
      }),
      this.prisma.friendship.count({
        where: { status: 'PENDING', addresseeId: viewer.sub },
      }),
    ])
    return { friends, incomingRequests }
  }

  /** Статус дружбы смотрящего с targetId (для кнопки в чужом профиле). */
  async statusFor(viewerId: string, targetId: string): Promise<FriendshipStatusResult> {
    if (viewerId === targetId) return { status: 'NONE' }
    const f = await this.findBetween(viewerId, targetId)
    if (!f) return { status: 'NONE' }
    if (f.status === 'ACCEPTED') return { status: 'ACCEPTED', friendshipId: f.id }
    return {
      status: f.requesterId === viewerId ? 'PENDING_OUTGOING' : 'PENDING_INCOMING',
      friendshipId: f.id,
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private findBetween(a: string, b: string) {
    return this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: a, addresseeId: b },
          { requesterId: b, addresseeId: a },
        ],
      },
      select: { id: true, requesterId: true, addresseeId: true, status: true },
    })
  }

  private async acceptRow(friendshipId: string, requesterId: string): Promise<void> {
    await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    })
    await this.notify(requesterId, NOTIFICATION_JOBS.FRIEND_ACCEPTED, {
      title: 'Заявка в друзья принята',
      body: 'Ваша заявка в друзья принята',
      dedupeKey: `friend-accepted:${friendshipId}`,
    })
  }

  private counterpart(viewerId: string, requester: FriendUser, addressee: FriendUser): FriendUser {
    return requester.id === viewerId ? addressee : requester
  }

  private page<T extends { id: string }>(rows: T[], limit: number) {
    const hasNext = rows.length > limit
    const items = hasNext ? rows.slice(0, limit) : rows
    return { items, nextCursor: hasNext ? items[items.length - 1]?.id : undefined }
  }

  private async notify(
    recipientId: string,
    job: string,
    n: { title: string; body: string; dedupeKey: string },
  ): Promise<void> {
    // Тип SYSTEM доставляется всегда (не зависит от пер-тип настроек).
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      job,
      {
        recipientIds: [recipientId],
        type: 'SYSTEM',
        title: n.title,
        body: n.body,
        data: { url: '/friends' },
        dedupeKey: n.dedupeKey,
      },
      { jobId: n.dedupeKey },
    )
  }
}
