import { Injectable } from '@nestjs/common'
import { ChatType, Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  OpenSupportTicketInput,
  SupportQueueQueryInput,
  SupportReplyInput,
} from '@studenthub/shared-schemas'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { TelegramNotifyService } from '../../common/telegram/telegram-notify.service'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { ChatsService } from './chats.service'

// Поддержка платформы (docs/PROJECT.md §Поддержка).
//
// Живёт в модуле чатов, а не в своём: обращение — это строка в `chats`, а таблица
// принадлежит этому модулю (BACKEND_RULES §2.1). Отдельный файл, а не методы в
// ChatsService: у поддержки своя роль и свой жизненный цикл, и растворять её в сервисе
// на 2700 строк значило бы потерять и то и другое.

const STAFF_ROLES: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

const TICKET_SELECT = {
  id: true,
  createdAt: true,
  updatedAt: true,
  supportClosedAt: true,
  supportAssigneeId: true,
  supportFirstReplyAt: true,
  members: {
    select: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
  },
  messages: {
    where: { deletedAt: null },
    orderBy: { seq: Prisma.SortOrder.desc },
    take: 1,
    select: { content: true, createdAt: true, senderId: true },
  },
} satisfies Prisma.ChatSelect

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chats: ChatsService,
    private readonly audit: AuditService,
    private readonly telegram: TelegramNotifyService,
  ) {}

  /**
   * Открыть обращение или дописать в уже открытое.
   *
   * Второе обращение, пока первое не закрыто, не создаётся намеренно: иначе один человек
   * за минуту заводит десяток веток, и очередь перестаёт показывать, сколько людей ждут
   * ответа. Переписка остаётся одной, пока поддержка её не закроет.
   */
  async open(
    user: JwtPayload,
    input: OpenSupportTicketInput,
    ctx: RequestContext = {},
  ): Promise<{ id: string; created: boolean }> {
    const existing = await this.prisma.chat.findFirst({
      where: {
        type: ChatType.SUPPORT_PLATFORM,
        supportClosedAt: null,
        members: { some: { userId: user.sub } },
      },
      select: { id: true },
    })

    const chatId = existing ? existing.id : await this.createTicket(user.sub)
    await this.chats.createMessage(user.sub, { chatId, content: input.text })

    await this.audit.record({
      userId: user.sub,
      action: existing ? 'support.ticket.append' : 'support.ticket.open',
      entity: 'Chat',
      entityId: chatId,
      ...ctx,
    })
    // Только о новом обращении: дописка в открытое уже кого-то ждёт, и второе
    // уведомление о той же ветке ничего не добавляет.
    if (!existing) {
      await this.telegram.notifyStaff('ticket', 'Новое обращение в поддержку', `support_${chatId}`)
    }
    return { id: chatId, created: existing === null }
  }

  /** Очередь обращений. Только команда платформы. */
  async queue(viewer: JwtPayload, query: SupportQueueQueryInput): Promise<Paginated<unknown>> {
    this.assertStaff(viewer)
    // Сотрудник, назначенный после создания обращения, в его участниках не состоит —
    // иначе не увидел бы ни очереди, ни переписки. Догоняем при открытии очереди, тем же
    // ленивым приёмом, каким домен чатов заводит официальные чаты.
    await this.joinOpenTickets(viewer.sub)

    const where: Prisma.ChatWhereInput = {
      type: ChatType.SUPPORT_PLATFORM,
      supportClosedAt: query.status === 'open' ? null : { not: null },
      ...(query.assignee === 'mine' ? { supportAssigneeId: viewer.sub } : {}),
      ...(query.assignee === 'free' ? { supportAssigneeId: null } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.chat.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: TICKET_SELECT,
      }),
      this.prisma.chat.count({ where }),
    ])

    return new Paginated(rows.map(toTicket), { total })
  }

  /**
   * Обращение вместе с перепиской: команда платформы или его автор.
   *
   * Карточка обращения отдаётся рядом с сообщениями намеренно. Экран открывается не только
   * из очереди, но и по ссылке из уведомления — а там списка, откуда взять автора и дату,
   * у клиента нет.
   */
  async thread(viewer: JwtPayload, chatId: string) {
    await this.assertAccess(viewer, chatId)
    const [row, messages] = await Promise.all([
      this.prisma.chat.findUniqueOrThrow({ where: { id: chatId }, select: TICKET_SELECT }),
      this.chats.getMessages(viewer, chatId, { limit: 50 }),
    ])
    return { ticket: toTicket(row), messages: messages.items }
  }

  /**
   * Ответить. Ответ в закрытое обращение открывает его снова: человек с уточняющим
   * вопросом иначе остался бы без канала и завёл бы второе обращение о том же.
   */
  async reply(
    viewer: JwtPayload,
    chatId: string,
    input: SupportReplyInput,
    ctx: RequestContext = {},
  ) {
    await this.assertAccess(viewer, chatId)
    const { message } = await this.chats.createMessage(viewer.sub, {
      chatId,
      content: input.text,
    })
    await this.prisma.chat.updateMany({
      where: { id: chatId, supportClosedAt: { not: null } },
      data: { supportClosedAt: null },
    })
    // Первый ответ команды. `supportFirstReplyAt: null` в условии — чтобы отметка
    // проставилась ровно один раз: повторное открытие обращения не делает первый
    // ответ быстрее, и переписывать её значило бы улучшать метрику задним числом.
    if (STAFF_ROLES.includes(viewer.role)) {
      await this.prisma.chat.updateMany({
        where: { id: chatId, supportFirstReplyAt: null },
        data: { supportFirstReplyAt: new Date() },
      })
    }
    await this.audit.record({
      userId: viewer.sub,
      action: 'support.ticket.reply',
      entity: 'Chat',
      entityId: chatId,
      ...ctx,
    })
    // Ответ АВТОРА будит команду, ответ команды — нет: иначе поддержка уведомляла бы
    // сама себя. Без этого человек, дописавший в открытое обращение, ждал молча, а
    // узнавали о нём, только зайдя в очередь.
    if (!STAFF_ROLES.includes(viewer.role)) {
      await this.telegram.notifyStaff('reply', 'Ответ в обращении поддержки', `support_${chatId}`)
    }
    return message
  }

  /**
   * Взять обращение себе или отдать обратно в общую очередь.
   *
   * Перехватить чужое нельзя: если обращение уже за кем-то, сервер отвечает отказом, а не
   * молча переписывает назначение. Двое, разбирающие одно обращение и не знающие об этом, —
   * та самая проблема, ради которой назначение и заводится.
   */
  async assign(
    viewer: JwtPayload,
    chatId: string,
    take: boolean,
    ctx: RequestContext = {},
  ): Promise<{ assigneeId: string | null }> {
    this.assertStaff(viewer)
    await this.assertTicket(chatId)

    const { count } = await this.prisma.chat.updateMany({
      // Взять можно только свободное, отдать — только своё.
      where: take
        ? { id: chatId, supportAssigneeId: null }
        : { id: chatId, supportAssigneeId: viewer.sub },
      data: { supportAssigneeId: take ? viewer.sub : null },
    })
    if (count === 0) throw new AppException('CONFLICT', 'Обращение уже разбирает другой человек')

    await this.audit.record({
      userId: viewer.sub,
      action: take ? 'support.ticket.assign' : 'support.ticket.unassign',
      entity: 'Chat',
      entityId: chatId,
      ...ctx,
    })
    return { assigneeId: take ? viewer.sub : null }
  }

  /** Закрыть обращение. Переписка остаётся; закрытие — про очередь, не про доступ. */
  async close(viewer: JwtPayload, chatId: string, ctx: RequestContext = {}) {
    this.assertStaff(viewer)
    await this.assertTicket(chatId)
    await this.prisma.chat.update({
      where: { id: chatId },
      data: { supportClosedAt: new Date() },
    })
    await this.audit.record({
      userId: viewer.sub,
      action: 'support.ticket.close',
      entity: 'Chat',
      entityId: chatId,
      ...ctx,
    })
    return { id: chatId, closed: true }
  }

  /** Создаёт обращение с автором и всей текущей командой платформы в участниках. */
  private async createTicket(authorId: string): Promise<string> {
    const staff = await this.prisma.user.findMany({
      where: { role: { in: [...STAFF_ROLES] }, deletedAt: null, isBlocked: false },
      select: { id: true },
      take: 100,
    })
    const userIds = [...new Set([authorId, ...staff.map((s) => s.id)])]
    const chat = await this.prisma.chat.create({
      data: {
        type: ChatType.SUPPORT_PLATFORM,
        members: { create: userIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    })
    return chat.id
  }

  /** Добавляет сотрудника в обращения, где его ещё нет (батчем, без запроса на чат). */
  private async joinOpenTickets(userId: string): Promise<void> {
    const missing = await this.prisma.chat.findMany({
      where: {
        type: ChatType.SUPPORT_PLATFORM,
        supportClosedAt: null,
        members: { none: { userId } },
      },
      select: { id: true },
      take: 200,
    })
    if (missing.length === 0) return
    await this.prisma.chatMember.createMany({
      data: missing.map((chat) => ({ chatId: chat.id, userId })),
      skipDuplicates: true,
    })
  }

  private assertStaff(viewer: JwtPayload): void {
    if (!STAFF_ROLES.includes(viewer.role)) {
      throw new AppException('FORBIDDEN', 'Недостаточно прав')
    }
  }

  private async assertTicket(chatId: string): Promise<void> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { type: true },
    })
    if (chat?.type !== ChatType.SUPPORT_PLATFORM) {
      throw new AppException('NOT_FOUND', 'Обращение не найдено')
    }
  }

  /** Доступ к обращению: сотрудник платформы (с догоном членства) либо участник-автор. */
  private async assertAccess(viewer: JwtPayload, chatId: string): Promise<void> {
    await this.assertTicket(chatId)
    if (STAFF_ROLES.includes(viewer.role)) {
      await this.prisma.chatMember.createMany({
        data: [{ chatId, userId: viewer.sub }],
        skipDuplicates: true,
      })
      return
    }
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: viewer.sub } },
      select: { id: true },
    })
    if (!member) throw new AppException('NOT_FOUND', 'Обращение не найдено')
  }
}

