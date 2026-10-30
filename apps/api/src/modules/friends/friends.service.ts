import { RESTRICTED_ROLES, Role } from '@studenthub/shared-types'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import type {
  FriendsListQueryInput,
  FriendRequestsQueryInput,
  FriendshipStatusValue,
} from '@studenthub/shared-schemas'
import type { NotificationMessageKey, NotificationParams } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { QueueService, QUEUES, NOTIFICATION_JOBS } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { NotificationsService } from '../notifications/notifications.service'
import { ChatsService } from '../chats/chats.service'

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

// Личных блокировок у человека единицы-десятки, но take обязателен (§7.2).
const BLOCKS_SCAN_LIMIT = 1000

// Собеседник в списках и счётчиках — только живой аккаунт. Удалённый («Удалённый
// пользователь») и заблокированный платформой висели в друзьях и в цифре на бейдже. Условие
// стоит на связи в самом запросе, а не фильтром после выборки: иначе страница короче `take`
// и счётчик расходился бы со списком.
const ACTIVE_USER = { deletedAt: null, isBlocked: false } satisfies Prisma.UserWhereInput

// Пауза на повторную заявку после отклонения: отклонённый иначе мог слать заявку по кругу, и
// каждая будила адресата новым уведомлением. Неделя — достаточно, чтобы повтор не стал
// способом давить на человека, и не навсегда: люди мирятся. Пауза направленная — сам
// отклонивший может написать заявку в ответ когда угодно.
const DECLINE_PAUSE_SECONDS = 7 * 24 * 60 * 60

// Окно уведомления о заявке: одна пара будит адресата не чаще раза в сутки. Отмена своей
// заявки паузы не ставит (передумать — нормально), но «отменил — отправил снова» по кругу
// иначе давал новое уведомление на каждом шаге. Заявка при этом создаётся как обычно и
// видна во входящих — молчит только колокольчик.
const REQUEST_NOTICE_WINDOW_SECONDS = 24 * 60 * 60

function requestNoticeKey(requesterId: string, addresseeId: string): string {
  return `friend-request-notice:${requesterId}:${addresseeId}`
}

/** Ключ паузы: `requesterId` отклонён `addresseeId` и пока не может повторить заявку. */
function declinePauseKey(requesterId: string, addresseeId: string): string {
  return `friend-declined:${requesterId}:${addresseeId}`
}

