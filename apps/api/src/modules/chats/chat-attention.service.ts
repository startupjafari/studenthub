import { Injectable, type OnModuleInit } from '@nestjs/common'
import { ChatAttentionKind, ChatType, type Prisma } from '@prisma/client'
import { CHAT_ATTENTION_PAGE_MAX } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../common/realtime'
import { ChatsService } from './chats.service'
import { mentionTokens, mentionsName } from './chat-mentions'
import type {
  AttentionMessage,
  ChatAttentionCounts,
  ChatAttentionHook,
} from './chat-attention.types'

/**
 * Где упоминания считаются. В личном чате и «Сохранённых» адресат и так один: значок «@» на
 * каждый ответ собеседнику был бы шумом — Telegram считает упоминания только в группах.
 * Реакции считаются везде.
 */
const MENTION_CHAT_TYPES: ReadonlySet<ChatType> = new Set(
  Object.values(ChatType).filter((t) => t !== ChatType.PRIVATE && t !== ChatType.SAVED),
)

/** Потолок кандидатов в упомянутые на одно сообщение (участники с подходящим именем). */
const MENTION_CANDIDATES_MAX = 200

/** Потолок строк одного сообщения при правке, удалении и пересчёте (по одной на участника). */
const MESSAGE_ROWS_MAX = 5000

/** WS-событие своим устройствам: счётчики «@» и «♥» чата изменились. */
export const CHAT_ATTENTION_EVENT = 'chat:attention'

export interface ChatAttentionEvent extends ChatAttentionCounts {
  chatId: string
}

export interface ChatAttentionItem {
  messageId: string
  seq: number
  createdAt: Date
}

const EMPTY: ChatAttentionCounts = { unreadMentionsCount: 0, unreadReactionsCount: 0 }

/**
 * Непрочитанные упоминания и реакции (Telegram: unreadMentionsCount / unreadReactionsCount).
 *
 * Хранит строку ChatAttention на каждое сообщение, которое ждёт внимания участника, и
 * удаляет её, когда сообщение показали («прочитать по одному») или человек нажал
 * «Прочитать всё». Счётчики уходят в элемент списка чатов (GET /chats) и событием
 * `chat:attention` на все устройства участника.
 *
 * Отметка «прочитано до» эти строки не снимает, как и в Telegram: пролистанное кнопкой
 * «вниз» упоминание остаётся непрочитанным, пока сообщение не окажется на экране. Снимает
 * только «Прочитать» чат целиком (POST /chats/read).
 */
