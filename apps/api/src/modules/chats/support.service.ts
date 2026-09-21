import { Injectable } from '@nestjs/common'
import { ChatType, Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  OpenSupportTicketInput,
  SupportQueueQueryInput,
  SupportReplyInput,
  SupportTag,
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
  supportTags: true,
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
      // Тег фильтрует сервер: клиент видит одну страницу, и «все обращения про доступ»
      // среди тридцати загруженных строк — это не «все».
      ...(query.tag ? { supportTags: { has: query.tag } } : {}),
      // Поиск сразу по двум местам: «мы это уже кому-то отвечали» ищут по словам из
      // переписки, а «что там было у Сериковой» — по фамилии. Разделять их на два поля
      // значило бы заставить человека выбирать, что он помнит лучше.
      ...(query.search
        ? {
            OR: [
              { messages: { some: { content: { contains: query.search, mode: 'insensitive' } } } },
              {
                members: {
                  some: { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
                },
              },
            ],
          }
        : {}),
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

  /**
   * Проставить теги обращению. Набор заменяется целиком: снимать теги по одному нечем,
   * а «добавить» и «убрать» двумя ручками — два способа получить расходящееся состояние.
   */
  async setTags(
    viewer: JwtPayload,
    chatId: string,
    tags: SupportTag[],
    ctx: RequestContext = {},
  ): Promise<{ tags: SupportTag[] }> {
    this.assertStaff(viewer)
    await this.assertTicket(chatId)

    // Дубликаты приходят от двойного касания по чипу и ломают счётчики в сводке.
    const unique = [...new Set(tags)]
    await this.prisma.chat.update({ where: { id: chatId }, data: { supportTags: unique } })
    await this.audit.record({
      userId: viewer.sub,
      action: 'support.ticket.tags',
      entity: 'Chat',
      entityId: chatId,
      metadata: { tags: unique },
      ...ctx,
    })
    return { tags: unique }
  }

  /**
   * О чём спрашивают чаще: счётчики тегов за 30 дней.
   *
   * Ради этого числа теги и заводились — «поддержка отвечает на одно и то же» превращается
   * в «шестьдесят обращений про доступ за месяц», то есть в понятную задачу продукту.
   * Окно ограничено намеренно: за всё время счётчик показывал бы историю платформы, а не
   * то, что происходит сейчас.
   */
  async tagCounts(viewer: JwtPayload): Promise<{ tag: string; count: number }[]> {
    this.assertStaff(viewer)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const rows = await this.prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT unnest(support_tags) AS tag, COUNT(*) AS count
        FROM chats
       WHERE type = 'SUPPORT_PLATFORM' AND created_at >= ${since}
       GROUP BY 1
       ORDER BY 2 DESC
    `
    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }))
  }

  /**
   * Эскалировать обращение администраторам.
   *
   * Это действие, а не состояние: эскалация означает «я не справляюсь, посмотрите», и
   * ответ на неё — человек, а не флаг в таблице. Уведомление идёт мимо дежурства и тихих
   * часов: эскалируют ровно тогда, когда обычный путь не сработал.
   */
  async escalate(viewer: JwtPayload, chatId: string, ctx: RequestContext = {}) {
    this.assertStaff(viewer)
    await this.assertTicket(chatId)

    await this.telegram.notifyStaff(
      'ticket',
      'Обращение эскалировано — нужен администратор',
      `support_${chatId}`,
      new Date(),
      true,
    )
    await this.audit.record({
      userId: viewer.sub,
      action: 'support.ticket.escalate',
      entity: 'Chat',
      entityId: chatId,
      ...ctx,
    })
    return { escalated: true }
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

  /**
   * Закрыть обращения, в которых давно нет движения.
   *
   * Закрывается только то, где последнее слово было за КОМАНДОЙ: человек получил ответ и
   * не вернулся. Обращение, где последним писал автор, — это неотвеченный вопрос, и
   * закрывать его по таймеру значит прятать собственный долг.
   *
   * Ответ такое обращение откроет снова, поэтому закрытие ничего не отнимает.
   */
  async closeStale(olderThan: Date): Promise<number> {
    const stale = await this.prisma.chat.findMany({
      where: {
        type: ChatType.SUPPORT_PLATFORM,
        supportClosedAt: null,
        updatedAt: { lt: olderThan },
      },
      select: {
        id: true,
        messages: {
          orderBy: { seq: Prisma.SortOrder.desc },
          take: 1,
          select: { sender: { select: { role: true } } },
        },
      },
      take: 200,
    })

    const ids = stale
      .filter((chat) => {
        const lastRole = chat.messages[0]?.sender.role as Role | undefined
        return lastRole !== undefined && STAFF_ROLES.includes(lastRole)
      })
      .map((chat) => chat.id)
    if (ids.length === 0) return 0

    const { count } = await this.prisma.chat.updateMany({
      where: { id: { in: ids } },
      data: { supportClosedAt: new Date() },
    })
    return count
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
  supportTags: string[]
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
    tags: row.supportTags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
