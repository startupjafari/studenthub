import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
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
import { lastMessagesOf } from './last-message'

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
} satisfies Prisma.ChatSelect

/** Последнее сообщение обращения для строки очереди — читается отдельно, см. lastTicketMessages. */
interface TicketLastMessage {
  chatId: string
  content: string | null
  createdAt: Date
  senderId: string
}

/** Потолок сотрудников в одном обращении, которых читаем, чтобы решить, кого не уведомлять. */
const TICKET_STAFF_SCAN = 500

/** Порция чтения команды платформы при создании обращения. */
const STAFF_BATCH = 200

@Injectable()
export class SupportService implements OnModuleInit {
  private readonly logger = new Logger(SupportService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly chats: ChatsService,
    private readonly audit: AuditService,
    private readonly telegram: TelegramNotifyService,
  ) {}

  onModuleInit(): void {
    this.chats.registerSupportHook((event) => this.onTicketMessage(event))
  }

  /**
   * Правила обращения для КАЖДОГО нового сообщения в нём — каким бы путём оно ни пришло.
   *
   * Автору сказано: «ответ придёт в „Чаты“ — там же можно дослать скриншот». И дописывает он
   * обычной отправкой из окна чата, а не ручкой поддержки. Пока правила жили только в
   * `reply`, дописка в закрытое обращение оставляла его закрытым: в очереди открытых его не
   * было, команде ничего не приходило, и вопрос лежал, пока кто-то случайно не откроет
   * закрытую ветку. Поэтому их зовёт домен чатов — из той точки, где сходятся все пути
   * отправки: окно чата, вложения, пересылка, `open`, `reply`, голосовой ответ.
   *
   * - Любое сообщение открывает закрытое обращение снова: закрытие — про очередь, и раз в
   *   ветке снова разговор, ей место среди открытых. Склеенную ветку не открываем — в
   *   очереди её нет, и открытой она стала бы невидимой; открываем ту, в которую склеили.
   * - Сообщение автора будит команду, но только когда мяч переходит к ней: обращение было
   *   закрыто или последнее слово было за командой. Дописка следом за собственным
   *   сообщением уже кого-то ждёт — второе уведомление о той же ветке ничего не добавляет.
   * - Ответ команды проставляет время первого ответа — один раз.
   *
   * Возвращает сотрудников, которым обычное уведомление о сообщении не нужно: все, кроме
   * разбирающего. Команда узнаёт об обращениях из очереди и Telegram, а сотня уведомлений
   * на каждую строчку автора — это шум, в котором тонет сам сигнал.
   */
  async onTicketMessage(event: {
    chatId: string
    senderId: string
    seq: number
  }): Promise<ReadonlySet<string>> {
    const [ticket, staffRows] = await Promise.all([
      this.prisma.chat.findUnique({
        where: { id: event.chatId },
        select: { supportMergedIntoId: true, supportAssigneeId: true },
      }),
      this.prisma.chatMember.findMany({
        where: { chatId: event.chatId, user: { role: { in: [...STAFF_ROLES] } } },
        select: { userId: true },
        take: TICKET_STAFF_SCAN,
      }),
    ])
    if (!ticket) return new Set()
    const staff = new Set(staffRows.map((row) => row.userId))
    const fromStaff = staff.has(event.senderId)
    const targetId = ticket.supportMergedIntoId ?? event.chatId

    const { count: reopened } = await this.prisma.chat.updateMany({
      where: { id: targetId, supportClosedAt: { not: null } },
      data: { supportClosedAt: null },
    })

    if (fromStaff) {
      // `supportFirstReplyAt: null` в условии — чтобы отметка проставилась ровно один раз:
      // повторное открытие не делает первый ответ быстрее, а переписывать её значило бы
      // улучшать метрику задним числом.
      await this.prisma.chat.updateMany({
        where: { id: event.chatId, supportFirstReplyAt: null },
        data: { supportFirstReplyAt: new Date() },
      })
    } else if (reopened > 0 || (await this.lastWordIsStaff(event, staff))) {
      // Отправку сообщения Telegram не задерживает: уведомление — побочный сигнал, и
      // человек, приславший скриншот, не должен ждать ответа чужого API.
      void this.telegram
        .notifyStaff('reply', 'Ответ в обращении поддержки', `support_${targetId}`)
        .catch((error: unknown) => {
          this.logger.warn(`Не удалось уведомить команду об ответе: ${String(error)}`)
        })
    }

    staff.delete(event.senderId)
    if (ticket.supportAssigneeId) staff.delete(ticket.supportAssigneeId)
    return staff
  }