/** Лок пары: ключ не зависит от того, кто из двоих начал. */
function pairLockKey(a: string, b: string): string {
  return a < b ? `friendship:${a}:${b}` : `friendship:${b}:${a}`
}

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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly notifications: NotificationsService,
    private readonly chats: ChatsService,
  ) {}

  /** Отправить заявку. Если есть встречная PENDING — авто-принятие. */
  async sendRequest(
    viewer: JwtPayload,
    targetId: string,
  ): Promise<{ status: 'pending' | 'accepted' }> {
    if (targetId === viewer.sub) {
      throw new AppException('BAD_REQUEST', 'Нельзя добавить в друзья самого себя')
    }
    // Работодатель в друзья не добавляет и не добавляется: дружба снимает правило «свой
    // вуз» для личной переписки (§50) и была бы для компании обходом допуска вуза.
    if (viewer.role === Role.EMPLOYER) {
      throw new AppException('FORBIDDEN', 'Работодатель не добавляет в друзья')
    }
    // Охрана и библиотекарь друзей не имеют вовсе (§2.1): заявку им не принять и не увидеть.
    const target = await this.prisma.user.findFirst({
      where: {
        id: targetId,
        deletedAt: null,
        isBlocked: false,
        role: { notIn: [Role.EMPLOYER, ...RESTRICTED_ROLES] },
      },
      select: { id: true },
    })
    if (!target) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    // Личная блокировка в любую сторону закрывает и заявки: иначе заблокированный продолжал
    // бы стучаться уведомлениями «хочет добавить вас в друзья».
    await this.assertNotBlocked(viewer.sub, targetId)

    // Пауза после отклонения читается до транзакции: ждать Redis, держа лок пары, незачем.
    const paused = await this.isRequestPaused(viewer.sub, targetId)

    const outcome = await this.prisma
      .$transaction(async (tx) => {
        // Лок пары: одновременные A→B и B→A иначе обе видели «связи нет» и создавали по
        // PENDING-строке — уникальный индекс направленный и встречную пару не ловит. Под локом
        // второй запрос видит первую заявку и принимает её как встречную.
        await advisoryXactLock(tx, pairLockKey(viewer.sub, targetId))
        const existing = await this.findBetween(viewer.sub, targetId, tx)
        if (existing) {
          if (existing.status === 'ACCEPTED') {
            throw new AppException('CONFLICT', 'Вы уже друзья')
          }
          // Встречная заявка (адресат — я) → принимаем.
          if (existing.addresseeId === viewer.sub) {
            const duplicateId = await this.acceptInTx(
              tx,
              existing.id,
              existing.requesterId,
              viewer.sub,
            )
            return {
              kind: 'accepted' as const,
              friendshipId: existing.id,
              requesterId: existing.requesterId,
              duplicateId,
            }
          }
          throw new AppException('CONFLICT', 'Заявка уже отправлена')
        }
        // Пауза мешает только новой заявке: встречную (выше) принять можно и во время паузы.
        if (paused) {
          throw new AppException(
            'CONFLICT',
            'Пользователь недавно отклонил вашу заявку — отправить новую пока нельзя',
          )
        }
        const created = await tx.friendship.create({
          data: { requesterId: viewer.sub, addresseeId: targetId },
          select: { id: true },
        })
        return { kind: 'created' as const, friendshipId: created.id }
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AppException('CONFLICT', 'Заявка уже существует')
        }
        throw error
      })

    // Уведомления — после коммита: job в очереди не должен ссылаться на откатившуюся связь.
    if (outcome.kind === 'accepted') {
      await this.afterAccept(
        outcome.friendshipId,
        outcome.requesterId,
        viewer.sub,
        outcome.duplicateId,
      )
      return { status: 'accepted' }
    }
    const friendshipId = outcome.friendshipId
    if (!(await this.claimRequestNotice(viewer.sub, targetId))) return { status: 'pending' }
    // Имя отправителя — для тела уведомления с кнопками принять/отклонить.
    const requester = await this.prisma.user.findUnique({
      where: { id: viewer.sub },
      select: { firstName: true, lastName: true },
    })
    const name =
      `${requester?.firstName ?? ''} ${requester?.lastName ?? ''}`.trim() || 'Пользователь'
    await this.notify(targetId, NOTIFICATION_JOBS.FRIEND_REQUEST, {
      titleKey: 'friends.request.title',
      bodyKey: 'friends.request.body',
      params: { name },
      dedupeKey: `friend-request:${friendshipId}`,
      // kind/friendshipId — чтобы колокольчик показал кнопки принять/отклонить прямо в уведомлении.
      data: {
        kind: 'friend-request',
        friendshipId,
        requesterId: viewer.sub,
        url: `/profile/${viewer.sub}`,
      },
    })
    return { status: 'pending' }
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
    // Заявку от того, кто заблокирован (или кто заблокировал), не принять: висящая заявка
    // от заблокированного иначе превращалась в дружбу, а дружба открывает закрытый профиль.
    await this.assertNotBlocked(viewer.sub, f.requesterId)
    // Под тем же локом пары, что и sendRequest: принятие и встречная заявка не пересекаются.
    const duplicateId = await this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, pairLockKey(viewer.sub, f.requesterId))
      return this.acceptInTx(tx, f.id, f.requesterId, viewer.sub)
    })
    await this.afterAccept(f.id, f.requesterId, viewer.sub, duplicateId)
  }

  /** Удалить связь: отмена исходящей / отклонение входящей / удаление из друзей (любой участник). */
  async remove(viewer: JwtPayload, friendshipId: string): Promise<void> {
    const f = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
      select: { id: true, requesterId: true, addresseeId: true, status: true },
    })
    if (!f) {
      throw new AppException('NOT_FOUND', 'Связь не найдена')
    }
    if (f.requesterId !== viewer.sub && f.addresseeId !== viewer.sub) {
      throw new AppException('FORBIDDEN', 'Нет доступа к этой связи')
    }
    await this.prisma.friendship.delete({ where: { id: f.id } })
    // Отклонение/отмена/удаление — гасим уведомление-заявку у получателя. Отправителю НИЧЕГО
    // не шлём (по требованию: при отклонении инициатор ничего не получает).
    await this.clearRequestNotification(f.id, f.addresseeId)
    // Отклонение — адресат снимает висящую заявку — ставит паузу на повтор. Отмена своей
    // заявки и удаление из друзей паузы не ставят.
    if (f.status === 'PENDING' && f.addresseeId === viewer.sub) {
      await this.pauseRequests(f.requesterId, f.addresseeId)
    }
  }

  /** Список друзей (принятые) — карточка «другого» пользователя. Cursor по id связи. */
  async listFriends(viewer: JwtPayload, query: FriendsListQueryInput): Promise<Paginated<unknown>> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: this.withActiveCounterpart(viewer.sub),
        ...(await this.notBlockedWhere(viewer.sub)),
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
    const direction: Prisma.FriendshipWhereInput =
      query.direction === 'outgoing'
        ? { status: 'PENDING', requesterId: viewer.sub, addressee: ACTIVE_USER }
        : { status: 'PENDING', addresseeId: viewer.sub, requester: ACTIVE_USER }
    const where: Prisma.FriendshipWhereInput = {
      ...direction,
      ...(await this.notBlockedWhere(viewer.sub)),
    }
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
    const notBlocked = await this.notBlockedWhere(viewer.sub)
    const [friends, incomingRequests] = await this.prisma.$transaction([
      this.prisma.friendship.count({
        where: {
          status: 'ACCEPTED',
          OR: this.withActiveCounterpart(viewer.sub),
          ...notBlocked,
        },
      }),
      this.prisma.friendship.count({
        where: {
          status: 'PENDING',
          addresseeId: viewer.sub,
          requester: ACTIVE_USER,
          ...notBlocked,
        },
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

  /** Личная блокировка между двумя пользователями в любую сторону → FORBIDDEN. */
  private async assertNotBlocked(a: string, b: string): Promise<void> {
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { id: true },
    })
    if (blocked) {
      throw new AppException('FORBIDDEN', 'Заявка недоступна: пользователь заблокирован')
    }
  }

  /**
   * Фильтр связей, исключающий тех, с кем у смотрящего личная блокировка. Блокировка сама
   * удаляет дружбу и заявки (ChatsService.blockUser), но пары, заблокированные раньше, остались
   * друзьями в базе — в списках и счётчиках их не показываем. Сам смотрящий в списке не
   * встречается (себя не заблокировать), поэтому условие на обе стороны связи корректно.
   */
  private async notBlockedWhere(viewerId: string): Promise<Prisma.FriendshipWhereInput> {
    const blocks = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
      take: BLOCKS_SCAN_LIMIT,
    })
    if (blocks.length === 0) return {}
    const ids = blocks.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId))
    // Через AND, а не полями верхнего уровня: иначе спред затёр бы requesterId/addresseeId
    // самого запроса («мои исходящие», «мне входящие»).
    return { AND: [{ requesterId: { notIn: ids } }, { addresseeId: { notIn: ids } }] }
  }

  /** Связи смотрящего, где второй участник — живой аккаунт (ACTIVE_USER). Для `OR` в where. */
  private withActiveCounterpart(viewerId: string): Prisma.FriendshipWhereInput[] {
    return [
      { requesterId: viewerId, addressee: ACTIVE_USER },
      { addresseeId: viewerId, requester: ACTIVE_USER },
    ]
  }

  private findBetween(a: string, b: string, db: Prisma.TransactionClient = this.prisma) {
    return db.friendship.findFirst({
      where: {
        OR: [
          { requesterId: a, addresseeId: b },
          { requesterId: b, addresseeId: a },
        ],
      },
      select: { id: true, requesterId: true, addresseeId: true, status: true },
      // Две строки на пару — след гонки встречных заявок до лока пары. Порядок закреплён, чтобы
      // кнопка в профиле и sendRequest видели одну и ту же строку: принятая главнее заявки
      // (enum в Postgres сортируется по объявлению, PENDING < ACCEPTED), из двух заявок — ранняя.
      orderBy: [{ status: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
  }

  /**
   * Принять заявку внутри транзакции под локом пары. Условие PENDING стоит в самом UPDATE —
   * уже принятую или снятую заявку второй раз не принять. Встречная строка той же пары
   * (принявший → инициатор) — дубль из времён до лока — удаляется: дружбу держит одна строка.
   * Возвращает id удалённого дубля, чтобы погасить и его уведомление-заявку.
   */
  private async acceptInTx(
    tx: Prisma.TransactionClient,
    friendshipId: string,
    requesterId: string,
    accepterId: string,
  ): Promise<string | null> {
    const { count } = await tx.friendship.updateMany({
      where: { id: friendshipId, status: 'PENDING' },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    })
    if (count === 0) {
      throw new AppException('CONFLICT', 'Заявка уже обработана')
    }
    const duplicate = await tx.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: accepterId, addresseeId: requesterId } },
      select: { id: true },
    })
    if (!duplicate || duplicate.id === friendshipId) return null
    await tx.friendship.delete({ where: { id: duplicate.id } })
    return duplicate.id
  }

  /**
   * После коммита принятия: гасим уведомления-заявки, снимаем висящий запрос на переписку
   * пары (§3.6 — дружба тоже согласие) и уведомляем инициатора.
   */
  private async afterAccept(
    friendshipId: string,
    requesterId: string,
    accepterId: string,
    duplicateId: string | null,
  ): Promise<void> {
    await this.clearRequestNotification(friendshipId, accepterId)
    // Дубль — встречная заявка принявшего: её уведомление лежит у инициатора.
    if (duplicateId) await this.clearRequestNotification(duplicateId, requesterId)
    try {
      await this.chats.clearRequestBetween(requesterId, accepterId)
    } catch (error) {
      // Дружба уже принята; запрос всё равно снимется первой же репликой (resolveChatRequest).
      this.logger.warn({ err: error, friendshipId }, 'Запрос на переписку не снят после дружбы')
    }
    await this.notify(requesterId, NOTIFICATION_JOBS.FRIEND_ACCEPTED, {
      titleKey: 'friends.accepted.title',
      bodyKey: 'friends.accepted.body',
      dedupeKey: `friend-accepted:${friendshipId}`,
      data: { url: `/profile/${accepterId}` },
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
    n: {
      titleKey: NotificationMessageKey
      bodyKey: NotificationMessageKey
      params?: NotificationParams
      dedupeKey: string
      data?: Record<string, unknown>
    },
  ): Promise<void> {
    // Тип SYSTEM доставляется всегда (не зависит от пер-тип настроек).
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      job,
      {
        recipientIds: [recipientId],
        type: 'SYSTEM',
        titleKey: n.titleKey,
        bodyKey: n.bodyKey,
        params: n.params,
        data: n.data ?? {},
        dedupeKey: n.dedupeKey,
      },
      { jobId: n.dedupeKey },
    )
  }

  /** Действует ли пауза после отклонения. Redis недоступен — пауза не главнее заявки: пропускаем. */
  private async isRequestPaused(requesterId: string, addresseeId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(declinePauseKey(requesterId, addresseeId))) > 0
    } catch (error) {
      this.logger.warn(`Пауза повторной заявки не проверена: ${(error as Error).message}`)
      return false
    }
  }

  /**
   * Занять окно уведомления о заявке пары: false — адресата в эти сутки уже будили.
   * Redis недоступен — уведомляем: пропущенная заявка хуже лишнего уведомления.
   */
  private async claimRequestNotice(requesterId: string, addresseeId: string): Promise<boolean> {
    try {
      const claimed = await this.redis.set(
        requestNoticeKey(requesterId, addresseeId),
        '1',
        'EX',
        REQUEST_NOTICE_WINDOW_SECONDS,
        'NX',
      )
      return claimed === 'OK'
    } catch (error) {
      this.logger.warn(`Окно уведомления о заявке не проверено: ${(error as Error).message}`)
      return true
    }
  }

  /** Поставить паузу на повторную заявку. Ошибка Redis не мешает самому отклонению. */
  private async pauseRequests(requesterId: string, addresseeId: string): Promise<void> {
    try {
      await this.redis.set(
        declinePauseKey(requesterId, addresseeId),
        '1',
        'EX',
        DECLINE_PAUSE_SECONDS,
      )
    } catch (error) {
      this.logger.warn(`Пауза повторной заявки не поставлена: ${(error as Error).message}`)
    }
  }

  // Гасим уведомление-заявку у получателя после принятия/отклонения (dedupeKey одноразовый).
  // Вместе со строкой сбрасываем его кэш непрочитанных: иначе бейдж колокольчика показывал
  // удалённую заявку до истечения кэша (§10.1 — любая мутация уведомлений его сбрасывает).
  private async clearRequestNotification(friendshipId: string, recipientId: string): Promise<void> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { dedupeKey: `friend-request:${friendshipId}` },
    })
    if (count > 0) await this.notifications.invalidateUnread(recipientId)
  }
}
