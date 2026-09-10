import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { ChatType, Prisma } from '@prisma/client'
import type {
  CreateChatInput,
  ChatListQueryInput,
  ChatMessagesQueryInput,
  ChatMediaQueryInput,
  ChatUpdatesQueryInput,
  CreateChatPollInput,
  CursorPaginationInput,
  MessageSearchQueryInput,
  MessageSendInput,
  PollVoteInput,
  ScheduleMessageInput,
  UpdateScheduledMessageInput,
} from '@studenthub/shared-schemas'
import { MESSAGE_EDIT_WINDOW_MS } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { buildPublicObjectUrl } from '../../common/minio/public-url'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { LINK_PREVIEW_JOBS, NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { RealtimeGateway } from '../../common/realtime'
import { FileService } from '../files/file.service'
import { PostsService } from '../posts/posts.service'
import type { EnvVars } from '../../config/env.schema'

/** Проголосовавший в неанонимном опросе (§39). */
interface PollVoter {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
}

const SENDER_SELECT = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }

// Потолок дельты догона (GET /chats/:id/updates). Больше — клиенту дешевле перезапросить историю,
// чем склеивать: непрерывность ленты всё равно не гарантируется.
const CHAT_UPDATES_LIMIT = 200

// Потолки на списки (BACKEND_RULES §7.2 «findMany без take запрещён»). Список чатов теперь
// страничный (cursor), и его спутники считаются от размера страницы — см. peerLimit
// в listChats. Рассылки участникам обязаны дойти до всех и читаются батчами (allMembers).
const BLOCKED_LIST_LIMIT = 200
/** Голоса одного пользователя в одном опросе: не больше, чем вариантов. */
const POLL_VOTES_LIMIT = 100
/** Сколько голосов неанонимного опроса раскрываем по именам (§39). */
const POLL_VOTERS_LIMIT = 300
/** Реакция на сообщение одна на пользователя; потолок — страховка от исторических дублей. */
const MESSAGE_REACTION_LIMIT = 10
/** Размер батча при чтении участников чата целиком. */
const MEMBER_BATCH = 500

/** Участник в контексте рассылки уведомлений: членство + режим заглушения (§17). */
interface ChatMemberNotifyRow {
  userId: string
  mutedAt: Date | null
  mutedUntil: Date | null
  muteImportantOnly: boolean
}

// С какого момента сообщения считаются непрочитанными: позднее из «последнего прочтения»
// и «очистки истории у себя». Оба могут быть null — тогда непрочитано всё, что есть.
function unreadFloor(m: { lastReadAt: Date | null; clearedAt: Date | null }): Date | null {
  if (!m.lastReadAt) return m.clearedAt
  if (!m.clearedAt) return m.lastReadAt
  return m.lastReadAt > m.clearedAt ? m.lastReadAt : m.clearedAt
}

// Потолок разбора членств для сводного счётчика непрочитанного (см. getUnreadSummary).
const UNREAD_SCAN_LIMIT = 500

// Заглушён ли участник (§17): навсегда (mutedAt) или на время (mutedUntil ещё не истёк).
function isMemberMuted(m: { mutedAt: Date | null; mutedUntil: Date | null }): boolean {
  return m.mutedAt != null || (m.mutedUntil != null && m.mutedUntil.getTime() > Date.now())
}

// Общие материалы (§23): фильтр MIME по типу вкладки правой панели.
function mediaMimeWhere(type: 'media' | 'file' | 'voice'): Prisma.FileWhereInput {
  if (type === 'voice') return { mime: { startsWith: 'audio/' } }
  if (type === 'media')
    return { OR: [{ mime: { startsWith: 'image/' } }, { mime: { startsWith: 'video/' } }] }
  return {
    NOT: [
      { mime: { startsWith: 'image/' } },
      { mime: { startsWith: 'video/' } },
      { mime: { startsWith: 'audio/' } },
    ],
  }
}

type MediaSenderRow = { id: string; firstName: string; lastName: string; avatarUrl: string | null }
type ChatMediaRow = {
  id: string
  messageId: string
  name: string | null
  mime: string
  size: number
  hasPoster: boolean
  createdAt: Date
  sender: MediaSenderRow | null
}
type ChatLinkRow = {
  messageId: string
  createdAt: Date
  sender: MediaSenderRow | null
  linkPreview: Prisma.JsonValue
}

const MESSAGE_SELECT = {
  id: true,
  chatId: true,
  // Позиция в чате: клиент хранит максимальный полученный seq и догоняет разницу после обрыва.
  seq: true,
  senderId: true,
  content: true,
  replyToId: true,
  forwardedFromId: true,
  editedAt: true,
  pinnedAt: true,
  createdAt: true,
  linkPreview: true,
  systemType: true,
  systemMeta: true,
  sender: SENDER_SELECT,
  media: { select: { id: true, mime: true, size: true, name: true, spoiler: true } },
  // Процитированный фрагмент: клиент рисует его вместо начала исходного сообщения.
  replyQuote: true,
  // «Без звука»: клиенту нужен для пометки у своего сообщения («отправлено без звука»).
  silent: true,
  replyTo: {
    select: { id: true, content: true, senderId: true, sender: SENDER_SELECT },
  },
  forwardedFrom: {
    select: { id: true, senderId: true, sender: SENDER_SELECT },
  },
  // Превью-карточка расшаренного поста (share-to-chat): автор, текст, первая медиа-миниатюра.
  sharedPost: {
    select: {
      id: true,
      title: true,
      content: true,
      authorId: true,
      deletedAt: true,
      author: SENDER_SELECT,
      media: { select: { id: true, mime: true }, take: 1 },
      _count: { select: { comments: true, reactions: true } },
    },
  },
  reactions: { select: { emoji: true, userId: true, user: SENDER_SELECT } },
  // Опрос (§38): только статика — вопрос/настройки/варианты. Результаты (счётчики + мой голос,
  // с учётом анонимности) отдаёт отдельный viewer-aware эндпоинт getPollResults.
  poll: {
    select: {
      id: true,
      question: true,
      multiple: true,
      anonymous: true,
      allowRevote: true,
      randomOrder: true,
      closed: true,
      options: { select: { id: true, text: true, order: true }, orderBy: { order: 'asc' } },
    },
  },
} satisfies Prisma.MessageSelect

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>

// Окно троттлинга провижининга официальных чатов на пользователя (см. ensureOfficialChatsThrottled).
const CHAT_ENSURE_TTL_SECONDS = 600

// Антифлуд отправки: не больше FLOOD_MAX сообщений за окно (см. assertNotFlooding).
const FLOOD_MAX = 20
const FLOOD_WINDOW_SECONDS = 10

// §50: сколько сообщений инициатор может отправить в ещё не принятый запрос на переписку.
const REQUEST_MESSAGE_QUOTA = 5

// Отложенные сообщения: потолок «в очереди» на чат и размер батча доставки за один тик cron.
const SCHEDULED_PER_CHAT_LIMIT = 50
const SCHEDULED_BATCH = 500