@Injectable()
export class ChatAttentionService implements ChatAttentionHook, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly chats: ChatsService,
  ) {}

  onModuleInit(): void {
    this.chats.registerAttentionHook(this)
  }

  // ── Кого сообщение упоминает ─────────────────────────────────────────────────

  /**
   * Действующие участники чата (кроме автора), к которым обращено сообщение: ответ на их
   * сообщение или «@Фамилия Имя» в тексте. Служебные и пересланные сообщения никого не
   * упоминают: пересылка — чужие слова, обращённые не к этому чату.
   */
  async mentionedUserIds(
    chatId: string,
    chatType: ChatType | null,
    message: Pick<AttentionMessage, 'senderId' | 'systemType' | 'forwardedFromId' | 'replyTo'> & {
      content: string
    },
  ): Promise<string[]> {
    if (!chatType || !MENTION_CHAT_TYPES.has(chatType)) return []
    if (message.systemType || message.forwardedFromId) return []
    const out = new Set<string>()
    const replyTo = message.replyTo?.senderId
    if (replyTo && replyTo !== message.senderId) out.add(replyTo)

    const tokens = mentionTokens(message.content)
    if (tokens.length > 0) {
      const candidates = await this.prisma.chatMember.findMany({
        where: {
          chatId,
          bannedAt: null,
          userId: { not: message.senderId },
          user: {
            OR: tokens.flatMap((t) => [
              { lastName: { startsWith: t, mode: 'insensitive' as const } },
              { firstName: { startsWith: t, mode: 'insensitive' as const } },
            ]),
          },
        },
        select: { userId: true, user: { select: { firstName: true, lastName: true } } },
        take: MENTION_CANDIDATES_MAX,
      })
      for (const c of candidates) {
        if (mentionsName(message.content, c.user)) out.add(c.userId)
      }
    }
    if (out.size === 0) return []
    // Ответ мог прийти на сообщение того, кто уже вышел или забанен: упоминать некого.
    const members = await this.prisma.chatMember.findMany({
      where: { chatId, bannedAt: null, userId: { in: [...out] } },
      select: { userId: true },
      take: out.size,
    })
    return members.map((m) => m.userId)
  }

  // ── Хуки сервиса чатов ───────────────────────────────────────────────────────

  async onMessageSent(event: {
    chatId: string
    chatType: ChatType | null
    message: AttentionMessage
  }): Promise<void> {
    const { chatId, message } = event
    const userIds = await this.mentionedUserIds(chatId, event.chatType, message)
    if (userIds.length === 0) return
    await this.prisma.chatAttention.createMany({
      data: userIds.map((userId) => ({
        chatId,
        userId,
        messageId: message.id,
        kind: ChatAttentionKind.MENTION,
      })),
      skipDuplicates: true,
    })
    await this.emitCounts(userIds, chatId)
  }

  async onMessageEdited(event: {
    chatId: string
    message: AttentionMessage
    previousContent: string
  }): Promise<void> {
    const { chatId, message } = event
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { type: true },
    })
    const chatType = chat?.type ?? null
    const [now, before] = await Promise.all([
      this.mentionedUserIds(chatId, chatType, message),
      this.mentionedUserIds(chatId, chatType, { ...message, content: event.previousContent }),
    ])
    const nowSet = new Set(now)
    const beforeSet = new Set(before)
    const added = now.filter((id) => !beforeSet.has(id))
    const removed = before.filter((id) => !nowSet.has(id))
    const changed = new Set<string>()
    if (added.length > 0) {
      await this.prisma.chatAttention.createMany({
        data: added.map((userId) => ({
          chatId,
          userId,
          messageId: message.id,
          kind: ChatAttentionKind.MENTION,
        })),
        skipDuplicates: true,
      })
      for (const id of added) changed.add(id)
    }
    if (removed.length > 0) {
      const gone = await this.prisma.chatAttention.findMany({
        where: { messageId: message.id, kind: ChatAttentionKind.MENTION, userId: { in: removed } },
        select: { userId: true },
        take: removed.length,
      })
      if (gone.length > 0) {
        await this.prisma.chatAttention.deleteMany({
          where: {
            messageId: message.id,
            kind: ChatAttentionKind.MENTION,
            userId: { in: gone.map((g) => g.userId) },
          },
        })
        for (const g of gone) changed.add(g.userId)
      }
    }
    await this.emitCounts([...changed], chatId)
  }

  /**
   * Реакция на сообщение. Поставили или заменили чужую — у автора непрочитанная реакция
   * (время — сейчас: свежая реакция поднимает сообщение в очереди «к реакции» не выше его
   * места в ленте, очередь упорядочена по seq). Сняли — непрочитанное уходит, только если
   * чужих реакций на сообщении не осталось вовсе.
   */
  async onReactionChanged(event: {
    chatId: string
    messageId: string
    reactorId: string
    added: boolean
  }): Promise<void> {
    const { chatId, messageId } = event
    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, chatId, deletedAt: null },
      select: { senderId: true, systemType: true },
    })
    if (!msg || msg.systemType || msg.senderId === event.reactorId) return
    const authorId = msg.senderId
    if (event.added) {
      const member = await this.prisma.chatMember.findFirst({
        where: { chatId, userId: authorId, bannedAt: null },
        select: { id: true },
      })
      if (!member) return
      await this.prisma.chatAttention.upsert({
        where: {
          userId_messageId_kind: { userId: authorId, messageId, kind: ChatAttentionKind.REACTION },
        },
        create: { chatId, userId: authorId, messageId, kind: ChatAttentionKind.REACTION },
        update: { createdAt: new Date() },
      })
      await this.emitCounts([authorId], chatId)
      return
    }
    const foreign = await this.prisma.messageReaction.findFirst({
      where: { messageId, userId: { not: authorId } },
      select: { id: true },
    })
    if (foreign) return
    const { count } = await this.prisma.chatAttention.deleteMany({
      where: { userId: authorId, messageId, kind: ChatAttentionKind.REACTION },
    })
    if (count > 0) await this.emitCounts([authorId], chatId)
  }

  async onMessagesGone(event: {
    chatId: string
    messageIds: string[]
    userId?: string
  }): Promise<void> {
    const { chatId, messageIds, userId } = event
    if (messageIds.length === 0) return
    const where: Prisma.ChatAttentionWhereInput = {
      chatId,
      messageId: { in: messageIds },
      ...(userId ? { userId } : {}),
    }
    const rows = await this.prisma.chatAttention.findMany({
      where,
      select: { userId: true },
      take: MESSAGE_ROWS_MAX,
    })
    if (rows.length === 0) return
    await this.prisma.chatAttention.deleteMany({ where })
    await this.emitCounts([...new Set(rows.map((r) => r.userId))], chatId)
  }

  async onHistoryCleared(event: { chatId: string; userId: string }): Promise<void> {
    const { chatId, userId } = event
    const visible = await this.chats.visibleMessagesWhere(userId, chatId)
    const { count } = await this.prisma.chatAttention.deleteMany({
      where: { userId, chatId, NOT: { message: visible } },
    })
    if (count > 0) await this.emitCounts([userId], chatId)
  }

  async onChatsRead(event: { userId: string; chatIds: string[] }): Promise<void> {
    const { userId, chatIds } = event
    if (chatIds.length === 0) return
    const touched = await this.prisma.chatAttention.groupBy({
      by: ['chatId'],
      where: { userId, chatId: { in: chatIds } },
      _count: { _all: true },
    })
    if (touched.length === 0) return
    const ids = touched.map((t) => t.chatId)
    await this.prisma.chatAttention.deleteMany({ where: { userId, chatId: { in: ids } } })
    for (const chatId of ids) this.emit(userId, chatId, EMPTY)
  }

  async countsFor(
    userId: string,
    chats: { chatId: string; messageWhere: Prisma.MessageWhereInput }[],
  ): Promise<Map<string, ChatAttentionCounts>> {
    if (chats.length === 0) return new Map()
    return this.count(
      userId,
      chats.map((c) => ({ chatId: c.chatId, message: c.messageWhere })),
    )
  }

  // ── REST: выдача и прочтение ─────────────────────────────────────────────────

  /**
   * Непрочитанные упоминания (реакции) чата по порядку ленты, старые первыми: кнопка «@»
   * ведёт к самому раннему, как в Telegram. Только видимые смотрящему сообщения.
   */
  async listUnread(
    userId: string,
    chatId: string,
    kind: ChatAttentionKind,
  ): Promise<{ items: ChatAttentionItem[]; count: number }> {
    const visible = await this.chats.visibleMessagesWhere(userId, chatId)
    const where: Prisma.ChatAttentionWhereInput = { userId, chatId, kind, message: visible }
    const [rows, count] = await Promise.all([
      this.prisma.chatAttention.findMany({
        where,
        select: { messageId: true, message: { select: { seq: true, createdAt: true } } },
        orderBy: { message: { seq: 'asc' } },
        take: CHAT_ATTENTION_PAGE_MAX,
      }),
      this.prisma.chatAttention.count({ where }),
    ])
    return {
      items: rows.map((r) => ({
        messageId: r.messageId,
        seq: r.message.seq,
        createdAt: r.message.createdAt,
      })),
      count,
    }
  }

  /**
   * Прочитать упоминания (реакции) чата: показанные сообщения (`messageIds`) или все.
   * Возвращает счётчики после прочтения; другим устройствам — `chat:attention`.
   */
  async markRead(
    userId: string,
    chatId: string,
    kind: ChatAttentionKind,
    messageIds?: string[],
  ): Promise<ChatAttentionCounts> {
    await this.chats.assertMembership(userId, chatId)
    const { count } = await this.prisma.chatAttention.deleteMany({
      where: { userId, chatId, kind, ...(messageIds ? { messageId: { in: messageIds } } : {}) },
    })
    const counts = (await this.count(userId, [{ chatId }])).get(chatId) ?? EMPTY
    if (count > 0) this.emit(userId, chatId, counts)
    return counts
  }

  // ── Счётчики и события ───────────────────────────────────────────────────────

  /**
   * Счётчики по чатам одним GROUP BY. Удалённые и скрытые «у себя» сообщения не считаются
   * даже если их строки ещё не убраны (удаление модератором, гонка с прочтением).
   */
  private async count(
    userId: string,
    branches: Prisma.ChatAttentionWhereInput[],
  ): Promise<Map<string, ChatAttentionCounts>> {
    const grouped = await this.prisma.chatAttention.groupBy({
      by: ['chatId', 'kind'],
      where: {
        userId,
        message: { deletedAt: null, hiddenBy: { none: { userId } } },
        OR: branches,
      },
      _count: { _all: true },
    })
    const out = new Map<string, ChatAttentionCounts>()
    for (const g of grouped) {
      const cur = out.get(g.chatId) ?? { ...EMPTY }
      if (g.kind === ChatAttentionKind.MENTION) cur.unreadMentionsCount = g._count._all
      else cur.unreadReactionsCount = g._count._all
      out.set(g.chatId, cur)
    }
    return out
  }

  /** Пересчитать счётчики чата у каждого из участников и разослать их устройствам. */
  private async emitCounts(userIds: string[], chatId: string): Promise<void> {
    for (const userId of userIds) {
      const counts = (await this.count(userId, [{ chatId }])).get(chatId) ?? EMPTY
      this.emit(userId, chatId, counts)
    }
  }

  private emit(userId: string, chatId: string, counts: ChatAttentionCounts): void {
    const payload: ChatAttentionEvent = { chatId, ...counts }
    this.realtime.emitToUser(userId, CHAT_ATTENTION_EVENT, payload)
  }
}
