import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChatType, Prisma } from '@prisma/client'
import type {
  CreateChatInput,
  ChatMessagesQueryInput,
  MessageSearchQueryInput,
  MessageSendInput,
} from '@studenthub/shared-schemas'
import { MESSAGE_EDIT_WINDOW_MS } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { buildPublicObjectUrl } from '../../common/minio/public-url'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { RealtimeGateway } from '../../common/realtime'
import { FileService } from '../files/file.service'
import { PostsService } from '../posts/posts.service'
import type { EnvVars } from '../../config/env.schema'

const SENDER_SELECT = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }

const MESSAGE_SELECT = {
  id: true,
  chatId: true,
  senderId: true,
  content: true,
  replyToId: true,
  forwardedFromId: true,
  editedAt: true,
  pinnedAt: true,
  createdAt: true,
  sender: SENDER_SELECT,
  media: { select: { id: true, mime: true, size: true, name: true } },
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
      content: true,
      authorId: true,
      deletedAt: true,
      author: SENDER_SELECT,
      media: { select: { id: true, mime: true }, take: 1 },
      _count: { select: { comments: true, reactions: true } },
    },
  },
  reactions: { select: { emoji: true, userId: true, user: SENDER_SELECT } },
} satisfies Prisma.MessageSelect

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>

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

  async listChats(viewer: JwtPayload) {
    await this.ensureOfficialChatsForUser(viewer)
    const chats = await this.prisma.chat.findMany({
      // Забаненные чаты (bannedAt != null у своего членства) в списке не показываем.
      where: { members: { some: { userId: viewer.sub, bannedAt: null } } },
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
        updatedAt: true,
        members: {
          where: { userId: viewer.sub },
          select: { lastReadAt: true, mutedAt: true, isAdmin: true, clearedAt: true },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: MESSAGE_SELECT,
        },
        _count: { select: { members: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
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
    const others =
      privateIds.length > 0
        ? await this.prisma.chatMember.findMany({
            where: { chatId: { in: privateIds }, userId: { not: viewer.sub } },
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
    const unreadFloor = (m: { lastReadAt: Date | null; clearedAt: Date | null }): Date | null => {
      if (!m.lastReadAt) return m.clearedAt
      if (!m.clearedAt) return m.lastReadAt
      return m.lastReadAt > m.clearedAt ? m.lastReadAt : m.clearedAt
    }
    const needCount = chats.filter((c) => {
      const lm = c.messages[0]
      const mem = c.members[0]
      if (!lm || !mem) return false
      const floor = unreadFloor(mem)
      const cleared = mem.clearedAt
      const afterClear = !cleared || lm.createdAt > cleared
      return lm.senderId !== viewer.sub && afterClear && (floor === null || lm.createdAt > floor)
    })
    const counts = await Promise.all(
      needCount.map((c) =>
        this.prisma.message.count({
          where: {
            chatId: c.id,
            deletedAt: null,
            senderId: { not: viewer.sub },
            ...(unreadFloor(c.members[0]!)
              ? { createdAt: { gt: unreadFloor(c.members[0]!)! } }
              : {}),
          },
        }),
      ),
    )
    const countMap = new Map(needCount.map((c, i) => [c.id, counts[i] ?? 0]))

    return chats.map((c) => {
      const mem = c.members[0]
      const cleared = mem?.clearedAt ?? null
      // Очищенную «для меня» историю не показываем в превью.
      const lastMessage =
        c.messages[0] && (!cleared || c.messages[0].createdAt > cleared) ? c.messages[0] : null
      const unreadCount = countMap.get(c.id) ?? 0
      const unread = unreadCount > 0
      const other = otherMap.get(c.id)
      return {
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
        muted: mem?.mutedAt != null,
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
        updatedAt: c.updatedAt,
      }
    })
  }

  // ── Создание PRIVATE/GROUP (9.5) ────────────────────────────────────────────

  async createChat(actor: JwtPayload, input: CreateChatInput) {
    const memberIds = [...new Set([actor.sub, ...input.memberIds])]
    // Личный чат с заблокированным (в любую сторону) создать нельзя.
    if (input.type === 'PRIVATE') {
      const other = memberIds.find((id) => id !== actor.sub)
      if (other && (await this.isBlockedBetween(actor.sub, other))) {
        throw new AppException('FORBIDDEN', 'Переписка недоступна: пользователь заблокирован')
      }
    }
    const chat = await this.prisma.chat.create({
      data: {
        type: input.type as ChatType,
        title: input.title,
        // Создатель — «админ» пользовательской группы (для бана/аватара).
        createdById: input.type === 'GROUP' ? actor.sub : null,
        members: {
          create: memberIds.map((userId) => ({
            userId,
            isAdmin: input.type === 'GROUP' && userId === actor.sub,
          })),
        },
      },
      select: { id: true, type: true, title: true },
    })
    return chat
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
    const rows = await this.prisma.message.findMany({
      where: {
        chatId,
        deletedAt: null,
        ...(mem?.clearedAt ? { createdAt: { gt: mem.clearedAt } } : {}),
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
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    const online = new Set(this.realtime.onlineAmong(members.map((m) => m.userId)))
    return members.map((m) => ({
      ...m.user,
      online: online.has(m.userId),
      banned: m.bannedAt != null,
      isAdmin: m.isAdmin,
    }))
  }

  async addMember(actor: JwtPayload, chatId: string, userId: string) {
    await this.assertMembership(actor.sub, chatId)
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
    return { chatId, user }
  }

  async removeMember(actor: JwtPayload, chatId: string, userId: string): Promise<void> {
    await this.assertMembership(actor.sub, chatId)
    await this.prisma.chatMember.deleteMany({ where: { chatId, userId } })
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
  ): Promise<{ message: MessageRow; recipientIds: string[] }> {
    await this.assertMembership(senderId, input.chatId)
    this.assertNotFlooding(senderId)
    await this.assertNotBlockedInPrivate(input.chatId, senderId)
    await this.assertReplyInChat(input.chatId, input.replyToId)
    const message = await this.prisma.message.create({
      data: {
        chatId: input.chatId,
        senderId,
        content: input.content,
        replyToId: input.replyToId,
      },
      select: MESSAGE_SELECT,
    })
    await this.bumpChat(input.chatId)
    const recipientIds = await this.notifyNewMessage(input.chatId, senderId, message)
    return { message, recipientIds }
  }

  /**
   * Отправка сообщения с вложениями через REST (multipart, 9+). Текст опционален, если есть файлы.
   * Порядок: создать сообщение → загрузить файлы в приватный бакет chat-media с привязкой к
   * messageId → перечитать сообщение с media → эмит `message:new` один раз всем в комнате.
   */
  async sendMessageRest(
    senderId: string,
    input: { chatId: string; content?: string; replyToId?: string },
    files: { buffer: Buffer; name?: string }[],
  ): Promise<MessageRow> {
    await this.assertMembership(senderId, input.chatId)
    this.assertNotFlooding(senderId)
    await this.assertNotBlockedInPrivate(input.chatId, senderId)
    await this.assertReplyInChat(input.chatId, input.replyToId)
    const content = input.content?.trim() ?? ''
    if (content.length === 0 && files.length === 0) {
      throw new AppException('BAD_REQUEST', 'Сообщение не может быть пустым')
    }
    const bucket = this.config.get('MINIO_BUCKET_CHAT', { infer: true })
    const created = await this.prisma.message.create({
      data: { chatId: input.chatId, senderId, content, replyToId: input.replyToId },
      select: { id: true },
    })
    for (const file of files) {
      await this.files.upload({
        buffer: file.buffer,
        bucket,
        ownerId: senderId,
        messageId: created.id,
        name: file.name,
      })
    }
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: created.id },
      select: MESSAGE_SELECT,
    })
    await this.bumpChat(input.chatId)
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
    const members = await this.prisma.chatMember.findMany({
      where: { chatId, userId: { not: senderId } },
      select: { userId: true, mutedAt: true },
    })
    // Живой список чатов у всех участников (в т.ч. заглушённых): message:new уходит только в комнату
    // chat:{id} (её джойнят только с открытым чатом), поэтому для превью/счётчика/порядка в списке
    // шлём тихий сигнал в user:{id}. Он НЕ создаёт уведомление — только просит обновить список.
    for (const m of members) {
      this.realtime.emitToUser(m.userId, 'chat:activity', { chatId })
    }
    // Кто сейчас открыл этот чат (в комнате chat:{id}) — уведомление не создаём: они читают его вживую.
    // Заглушённые (mutedAt != null) — тоже без уведомления (Telegram-стиль), но сообщение им приходит.
    const viewing = await this.realtime.usersInRoom(`chat:${chatId}`)
    const recipientIds = members
      .filter((m) => !m.mutedAt && !viewing.has(m.userId))
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
    return message
  }

  /** Закреплённые сообщения чата, новые сверху. */
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
    const source = await this.prisma.message.findFirst({
      where: { id: sourceMessageId, deletedAt: null },
      select: {
        id: true,
        chatId: true,
        content: true,
        media: { select: { bucket: true, key: true, mime: true, size: true, name: true } },
      },
    })
    if (!source) throw new AppException('NOT_FOUND', 'Исходное сообщение не найдено')
    await this.assertMembership(userId, source.chatId)
    const created = await this.prisma.message.create({
      data: {
        chatId: targetChatId,
        senderId: userId,
        content: source.content,
        forwardedFromId: source.id,
      },
      select: { id: true },
    })
    // Копируем каждое вложение на новый ключ (у File @@unique([bucket,key]) — переиспользовать нельзя).
    for (const f of source.media) {
      await this.files.copyToMessage(f, userId, created.id)
    }
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: created.id },
      select: MESSAGE_SELECT,
    })
    await this.bumpChat(targetChatId)
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
    // Бросит NOT_FOUND, если пост не виден отправителю (IDOR-защита).
    await this.posts.assertVisibleToViewer(viewer, postId)
    const created = await this.prisma.message.create({
      data: {
        chatId: targetChatId,
        senderId: viewer.sub,
        content: comment?.trim() ?? '',
        sharedPostId: postId,
      },
      select: { id: true },
    })
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
  async setMuted(
    userId: string,
    chatId: string,
    muted: boolean,
  ): Promise<{ chatId: string; muted: boolean }> {
    await this.assertMembership(userId, chatId)
    await this.prisma.chatMember.updateMany({
      where: { chatId, userId },
      data: { mutedAt: muted ? new Date() : null },
    })
    return { chatId, muted }
  }

  // ── Присутствие (Ф9+) ──────────────────────────────────────────────────────

  /** Онлайн-статус участников чата (по активным WS-соединениям). */
  async getPresence(
    userId: string,
    chatId: string,
  ): Promise<{ userId: string; online: boolean }[]> {
    await this.assertMembership(userId, chatId)
    const members = await this.prisma.chatMember.findMany({
      where: { chatId },
      select: { userId: true },
    })
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

  /** Для PRIVATE-чата — запретить отправку, если между участниками есть блокировка. */
  private async assertNotBlockedInPrivate(chatId: string, senderId: string): Promise<void> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: {
        type: true,
        members: { where: { userId: { not: senderId } }, select: { userId: true } },
      },
    })
    if (chat?.type !== ChatType.PRIVATE) return
    const other = chat.members[0]?.userId
    if (other && (await this.isBlockedBetween(senderId, other))) {
      throw new AppException('FORBIDDEN', 'Переписка недоступна: пользователь заблокирован')
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
    // Иначе — выходим/удаляем у себя; если участников не осталось, удаляем чат целиком.
    await this.prisma.chatMember.deleteMany({ where: { chatId, userId: actor.sub } })
    const left = await this.prisma.chatMember.count({ where: { chatId } })
    if (left === 0) {
      await this.prisma.chat.delete({ where: { id: chatId } })
      return { chatId, deleted: true }
    }
    return { chatId, deleted: false }
  }

  /** Список заблокированных мной пользователей (для экрана управления блокировками). */
  async listBlocked(actorId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: { blockerId: actorId },
      select: { blockedId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const ids = blocks.map((b) => b.blockedId)
    const users =
      ids.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: ids } },
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
  private readonly msgTimes = new Map<string, number[]>()
  private assertNotFlooding(userId: string): void {
    const now = Date.now()
    const windowMs = 10_000
    const max = 20
    const recent = (this.msgTimes.get(userId) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= max) {
      throw new AppException('RATE_LIMIT', 'Слишком много сообщений — подождите немного')
    }
    recent.push(now)
    this.msgTimes.set(userId, recent)
  }

  // ── Официальные чаты (9.6) ────────────────────────────────────────────────

  /** Лениво создаёт официальные чаты scope пользователя и добавляет его в участники. */
  async ensureOfficialChatsForUser(user: JwtPayload): Promise<void> {
    if (user.groupId) {
      await this.ensureOfficialChat(ChatType.GROUP_OFFICIAL, { groupId: user.groupId }, user.sub)
    }
    if (user.facultyId) {
      await this.ensureOfficialChat(ChatType.FACULTY, { facultyId: user.facultyId }, user.sub)
    }
    if (user.universityId) {
      await this.ensureOfficialChat(ChatType.SUPPORT, { universityId: user.universityId }, user.sub)
    }
  }

  private async ensureOfficialChat(
    type: ChatType,
    scope: { groupId?: string; facultyId?: string; universityId?: string },
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