/** Строка очереди: кто написал, когда и чем закончилось — без лишнего для телефона. */
function toTicket(row: {
  id: string
  createdAt: Date
  updatedAt: Date
  supportClosedAt: Date | null
  supportAssigneeId: string | null
  supportFirstReplyAt: Date | null
  members: { user: { id: string; firstName: string; lastName: string; role: string } }[]
  messages: { content: string | null; createdAt: Date; senderId: string }[]
}) {
  // Автор — единственный участник не из команды платформы: обращение заводится от него,
  // а сотрудники добавляются пачкой.
  const author = row.members.find((m) => !STAFF_ROLES.includes(m.user.role as Role))?.user ?? null
  const last = row.messages[0] ?? null
  return {
    id: row.id,
    author: author && {
      id: author.id,
      firstName: author.firstName,
      lastName: author.lastName,
    },
    lastMessage: last && {
      text: last.content,
      createdAt: last.createdAt,
      fromAuthor: author !== null && last.senderId === author.id,
    },
    closedAt: row.supportClosedAt,
    assigneeId: row.supportAssigneeId,
    // Имя разбирающего берём из участников: команда платформы в них уже есть.
    assignee: row.members.find((m) => m.user.id === row.supportAssigneeId)?.user ?? null,
    firstReplyAt: row.supportFirstReplyAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