  /** Последнее сообщение перед этим — от команды: значит, автор отвечает на её ответ. */
  private async lastWordIsStaff(
    event: { chatId: string; seq: number },
    staff: ReadonlySet<string>,
  ): Promise<boolean> {
    const previous = await this.prisma.message.findFirst({
      where: { chatId: event.chatId, seq: { lt: event.seq }, deletedAt: null, systemType: null },
      orderBy: { seq: Prisma.SortOrder.desc },
      select: { senderId: true },
    })
    return previous !== null && staff.has(previous.senderId)
  }

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
        // Склеенная ветка — не обращение (F-F27): в очереди её нет, и дописка в неё уходила
        // туда, где её никто не увидит. Склеенную, открытую до правки правил, тоже обходим.
        supportMergedIntoId: null,
        members: { some: { userId: user.sub } },
      },
      // Самое свежее открытое: если открытых по старым данным несколько, пишем в последнее.
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    const chatId = existing ? existing.id : await this.createTicket(user.sub)
    const { message: opened } = await this.chats.createMessage(user.sub, {
      chatId,
      content: input.text,
    })
    // createMessage в комнату чата не шлёт (это делает шлюз), а обращение пишется по REST:
    // без рассылки у сотрудника с открытым обращением сообщение не появлялось вживую.
    this.chats.publishNewMessage(chatId, opened)

    await this.audit.record({
      userId: user.sub,
      action: existing ? 'support.ticket.append' : 'support.ticket.open',
      entity: 'Chat',
      entityId: chatId,
      ...ctx,
    })
    // Только о новом обращении: дописка в открытое уже кого-то ждёт, и второе
    // уведомление о той же ветке ничего не добавляет. Дописку в ответ на слово команды
    // отмечает `onTicketMessage` — для неё мяч снова на стороне поддержки.
    if (!existing) {
      // Размер очереди прямо в уведомлении: одно обращение в спокойный день и одно
      // поверх десяти неразобранных требуют разной срочности, а по голому «пришло
      // новое» отличить их можно было только открыв приложение.
      const { count } = await this.queueStats()
      await this.telegram.notifyStaff(
        'ticket',
        `Новое обращение в поддержку\nОткрытых обращений: ${count}`,
        `support_${chatId}`,
        new Date(),
        false,
        // «Беру в работу» прямо под уведомлением: без квитирования двое пишут один ответ,
        // а третье обращение не берёт никто, решив, что его уже взяли.
        { kind: 'ticket', id: chatId },
      )
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
      // Склеенная ветка в очереди не показывается ни открытой, ни закрытой: она больше
      // не самостоятельное обращение, а часть другого.
      supportMergedIntoId: null,
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
    const last = await this.lastTicketMessages(rows.map((row) => row.id))

    return new Paginated(
      rows.map((row) => toTicket(row, last.get(row.id) ?? null)),
      { total },
    )
  }

  /**
   * Последнее сообщение каждого обращения — по одной строке на обращение (F-F02). Вложенный
   * `messages: { take: 1 }` в `findMany` Prisma обрезает в памяти: ради строки очереди
   * читалась бы вся переписка обращений страницы.
   */
  private lastTicketMessages(chatIds: string[]): Promise<Map<string, TicketLastMessage>> {
    return lastMessagesOf(this.prisma, chatIds, (ids) =>
      this.prisma.message.findMany({
        where: { id: { in: ids } },
        select: { chatId: true, content: true, createdAt: true, senderId: true },
        take: ids.length,
      }),
    )
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
    const [row, last, messages, merged] = await Promise.all([
      this.prisma.chat.findUniqueOrThrow({ where: { id: chatId }, select: TICKET_SELECT }),
      this.lastTicketMessages([chatId]),
      this.chats.getMessages(viewer, chatId, { limit: 50 }),
      this.prisma.chat.findMany({
        where: { supportMergedIntoId: chatId },
        select: { id: true },
        take: 10,
      }),
    ])

    // Переписка склеенных веток читается вместе с целевой: склейка нужна, чтобы видеть
    // разговор целиком, а не чтобы прятать половину. Сообщения не переносились, поэтому
    // порядок восстанавливаем по времени — `seq` сравним только внутри одного чата.
    // Склеенная ветка закрыта, и догон членства (`joinOpenTickets`) её обходит: сотрудник,
    // пришедший после склейки, в ней не состоит, и чтение по членству роняло весь экран.
    // Догоняем членство тем же приёмом, что и `assertAccess` для самой ветки.
    if (STAFF_ROLES.includes(viewer.role) && merged.length > 0) {
      await this.prisma.chatMember.createMany({
        data: merged.map((ticket) => ({ chatId: ticket.id, userId: viewer.sub })),
        skipDuplicates: true,
      })
    }
    const extra = await Promise.all(
      merged.map((ticket) => this.chats.getMessages(viewer, ticket.id, { limit: 50 })),
    )
    const all = [...messages.items, ...extra.flatMap((page) => page.items)] as {
      createdAt: Date
    }[]
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    // Другие обращения того же человека — то, с чем эту ветку можно склеить. Без списка
    // модератору пришлось бы искать дубль в очереди по фамилии и запоминать id.
    const author = row.members.find((m) => !STAFF_ROLES.includes(m.user.role as Role))?.user
    const siblings = author
      ? await this.prisma.chat.findMany({
          where: {
            type: ChatType.SUPPORT_PLATFORM,
            id: { not: chatId },
            supportMergedIntoId: null,
            members: { some: { userId: author.id } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, createdAt: true, supportClosedAt: true },
        })
      : []

    return {
      ticket: toTicket(row, last.get(chatId) ?? null),
      messages: all,
      mergedCount: merged.length,
      siblings: siblings.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        closed: item.supportClosedAt !== null,
      })),
    }
  }

  /**
   * Склеить обращение с другим: две ветки об одном превращаются в одну.
   *
   * Сообщения НЕ переносятся. Перенос переписал бы отправителям их собственную историю, а
   * порядок сообщений внутри чата задан `seq`, который в чужом чате ничего не значит.
   * Склеенная ветка закрывается и помечается указателем, а её переписка читается вместе
   * с целевой — то есть разговор виден целиком, ничего не потеряно и ничего не подделано.
   *
   * Склеивать можно только обращения ОДНОГО человека. Две ветки разных людей — это чужая
   * переписка в чужом обращении: склейка показала бы каждому вопросы другого.
   */
  async merge(
    viewer: JwtPayload,
    chatId: string,
    intoId: string,
    ctx: RequestContext = {},
  ): Promise<{ mergedInto: string }> {
    this.assertStaff(viewer)
    if (chatId === intoId) throw new AppException('BAD_REQUEST', 'Обращение нельзя склеить с собой')

    const [source, target] = await Promise.all([
      this.ticketWithAuthor(chatId),
      this.ticketWithAuthor(intoId),
    ])
    if (source.mergedInto) throw new AppException('CONFLICT', 'Обращение уже склеено с другим')
    // Цепочки запрещены: склейка в склеенное дала бы ветку, чью переписку не видно нигде,
    // потому что читатель идёт ровно на один шаг.
    if (target.mergedInto) {
      throw new AppException('CONFLICT', 'Второе обращение само склеено с третьим')
    }
    if (!source.authorId || source.authorId !== target.authorId) {
      throw new AppException('BAD_REQUEST', 'Склеивать можно только обращения одного человека')
    }

    // Ветки, склеенные в источник раньше, переезжают в цель вместе с ним: иначе они
    // указывали бы на склеенное, а читатель идёт ровно на один шаг — их переписку не было
    // бы видно нигде. Автор у них тот же, что и у источника, так что чужого не смешиваем.
    await this.prisma.$transaction([
      this.prisma.chat.updateMany({
        where: { supportMergedIntoId: chatId },
        data: { supportMergedIntoId: intoId },
      }),
      this.prisma.chat.update({
        where: { id: chatId },
        data: { supportMergedIntoId: intoId, supportClosedAt: new Date() },
      }),
    ])
    await this.audit.record({
      userId: viewer.sub,
      action: 'support.ticket.merge',
      entity: 'Chat',
      entityId: chatId,
      metadata: { into: intoId },
      ...ctx,
    })
    return { mergedInto: intoId }
  }

  /** Обращение с id автора и указателем склейки — для проверок склеивания. */
  private async ticketWithAuthor(
    chatId: string,
  ): Promise<{ authorId: string | null; mergedInto: string | null }> {
    const row = await this.prisma.chat.findFirst({
      where: { id: chatId, type: ChatType.SUPPORT_PLATFORM },
      select: {
        supportMergedIntoId: true,
        members: { select: { user: { select: { id: true, role: true } } } },
      },
    })
    if (!row) throw new AppException('NOT_FOUND', 'Обращение не найдено')
    const author = row.members.find((m) => !STAFF_ROLES.includes(m.user.role as Role))?.user
    return { authorId: author?.id ?? null, mergedInto: row.supportMergedIntoId }
  }

  /**
   * Ответить. Ответ в закрытое обращение открывает его снова: человек с уточняющим
   * вопросом иначе остался бы без канала и завёл бы второе обращение о том же.
   *
   * Само переоткрытие, отметка первого ответа и уведомление команды — в `onTicketMessage`:
   * они срабатывают на любом сообщении в обращении, в том числе отправленном из окна чата.
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
    // Ответ уходит в комнату чата: у человека с открытым обращением он появляется сразу
    // (уведомление ему при этом не создаётся — он «смотрит чат»).
    this.chats.publishNewMessage(chatId, message)
    await this.audit.record({
      userId: viewer.sub,
      action: 'support.ticket.reply',
      entity: 'Chat',
      entityId: chatId,
      ...ctx,
    })
    return message
  }

  /**
   * Голосовой ответ.
   *
   * На телефоне надиктовать быстрее, чем набрать, — а поддержка с телефона только этим и
   * занимается. Отдельная ручка, а не `@MiniAllowed()` на `POST /chats/:id/messages`:
   * последнее открыло бы токену мини-аппа все чаты, в которых состоит сотрудник, включая
   * его личные. Здесь же проверяется и тип чата, и роль отправителя.
   *
   * Голосовое распознаётся чатом по имени файла (`voice-msg.<ext>`) — так же, как в вебе:
   * mime по содержимому непредсказуем, webm-аудио браузеры отдают как `video/webm`.
   */
  async voiceReply(
    viewer: JwtPayload,
    chatId: string,
    file: { buffer: Buffer; name?: string },
    ctx: RequestContext = {},
  ) {
    this.assertStaff(viewer)
    await this.assertTicket(chatId)
    await this.assertAccess(viewer, chatId)

    const message = await this.chats.sendMessageRest(viewer.sub, { chatId }, [
      { buffer: file.buffer, name: file.name ?? 'voice-msg.webm' },
    ])

    // Всё остальное — как у текстового ответа: закрытое обращение открывается снова,
    // отметка первого ответа ставится один раз. Правила не дублируются здесь — их
    // применяет `onTicketMessage` к любому сообщению в обращении, голосовому тоже.
    await this.audit.record({
      userId: viewer.sub,
      action: 'support.ticket.reply.voice',
      entity: 'Chat',
      entityId: chatId,
      ...ctx,
    })
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
      select: { id: true },
      take: 200,
    })
    // Последнее слово — по одной строке на обращение, а не всей перепиской (F-F02).
    // Удалённые сообщения тоже считаются: правило «кто ответил последним» не менялось.
    const last = await lastMessagesOf(
      this.prisma,
      stale.map((chat) => chat.id),
      (ids) =>
        this.prisma.message.findMany({
          where: { id: { in: ids } },
          select: { chatId: true, sender: { select: { role: true } } },
          take: ids.length,
        }),
      { includeDeleted: true },
    )

    const ids = stale
      .filter((chat) => {
        const lastRole = last.get(chat.id)?.sender.role as Role | undefined
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

  /**
   * Сколько обращений открыто и когда пришло самое старое из них.
   *
   * Здесь по той же причине, что и у жалоб: таблица чатов принадлежит этому модулю, а
   * спрашивают числа сводка и бот. Возвращаются только числа и дата — ни одного
   * обращения и ни одного слова из переписки.
   */
  async queueStats(): Promise<{ count: number; oldestAt: Date | null }> {
    const where = { type: ChatType.SUPPORT_PLATFORM, supportClosedAt: null }
    const [count, oldest] = await this.prisma.$transaction([
      this.prisma.chat.count({ where }),
      this.prisma.chat.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ])
    return { count, oldestAt: oldest?.createdAt ?? null }
  }

  /**
   * Движение за период: сколько обращений пришло и сколько закрыто. Для сводки — та же
   * пара чисел, что и у жалоб, и по той же причине.
   */
  async dayStats(since: Date): Promise<{ created: number; closed: number }> {
    const type = ChatType.SUPPORT_PLATFORM
    const [created, closed] = await this.prisma.$transaction([
      this.prisma.chat.count({ where: { type, createdAt: { gte: since } } }),
      this.prisma.chat.count({ where: { type, supportClosedAt: { gte: since } } }),
    ])
    return { created, closed }
  }

  /**
   * Создаёт обращение с автором и всей текущей командой платформы в участниках.
   *
   * Команда читается вся, порциями по порядку id (F-F27). Раньше брались первые сто без
   * сортировки — кто именно, решала база, и сто первый сотрудник не видел новых обращений
   * в своих чатах, пока не откроет очередь. Догон в `joinOpenTickets` остаётся — для тех,
   * кто пришёл в команду уже после создания обращения.
   */
  private async createTicket(authorId: string): Promise<string> {
    const staff = await this.activeStaffIds()
    const userIds = [...new Set([authorId, ...staff])]
    const chat = await this.prisma.chat.create({
      data: {
        type: ChatType.SUPPORT_PLATFORM,
        members: { create: userIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    })
    return chat.id
  }

  /** id действующих сотрудников платформы — все, порциями по курсору (BACKEND_RULES §7.2). */
  private async activeStaffIds(): Promise<string[]> {
    const ids: string[] = []
    let cursor: string | undefined
    for (;;) {
      const batch = await this.prisma.user.findMany({
        where: { role: { in: [...STAFF_ROLES] }, deletedAt: null, isBlocked: false },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: STAFF_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      ids.push(...batch.map((row) => row.id))
      if (batch.length < STAFF_BATCH) return ids
      cursor = batch.at(-1)?.id
    }
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
function toTicket(
  row: {
    id: string
    createdAt: Date
    updatedAt: Date
    supportClosedAt: Date | null
    supportAssigneeId: string | null
    supportFirstReplyAt: Date | null
    supportTags: string[]
    members: { user: { id: string; firstName: string; lastName: string; role: string } }[]
  },
  last: TicketLastMessage | null,
) {
  // Автор — единственный участник не из команды платформы: обращение заводится от него,
  // а сотрудники добавляются пачкой.
  const author = row.members.find((m) => !STAFF_ROLES.includes(m.user.role as Role))?.user ?? null
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