const SCHEDULED_SELECT = {
  id: true,
  content: true,
  replyToId: true,
  replyQuote: true,
  silent: true,
  scheduledAt: true,
  createdAt: true,
} satisfies Prisma.ScheduledMessageSelect

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeGateway,
    private readonly files: FileService,
    private readonly posts: PostsService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── Членство ────────────────────────────────────────────────────────────────

  /** Проверка членства (для REST и WS chat:join). Возвращает id участников либо бросает. */
  async assertMembership(userId: string, chatId: string): Promise<void> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true, bannedAt: true },
    })
    if (!member) {
      throw new AppException('WRONG_SCOPE', 'Вы не участник этого чата')
    }
    // Забаненный участник теряет доступ к чату (не может читать/писать).
    if (member.bannedAt) {
      throw new AppException('FORBIDDEN', 'Вы заблокированы в этом чате')
    }
  }

  async isMember(userId: string, chatId: string): Promise<boolean> {
    const m = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true },
    })
    return m !== null
  }

  // ── Список чатов (9.5/9.6) ──────────────────────────────────────────────────

  async listChats(viewer: JwtPayload, query: ChatListQueryInput): Promise<Paginated<unknown>> {
    // Провижининг официальных чатов — только на первой странице: на второй он бы
    // повторял ту же проверку ради тех же уже созданных чатов.
    if (!query.cursor) await this.ensureOfficialChatsThrottled(viewer)
    const chats = await this.prisma.chat.findMany({
      // Забаненные (bannedAt != null) и скрытые «у себя» (hiddenAt != null) чаты в списке не показываем.
      where: { members: { some: { userId: viewer.sub, bannedAt: null, hiddenAt: null } } },
      select: {
        id: true,
        type: true,
        title: true,
        avatarUrl: true,
        createdById: true,
        groupId: true,
        facultyId: true,
        universityId: true,
        subject: true,
        requestPendingForId: true,
        updatedAt: true,
        members: {
          where: { userId: viewer.sub },
          select: {
            lastReadAt: true,
            mutedAt: true,
            mutedUntil: true,
            muteImportantOnly: true,
            isAdmin: true,
            clearedAt: true,
            draft: true,
            pinnedAt: true,
            archivedAt: true,
          },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: MESSAGE_SELECT,
        },
        _count: { select: { members: true } },
      },
      // Стабильный порядок под курсор: id — вторая ступень, иначе чаты с одинаковым
      // updatedAt перемешивались бы между страницами. Закреплённые наверх поднимает
      // клиент по pinnedAt: внутри страницы это сделать нельзя, порядок нужен сквозной.
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = chats.length > query.limit
    if (hasNext) chats.length = query.limit
    // Watermark прочтения другими участниками — для статусов доставки своих сообщений (Ф9+).
    const chatIds = chats.map((c) => c.id)
    const reads =
      chatIds.length > 0
        ? await this.prisma.chatMember.groupBy({
            by: ['chatId'],
            where: {
              chatId: { in: chatIds },
              userId: { not: viewer.sub },
              lastReadAt: { not: null },
            },
            _max: { lastReadAt: true },
          })
        : []
    const readMap = new Map(reads.map((r) => [r.chatId, r._max.lastReadAt]))

    // Статус блокировки для PRIVATE-чатов: второй участник + наличие UserBlock в любую сторону.
    const privateIds = chats.filter((c) => c.type === ChatType.PRIVATE).map((c) => c.id)
    // По одной строке собеседника на личный чат страницы и до двух блокировок на пару.
    const peerLimit = query.limit * 2
    const others =
      privateIds.length > 0
        ? await this.prisma.chatMember.findMany({
            where: { chatId: { in: privateIds }, userId: { not: viewer.sub } },
            take: peerLimit,
            select: {
              chatId: true,
              userId: true,
              user: { select: { avatarUrl: true, firstName: true, lastName: true } },
            },
          })
        : []
    const otherMap = new Map(others.map((o) => [o.chatId, o.userId]))
    // Аватар собеседника — для показа в личных чатах вместо инициалов.
    const otherAvatarMap = new Map(others.map((o) => [o.chatId, o.user?.avatarUrl ?? null]))
    // Имя собеседника — заголовок PRIVATE-чата (у самой сущности chat.title = null).
    const otherNameMap = new Map(
      others.map((o) => [o.chatId, `${o.user?.lastName ?? ''} ${o.user?.firstName ?? ''}`.trim()]),
    )
    const otherIds = [...new Set(others.map((o) => o.userId))]
    const blocks =
      otherIds.length > 0
        ? await this.prisma.userBlock.findMany({
            where: {
              OR: [
                { blockerId: viewer.sub, blockedId: { in: otherIds } },
                { blockedId: viewer.sub, blockerId: { in: otherIds } },
              ],
            },
            // Не больше двух записей на собеседника (по одной в каждую сторону).
            take: peerLimit,
            select: { blockerId: true, blockedId: true },
          })
        : []
    const iBlocked = new Set(
      blocks.filter((b) => b.blockerId === viewer.sub).map((b) => b.blockedId),
    )
    const blockedMe = new Set(
      blocks.filter((b) => b.blockedId === viewer.sub).map((b) => b.blockerId),
    )
    // Онлайн-статус собеседника в личных чатах — для индикатора в списке (снимок на момент запроса).
    const onlineOthers = new Set(this.realtime.onlineAmong(otherIds))

    // Числовой счётчик непрочитанных: считаем только для чатов, где вообще есть непрочитанное
    // (последнее сообщение чужое и позже watermark'а), чтобы не делать COUNT по всем чатам.
    const needCount = chats.filter((c) => {
      const lm = c.messages[0]
      const mem = c.members[0]
      if (!lm || !mem) return false
      const floor = unreadFloor(mem)
      const cleared = mem.clearedAt
      const afterClear = !cleared || lm.createdAt > cleared
      return lm.senderId !== viewer.sub && afterClear && (floor === null || lm.createdAt > floor)
    })
    // Непрочитанные — ОДНИМ запросом на все чаты с непрочитанным (иначе N COUNT-ов по числу
    // чатов). Пер-чатовый порог createdAt задаём OR-ветками; senderId/deletedAt общие для всех.
    const countBranches = needCount.map((c) => {
      const floor = unreadFloor(c.members[0]!)
      return { chatId: c.id, ...(floor ? { createdAt: { gt: floor } } : {}) }
    })
    const grouped =
      countBranches.length > 0
        ? await this.prisma.message.groupBy({
            by: ['chatId'],
            where: { deletedAt: null, senderId: { not: viewer.sub }, OR: countBranches },
            _count: { _all: true },
          })
        : []
    const countMap = new Map(grouped.map((g) => [g.chatId, g._count._all]))

    const rows = chats.map((c) => {
      const mem = c.members[0]
      const cleared = mem?.clearedAt ?? null
      // Очищенную «для меня» историю не показываем в превью.
      const lastMessage =
        c.messages[0] && (!cleared || c.messages[0].createdAt > cleared) ? c.messages[0] : null
      const unreadCount = countMap.get(c.id) ?? 0
      const unread = unreadCount > 0
      const other = otherMap.get(c.id)
      const pinnedAt = mem?.pinnedAt ?? null
      return {
        pinnedAt,
        updatedAt: c.updatedAt,
        item: {
          id: c.id,
          type: c.type,
          // Личный чат — имя собеседника (в сущности chat.title = null); групповой/официальный — своё название.
          title: c.type === ChatType.PRIVATE ? otherNameMap.get(c.id) || c.title : c.title,
          // Личный чат — аватар собеседника; групповой — аватар группы.
          avatarUrl: c.type === ChatType.PRIVATE ? (otherAvatarMap.get(c.id) ?? null) : c.avatarUrl,
          subject: c.subject,
          memberCount: c._count.members,
          lastMessage,
          unread,
          unreadCount,
          muted: mem ? isMemberMuted(mem) : false,
          // §17: заглушено, но важное (ответы мне и упоминания) всё равно уведомляет.
          mutedImportantOnly: mem?.muteImportantOnly ?? false,
          draft: mem?.draft ?? null,
          // Закреплён «у себя» (Telegram-стиль): показывается сверху списка. Время нужно
          // клиенту: страницы приходят по updatedAt, и «закреплённые сверху» он собирает
          // сам поверх всех загруженных страниц.
          pinned: pinnedAt != null,
          pinnedAt,
          // Архив «у себя»: чат уезжает в отдельную вкладку. Список отдаёт его как обычно —
          // раскладывает по вкладкам клиент, как и непринятые запросы.
          archived: mem?.archivedAt != null,
          othersReadAt: readMap.get(c.id) ?? null,
          // Владелец группы (создатель).
          isOwner: c.createdById != null && c.createdById === viewer.sub,
          // Я — админ группы (могу банить, менять аватар/название, управлять участниками).
          isAdmin: mem?.isAdmin === true,
          // Блокировка (только для PRIVATE): blocked — я заблокировал собеседника; blockedBy — он меня.
          blocked: other ? iBlocked.has(other) : false,
          blockedBy: other ? blockedMe.has(other) : false,
          // Собеседник онлайн (только PRIVATE); для групп/официальных чатов — false.
          online: other != null && onlineOthers.has(other),
          // Запрос на переписку (§50): incoming — решение за мной (чат живёт во вкладке
          // «Запросы» и никуда больше не попадает); outgoing — я написал и жду принятия.
          requestIncoming: c.requestPendingForId === viewer.sub,
          requestOutgoing: c.requestPendingForId != null && c.requestPendingForId !== viewer.sub,
          updatedAt: c.updatedAt,
        },
      }
    })
    // Пустая оболочка непринятого запроса адресату не показывается: чат заводится уже по
    // клику в поиске людей, и без первого сообщения показывать во «Запросах» нечего —
    // человек увидел бы карточку, за которой ничего нет. Инициатор свой чат видит всегда:
    // он в нём и пишет.
    const visible = rows.filter((r) => !(r.item.requestIncoming && r.item.lastMessage === null))
    // Курсор — id последнего чата СТРАНИЦЫ (до фильтрации пустых оболочек запроса):
    // иначе отфильтрованный хвост уронил бы точку продолжения и страница повторилась бы.
    const cursor = hasNext ? chats[chats.length - 1]?.id : undefined
    return new Paginated(
      visible.map((r) => r.item),
      { cursor, hasNext },
    )
  }

  /**
   * Сводка непрочитанного для бейджа в навигации.
   *
   * Отдельный лёгкий эндпоинт, а не «посчитать по GET /chats»: список чатов клиент тянет
   * страницами и целиком, а бейдж нужен на каждом экране приложения — грузить ради числа
   * всю переписку со всеми превью незачем.
   *
   * Непринятые входящие запросы (§50) в счётчик не идут: согласия на переписку ещё не было,
   * и бейдж по ним требовал бы внимания к тому, что человек, возможно, отклонит.
   */
  async getUnreadSummary(viewer: JwtPayload): Promise<{ chats: number; messages: number }> {
    const members = await this.prisma.chatMember.findMany({
      // Архив ради того и нужен, чтобы эти чаты перестали требовать внимания — в бейдж
      // они не идут.
      where: { userId: viewer.sub, bannedAt: null, hiddenAt: null, archivedAt: null },
      select: {
        chatId: true,
        lastReadAt: true,
        clearedAt: true,
        chat: { select: { requestPendingForId: true } },
      },
      take: UNREAD_SCAN_LIMIT,
    })
    // Пер-чатовый порог задаём OR-ветками: у каждого чата своя точка прочтения, и одним
    // общим условием это не выражается — иначе пришлось бы делать COUNT на каждый чат.
    const branches = members
      .filter((m) => m.chat.requestPendingForId !== viewer.sub)
      .map((m) => {
        const floor = unreadFloor(m)
        return { chatId: m.chatId, ...(floor ? { createdAt: { gt: floor } } : {}) }
      })
    if (branches.length === 0) return { chats: 0, messages: 0 }
    const grouped = await this.prisma.message.groupBy({
      by: ['chatId'],
      where: { deletedAt: null, senderId: { not: viewer.sub }, OR: branches },
      _count: { _all: true },
    })
    return {
      chats: grouped.length,
      messages: grouped.reduce((sum, g) => sum + g._count._all, 0),
    }
  }

  // ── Создание PRIVATE/GROUP (9.5) ────────────────────────────────────────────

  async createChat(actor: JwtPayload, input: CreateChatInput) {
    const memberIds = [...new Set([actor.sub, ...input.memberIds])]
    // Друзья — единственное, что открывает переписку сразу; всем остальным уходит запрос (§50).
    let requestPendingForId: string | null = null
    // Личный чат с заблокированным (в любую сторону) создать нельзя.
    if (input.type === 'PRIVATE') {
      const other = memberIds.find((id) => id !== actor.sub)
      if (other && (await this.isBlockedBetween(actor.sub, other))) {
        throw new AppException('FORBIDDEN', 'Переписка недоступна: пользователь заблокирован')
      }
      // Между двумя людьми личный чат ровно один. Кнопка «Написать сообщение» в профиле
      // (и в панели участников группы) вызывает этот же эндпоинт, поэтому без поиска
      // существующего каждое нажатие плодило новый чат: в списке появлялись дубли с одним
      // и тем же собеседником, а переписка расходилась по ним.
      //
      // Скрытый «у себя» чат (hiddenAt) тоже переиспользуем: членство при удалении
      // сохраняется, и заводить рядом второй значило бы потерять историю у собеседника.
      // Из списка он вернётся сам — hiddenAt снимается при первом же сообщении.
      if (other) {
        const existing = await this.findPrivateChat(actor.sub, other)
        if (existing) return existing
        // Новый личный чат — только внутри своего вуза (§50). Дружба важнее скоупа: связь
        // Friendship вуза не знает, и уже сложившимся друзьям переписку рвать нельзя.
        const friends = await this.areFriends(actor.sub, other)
        await this.assertCanStartPrivate(actor, other, friends)
        if (!friends) requestPendingForId = other
      }
    }
    const chat = await this.prisma.chat.create({
      data: {
        type: input.type as ChatType,
        title: input.title,
        // Создатель — «админ» пользовательской группы (для бана/аватара).
        createdById: input.type === 'GROUP' ? actor.sub : null,
        requestPendingForId,
        members: {
          create: memberIds.map((userId) => ({
            userId,
            isAdmin: input.type === 'GROUP' && userId === actor.sub,
          })),
        },
      },
      select: { id: true, type: true, title: true, requestPendingForId: true },
    })
    return chat
  }

  /** Есть ли принятая дружба между двумя пользователями. */
  private async areFriends(a: string, b: string): Promise<boolean> {
    const row = await this.prisma.friendship.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { requesterId: a, addresseeId: b },
          { requesterId: b, addresseeId: a },
        ],
      },
      select: { id: true },
    })
    return row !== null
  }

  /**
   * Кому вообще можно завести личный чат (§50): своему вузу. Друзьям — всегда (см. выше).
   * Роли вне вуза (платформенные, работодатель) под ограничение не попадают: universityId
   * у них null, и сравнивать не с чем — их доступ ограничивают другие правила.
   */
  private async assertCanStartPrivate(
    actor: JwtPayload,
    otherId: string,
    friends: boolean,
  ): Promise<void> {
    if (friends || actor.universityId == null) return
    const other = await this.prisma.user.findFirst({
      where: { id: otherId, deletedAt: null, isBlocked: false },
      select: { universityId: true },
    })
    if (!other) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    if (other.universityId != null && other.universityId !== actor.universityId) {
      throw new AppException('FORBIDDEN', 'Написать можно только людям своего вуза')
    }
  }

  /**
   * Уведомление о запросе на переписку. Одно на чат: дальнейшие сообщения инициатора
   * уведомлений не создают (notifyNewMessage вырезает адресата, пока запрос не принят) —
   * иначе непринятый запрос работал бы как обычный чат и обходил само согласие.
   */
  private async notifyChatRequest(fromId: string, toId: string, chatId: string): Promise<void> {
    const from = await this.prisma.user.findUnique({
      where: { id: fromId },
      select: { firstName: true, lastName: true },
    })
    const name = `${from?.lastName ?? ''} ${from?.firstName ?? ''}`.trim() || 'Пользователь'
    const dedupeKey = `chat-request:${chatId}`
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.CHAT_REQUEST,
      {
        recipientIds: [toId],
        // SYSTEM доставляется всегда, мимо пер-типовых настроек уведомлений о сообщениях:
        // само согласие на переписку — не сообщение, и отключать его отдельно нечем.
        type: 'SYSTEM',
        title: 'Запрос на переписку',
        body: `${name} хочет вам написать`,
        data: { kind: 'chat-request', chatId, url: `/chats?c=${chatId}` },
        dedupeKey,
      },
      { jobId: dedupeKey },
    )
  }

  /**
   * Принять запрос на переписку — чат становится обычным у обеих сторон.
   * Ответ адресата сообщением делает то же самое (createMessage), это явная кнопка.
   */
  async acceptChatRequest(userId: string, chatId: string): Promise<{ id: string }> {
    const chat = await this.requirePendingRequest(userId, chatId)
    await this.clearChatRequest(chat.id)
    // Обеим сторонам: у адресата чат уезжает из «Запросов», у инициатора снимается пометка.
    await this.pingChatList(chat.id)
    return { id: chat.id }
  }

  /**
   * Отклонить запрос — чат удаляется целиком (сообщения и членства уходят по каскаду).
   * Инициатору ничего не уведомляем: как и с заявками в друзья, отказ не сообщается.
   */
  async declineChatRequest(userId: string, chatId: string): Promise<void> {
    const chat = await this.requirePendingRequest(userId, chatId)
    const members = await this.allMembers(chat.id)
    await this.prisma.notification.deleteMany({ where: { dedupeKey: `chat-request:${chat.id}` } })
    await this.prisma.chat.delete({ where: { id: chat.id } })
    for (const m of members) this.realtime.emitToUser(m.userId, 'chat:activity', { chatId })
  }

  /** Чат, ждущий решения именно этого пользователя. Иначе — 404/409, без утечки чужих чатов. */
  private async requirePendingRequest(userId: string, chatId: string): Promise<{ id: string }> {
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, members: { some: { userId } } },
      select: { id: true, requestPendingForId: true },
    })
    if (!chat) throw new AppException('NOT_FOUND', 'Чат не найден')
    if (chat.requestPendingForId == null) {
      throw new AppException('CONFLICT', 'Запрос уже обработан')
    }
    if (chat.requestPendingForId !== userId) {
      throw new AppException('FORBIDDEN', 'Решение по запросу принимает адресат')
    }
    return { id: chat.id }
  }

  /**
   * Состояние запроса на переписку на момент отправки сообщения (§50). Возвращает того,
   * чьё согласие ещё не получено, или null.
   *
   * Живёт на пути каждого сообщения (все пять способов отправки сходятся в notifyNewMessage),
   * поэтому чат читается здесь ровно один раз и обслуживает сразу три вещи:
   * - ответ адресата = согласие: отдельная кнопка была бы лишним шагом после уже написанного;
   * - успевшая сложиться дружба снимает висящий запрос — согласие дано в другом месте;
   * - первое сообщение инициатора порождает то самое SYSTEM-уведомление о запросе. Оно
   *   привязано к чату, а не к созданию: оболочка заводится уже по клику в поиске людей, и
   *   уведомлять по ней значило бы дёргать человека тем, что ему как раз не написали.
   *   Процессор идемпотентен по dedupeKey, поэтому следующие сообщения его не задваивают.
   */
  private async resolveChatRequest(chatId: string, senderId: string): Promise<string | null> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { requestPendingForId: true },
    })
    const pendingFor = chat?.requestPendingForId ?? null
    if (pendingFor == null) return null
    if (pendingFor === senderId || (await this.areFriends(senderId, pendingFor))) {
      await this.clearChatRequest(chatId)
      return null
    }
    await this.notifyChatRequest(senderId, pendingFor, chatId)
    return pendingFor
  }

  /** Снять пометку запроса и погасить уведомление о нём (оно одноразовое). */
  private async clearChatRequest(chatId: string): Promise<void> {
    await this.prisma.chat.update({
      where: { id: chatId },
      data: { requestPendingForId: null },
    })
    await this.prisma.notification.deleteMany({ where: { dedupeKey: `chat-request:${chatId}` } })
  }

  /**
   * Существующий личный чат этой пары, если он есть.
   *
   * `every` отсекает чаты с третьим участником, два `some` требуют обоих из пары —
   * вместе это «участники ровно эти двое». Одного `some` не хватило бы: он совпал бы и
   * с чатом, где к паре кто-то добавлен.
   */
  private findPrivateChat(
    userId: string,
    otherId: string,
  ): Promise<{
    id: string
    type: ChatType
    title: string | null
    requestPendingForId: string | null
  } | null> {
    return this.prisma.chat.findFirst({
      where: {
        type: ChatType.PRIVATE,
        members: { every: { userId: { in: [userId, otherId] } } },
        AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherId } } }],
      },
      // Самый старый: в нём лежит переписка, если дубли успели накопиться до этой правки.
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, title: true, requestPendingForId: true },
    })
  }

  // ── История сообщений (9.5) — cursor ────────────────────────────────────────

  async getMessages(
    viewer: JwtPayload,
    chatId: string,
    query: ChatMessagesQueryInput,
  ): Promise<Paginated<MessageRow>> {
    await this.assertMembership(viewer.sub, chatId)
    // Очистка истории «для меня»: не отдаём сообщения старше clearedAt.
    const mem = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: viewer.sub } },
      select: { clearedAt: true },
    })
    const baseWhere: Prisma.MessageWhereInput = {
      chatId,
      deletedAt: null,
      ...(mem?.clearedAt ? { createdAt: { gt: mem.clearedAt } } : {}),
    }
    const limit = query.limit

    // Окно вокруг сообщения (Этап 1): jump-to-message / ссылка на сообщение.
    if (query.around) {
      const target = await this.prisma.message.findFirst({
        where: { ...baseWhere, id: query.around },
        select: { id: true, createdAt: true },
      })
      if (!target) throw new AppException('NOT_FOUND', 'Сообщение не найдено')
      return this.buildMessageWindow(baseWhere, target, limit)
    }

    // Окно вокруг ПЕРВОГО сообщения на/после даты (переход по дате / календарь, #5).
    // Нет сообщений на/после даты (дата в будущем) — проваливаемся к дефолту (новейшие).
    if (query.aroundDate) {
      const anchor = await this.prisma.message.findFirst({
        // Через AND, а не спредом: `createdAt` в baseWhere уже занят границей clearedAt,
        // и второй ключ `createdAt` затёр бы её — якорем становилось сообщение из
        // очищенной истории, и оно всплывало в чате после «Очистить историю».
        where: { AND: [baseWhere, { createdAt: { gte: new Date(query.aroundDate) } }] },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, createdAt: true },
      })
      if (anchor) return this.buildMessageWindow(baseWhere, anchor, limit)
    }

    // Подгрузка более НОВЫХ после jump (direction=newer): курсор — id самого нового загруженного.
    if (query.direction === 'newer' && query.cursor) {
      const rows = await this.prisma.message.findMany({
        where: baseWhere,
        select: MESSAGE_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        cursor: { id: query.cursor },
        skip: 1,
      })
      const hasPrev = rows.length > limit
      const asc = hasPrev ? rows.slice(0, limit) : rows
      const items = asc.reverse()
      return new Paginated(items, { prevCursor: items[0]?.id, hasPrev })
    }

    // По умолчанию — более СТАРЫЕ (текущее поведение, вниз истории вверх по скроллу).
    const rows = await this.prisma.message.findMany({
      where: baseWhere,
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = rows.length > limit
    const items = hasNext ? rows.slice(0, limit) : rows
    const nextCursor = hasNext ? items[items.length - 1]?.id : undefined
    return new Paginated(items, { cursor: nextCursor, hasNext })
  }

  /**
   * Разница по чату с позиции клиента — для догона после обрыва связи вместо перезапроса истории.
   *
   * `created` — сообщения новее `since` (по Message.seq). `mutated` — уже известные клиенту
   * сообщения, изменившиеся после `sinceTs` (правка, (от)закрепление). `deletedIds` — удалённые
   * за то же время: отдельным списком, потому что MESSAGE_SELECT намеренно не отдаёт deletedAt.
   *
   * `overflow` — новых оказалось больше лимита: клиент не может достроить непрерывную ленту и
   * должен перезапросить историю целиком. Снятие реакции дельтой не покрывается: удалённая строка
   * MessageReaction не оставляет следа (см. план, «Не входит»).
   */
  async getUpdates(
    viewer: JwtPayload,
    chatId: string,
    query: ChatUpdatesQueryInput,
  ): Promise<{
    created: MessageRow[]
    mutated: MessageRow[]
    deletedIds: string[]
    latestSeq: number
    overflow: boolean
  }> {
    await this.assertMembership(viewer.sub, chatId)
    // Очистка истории «для меня» — та же граница, что и в getMessages.
    const mem = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: viewer.sub } },
      select: { clearedAt: true },
    })
    const baseWhere: Prisma.MessageWhereInput = {
      chatId,
      ...(mem?.clearedAt ? { createdAt: { gt: mem.clearedAt } } : {}),
    }
    const sinceTs = query.sinceTs ? new Date(query.sinceTs) : undefined

    // Уже известные клиенту сообщения — только они могут «мутировать» с его точки зрения.
    const knownWhere: Prisma.MessageWhereInput = { ...baseWhere, seq: { lte: query.since } }

    const [createdRows, mutated, deleted, chat] = await Promise.all([
      this.prisma.message.findMany({
        where: { ...baseWhere, deletedAt: null, seq: { gt: query.since } },
        select: MESSAGE_SELECT,
        orderBy: { seq: 'asc' },
        take: CHAT_UPDATES_LIMIT + 1,
      }),
      sinceTs
        ? this.prisma.message.findMany({
            where: {
              ...knownWhere,
              deletedAt: null,
              OR: [{ editedAt: { gt: sinceTs } }, { pinnedAt: { gt: sinceTs } }],
            },
            select: MESSAGE_SELECT,
            orderBy: { seq: 'asc' },
            take: CHAT_UPDATES_LIMIT,
          })
        : Promise.resolve([]),
      sinceTs
        ? this.prisma.message.findMany({
            where: { ...knownWhere, deletedAt: { gt: sinceTs } },
            select: { id: true },
            orderBy: { seq: 'asc' },
            take: CHAT_UPDATES_LIMIT,
          })
        : Promise.resolve([]),
      this.prisma.chat.findUnique({ where: { id: chatId }, select: { lastSeq: true } }),
    ])

    // Разрыв больше лимита достроить нельзя — отдаём пустую дельту, клиент перезапросит историю.
    const overflow = createdRows.length > CHAT_UPDATES_LIMIT

    return {
      created: overflow ? [] : createdRows,
      mutated,
      deletedIds: deleted.map((m) => m.id),
      latestSeq: chat?.lastSeq ?? query.since,
      overflow,
    }
  }

  // Окно сообщений вокруг целевого (для around / aroundDate): до limit СТАРЕЕ + целевое + до limit НОВЕЕ,
  // всё по убыванию. meta: cursor/hasNext — старые (вверх), prevCursor/hasPrev — новые (вниз).
  private async buildMessageWindow(
    baseWhere: Prisma.MessageWhereInput,
    target: { id: string; createdAt: Date },
    limit: number,
  ): Promise<Paginated<MessageRow>> {
    const [olderRows, newerRows] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          ...baseWhere,
          OR: [
            { createdAt: { lt: target.createdAt } },
            { createdAt: target.createdAt, id: { lt: target.id } },
          ],
        },
        select: MESSAGE_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.prisma.message.findMany({
        where: {
          ...baseWhere,
          OR: [
            { createdAt: { gt: target.createdAt } },
            { createdAt: target.createdAt, id: { gt: target.id } },
          ],
        },
        select: MESSAGE_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
    ])
    // Целевое сообщение читаем под тем же baseWhere, что и окно вокруг него: выборка по
    // одному id в обход фильтров отдала бы удалённое или скрытое очисткой сообщение,
    // даже если весь остальной ответ его исключает.
    const targetRow = await this.prisma.message.findFirst({
      where: { ...baseWhere, id: target.id },
      select: MESSAGE_SELECT,
    })
    const hasNext = olderRows.length > limit
    const hasPrev = newerRows.length > limit
    const older = hasNext ? olderRows.slice(0, limit) : olderRows
    const newerDesc = (hasPrev ? newerRows.slice(0, limit) : newerRows).reverse()
    const items = [...newerDesc, ...(targetRow ? [targetRow] : []), ...older]
    return new Paginated(items, {
      cursor: older[older.length - 1]?.id,
      hasNext,
      prevCursor: newerDesc[0]?.id,
      hasPrev,
    })
  }

  // ── Общие материалы (§23) ───────────────────────────────────────────────────

  /** Вложения чата по типу (media/file/voice) для правой панели «Общие материалы». */
  async listChatMedia(
    viewer: JwtPayload,
    chatId: string,
    query: ChatMediaQueryInput,
  ): Promise<Paginated<ChatMediaRow>> {
    await this.assertMembership(viewer.sub, chatId)
    const mem = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: viewer.sub } },
      select: { clearedAt: true },
    })
    const messageWhere: Prisma.MessageWhereInput = {
      chatId,
      deletedAt: null,
      ...(mem?.clearedAt ? { createdAt: { gt: mem.clearedAt } } : {}),
    }
    const rows = await this.prisma.file.findMany({
      where: { message: messageWhere, ...mediaMimeWhere(query.type) },
      select: {
        id: true,
        name: true,
        mime: true,
        size: true,
        posterKey: true,
        createdAt: true,
        messageId: true,
        message: { select: { createdAt: true, senderId: true, sender: SENDER_SELECT } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = rows.length > query.limit
    const page = hasNext ? rows.slice(0, query.limit) : rows
    const items: ChatMediaRow[] = page.map((f) => ({
      id: f.id,
      messageId: f.messageId ?? '',
      name: f.name,
      mime: f.mime,
      size: f.size,
      hasPoster: !!f.posterKey,
      createdAt: f.message?.createdAt ?? f.createdAt,
      sender: f.message?.sender ?? null,
    }))
    return new Paginated(items, {
      cursor: hasNext ? page[page.length - 1]?.id : undefined,
      hasNext,
    })
  }

  /** Сообщения со ссылками (linkPreview) — вкладка «Ссылки». */
  async listChatLinks(
    viewer: JwtPayload,
    chatId: string,
    query: CursorPaginationInput,
  ): Promise<Paginated<ChatLinkRow>> {
    await this.assertMembership(viewer.sub, chatId)
    const mem = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: viewer.sub } },
      select: { clearedAt: true },
    })
    const rows = await this.prisma.message.findMany({
      where: {
        chatId,
        deletedAt: null,
        linkPreview: { not: Prisma.DbNull },
        ...(mem?.clearedAt ? { createdAt: { gt: mem.clearedAt } } : {}),
      },
      select: {
        id: true,
        createdAt: true,
        senderId: true,
        sender: SENDER_SELECT,
        linkPreview: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = rows.length > query.limit
    const page = hasNext ? rows.slice(0, query.limit) : rows
    const items: ChatLinkRow[] = page.map((m) => ({
      messageId: m.id,
      createdAt: m.createdAt,
      sender: m.sender,
      linkPreview: m.linkPreview,
    }))
    return new Paginated(items, {
      cursor: hasNext ? page[page.length - 1]?.id : undefined,
      hasNext,
    })
  }

  // ── Опросы в чате (§38–39) ──────────────────────────────────────────────────

  /** Создать опрос: сообщение-опрос (content=вопрос) + ChatPoll + варианты, эмит message:new. */
  async createPoll(
    senderId: string,
    chatId: string,
    input: CreateChatPollInput,
  ): Promise<MessageRow> {
    await this.assertMembership(senderId, chatId)
    await this.assertCanSend(chatId, senderId)
    const messageId = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          chatId,
          seq: await this.allocateSeq(chatId, tx),
          senderId,
          content: input.question,
        },
        select: { id: true },
      })
      await tx.chatPoll.create({
        data: {
          messageId: message.id,
          question: input.question,
          multiple: input.multiple ?? false,
          anonymous: input.anonymous ?? false,
          allowRevote: input.allowRevote ?? true,
          randomOrder: input.randomOrder ?? false,
          options: {
            create: input.options.map((text, i) => ({ text, order: i })),
          },
        },
      })
      return message.id
    })
    await this.bumpChat(chatId)
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      select: MESSAGE_SELECT,
    })
    await this.notifyNewMessage(chatId, senderId, message)
    this.realtime.emitToRoom(`chat:${chatId}`, 'message:new', { message, chatId })
    return message
  }

  /** Результаты опроса для смотрящего: счётчики по вариантам + свой голос. Анонимный — без личностей. */
  async getPollResults(viewer: JwtPayload, pollId: string) {
    const poll = await this.prisma.chatPoll.findUnique({
      where: { id: pollId },
      select: {
        id: true,
        anonymous: true,
        multiple: true,
        allowRevote: true,
        closed: true,
        message: { select: { chatId: true } },
        options: {
          select: { id: true, text: true, order: true, _count: { select: { votes: true } } },
          orderBy: { order: 'asc' },
        },
      },
    })
    if (!poll) throw new AppException('NOT_FOUND', 'Опрос не найден')
    await this.assertMembership(viewer.sub, poll.message.chatId)
    const myVotes = await this.prisma.chatPollVote.findMany({
      where: { pollId, userId: viewer.sub },
      take: POLL_VOTES_LIMIT,
      select: { optionId: true },
    })
    const totalVotes = poll.options.reduce((n, o) => n + o._count.votes, 0)

    // §39: у неанонимного опроса видно, кто как проголосовал — иначе пометка «не анонимный»
    // ничего не означала. Анонимный опрос личностей не раскрывает никогда, даже автору:
    // именно это ему и обещано в момент голосования.
    const votersByOption = new Map<string, PollVoter[]>()
    if (!poll.anonymous) {
      const votes = await this.prisma.chatPollVote.findMany({
        where: { pollId },
        select: {
          optionId: true,
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: POLL_VOTERS_LIMIT,
      })
      for (const v of votes) {
        const list = votersByOption.get(v.optionId) ?? []
        list.push({
          id: v.user.id,
          firstName: v.user.firstName,
          lastName: v.user.lastName,
          avatarUrl: v.user.avatarUrl,
        })
        votersByOption.set(v.optionId, list)
      }
    }

    return {
      id: poll.id,
      anonymous: poll.anonymous,
      multiple: poll.multiple,
      allowRevote: poll.allowRevote,
      closed: poll.closed,
      totalVotes,
      options: poll.options.map((o) => ({
        id: o.id,
        text: o.text,
        order: o.order,
        votes: o._count.votes,
        // Пусто у анонимного опроса и у варианта, чьи голоса не попали в POLL_VOTERS_LIMIT:
        // счётчик `votes` остаётся полным, имена — только для первых проголосовавших.
        voters: votersByOption.get(o.id) ?? [],
      })),
      myOptionIds: myVotes.map((v) => v.optionId),
    }
  }

  /** Проголосовать/переголосовать/снять голос. optionIds пустой — снять. Эмит poll:updated. */
  async votePoll(viewer: JwtPayload, pollId: string, input: PollVoteInput) {
    const poll = await this.prisma.chatPoll.findUnique({
      where: { id: pollId },
      select: {
        id: true,
        multiple: true,
        allowRevote: true,
        closed: true,
        message: { select: { chatId: true } },
        options: { select: { id: true } },
      },
    })
    if (!poll) throw new AppException('NOT_FOUND', 'Опрос не найден')
    await this.assertMembership(viewer.sub, poll.message.chatId)
    if (poll.closed) throw new AppException('BAD_REQUEST', 'Опрос завершён')

    const optionIds = [...new Set(input.optionIds)]
    if (!poll.multiple && optionIds.length > 1) {
      throw new AppException('BAD_REQUEST', 'Можно выбрать только один вариант')
    }
    const valid = new Set(poll.options.map((o) => o.id))
    if (optionIds.some((id) => !valid.has(id))) {
      throw new AppException('BAD_REQUEST', 'Неизвестный вариант опроса')
    }

    const existing = await this.prisma.chatPollVote.findMany({
      where: { pollId, userId: viewer.sub },
      take: POLL_VOTES_LIMIT,
      select: { id: true },
    })
    if (existing.length > 0 && !poll.allowRevote) {
      throw new AppException('BAD_REQUEST', 'Изменение голоса запрещено')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.chatPollVote.deleteMany({ where: { pollId, userId: viewer.sub } })
      if (optionIds.length > 0) {
        await tx.chatPollVote.createMany({
          data: optionIds.map((optionId) => ({ pollId, optionId, userId: viewer.sub })),
        })
      }
    })
    this.realtime.emitToRoom(`chat:${poll.message.chatId}`, 'poll:updated', {
      pollId,
      chatId: poll.message.chatId,
    })
    return this.getPollResults(viewer, pollId)
  }

  // ── Сохранённые (§15) ───────────────────────────────────────────────────────

  /** Личный self-chat «Сохранённые»: находим или создаём (единственный участник — сам пользователь). */
  async getSavedChat(userId: string): Promise<{ id: string }> {
    const existing = await this.prisma.chat.findFirst({
      where: { type: ChatType.SAVED, createdById: userId },
      select: { id: true },
    })
    if (existing) return existing
    return this.prisma.chat.create({
      data: { type: ChatType.SAVED, createdById: userId, members: { create: { userId } } },
      select: { id: true },
    })
  }

  // ── Участники (9.5) ─────────────────────────────────────────────────────────

  /** Список участников чата с ролью и онлайн-статусом (для окна управления группой, Ф9+). */
  async listMembers(viewer: JwtPayload, chatId: string) {
    await this.assertMembership(viewer.sub, chatId)
    const members = await this.prisma.chatMember.findMany({
      where: { chatId },
      select: {
        userId: true,
        createdAt: true,
        bannedAt: true,
        isAdmin: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            role: true,
            lastSeenAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    const online = new Set(this.realtime.onlineAmong(members.map((m) => m.userId)))
    return members.map(({ user, ...m }) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      online: online.has(m.userId),
      // §49: last-seen отдаём только оффлайн-участникам (онлайн — и так «в сети»).
      lastSeenAt: online.has(m.userId) ? null : (user.lastSeenAt?.toISOString() ?? null),
      banned: m.bannedAt != null,
      isAdmin: m.isAdmin,
    }))
  }

  /**
   * Статусы прочтения участниками (Ф9+, «кто прочитал» в группах). Возвращает участников
   * (кроме себя) с их lastReadAt; фронт показывает, кто прочитал сообщение (lastReadAt ≥ его createdAt).
   */
  async getReadReceipts(viewer: JwtPayload, chatId: string) {
    await this.assertMembership(viewer.sub, chatId)
    const members = await this.prisma.chatMember.findMany({
      where: { chatId, userId: { not: viewer.sub }, bannedAt: null },
      select: {
        userId: true,
        lastReadAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
      orderBy: { lastReadAt: 'desc' },
      take: 500,
    })
    return members.map((m) => ({ ...m.user, lastReadAt: m.lastReadAt }))
  }

  /** Сохранить/очистить черновик сообщения участника в чате (Ф9+, синхронизация между устройствами). */
  async saveDraft(
    userId: string,
    chatId: string,
    text: string,
  ): Promise<{ chatId: string; draft: string | null }> {
    await this.assertMembership(userId, chatId)
    const draft = text.trim().slice(0, 4000) || null
    await this.prisma.chatMember.updateMany({ where: { chatId, userId }, data: { draft } })
    return { chatId, draft }
  }

  async addMember(actor: JwtPayload, chatId: string, userId: string) {
    // Управление составом группы — только админам группы (не любому участнику): иначе
    // рядовой участник добавлял бы произвольных пользователей. GROUP-only (проверяет helper).
    await this.assertGroupAdmin(actor, chatId)
    try {
      await this.prisma.chatMember.create({ data: { chatId, userId } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Пользователь уже в чате')
      }
      throw error
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: SENDER_SELECT.select,
    })
    // Realtime (9.4): открытое окно чата получает нового участника, список чатов у всех
    // (включая только что добавленного) обновляется тихим сигналом.
    this.realtime.emitToRoom(`chat:${chatId}`, 'chat:member-added', { chatId, user })
    await this.pingChatList(chatId)
    if (user) {
      await this.emitSystemMessage(chatId, actor.sub, 'member_added', {
        targetName: `${user.lastName} ${user.firstName}`.trim(),
      })
    }
    return { chatId, user }
  }

  async removeMember(actor: JwtPayload, chatId: string, userId: string): Promise<void> {
    // Исключение участника — только админам группы (самовыход — отдельный deleteOrLeaveChat).
    const chat = await this.assertGroupAdmin(actor, chatId)
    // Владельца (создателя) исключить нельзя — иначе админ выкидывал бы создателя из его группы.
    if (chat.createdById && userId === chat.createdById) {
      throw new AppException('FORBIDDEN', 'Нельзя исключить создателя группы')
    }
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    })
    await this.prisma.chatMember.deleteMany({ where: { chatId, userId } })
    // Realtime (9.4): удалённый участник больше не в комнате — пингуем его отдельно, чтобы
    // чат исчез из его списка; остальным обновляем открытое окно и список.
    this.realtime.emitToRoom(`chat:${chatId}`, 'chat:member-removed', { chatId, userId })
    await this.pingChatList(chatId, [userId])
    await this.emitSystemMessage(chatId, actor.sub, 'member_removed', {
      targetName: target ? `${target.lastName} ${target.firstName}`.trim() : undefined,
    })
  }

  // Тихий сигнал «обнови список чатов» всем участникам (+доп. id, напр. удалённому).
  /**
   * Кому из заглушённых с режимом «только важные» (§17) сообщение всё равно адресовано:
   * ответ на его сообщение или упоминание его по имени.
   *
   * Упоминания в чате — обычный текст, отдельной сущности у них нет: композер вставляет
   * «@Фамилия Имя», поэтому по этой же строке и ищем (плюс обратный порядок — набрать руками
   * можно как угодно). Имена подтягиваем только для тех, у кого включён режим, и только если
   * в сообщении вообще есть «@»: на каждое сообщение в чате лишний join не нужен.
   */
  private async importantRecipients(
    members: ChatMemberNotifyRow[],
    message: MessageRow,
  ): Promise<Set<string>> {
    const candidates = members.filter((m) => m.muteImportantOnly && isMemberMuted(m))
    if (candidates.length === 0) return new Set()

    const out = new Set<string>()
    // Ответ на моё сообщение — важное всегда, никакого разбора текста не нужно.
    const replyToSenderId = message.replyTo?.senderId
    if (replyToSenderId) {
      for (const m of candidates) {
        if (m.userId === replyToSenderId) out.add(m.userId)
      }
    }

    if (!message.content.includes('@')) return out

    const users = await this.prisma.user.findMany({
      where: { id: { in: candidates.map((m) => m.userId) } },
      select: { id: true, firstName: true, lastName: true },
      take: candidates.length,
    })
    const text = message.content.toLowerCase()
    for (const u of users) {
      const asComposed = `@${u.lastName} ${u.firstName}`.toLowerCase()
      const reversed = `@${u.firstName} ${u.lastName}`.toLowerCase()
      if (text.includes(asComposed) || text.includes(reversed)) out.add(u.id)
    }
    return out
  }

  /**
   * Все участники чата — батчами по курсору.
   *
   * Рассылки (`chat:activity`, `chat:pinned`, уведомления о новом сообщении) обязаны дойти
   * до каждого участника, поэтому обрезать список потолком нельзя: в группе на 600 человек
   * сотня молча осталась бы без сигнала. Но и тянуть чат целиком одним запросом нельзя
   * (BACKEND_RULES §7.2), поэтому читаем страницами по MEMBER_BATCH.
   */
  private async allMembers(
    chatId: string,
    opts: { exceptUserId?: string } = {},
  ): Promise<ChatMemberNotifyRow[]> {
    const out: ChatMemberNotifyRow[] = []
    let cursor: string | undefined
    for (;;) {
      const batch = await this.prisma.chatMember.findMany({
        where: {
          chatId,
          ...(opts.exceptUserId ? { userId: { not: opts.exceptUserId } } : {}),
        },
        select: {
          id: true,
          userId: true,
          mutedAt: true,
          mutedUntil: true,
          muteImportantOnly: true,
        },
        orderBy: { id: 'asc' },
        take: MEMBER_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (batch.length === 0) break
      for (const m of batch) {
        out.push({
          userId: m.userId,
          mutedAt: m.mutedAt,
          mutedUntil: m.mutedUntil,
          muteImportantOnly: m.muteImportantOnly,
        })
      }
      if (batch.length < MEMBER_BATCH) break
      cursor = batch.at(-1)?.id
    }
    return out
  }

  // Аналог chat:activity из notifyNewMessage: не создаёт уведомление, только просит рефетч.
  private async pingChatList(chatId: string, extraUserIds: string[] = []): Promise<void> {
    const members = await this.allMembers(chatId)
    const ids = new Set<string>([...members.map((m) => m.userId), ...extraUserIds])
    for (const id of ids) this.realtime.emitToUser(id, 'chat:activity', { chatId })
  }

  /**
   * Присоединиться к группе по ссылке-приглашению (Ф9+). Только пользовательские GROUP-чаты
   * (официальные/личные так не присоединяют). Идемпотентно. id чата служит одноразово-непубличным токеном.
   */
  async joinByInvite(userId: string, chatId: string) {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, type: true, title: true },
    })
    if (!chat) throw new AppException('NOT_FOUND', 'Чат не найден')
    if (chat.type !== ChatType.GROUP) {
      throw new AppException('WRONG_SCOPE', 'К этому чату нельзя присоединиться по ссылке')
    }
    const exists = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true },
    })
    if (!exists) await this.prisma.chatMember.create({ data: { chatId, userId } })
    return chat
  }

  // ── Сообщения (используются ChatGateway) ─────────────────────────────────────

  /** Сохранить сообщение (сначала БД, затем трансляция — §10). Возвращает DTO + получателей. */
  async createMessage(
    senderId: string,
    input: MessageSendInput,
    // skipFlood — доставка отложенного сообщения из cron: темп задаёт расписание, а не
    // человек, и пачка отложенных на одну минуту иначе упёрлась бы в лимит 20/10с.
    // Блокировка и потолок непринятого запроса проверяются и здесь: за время ожидания
    // собеседник мог заблокировать отправителя.
    opts: { skipFlood?: boolean } = {},
  ): Promise<{ message: MessageRow; recipientIds: string[] }> {
    await this.assertMembership(senderId, input.chatId)
    await this.assertCanSend(input.chatId, senderId, opts)
    await this.assertReplyInChat(input.chatId, input.replyToId)
    const message = await this.prisma.$transaction(async (tx) =>
      tx.message.create({
        data: {
          chatId: input.chatId,
          seq: await this.allocateSeq(input.chatId, tx),
          senderId,
          content: input.content,
          replyToId: input.replyToId,
          replyQuote: input.replyQuote,
          silent: input.silent ?? false,
        },
        select: MESSAGE_SELECT,
      }),
    )
    await this.bumpChat(input.chatId)
    await this.enqueueLinkPreview(message.id, input.chatId, input.content)
    const recipientIds = await this.notifyNewMessage(input.chatId, senderId, message)
    return { message, recipientIds }
  }

  // Первая http(s)-ссылка в тексте → job на выборку OG-превью (карточка появится по message:updated).
  private async enqueueLinkPreview(
    messageId: string,
    chatId: string,
    content?: string,
  ): Promise<void> {
    const url = content ? /(https?:\/\/[^\s<>"']+)/i.exec(content)?.[1] : undefined
    if (!url) return
    await this.queue.enqueue(
      QUEUES.LINK_PREVIEW,
      LINK_PREVIEW_JOBS.FETCH,
      { messageId, chatId, url },
      { jobId: `link-preview:${messageId}` },
    )
  }

  /**
   * Отправка сообщения с вложениями через REST (multipart, 9+). Текст опционален, если есть файлы.
   * Порядок: создать сообщение → загрузить файлы в приватный бакет chat-media с привязкой к
   * messageId → перечитать сообщение с media → эмит `message:new` один раз всем в комнате.
   */
  async sendMessageRest(
    senderId: string,
    input: {
      chatId: string
      content?: string
      replyToId?: string
      replyQuote?: string
      spoiler?: boolean
      silent?: boolean
    },
    files: { buffer: Buffer; name?: string }[],
  ): Promise<MessageRow> {
    await this.assertMembership(senderId, input.chatId)
    await this.assertCanSend(input.chatId, senderId)
    await this.assertReplyInChat(input.chatId, input.replyToId)
    const content = input.content?.trim() ?? ''
    if (content.length === 0 && files.length === 0) {
      throw new AppException('BAD_REQUEST', 'Сообщение не может быть пустым')
    }
    const bucket = this.config.get('MINIO_BUCKET_CHAT', { infer: true })
    const created = await this.prisma.$transaction(async (tx) =>
      tx.message.create({
        data: {
          chatId: input.chatId,
          seq: await this.allocateSeq(input.chatId, tx),
          senderId,
          content,
          replyToId: input.replyToId,
          replyQuote: input.replyQuote,
          silent: input.silent ?? false,
        },
        select: { id: true },
      }),
    )
    for (const file of files) {
      await this.files.upload({
        buffer: file.buffer,
        bucket,
        ownerId: senderId,
        messageId: created.id,
        name: file.name,
      })
    }
    // §34: помечаем все вложения сообщения спойлером (размытие до клика на клиенте).
    if (input.spoiler && files.length > 0) {
      await this.prisma.file.updateMany({
        where: { messageId: created.id },
        data: { spoiler: true },
      })
    }
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: created.id },
      select: MESSAGE_SELECT,
    })
    await this.bumpChat(input.chatId)
    await this.enqueueLinkPreview(created.id, input.chatId, content)
    await this.notifyNewMessage(input.chatId, senderId, message)
    // REST-путь не проходит через ChatGateway — эмитим сами, ровно один раз (§10).
    this.realtime.emitToRoom(`chat:${input.chatId}`, 'message:new', {
      message,
      chatId: input.chatId,
    })
    return message
  }

  // Поднять чат в списке по времени последнего события.
  private async bumpChat(chatId: string): Promise<void> {
    await this.prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } })
  }

  /**
   * Выдать следующий seq сообщения в чате: один UPDATE ... RETURNING под блокировкой строки чата.
   *
   * Вызывать только внутри транзакции, вместе со вставкой сообщения — отсюда обязательный `tx`.
   * Блокировка строки чата держится до конца транзакции, поэтому параллельная отправка ждёт и
   * порядок коммитов совпадает с порядком номеров. Аллокация отдельным запросом сняла бы блокировку
   * сразу, и сообщение с меньшим seq могло бы закоммититься позже — дельта догона его пропустила бы.
   */
  private async allocateSeq(chatId: string, tx: Prisma.TransactionClient): Promise<number> {
    const rows = await tx.$queryRaw<{ last_seq: number }[]>`
      UPDATE "chats" SET "last_seq" = "last_seq" + 1 WHERE "id" = ${chatId} RETURNING "last_seq"
    `
    const next = rows[0]?.last_seq
    if (next == null) throw new AppException('NOT_FOUND', 'Чат не найден')
    return next
  }

  // Системное сообщение группы (§20): служебная запись о событии (актор = actorId). Текст рендерит
  // клиент по systemType + systemMeta (денормализованные детали). Эмитим message:new — попадает в ленту.
  private async emitSystemMessage(
    chatId: string,
    actorId: string,
    systemType: string,
    systemMeta?: Prisma.InputJsonValue,
  ): Promise<void> {
    const message = await this.prisma.$transaction(async (tx) =>
      tx.message.create({
        data: {
          chatId,
          seq: await this.allocateSeq(chatId, tx),
          senderId: actorId,
          content: '',
          systemType,
          ...(systemMeta !== undefined ? { systemMeta } : {}),
        },
        select: MESSAGE_SELECT,
      }),
    )
    await this.bumpChat(chatId)
    this.realtime.emitToRoom(`chat:${chatId}`, 'message:new', { message, chatId })
  }

  // Ответ (replyToId) должен ссылаться на сообщение того же чата, иначе BAD_REQUEST.
  private async assertReplyInChat(chatId: string, replyToId?: string): Promise<void> {
    if (!replyToId) return
    const parent = await this.prisma.message.findFirst({
      where: { id: replyToId, chatId },
      select: { id: true },
    })
    if (!parent) throw new AppException('BAD_REQUEST', 'Ответ на сообщение вне этого чата')
  }

  // Уведомление офлайн-участникам (9.7): всем участникам, кроме отправителя. Возвращает получателей.
  private async notifyNewMessage(
    chatId: string,
    senderId: string,
    message: MessageRow,
  ): Promise<string[]> {
    // Новое сообщение возвращает чат тем, кто «удалил его у себя» (hiddenAt): снимаем скрытие у всех.
    await this.prisma.chatMember.updateMany({
      where: { chatId, hiddenAt: { not: null } },
      data: { hiddenAt: null },
    })
    const members = await this.allMembers(chatId, { exceptUserId: senderId })
    // Живой список чатов у всех участников (в т.ч. заглушённых): message:new уходит только в комнату
    // chat:{id} (её джойнят только с открытым чатом), поэтому для превью/счётчика/порядка в списке
    // шлём тихий сигнал в user:{id}. Он НЕ создаёт уведомление — только просит обновить список.
    for (const m of members) {
      this.realtime.emitToUser(m.userId, 'chat:activity', { chatId })
    }
    // Кто сейчас открыл этот чат (в комнате chat:{id}) — уведомление не создаём: они читают его вживую.
    // Заглушённые — тоже без уведомления (Telegram-стиль), но сообщение им приходит.
    const viewing = await this.realtime.usersInRoom(`chat:${chatId}`)
    const important = await this.importantRecipients(members, message)
    const pendingFor = await this.resolveChatRequest(chatId, senderId)
    // «Без звука»: сообщение уходит всем как обычно (WS, список чатов, счётчик), но
    // уведомления и push по нему не создаются — это выбор отправителя, а не получателя,
    // поэтому решается здесь, а не в настройках адресата.
    if (message.silent) return []
    const recipientIds = members
      // §50: адресат непринятого запроса уведомлений о сообщениях не получает — иначе
      // непринятый чат ничем не отличался бы от принятого и согласие было бы формальностью.
      .filter((m) => m.userId !== pendingFor)
      .filter((m) => !viewing.has(m.userId))
      // §17: заглушённый участник получает уведомление, только если сообщение «важное» для него.
      .filter((m) => !isMemberMuted(m) || important.has(m.userId))
      .map((m) => m.userId)
    if (recipientIds.length > 0) {
      const preview = message.content.slice(0, 140) || '📎 Вложение'
      await this.queue.enqueue(
        QUEUES.NOTIFICATIONS,
        NOTIFICATION_JOBS.NEW_MESSAGE,
        {
          recipientIds,
          type: 'MESSAGE',
          title: `${message.sender.lastName} ${message.sender.firstName}`,
          body: preview,
          data: { chatId, messageId: message.id, url: `/chats?c=${chatId}` },
          dedupeKey: `new-message:${message.id}`,
        },
        { jobId: `new-message:${message.id}` },
      )
    }
    return recipientIds
  }

  async editMessage(senderId: string, messageId: string, content: string): Promise<MessageRow> {
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, senderId: true, createdAt: true },
    })
    if (!msg) throw new AppException('NOT_FOUND', 'Сообщение не найдено')
    if (msg.senderId !== senderId)
      throw new AppException('WRONG_SCOPE', 'Можно править только свои сообщения')
    // Редактирование доступно ограниченное время после отправки (Ф9+).
    if (Date.now() - msg.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MS) {
      throw new AppException(
        'BAD_REQUEST',
        'Редактировать сообщение можно в течение 10 минут после отправки',
      )
    }
    return this.prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      select: MESSAGE_SELECT,
    })
  }

  async deleteMessage(senderId: string, messageId: string): Promise<{ chatId: string }> {
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, senderId: true, chatId: true },
    })
    if (!msg) throw new AppException('NOT_FOUND', 'Сообщение не найдено')
    if (msg.senderId !== senderId)
      throw new AppException('WRONG_SCOPE', 'Можно удалять только свои сообщения')
    await this.prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date() } })
    return { chatId: msg.chatId }
  }

  async markRead(
    userId: string,
    chatId: string,
    messageId: string,
  ): Promise<{ chatId: string; messageId: string; userId: string; readAt: Date }> {
    await this.assertMembership(userId, chatId)
    const readAt = new Date()
    await this.prisma.chatMember.updateMany({
      where: { chatId, userId },
      data: { lastReadAt: readAt },
    })
    return { chatId, messageId, userId, readAt }
  }

  // ── Закрепление сообщений (Ф9+) ──────────────────────────────────────────────

  /** Закрепить/снять закрепление. Любой участник чата может закреплять (§3.6). Эмитит WS-событие. */
  async setPinned(userId: string, messageId: string, pinned: boolean): Promise<MessageRow> {
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, chatId: true },
    })
    if (!msg) throw new AppException('NOT_FOUND', 'Сообщение не найдено')
    await this.assertMembership(userId, msg.chatId)
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: pinned
        ? { pinnedAt: new Date(), pinnedById: userId }
        : { pinnedAt: null, pinnedById: null },
      select: MESSAGE_SELECT,
    })
    this.realtime.emitToRoom(`chat:${msg.chatId}`, pinned ? 'message:pinned' : 'message:unpinned', {
      message,
      chatId: msg.chatId,
    })
    // Комната chat:{id} есть только у тех, кто открыл чат. Чтобы закрепление подтянулось и при
    // закрытом чате, шлём сигнал в user:{id} каждому участнику — клиент инвалидирует pinned/messages.
    const members = await this.allMembers(msg.chatId)
    for (const m of members) {
      this.realtime.emitToUser(m.userId, 'chat:pinned', { chatId: msg.chatId })
    }
    // Системное событие только при закреплении (открепление — без шума в ленте).
    if (pinned) await this.emitSystemMessage(msg.chatId, userId, 'message_pinned')
    return message
  }

  /** Закреплённые сообщения чата, новые сверху. */
  /** Сообщение в клиентской форме (MESSAGE_SELECT) — для рассылки message:updated из воркеров. */
  findMessageForClient(messageId: string): Promise<MessageRow | null> {
    return this.prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: MESSAGE_SELECT,
    })
  }

  async listPinned(userId: string, chatId: string): Promise<MessageRow[]> {
    await this.assertMembership(userId, chatId)
    return this.prisma.message.findMany({
      where: { chatId, deletedAt: null, pinnedAt: { not: null } },
      select: MESSAGE_SELECT,
      orderBy: { pinnedAt: 'desc' },
      take: 50,
    })
  }

  // ── Вложения (Ф9+) ───────────────────────────────────────────────────────────

  /** Presigned-GET к вложению: доступ по членству в чате сообщения (не по владению файлом). */
  async getAttachmentUrl(userId: string, fileId: string): Promise<string> {
    const file = await this.files.findOrThrow(fileId)
    if (!file.messageId) throw new AppException('NOT_FOUND', 'Файл не является вложением сообщения')
    const msg = await this.prisma.message.findUnique({
      where: { id: file.messageId },
      select: { chatId: true },
    })
    if (!msg) throw new AppException('NOT_FOUND', 'Сообщение не найдено')
    await this.assertMembership(userId, msg.chatId)
    return this.files.getPresignedUrl(fileId)
  }

  // ── Поиск сообщений (Ф9+) ─────────────────────────────────────────────────────

  /**
   * Поиск по подстроке (регистронезависимо). chatId задан — внутри чата (после проверки членства);
   * иначе — по всем чатам, где пользователь участник. Cursor-пагинация по [createdAt, id].
   */
  async searchMessages(
    viewer: JwtPayload,
    query: MessageSearchQueryInput,
  ): Promise<Paginated<MessageRow>> {
    let chatFilter: Prisma.MessageWhereInput
    if (query.chatId) {
      await this.assertMembership(viewer.sub, query.chatId)
      chatFilter = { chatId: query.chatId }
    } else {
      chatFilter = { chat: { members: { some: { userId: viewer.sub } } } }
    }
    const rows = await this.prisma.message.findMany({
      where: {
        deletedAt: null,
        content: { contains: query.q, mode: 'insensitive' },
        ...chatFilter,
        // Фильтры §4: по автору и по наличию вложений.
        ...(query.senderId ? { senderId: query.senderId } : {}),
        ...(query.hasFile ? { media: { some: {} } } : {}),
      },
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = rows.length > query.limit
    const items = hasNext ? rows.slice(0, query.limit) : rows
    const nextCursor = hasNext ? items[items.length - 1]?.id : undefined
    return new Paginated(items, { cursor: nextCursor, hasNext })
  }

  // ── Реакции (Ф9+) ─────────────────────────────────────────────────────────

  /**
   * Реакция участника на сообщение: один пользователь — одна реакция на сообщение (как в Telegram).
   * Та же эмодзи повторно — снимает; другая эмодзи — заменяет прежнюю. Эмитит message:reaction.
   */
  async toggleReaction(userId: string, messageId: string, emoji: string): Promise<MessageRow> {
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, chatId: true },
    })
    if (!msg) throw new AppException('NOT_FOUND', 'Сообщение не найдено')
    await this.assertMembership(userId, msg.chatId)
    const existing = await this.prisma.messageReaction.findMany({
      where: { messageId, userId },
      take: MESSAGE_REACTION_LIMIT,
      select: { id: true, emoji: true },
    })
    const same = existing.find((r) => r.emoji === emoji)
    if (same) {
      // Повтор той же реакции — снять.
      await this.prisma.messageReaction.delete({ where: { id: same.id } })
    } else {
      // Заменить любую прежнюю реакцию этого пользователя на новую (одна на сообщение).
      if (existing.length > 0) {
        await this.prisma.messageReaction.deleteMany({ where: { messageId, userId } })
      }
      await this.prisma.messageReaction.create({ data: { messageId, userId, emoji } })
    }
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      select: MESSAGE_SELECT,
    })
    this.realtime.emitToRoom(`chat:${msg.chatId}`, 'message:reaction', {
      message,
      chatId: msg.chatId,
    })
    return message
  }

  // ── Пересылка (Ф9+) ────────────────────────────────────────────────────────

  /**
   * Переслать сообщение в целевой чат (участник обоих чатов). Копирует текст и вложения
   * (новые File-записи на тот же объект MinIO, без повторной загрузки) и метку источника.
   */
  async forwardMessage(
    userId: string,
    targetChatId: string,
    sourceMessageId: string,
  ): Promise<MessageRow> {
    await this.assertMembership(userId, targetChatId)
    await this.assertCanSend(targetChatId, userId)
    const source = await this.prisma.message.findFirst({
      where: { id: sourceMessageId, deletedAt: null },
      select: {
        id: true,
        chatId: true,
        content: true,
        linkPreview: true,
        media: { select: { bucket: true, key: true, mime: true, size: true, name: true } },
      },
    })
    if (!source) throw new AppException('NOT_FOUND', 'Исходное сообщение не найдено')
    await this.assertMembership(userId, source.chatId)
    const created = await this.prisma.$transaction(async (tx) =>
      tx.message.create({
        data: {
          chatId: targetChatId,
          seq: await this.allocateSeq(targetChatId, tx),
          senderId: userId,
          content: source.content,
          forwardedFromId: source.id,
          // Превью переносим готовым: ссылка та же, второй поход в сеть за тем же
          // результатом не нужен. Если у оригинала его нет — доберём job'ом ниже.
          linkPreview:
            source.linkPreview === null ? undefined : (source.linkPreview as Prisma.InputJsonValue),
        },
        select: { id: true },
      }),
    )
    // Копируем каждое вложение на новый ключ (у File @@unique([bucket,key]) — переиспользовать нельзя).
    for (const f of source.media) {
      await this.files.copyToMessage(f, userId, created.id)
    }
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: created.id },
      select: MESSAGE_SELECT,
    })
    await this.bumpChat(targetChatId)
    // У оригинала превью могло не быть (сообщение старше фичи, job не успел, ссылка была
    // недоступна) — тогда пробуем сами: пересланная ссылка ничем не хуже отправленной.
    if (source.linkPreview === null) {
      await this.enqueueLinkPreview(created.id, targetChatId, source.content ?? undefined)
    }
    await this.notifyNewMessage(targetChatId, userId, message)
    this.realtime.emitToRoom(`chat:${targetChatId}`, 'message:new', {
      message,
      chatId: targetChatId,
    })
    return message
  }

  // ── Поделиться постом (Ф9+ share-to-chat) ──────────────────────────────────

  /**
   * Отправить в чат превью-карточку поста. Отправитель должен быть участником чата и видеть
   * пост (пересечение с audience-видимостью). comment — необязательная подпись сообщения.
   */
  async sharePost(
    viewer: JwtPayload,
    targetChatId: string,
    postId: string,
    comment?: string,
  ): Promise<MessageRow> {
    await this.assertMembership(viewer.sub, targetChatId)
    await this.assertCanSend(targetChatId, viewer.sub)
    // Бросит NOT_FOUND, если пост не виден отправителю (IDOR-защита).
    await this.posts.assertVisibleToViewer(viewer, postId)
    const created = await this.prisma.$transaction(async (tx) =>
      tx.message.create({
        data: {
          chatId: targetChatId,
          seq: await this.allocateSeq(targetChatId, tx),
          senderId: viewer.sub,
          content: comment?.trim() ?? '',
          sharedPostId: postId,
        },
        select: { id: true },
      }),
    )
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: created.id },
      select: MESSAGE_SELECT,
    })
    await this.bumpChat(targetChatId)
    await this.notifyNewMessage(targetChatId, viewer.sub, message)
    this.realtime.emitToRoom(`chat:${targetChatId}`, 'message:new', {
      message,
      chatId: targetChatId,
    })
    return message
  }

  // ── Экспорт (Ф9+) ──────────────────────────────────────────────────────────

  /** История чата в хронологическом порядке для экспорта (только участник). Cap с логом при усечении. */
  async exportMessages(userId: string, chatId: string): Promise<MessageRow[]> {
    await this.assertMembership(userId, chatId)
    const CAP = 5000
    const rows = await this.prisma.message.findMany({
      where: { chatId, deletedAt: null },
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: CAP,
    })
    if (rows.length === CAP) {
      this.logger.warn(`Экспорт чата ${chatId}: история усечена до ${CAP} сообщений`)
    }
    return rows
  }

  // ── Mute уведомлений (Ф9+) ─────────────────────────────────────────────────

  /** Заглушить/включить уведомления о новых сообщениях чата для участника. */
  // §17: until = 'forever' (навсегда), Date (до момента), null (снять).
  // importantOnly — режим «только важные»: чат заглушён, но ответы на мои сообщения и
  // упоминания меня по имени уведомление всё равно создают. При снятии заглушения флаг
  // сбрасывается: он описывает исключение из заглушения, а не самостоятельную настройку.
  async setMuted(
    userId: string,
    chatId: string,
    until: Date | 'forever' | null,
    importantOnly = false,
  ): Promise<{ chatId: string; muted: boolean; importantOnly: boolean }> {
    await this.assertMembership(userId, chatId)
    const muted = until !== null
    const data =
      until === 'forever'
        ? { mutedAt: new Date(), mutedUntil: null }
        : until
          ? { mutedAt: null, mutedUntil: until }
          : { mutedAt: null, mutedUntil: null }
    await this.prisma.chatMember.updateMany({
      where: { chatId, userId },
      data: { ...data, muteImportantOnly: muted ? importantOnly : false },
    })
    return { chatId, muted, importantOnly: muted ? importantOnly : false }
  }

  /**
   * Убрать чат в архив «у себя» / вернуть обратно.
   *
   * От «удалить у себя» (hiddenAt) отличается тем, что новое сообщение архив НЕ снимает:
   * официальных чатов у роли автоматически создаётся с десяток, они пишут каждый день, и
   * возвращающийся чат сводил бы архив на нет.
   */
  async setChatArchived(
    userId: string,
    chatId: string,
    archived: boolean,
  ): Promise<{ chatId: string; archived: boolean }> {
    await this.assertMembership(userId, chatId)
    await this.prisma.chatMember.updateMany({
      where: { chatId, userId },
      data: { archivedAt: archived ? new Date() : null },
    })
    return { chatId, archived }
  }

  /** Закрепить/открепить чат «у себя» (Telegram-стиль): персонально, влияет только на порядок списка. */
  async setChatPinned(
    userId: string,
    chatId: string,
    pinned: boolean,
  ): Promise<{ chatId: string; pinned: boolean }> {
    await this.assertMembership(userId, chatId)
    await this.prisma.chatMember.updateMany({
      where: { chatId, userId },
      data: { pinnedAt: pinned ? new Date() : null },
    })
    return { chatId, pinned }
  }

  // ── Присутствие (Ф9+) ──────────────────────────────────────────────────────

  /** Онлайн-статус участников чата (по активным WS-соединениям). */
  async getPresence(
    userId: string,
    chatId: string,
  ): Promise<{ userId: string; online: boolean }[]> {
    await this.assertMembership(userId, chatId)
    const members = await this.allMembers(chatId)
    const ids = members.map((m) => m.userId)
    const online = new Set(this.realtime.onlineAmong(ids))
    return ids.map((id) => ({ userId: id, online: online.has(id) }))
  }

  // ── Блокировка пользователей (Ф9+) ─────────────────────────────────────────

  /** Есть ли блокировка между двумя пользователями в любую сторону. */
  private async isBlockedBetween(a: string, b: string): Promise<boolean> {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { id: true },
    })
    return block !== null
  }

  /** Заблокировать пользователя (личная блокировка). Идемпотентно. */
  async blockUser(
    actorId: string,
    targetUserId: string,
  ): Promise<{ userId: string; blocked: boolean }> {
    if (targetUserId === actorId) throw new AppException('BAD_REQUEST', 'Нельзя заблокировать себя')
    const exists = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true },
    })
    if (!exists) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: actorId, blockedId: targetUserId } },
      create: { blockerId: actorId, blockedId: targetUserId },
      update: {},
    })
    this.emitBlockChanged(actorId, targetUserId)
    return { userId: targetUserId, blocked: true }
  }

  /** Снять личную блокировку. Идемпотентно. */
  async unblockUser(
    actorId: string,
    targetUserId: string,
  ): Promise<{ userId: string; blocked: boolean }> {
    await this.prisma.userBlock.deleteMany({
      where: { blockerId: actorId, blockedId: targetUserId },
    })
    this.emitBlockChanged(actorId, targetUserId)
    return { userId: targetUserId, blocked: false }
  }

  // Блокировка влияет на возможность писать у ОБОИХ участников PRIVATE-чата — шлём сигнал обоим,
  // чтобы список чатов (флаги blocked/blockedBy) и поле ввода обновились в реальном времени.
  private emitBlockChanged(a: string, b: string): void {
    this.realtime.emitToUser(a, 'chat:block', { userId: b })
    this.realtime.emitToUser(b, 'chat:block', { userId: a })
  }

  /**
   * Общие условия отправки в чат — единственное место, где они собраны.
   *
   * Раньше их звали только createMessage/sendMessageRest/createPoll, а forwardMessage и
   * sharePost шли мимо: пересылкой обходились и личная блокировка (заблокировавший тебя
   * человек всё равно получал сообщение), и лимит частоты.
   *
   * Чат читается один раз на три проверки: обе «личные» (блокировка и потолок непринятого
   * запроса) касаются только PRIVATE и нуждаются в одних и тех же полях.
   */
  private async assertCanSend(
    chatId: string,
    senderId: string,
    opts: { skipFlood?: boolean } = {},
  ): Promise<void> {
    if (!opts.skipFlood) await this.assertNotFlooding(senderId)
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: {
        type: true,
        requestPendingForId: true,
        members: { where: { userId: { not: senderId } }, select: { userId: true } },
      },
    })
    if (chat?.type !== ChatType.PRIVATE) return

    const other = chat.members[0]?.userId
    if (other && (await this.isBlockedBetween(senderId, other))) {
      throw new AppException('FORBIDDEN', 'Переписка недоступна: пользователь заблокирован')
    }

    // §50: потолок сообщений в непринятый запрос. Уведомлений адресат не получает, но без
    // потолка инициатор набивал бы ему во вкладку «Запросы» стену текста — канал без
    // согласия. Ответ адресата снимает запрос, а вместе с ним и потолок.
    const pendingFor = chat.requestPendingForId
    if (pendingFor != null && pendingFor !== senderId) {
      const sent = await this.prisma.message.count({ where: { chatId, senderId, deletedAt: null } })
      if (sent >= REQUEST_MESSAGE_QUOTA) {
        throw new AppException(
          'FORBIDDEN',
          `Дождитесь ответа: до принятия запроса можно отправить не больше ${REQUEST_MESSAGE_QUOTA} сообщений`,
        )
      }
    }
  }

  /**
   * Антифлуд отправки. Счётчик в Redis, а не в памяти процесса: карта в памяти не
   * переживала второй инстанс (лимит обходился попаданием на другой) и никогда не
   * чистилась — запись оставалась навсегда на каждого, кто хоть раз написал.
   *
   * Окно фиксированное (INCR + EXPIRE на первой записи): на стыке двух окон пропускает
   * до двух лимитов подряд, но это цена одной атомарной операции вместо списка меток.
   * Redis недоступен — пропускаем (fail-open, как CronLockService): онемевшие чаты хуже,
   * чем неограниченная частота на время аварии.
   */
  private async assertNotFlooding(userId: string): Promise<void> {
    const key = `chat:flood:${userId}`
    let count: number
    try {
      count = await this.redis.incr(key)
      if (count === 1) await this.redis.expire(key, FLOOD_WINDOW_SECONDS)
    } catch (error) {
      this.logger.warn(`Redis недоступен, антифлуд пропущен: ${(error as Error).message}`)
      return
    }
    if (count > FLOOD_MAX) {
      throw new AppException('RATE_LIMIT', 'Слишком много сообщений — подождите немного')
    }
  }

  // ── Аватар / бан участников группы (Ф9+) ────────────────────────────────────

  /**
   * Права «админа» пользовательской группы: участник с isAdmin (создатель — админ по умолчанию).
   * Для legacy-групп без создателя и без админов действие разрешено любому участнику. Возвращает чат.
   */
  private async assertGroupAdmin(actor: JwtPayload, chatId: string) {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: actor.sub } },
      select: { isAdmin: true, bannedAt: true },
    })
    if (!member || member.bannedAt)
      throw new AppException('WRONG_SCOPE', 'Вы не участник этого чата')
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, type: true, avatarUrl: true, createdById: true },
    })
    if (!chat) throw new AppException('NOT_FOUND', 'Чат не найден')
    if (chat.type !== ChatType.GROUP) {
      throw new AppException('WRONG_SCOPE', 'Действие доступно только в пользовательских группах')
    }
    // Legacy-группа (нет создателя) без назначенных админов — разрешаем любому участнику.
    const legacy = chat.createdById == null
    if (!member.isAdmin && !legacy) {
      throw new AppException('FORBIDDEN', 'Действие доступно только администраторам группы')
    }
    return chat
  }

  /** Проверка, что actor — владелец (создатель) группы. Для передачи прав/назначения админов. */
  private async assertGroupOwner(actor: JwtPayload, chatId: string) {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, type: true, createdById: true },
    })
    if (!chat) throw new AppException('NOT_FOUND', 'Чат не найден')
    if (chat.type !== ChatType.GROUP) {
      throw new AppException('WRONG_SCOPE', 'Действие доступно только в пользовательских группах')
    }
    if (chat.createdById !== actor.sub) {
      throw new AppException('FORBIDDEN', 'Только создатель группы может выполнять это действие')
    }
    return chat
  }

  /** Установить аватар группы (публичный бакет avatars). Прежний файл удаляется. */
  async setChatAvatar(
    actor: JwtPayload,
    chatId: string,
    buffer: Buffer,
  ): Promise<{ id: string; avatarUrl: string }> {
    const chat = await this.assertGroupAdmin(actor, chatId)
    const bucket = this.config.get('MINIO_BUCKET_AVATARS', { infer: true })
    await this.deleteChatAvatarFile(chat.avatarUrl, bucket)
    const file = await this.files.upload({
      buffer,
      bucket,
      ownerId: actor.sub,
      expectedCategory: 'IMAGE',
    })
    const avatarUrl = this.buildPublicUrl(bucket, file.key)
    const updated = await this.prisma.chat.update({
      where: { id: chatId },
      data: { avatarUrl },
      select: { id: true, avatarUrl: true },
    })
    await this.bumpChat(chatId)
    this.realtime.emitToRoom(`chat:${chatId}`, 'chat:updated', { chatId, avatarUrl })
    await this.pingChatList(chatId)
    await this.emitSystemMessage(chatId, actor.sub, 'avatar_changed')
    return { id: updated.id, avatarUrl: updated.avatarUrl ?? avatarUrl }
  }

  /** Удалить аватар группы. */
  async removeChatAvatar(
    actor: JwtPayload,
    chatId: string,
  ): Promise<{ id: string; avatarUrl: null }> {
    const chat = await this.assertGroupAdmin(actor, chatId)
    const bucket = this.config.get('MINIO_BUCKET_AVATARS', { infer: true })
    await this.deleteChatAvatarFile(chat.avatarUrl, bucket)
    await this.prisma.chat.update({ where: { id: chatId }, data: { avatarUrl: null } })
    await this.bumpChat(chatId)
    this.realtime.emitToRoom(`chat:${chatId}`, 'chat:updated', { chatId, avatarUrl: null })
    await this.pingChatList(chatId)
    return { id: chatId, avatarUrl: null }
  }

  // Удаляет прежний файл аватара группы по ключу из публичного URL (бакет avatars общий с
  // пользовательскими аватарами, поэтому чистим точечно, а не по владельцу).
  private async deleteChatAvatarFile(avatarUrl: string | null, bucket: string): Promise<void> {
    if (!avatarUrl) return
    const marker = `/${bucket}/`
    const idx = avatarUrl.indexOf(marker)
    if (idx === -1) return
    const key = avatarUrl.slice(idx + marker.length)
    const file = await this.prisma.file.findFirst({ where: { key, bucket }, select: { id: true } })
    if (file) await this.files.delete(file.id)
  }

  private buildPublicUrl(bucket: string, key: string): string {
    return buildPublicObjectUrl(this.config, bucket, key)
  }

  /** Забанить участника группы (только создатель). Нельзя забанить себя/создателя. */
  async banMember(
    actor: JwtPayload,
    chatId: string,
    userId: string,
  ): Promise<{ chatId: string; userId: string; banned: boolean }> {
    const chat = await this.assertGroupAdmin(actor, chatId)
    if (userId === actor.sub) throw new AppException('BAD_REQUEST', 'Нельзя забанить себя')
    if (chat.createdById && userId === chat.createdById) {
      throw new AppException('FORBIDDEN', 'Нельзя забанить создателя группы')
    }
    const res = await this.prisma.chatMember.updateMany({
      where: { chatId, userId },
      data: { bannedAt: new Date() },
    })
    if (res.count === 0) throw new AppException('NOT_FOUND', 'Участник не найден')
    return { chatId, userId, banned: true }
  }

  /** Снять бан с участника группы (только создатель). */
  async unbanMember(
    actor: JwtPayload,
    chatId: string,
    userId: string,
  ): Promise<{ chatId: string; userId: string; banned: boolean }> {
    await this.assertGroupAdmin(actor, chatId)
    await this.prisma.chatMember.updateMany({ where: { chatId, userId }, data: { bannedAt: null } })
    return { chatId, userId, banned: false }
  }

  /** Изменить название группы (любой админ). */
  async editChatTitle(
    actor: JwtPayload,
    chatId: string,
    title: string,
  ): Promise<{ id: string; title: string }> {
    await this.assertGroupAdmin(actor, chatId)
    const updated = await this.prisma.chat.update({
      where: { id: chatId },
      data: { title },
      select: { id: true, title: true },
    })
    await this.bumpChat(chatId)
    this.realtime.emitToRoom(`chat:${chatId}`, 'chat:updated', { chatId, title: updated.title })
    await this.pingChatList(chatId)
    await this.emitSystemMessage(chatId, actor.sub, 'title_changed', {
      title: updated.title ?? title,
    })
    return { id: updated.id, title: updated.title ?? title }
  }

  /** Назначить/снять админа (только создатель группы). Создателя понижать нельзя. */
  async setAdmin(
    actor: JwtPayload,
    chatId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<{ userId: string; isAdmin: boolean }> {
    const chat = await this.assertGroupOwner(actor, chatId)
    if (userId === chat.createdById) throw new AppException('BAD_REQUEST', 'Создатель всегда админ')
    const res = await this.prisma.chatMember.updateMany({
      where: { chatId, userId },
      data: { isAdmin },
    })
    if (res.count === 0) throw new AppException('NOT_FOUND', 'Участник не найден')
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    })
    await this.emitSystemMessage(chatId, actor.sub, isAdmin ? 'admin_granted' : 'admin_revoked', {
      targetName: target ? `${target.lastName} ${target.firstName}`.trim() : undefined,
    })
    return { userId, isAdmin }
  }

  /** Передать владение группой другому участнику (только создатель). Новый владелец — админ. */
  async transferOwnership(
    actor: JwtPayload,
    chatId: string,
    userId: string,
  ): Promise<{ chatId: string; ownerId: string }> {
    await this.assertGroupOwner(actor, chatId)
    if (userId === actor.sub) throw new AppException('BAD_REQUEST', 'Вы уже владелец')
    const target = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true, bannedAt: true },
    })
    if (!target || target.bannedAt) throw new AppException('NOT_FOUND', 'Участник не найден')
    await this.prisma.$transaction([
      this.prisma.chat.update({ where: { id: chatId }, data: { createdById: userId } }),
      this.prisma.chatMember.updateMany({ where: { chatId, userId }, data: { isAdmin: true } }),
    ])
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    })
    await this.emitSystemMessage(chatId, actor.sub, 'owner_changed', {
      targetName: owner ? `${owner.lastName} ${owner.firstName}`.trim() : undefined,
    })
    return { chatId, ownerId: userId }
  }

  /** Очистить историю чата «для меня» (сообщения старше момента очистки скрываются). */
  async clearChat(
    actor: JwtPayload,
    chatId: string,
  ): Promise<{ chatId: string; cleared: boolean }> {
    await this.assertMembership(actor.sub, chatId)
    await this.prisma.chatMember.updateMany({
      where: { chatId, userId: actor.sub },
      data: { clearedAt: new Date() },
    })
    return { chatId, cleared: true }
  }

  /**
   * Удалить чат / покинуть группу. GROUP + владелец → удалить всю группу (cascade);
   * иначе — убрать своё членство (для PRIVATE это «удалить у себя»; пустой чат удаляется).
   */
  async deleteOrLeaveChat(
    actor: JwtPayload,
    chatId: string,
  ): Promise<{ chatId: string; deleted: boolean }> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, type: true, createdById: true, members: { select: { userId: true } } },
    })
    if (!chat) throw new AppException('NOT_FOUND', 'Чат не найден')
    if (!chat.members.some((m) => m.userId === actor.sub)) {
      throw new AppException('WRONG_SCOPE', 'Вы не участник этого чата')
    }
    // Владелец группы удаляет всю группу.
    if (chat.type === ChatType.GROUP && chat.createdById === actor.sub) {
      await this.prisma.chat.delete({ where: { id: chatId } })
      return { chatId, deleted: true }
    }
    // PRIVATE «удалить у себя» (Telegram-стиль): членство сохраняем, чат прячем (hiddenAt) и чистим
    // историю до текущего момента (clearedAt). Новое сообщение сбросит hiddenAt → чат вернётся,
    // а сообщения продолжают приходить в реальном времени (участник остаётся в чате).
    if (chat.type === ChatType.PRIVATE) {
      const now = new Date()
      await this.prisma.chatMember.updateMany({
        where: { chatId, userId: actor.sub },
        data: { hiddenAt: now, clearedAt: now },
      })
      return { chatId, deleted: false }
    }
    // Групповой чат — выходим (убираем членство); если участников не осталось, удаляем чат целиком.
    await this.prisma.chatMember.deleteMany({ where: { chatId, userId: actor.sub } })
    const left = await this.prisma.chatMember.count({ where: { chatId } })
    if (left === 0) {
      await this.prisma.chat.delete({ where: { id: chatId } })
      return { chatId, deleted: true }
    }
    await this.emitSystemMessage(chatId, actor.sub, 'member_left')
    return { chatId, deleted: false }
  }

  // ── Отложенные сообщения ────────────────────────────────────────────────────

  /**
   * Поставить сообщение в очередь на отправку в будущем.
   *
   * Хранится отдельной моделью, а не «сообщением со временем»: у Message есть seq —
   * монотонный номер, на котором держится дельта-догон после обрыва связи. Занятый заранее
   * номер означал бы дыру в ленте у всех клиентов до самой доставки.
   *
   * Условия отправки (антифлуд, блокировка, потолок непринятого запроса) проверяются и
   * сейчас, и повторно в момент доставки: за сутки ожидания собеседник может заблокировать.
   */
  async scheduleMessage(senderId: string, chatId: string, input: ScheduleMessageInput) {
    await this.assertMembership(senderId, chatId)
    await this.assertCanSend(chatId, senderId)
    await this.assertReplyInChat(chatId, input.replyToId)
    const pending = await this.prisma.scheduledMessage.count({ where: { chatId, senderId } })
    if (pending >= SCHEDULED_PER_CHAT_LIMIT) {
      throw new AppException(
        'BAD_REQUEST',
        `В одном чате нельзя держать больше ${SCHEDULED_PER_CHAT_LIMIT} отложенных сообщений`,
      )
    }
    return this.prisma.scheduledMessage.create({
      data: {
        chatId,
        senderId,
        content: input.content,
        replyToId: input.replyToId,
        replyQuote: input.replyQuote,
        silent: input.silent ?? false,
        scheduledAt: new Date(input.scheduledAt),
      },
      select: SCHEDULED_SELECT,
    })
  }

  /** Мои отложенные в этом чате — чужие не показываем: это черновики отправителя. */
  async listScheduled(senderId: string, chatId: string) {
    await this.assertMembership(senderId, chatId)
    return this.prisma.scheduledMessage.findMany({
      where: { chatId, senderId },
      orderBy: { scheduledAt: 'asc' },
      take: SCHEDULED_PER_CHAT_LIMIT,
      select: SCHEDULED_SELECT,
    })
  }

  /** Изменить текст/время своего отложенного сообщения. */
  async updateScheduled(senderId: string, id: string, input: UpdateScheduledMessageInput) {
    await this.ownScheduled(senderId, id)
    return this.prisma.scheduledMessage.update({
      where: { id },
      data: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.scheduledAt !== undefined ? { scheduledAt: new Date(input.scheduledAt) } : {}),
      },
      select: SCHEDULED_SELECT,
    })
  }

  /** Отменить своё отложенное сообщение. */
  async cancelScheduled(senderId: string, id: string): Promise<void> {
    await this.ownScheduled(senderId, id)
    await this.prisma.scheduledMessage.delete({ where: { id } })
  }

  private async ownScheduled(senderId: string, id: string): Promise<void> {
    const row = await this.prisma.scheduledMessage.findUnique({
      where: { id },
      select: { senderId: true },
    })
    if (!row) throw new AppException('NOT_FOUND', 'Отложенное сообщение не найдено')
    if (row.senderId !== senderId) {
      throw new AppException('FORBIDDEN', 'Это чужое отложенное сообщение')
    }
  }

  /**
   * Отправить всё, чему подошло время (вызывается cron'ом из CleanupService — §9.3,
   * единственный дом для расписаний). Возвращает число доставленных.
   *
   * Каждое сообщение обрабатывается независимо: упавшее (чат удалён, автор исключён из
   * группы, собеседник заблокировал) не должно тормозить остальные. Строка удаляется в
   * любом случае — иначе неотправляемое сообщение крутилось бы в очереди вечно.
   */
  async deliverDueScheduled(): Promise<number> {
    const due = await this.prisma.scheduledMessage.findMany({
      where: { scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: SCHEDULED_BATCH,
      select: { ...SCHEDULED_SELECT, chatId: true, senderId: true },
    })
    let sent = 0
    for (const row of due) {
      try {
        // Сообщение-адресат ответа могли удалить за время ожидания. Ронять из-за этого
        // весь текст неправильно — отправляем без ответа и цитаты.
        const replyAlive =
          row.replyToId != null &&
          (await this.prisma.message.count({
            where: { id: row.replyToId, chatId: row.chatId, deletedAt: null },
          })) > 0
        await this.createMessage(
          row.senderId,
          {
            chatId: row.chatId,
            content: row.content,
            ...(replyAlive && row.replyToId ? { replyToId: row.replyToId } : {}),
            ...(replyAlive && row.replyQuote ? { replyQuote: row.replyQuote } : {}),
            silent: row.silent,
          },
          { skipFlood: true },
        )
        sent += 1
      } catch (error) {
        // Молча терять написанный текст нельзя: человек рассчитывал, что оно уйдёт.
        this.logger.warn(
          `Отложенное сообщение ${row.id} не отправлено: ${(error as Error).message}`,
        )
        await this.notifyScheduleFailed(row.senderId, row.chatId, row.content)
      }
      await this.prisma.scheduledMessage.delete({ where: { id: row.id } }).catch(() => undefined)
    }
    if (sent > 0) this.logger.log(`Отложенных сообщений отправлено: ${sent}`)
    return sent
  }

  /** Сообщить автору, что отложенное не ушло (чат удалён, его исключили, его заблокировали). */
  private async notifyScheduleFailed(
    senderId: string,
    chatId: string,
    content: string,
  ): Promise<void> {
    const dedupeKey = `scheduled-failed:${chatId}:${senderId}:${Date.now()}`
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.SCHEDULED_FAILED,
      {
        recipientIds: [senderId],
        type: 'SYSTEM',
        title: 'Отложенное сообщение не отправлено',
        body: content.slice(0, 140),
        data: { chatId, url: `/chats?c=${chatId}` },
        dedupeKey,
      },
      { jobId: dedupeKey },
    )
  }

  /** Список заблокированных мной пользователей (для экрана управления блокировками). */
  async listBlocked(actorId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: { blockerId: actorId },
      select: { blockedId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: BLOCKED_LIST_LIMIT,
    })
    const ids = blocks.map((b) => b.blockedId)
    const users =
      ids.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: ids } },
            take: BLOCKED_LIST_LIMIT,
            select: { id: true, firstName: true, lastName: true, avatarUrl: true },
          })
        : []
    const umap = new Map(users.map((u) => [u.id, u]))
    return blocks.map((b) => ({
      id: b.blockedId,
      firstName: umap.get(b.blockedId)?.firstName ?? '',
      lastName: umap.get(b.blockedId)?.lastName ?? '',
      avatarUrl: umap.get(b.blockedId)?.avatarUrl ?? null,
      blockedAt: b.createdAt,
    }))
  }

  // Антиспам: не более 20 сообщений за 10 сек на пользователя (in-memory, сбрасывается рестартом).

  // ── Официальные чаты (9.6) ────────────────────────────────────────────────

  /** Лениво создаёт официальные чаты scope пользователя и добавляет его в участники. */
  // Провижининг официальных чатов идемпотентен, но стоит ~30 последовательных запросов
  // (findFirst+findUnique на каждый тип + чат каждого предмета). На горячем пути GET /chats
  // это дорого на КАЖДОЙ загрузке мессенджера. Гейтим коротким Redis-флагом: провижиним не чаще
  // раза в CHAT_ENSURE_TTL_SECONDS на пользователя (первая загрузка — как раньше; повторные —
  // пропуск). Новый предмет в расписании подхватится в пределах окна. Redis недоступен →
  // деградируем к прежнему поведению (провижиним каждый раз).
  private async ensureOfficialChatsThrottled(user: JwtPayload): Promise<void> {
    const key = `chat:ensured:${user.sub}`
    let acquired = false
    try {
      acquired = (await this.redis.set(key, '1', 'EX', CHAT_ENSURE_TTL_SECONDS, 'NX')) !== null
      if (!acquired) return
    } catch {
      /* Redis недоступен — не блокируем список, провижиним как прежде */
    }
    try {
      await this.ensureOfficialChatsForUser(user)
    } catch (error) {
      // Провижининг не удался — снимаем флаг, чтобы следующий заход повторил попытку.
      if (acquired) await this.redis.del(key).catch(() => undefined)
      throw error
    }
  }

  async ensureOfficialChatsForUser(user: JwtPayload): Promise<void> {
    if (user.groupId) {
      await this.ensureOfficialChat(ChatType.GROUP_OFFICIAL, { groupId: user.groupId }, user.sub)
    }
    if (user.facultyId) {
      await this.ensureOfficialChat(ChatType.FACULTY, { facultyId: user.facultyId }, user.sub)
      // Чат с деканатом факультета (9.6): студенты/старосты/преподаватели факультета ↔ деканат.
      await this.ensureOfficialChat(ChatType.DEAN, { facultyId: user.facultyId }, user.sub)
    }
    if (user.universityId) {
      await this.ensureOfficialChat(ChatType.SUPPORT, { universityId: user.universityId }, user.sub)
    }
    await this.ensureSubjectChatsForUser(user)
  }

  /**
   * Чаты предметов (9.6): по одному на пару (группа × предмет) из активного расписания.
   * Студент/староста входит в чаты предметов своей группы; преподаватель — в чаты предметов,
   * которые он ведёт (по своим парам). Создаётся лениво по мере появления пар в расписании.
   */
  private async ensureSubjectChatsForUser(user: JwtPayload): Promise<void> {
    const seen = new Map<string, { groupId: string; subject: string }>()
    const collect = (rows: { groupId: string; subject: string }[]): void => {
      for (const r of rows) seen.set(r.groupId + '::' + r.subject, r)
    }
    if (user.groupId) {
      collect(
        await this.prisma.pair.findMany({
          where: { groupId: user.groupId, schedule: { isActive: true } },
          select: { groupId: true, subject: true },
          distinct: ['groupId', 'subject'],
          take: 100,
        }),
      )
    }
    // Преподаватель: предметы его пар (в любой группе). Для студента вернёт пусто — безвредно.
    collect(
      await this.prisma.pair.findMany({
        where: { teacherId: user.sub, schedule: { isActive: true } },
        select: { groupId: true, subject: true },
        distinct: ['groupId', 'subject'],
        take: 100,
      }),
    )
    for (const { groupId, subject } of seen.values()) {
      await this.ensureOfficialChat(ChatType.SUBJECT, { groupId, subject }, user.sub)
    }
  }

  private async ensureOfficialChat(
    type: ChatType,
    scope: { groupId?: string; facultyId?: string; universityId?: string; subject?: string },
    userId: string,
  ): Promise<void> {
    let chat = await this.prisma.chat.findFirst({
      where: { type, ...scope },
      select: { id: true },
    })
    if (!chat) {
      chat = await this.prisma.chat.create({ data: { type, ...scope }, select: { id: true } })
    }
    // Идемпотентно добавить пользователя (unique [chatId,userId]).
    const exists = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: chat.id, userId } },
      select: { id: true },
    })
    if (!exists) {
      await this.prisma.chatMember
        .create({ data: { chatId: chat.id, userId } })
        .catch(() => undefined)
    }
  }
}
