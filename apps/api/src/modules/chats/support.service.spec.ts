import { ChatType } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { SupportService } from './support.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { AuditService } from '../../common/audit/audit.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { ChatsService } from './chats.service'
import type { TelegramNotifyService } from '../../common/telegram/telegram-notify.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function who(role: Role, sub = 'u1'): JwtPayload {
  return { sub, role, email: 'a@b.c' } as unknown as JwtPayload
}

function setup(over: { openTicket?: { id: string } | null; chatType?: ChatType | null } = {}) {
  const prisma = {
    chat: {
      findFirst: jest.fn().mockResolvedValue(over.openTicket ?? null),
      findUnique: jest
        .fn()
        .mockResolvedValue(
          over.chatType === undefined
            ? { type: ChatType.SUPPORT_PLATFORM }
            : { type: over.chatType },
        ),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    chatMember: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'm1' }),
      // Сотрудники в участниках обращения (правила обращения решают, кого не уведомлять).
      findMany: jest.fn().mockResolvedValue([{ userId: 'staff-1' }, { userId: 'staff-2' }]),
    },
    // Предыдущее сообщение обращения: чьё было последнее слово.
    message: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'staff-1' }, { id: 'staff-2' }]) },
    // Счётчики тегов считаются одним запросом: массив в GROUP BY Prisma не умеет.
    $queryRaw: jest.fn().mockResolvedValue([]),
    // Размер очереди для уведомления и сводки: count + findFirst одной транзакцией.
    // Колбэк — создание обращения под локом: выполняется на том же моке.
    $transaction: jest.fn(),
    // Advisory-лок по автору при создании обращения.
    $executeRaw: jest.fn().mockResolvedValue(1),
  }
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.resolve([0, null]),
  )
  const chats = {
    createMessage: jest.fn().mockResolvedValue({ message: { id: 'msg-1' }, recipientIds: [] }),
    publishNewMessage: jest.fn(),
    getMessages: jest.fn().mockResolvedValue({ items: [], meta: {} }),
    sendMessageRest: jest.fn().mockResolvedValue({ id: 'voice-1' }),
    registerSupportHook: jest.fn(),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const telegram = { notifyStaff: jest.fn().mockResolvedValue(undefined) }
  const service = new SupportService(
    prisma as unknown as PrismaService,
    chats as unknown as ChatsService,
    audit as unknown as AuditService,
    telegram as unknown as TelegramNotifyService,
  )
  return { service, prisma, chats, audit, telegram }
}

describe('SupportService.open', () => {
  it('заводит обращение и кладёт в него автора вместе с командой платформы', async () => {
    const { service, prisma } = setup()

    const res = await service.open(who(Role.STUDENT), { text: 'не приходит письмо на почту' })

    expect(res).toEqual({ id: 'ticket-1', created: true })
    const members = prisma.chat.create.mock.calls[0]?.[0]?.data?.members?.create as {
      userId: string
    }[]
    expect(members.map((m) => m.userId)).toEqual(['u1', 'staff-1', 'staff-2'])
  })

  // Иначе один человек за минуту заводит десяток веток, и очередь перестаёт показывать,
  // сколько людей на самом деле ждут ответа.
  it('не заводит второе обращение, пока открыто первое — дописывает в него', async () => {
    const { service, prisma, chats } = setup({ openTicket: { id: 'ticket-9' } })

    const res = await service.open(who(Role.STUDENT), { text: 'ещё вопрос' })

    expect(res).toEqual({ id: 'ticket-9', created: false })
    expect(prisma.chat.create).not.toHaveBeenCalled()
    expect(chats.createMessage).toHaveBeenCalledWith('u1', {
      chatId: 'ticket-9',
      content: 'ещё вопрос',
    })
  })

  // Двойной клик или две вкладки: оба запроса видели «открытого нет» и заводили по
  // обращению. Под локом второй находит обращение, созданное первым.
  it('при параллельной отправке не заводит второе обращение — повторяет поиск под локом', async () => {
    const { service, prisma, chats } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ticket-7' })

    const res = await service.open(who(Role.STUDENT), { text: 'вопрос' })

    expect(res).toEqual({ id: 'ticket-7', created: false })
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.chat.create).not.toHaveBeenCalled()
    expect(chats.createMessage).toHaveBeenCalledWith('u1', {
      chatId: 'ticket-7',
      content: 'вопрос',
    })
  })

  // F-F27: склеенной ветки нет в очереди — дописка в неё ушла бы туда, где её не увидят.
  it('склеенную ветку за открытое обращение не принимает', async () => {
    const { service, prisma } = setup()

    await service.open(who(Role.STUDENT), { text: 'вопрос' })

    expect(prisma.chat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ supportClosedAt: null, supportMergedIntoId: null }),
      }),
    )
  })

  // F-F27: раньше в обращение попадали первые сто сотрудников в произвольном порядке.
  it('кладёт в обращение всю команду — порциями по id, без потолка в сто человек', async () => {
    const { service, prisma } = setup()
    const team = Array.from({ length: 250 }, (_, i) => ({
      id: `staff-${String(i).padStart(3, '0')}`,
    }))
    prisma.user.findMany
      .mockResolvedValueOnce(team.slice(0, 200))
      .mockResolvedValueOnce(team.slice(200))

    await service.open(who(Role.STUDENT), { text: 'вопрос' })

    const members = prisma.chat.create.mock.calls[0]?.[0]?.data?.members?.create as {
      userId: string
    }[]
    expect(members).toHaveLength(251)
    expect(prisma.user.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.user.findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: { id: 'asc' },
      take: 200,
    })
    expect(prisma.user.findMany.mock.calls[1]?.[0]).toMatchObject({
      cursor: { id: 'staff-199' },
      skip: 1,
    })
  })
})

describe('SupportService.queue', () => {
  it('не пускает обычную роль', async () => {
    const { service } = setup()

    await expect(
      service.queue(who(Role.STUDENT), { status: 'open', assignee: 'any', page: 1, limit: 30 }),
    ).rejects.toThrow(AppException)
  })

  // Сотрудник, назначенный после создания обращения, иначе не увидел бы ни очереди, ни переписки.
  it('догоняет членство сотрудника в обращениях, где его нет', async () => {
    const { service, prisma } = setup()
    prisma.chat.findMany.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]).mockResolvedValue([])

    await service.queue(who(Role.PLATFORM_MODERATOR, 'staff-9'), {
      status: 'open',
      assignee: 'any',
      page: 1,
      limit: 30,
    })

    expect(prisma.chatMember.createMany).toHaveBeenCalledWith({
      data: [
        { chatId: 't1', userId: 'staff-9' },
        { chatId: 't2', userId: 'staff-9' },
      ],
      skipDuplicates: true,
    })
  })
})

describe('SupportService.reply', () => {
  // Переоткрытие, первый ответ и уведомление команды — в onTicketMessage, куда сходятся все
  // пути отправки. Повтор здесь задвоил бы Telegram-уведомление об ответе автора.
  it('пишет общим путём отправки и правил обращения не дублирует', async () => {
    const { service, prisma, chats, telegram } = setup()

    await service.reply(who(Role.STUDENT), 'ticket-1', { text: 'всё ещё не работает' })

    expect(chats.createMessage).toHaveBeenCalledWith('u1', {
      chatId: 'ticket-1',
      content: 'всё ещё не работает',
    })
    expect(prisma.chat.updateMany).not.toHaveBeenCalled()
    expect(telegram.notifyStaff).not.toHaveBeenCalled()
  })

  it('не отвечает в чужое обращение', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)

    await expect(
      service.reply(who(Role.STUDENT, 'stranger'), 'ticket-1', { text: 'а что тут' }),
    ).rejects.toThrow(AppException)
  })

  // Ответ одинаков и для «нет такого обращения», и для «не твоё»: по разнице ответов
  // перебором id вычислялось бы, кто вообще обращался в поддержку.
  it('о чужом обращении отвечает «не найдено», а не «нет прав»', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)

    await expect(service.thread(who(Role.STUDENT, 'stranger'), 'ticket-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  // BUG-034: склеенная ветка закрыта, догон членства её обходит — сотрудник, пришедший после
  // склейки, в ней не состоял, и чтение по членству роняло весь экран.
  it('сотрудник догоняет членство и в склеенных ветках', async () => {
    const { service, prisma, chats } = setup()
    Object.assign(prisma.chat, {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'ticket-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        supportClosedAt: null,
        supportAssigneeId: null,
        supportFirstReplyAt: null,
        supportTags: [],
        members: [],
      }),
    })
    prisma.chat.findMany.mockResolvedValueOnce([{ id: 'merged-1' }])

    await service.thread(who(Role.PLATFORM_ADMIN, 'staff-9'), 'ticket-1')

    expect(prisma.chatMember.createMany).toHaveBeenCalledWith({
      data: [{ chatId: 'merged-1', userId: 'staff-9' }],
      skipDuplicates: true,
    })
    expect(chats.getMessages).toHaveBeenCalledWith(expect.anything(), 'merged-1', { limit: 50 })
  })

  it('не принимает за обращение обычный чат', async () => {
    const { service } = setup({ chatType: ChatType.PRIVATE })

    await expect(service.thread(who(Role.PLATFORM_ADMIN), 'chat-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('SupportService.close', () => {
  it('закрывает только команда платформы', async () => {
    const { service } = setup()

    await expect(service.close(who(Role.STUDENT), 'ticket-1')).rejects.toThrow(AppException)
  })

  it('ставит отметку времени, а не удаляет переписку', async () => {
    const { service, prisma } = setup()

    await service.close(who(Role.PLATFORM_ADMIN, 'staff-1'), 'ticket-1')

    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: { supportClosedAt: expect.any(Date) },
    })
  })
})

describe('SupportService — уведомление команды', () => {
  it('сообщает в Telegram о новом обращении', async () => {
    const { service, telegram } = setup()

    await service.open(who(Role.STUDENT), { text: 'не приходит письмо на почту' })

    // Последние аргументы — кнопка квитирования под уведомлением: без неё двое пишут
    // один ответ, а третье обращение не берёт никто.
    expect(telegram.notifyStaff).toHaveBeenCalledWith(
      'ticket',
      // Второй строкой — размер очереди: одно обращение в спокойный день и одно поверх
      // десяти неразобранных требуют разной срочности.
      expect.stringContaining('Новое обращение в поддержку\nОткрытых обращений:'),
      'support_ticket-1',
      expect.any(Date),
      false,
      { kind: 'ticket', id: 'ticket-1' },
    )
  })

  // Дописка в открытое обращение уже кого-то ждёт: второе уведомление о той же ветке
  // ничего не добавляет, а внимание к уведомлениям расходует.
  it('молчит, когда человек дописывает в открытое обращение', async () => {
    const { service, telegram } = setup({ openTicket: { id: 'ticket-9' } })

    await service.open(who(Role.STUDENT), { text: 'ещё вопрос' })

    expect(telegram.notifyStaff).not.toHaveBeenCalled()
  })
})

describe('SupportService.assign', () => {
  /**
   * Двое, разбирающие одно обращение и не знающие об этом, — та самая проблема, ради
   * которой назначение и заводится. Перехват поэтому запрещён на уровне запроса:
   * условие `supportAssigneeId: null` не даст двум одновременным «взять» победить обоим.
   */
  it('не даёт перехватить чужое обращение', async () => {
    const { service, prisma } = setup()
    prisma.chat.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      service.assign(who(Role.PLATFORM_MODERATOR, 'staff-2'), 'ticket-1', true),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('берёт свободное обращение', async () => {
    const { service, prisma } = setup()

    await expect(
      service.assign(who(Role.PLATFORM_ADMIN, 'staff-1'), 'ticket-1', true),
    ).resolves.toEqual({ assigneeId: 'staff-1' })
    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', supportAssigneeId: null },
      data: { supportAssigneeId: 'staff-1' },
    })
  })

  it('отдать обратно можно только своё', async () => {
    const { service, prisma } = setup()

    await service.assign(who(Role.PLATFORM_ADMIN, 'staff-1'), 'ticket-1', false)

    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', supportAssigneeId: 'staff-1' },
      data: { supportAssigneeId: null },
    })
  })

  it('обычную роль не пускает', async () => {
    const { service } = setup()

    await expect(service.assign(who(Role.STUDENT), 'ticket-1', true)).rejects.toThrow(AppException)
  })
})

// F-F03: автору сказано дописывать в «Чатах», и пишет он обычной отправкой из окна чата.
// Правила обращения поэтому живут в onTicketMessage — его зовёт домен чатов на любом пути.
describe('SupportService.onTicketMessage — правила обращения на любом пути отправки', () => {
  const author = { chatId: 'ticket-1', senderId: 'author-1', seq: 5 }
  const staffMsg = { chatId: 'ticket-1', senderId: 'staff-1', seq: 5 }

  function ticketSetup(
    ticket: { supportMergedIntoId?: string | null; supportAssigneeId?: string | null } = {},
    closed = false,
  ) {
    const base = setup()
    base.prisma.chat.findUnique.mockResolvedValue({
      supportMergedIntoId: ticket.supportMergedIntoId ?? null,
      supportAssigneeId: ticket.supportAssigneeId ?? null,
    })
    // Переоткрытие: updateMany по условию «закрыто» — 1 строка, если обращение было закрыто.
    base.prisma.chat.updateMany.mockResolvedValue({ count: closed ? 1 : 0 })
    return base
  }

  it('регистрируется в домене чатов при старте модуля', () => {
    const { service, chats } = setup()
    service.onModuleInit()
    expect(chats.registerSupportHook).toHaveBeenCalledWith(expect.any(Function))
  })

  it('дописка автора в закрытое обращение открывает его и будит команду', async () => {
    const { service, prisma, telegram } = ticketSetup({}, true)

    await service.onTicketMessage(author)

    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', supportClosedAt: { not: null } },
      data: { supportClosedAt: null },
    })
    expect(telegram.notifyStaff).toHaveBeenCalledWith(
      'reply',
      'Ответ в обращении поддержки',
      'support_ticket-1',
    )
  })

  it('ответ автора на слово команды будит команду', async () => {
    const { service, prisma, telegram } = ticketSetup()
    prisma.message.findFirst.mockResolvedValue({ senderId: 'staff-2' })

    await service.onTicketMessage(author)

    expect(prisma.message.findFirst.mock.calls[0][0].where).toMatchObject({
      chatId: 'ticket-1',
      seq: { lt: 5 },
    })
    expect(telegram.notifyStaff).toHaveBeenCalledTimes(1)
  })

  // Дописка вслед за собственным сообщением уже кого-то ждёт: второе уведомление о той же
  // ветке ничего не добавляет, а внимание к уведомлениям расходует.
  it('дописка вслед за своим же сообщением в открытое обращение никого не будит', async () => {
    const { service, prisma, telegram } = ticketSetup()
    prisma.message.findFirst.mockResolvedValue({ senderId: 'author-1' })

    await service.onTicketMessage(author)

    expect(telegram.notifyStaff).not.toHaveBeenCalled()
  })

  // Отметка ставится один раз: повторное открытие обращения не делает первый ответ
  // быстрее, и переписывать её значило бы улучшать метрику задним числом.
  it('ответ команды проставляет время первого ответа один раз и никого не будит', async () => {
    const { service, prisma, telegram } = ticketSetup({}, true)

    await service.onTicketMessage(staffMsg)

    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', supportFirstReplyAt: null },
      data: { supportFirstReplyAt: expect.any(Date) },
    })
    // Ответ команды в закрытое тоже открывает его: закрытие — про очередь.
    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', supportClosedAt: { not: null } },
      data: { supportClosedAt: null },
    })
    expect(telegram.notifyStaff).not.toHaveBeenCalled()
  })

  it('ответ автора временем первого ответа не считается', async () => {
    const { service, prisma } = ticketSetup()

    await service.onTicketMessage(author)

    const calls = prisma.chat.updateMany.mock.calls.map((call) => call[0])
    expect(calls.some((call) => 'supportFirstReplyAt' in (call.data ?? {}))).toBe(false)
  })

  // Склеенной ветки в очереди нет: открытой она стала бы невидимой.
  it('дописка в склеенную ветку открывает обращение, в которое её склеили', async () => {
    const { service, prisma, telegram } = ticketSetup({ supportMergedIntoId: 'ticket-main' }, true)

    await service.onTicketMessage(author)

    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-main', supportClosedAt: { not: null } },
      data: { supportClosedAt: null },
    })
    expect(telegram.notifyStaff).toHaveBeenCalledWith(
      'reply',
      'Ответ в обращении поддержки',
      'support_ticket-main',
    )
  })

  // Сотня уведомлений команде на каждую строчку автора — шум: сигнал для команды —
  // очередь и Telegram, а обычное уведомление нужно только тому, кто обращение разбирает.
  it('из команды уведомление о сообщении получает только разбирающий', async () => {
    const { service } = ticketSetup({ supportAssigneeId: 'staff-2' })

    const quiet = await service.onTicketMessage(author)

    expect([...quiet]).toEqual(['staff-1'])
  })

  it('автора в списке «не уведомлять» нет — ответ команды до него доходит', async () => {
    const { service } = ticketSetup()

    const quiet = await service.onTicketMessage(staffMsg)

    expect(quiet.has('author-1')).toBe(false)
    expect([...quiet]).toEqual(['staff-2'])
  })
})

describe('SupportService.closeStale', () => {
  function staleSetup(lastSenderRole: Role) {
    const base = setup()
    base.prisma.chat.findMany.mockResolvedValue([{ id: 't1' }])
    // Последнее слово читается отдельно: id — одним запросом, строка — вторым.
    base.prisma.$queryRaw.mockResolvedValue([{ chatId: 't1', id: 'm1' }])
    Object.assign(base.prisma.message, {
      findMany: jest.fn().mockResolvedValue([{ chatId: 't1', sender: { role: lastSenderRole } }]),
    })
    return base
  }

  // Вложенный `messages: { take: 1 }` Prisma обрезает в памяти — то есть читает всю
  // переписку каждого из двухсот обращений ради одной строки.
  it('не читает переписку обращений целиком', async () => {
    const { service, prisma } = staleSetup(Role.PLATFORM_ADMIN)

    await service.closeStale(new Date())

    expect(prisma.chat.findMany.mock.calls[0]?.[0].select).toEqual({ id: true })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })

  /**
   * Закрывается только то, где последнее слово было за КОМАНДОЙ: человек получил ответ и
   * не вернулся. Обращение, где последним писал автор, — это неотвеченный вопрос, и
   * закрывать его по таймеру значит прятать собственный долг.
   */
  it('закрывает обращение, где последним отвечала команда', async () => {
    const { service, prisma } = staleSetup(Role.PLATFORM_ADMIN)

    await expect(service.closeStale(new Date())).resolves.toBe(1)
    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['t1'] } },
      data: { supportClosedAt: expect.any(Date) },
    })
  })

  // BUG-111: двести «вечных» обращений, где последним писал автор, занимали всю выборку —
  // остальные не закрывались никогда. Теперь выборка идёт по курсору до конца.
  it('проходит обращения порциями до конца, а не одну выборку', async () => {
    const { service, prisma } = staleSetup(Role.PLATFORM_ADMIN)
    const full = Array.from({ length: 200 }, (_, i) => ({ id: `a${String(i).padStart(3, '0')}` }))
    prisma.chat.findMany.mockResolvedValueOnce(full).mockResolvedValueOnce([{ id: 't1' }])

    await service.closeStale(new Date())

    expect(prisma.chat.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.chat.findMany.mock.calls[1]?.[0]).toMatchObject({
      cursor: { id: 'a199' },
      skip: 1,
    })
  })

  it('не закрывает обращение, где последним писал автор', async () => {
    const { service, prisma } = staleSetup(Role.STUDENT)

    await expect(service.closeStale(new Date())).resolves.toBe(0)
    expect(prisma.chat.updateMany).not.toHaveBeenCalled()
  })

  it('на пустой выборке ничего не пишет', async () => {
    const { service, prisma } = setup()
    prisma.chat.findMany.mockResolvedValue([])

    await expect(service.closeStale(new Date())).resolves.toBe(0)
    expect(prisma.chat.updateMany).not.toHaveBeenCalled()
  })
})

describe('SupportService.escalate', () => {
  /**
   * Эскалируют ровно тогда, когда обычный путь не сработал: глушить её дежурством и
   * тихими часами значило бы глушить именно тот сигнал, ради которого её и завели.
   */
  it('пишет администраторам мимо дежурства и тишины', async () => {
    const { service, telegram } = setup()

    await service.escalate(who(Role.PLATFORM_MODERATOR, 'staff-2'), 'ticket-1')

    expect(telegram.notifyStaff).toHaveBeenCalledWith(
      'ticket',
      expect.stringContaining('эскалировано'),
      'support_ticket-1',
      expect.any(Date),
      true,
    )
  })

  it('обычную роль не пускает', async () => {
    const { service } = setup()

    await expect(service.escalate(who(Role.STUDENT), 'ticket-1')).rejects.toThrow(AppException)
  })
})

// ── Теги обращений (пункт 33) ───────────────────────────────────────────────
describe('SupportService — теги', () => {
  const staff = who(Role.PLATFORM_ADMIN, 'staff-1')

  it('набор заменяется целиком и чистится от дубликатов', async () => {
    const { service, prisma } = setup()
    await expect(service.setTags(staff, 'chat1', ['ACCESS', 'ACCESS', 'BUG'])).resolves.toEqual({
      tags: ['ACCESS', 'BUG'],
    })
    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: 'chat1' },
      data: { supportTags: ['ACCESS', 'BUG'] },
    })
  })

  it('обычной роли теги не доверяем', async () => {
    const { service } = setup()
    const err = await service.setTags(who(Role.STUDENT), 'chat1', ['BUG']).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
  })

  // Фильтр по тегу уходит на сервер: «все обращения про доступ» среди тридцати
  // загруженных строк — это не «все».
  it('фильтр по тегу попадает в запрос, а не режет страницу', async () => {
    const { service, prisma } = setup()
    await service.queue(staff, {
      status: 'open',
      assignee: 'any',
      tag: 'ACCESS',
      page: 1,
      limit: 30,
    })
    // Первым findMany идёт `joinOpenTickets` (догоняет участие сотрудника) — очередь
    // читается последним запросом.
    expect(prisma.chat.findMany.mock.calls.at(-1)?.[0].where).toMatchObject({
      supportTags: { has: 'ACCESS' },
    })
  })

  it('последнее сообщение строки берёт отдельным запросом, а не всей перепиской', async () => {
    const { service, prisma } = setup()
    prisma.chat.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 't1',
        createdAt: new Date(),
        updatedAt: new Date(),
        supportClosedAt: null,
        supportAssigneeId: null,
        supportFirstReplyAt: null,
        supportTags: [],
        members: [{ user: { id: 'u1', firstName: 'А', lastName: 'Б', role: Role.STUDENT } }],
      },
    ])
    prisma.$queryRaw.mockResolvedValue([{ chatId: 't1', id: 'm1' }])
    const createdAt = new Date()
    Object.assign(prisma.message, {
      findMany: jest
        .fn()
        .mockResolvedValue([{ chatId: 't1', content: 'Помогите', createdAt, senderId: 'u1' }]),
    })

    const page = await service.queue(staff, { status: 'open', assignee: 'any', page: 1, limit: 30 })

    expect(prisma.chat.findMany.mock.calls.at(-1)?.[0].select).not.toHaveProperty('messages')
    expect(page.items[0]).toMatchObject({
      lastMessage: { text: 'Помогите', createdAt, fromAuthor: true },
    })
  })

  // BUG-182: вся команда платформы состоит в каждом обращении — строка очереди не тянет её
  // целиком, а разбирающего читает одним запросом на страницу.
  it('из участников берёт только автора, разбирающего — отдельным запросом', async () => {
    const { service, prisma } = setup()
    prisma.chat.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 't1',
        createdAt: new Date(),
        updatedAt: new Date(),
        supportClosedAt: null,
        supportAssigneeId: 'staff-1',
        supportFirstReplyAt: null,
        supportTags: [],
        members: [],
      },
    ])
    const assignee = { id: 'staff-1', firstName: 'В', lastName: 'Г', role: Role.PLATFORM_ADMIN }
    prisma.user.findMany.mockResolvedValueOnce([assignee])

    const page = await service.queue(staff, { status: 'open', assignee: 'any', page: 1, limit: 30 })

    expect(prisma.chat.findMany.mock.calls.at(-1)?.[0].select.members).toMatchObject({
      where: { user: { role: { notIn: [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR] } } },
    })
    expect(page.items[0]).toMatchObject({ assignee })
  })

  it('счётчики отдаёт числами, а не bigint из базы', async () => {
    const { service, prisma } = setup()
    prisma.$queryRaw.mockResolvedValue([{ tag: 'ACCESS', count: 60n }])
    await expect(service.tagCounts(staff)).resolves.toEqual([{ tag: 'ACCESS', count: 60 }])
  })
})

// ── Склейка дублей (пункт 35) ───────────────────────────────────────────────
describe('SupportService.merge', () => {
  const staff = who(Role.PLATFORM_ADMIN, 'staff-1')

  function ticket(authorId: string | null, mergedInto: string | null = null) {
    return {
      supportMergedIntoId: mergedInto,
      members: [
        ...(authorId ? [{ user: { id: authorId, role: Role.STUDENT } }] : []),
        { user: { id: 'staff-1', role: Role.PLATFORM_ADMIN } },
      ],
    }
  }

  it('закрывает склеенную ветку и ставит указатель', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(ticket('author-1'))
    await expect(service.merge(staff, 'a', 'b')).resolves.toEqual({ mergedInto: 'b' })
    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { supportMergedIntoId: 'b', supportClosedAt: expect.any(Date) },
    })
  })

  // Две ветки разных людей — это чужая переписка в чужом обращении: склейка показала бы
  // каждому вопросы другого.
  it('чужие обращения склеивать нельзя', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst
      .mockResolvedValueOnce(ticket('author-1'))
      .mockResolvedValueOnce(ticket('author-2'))
    const err = await service.merge(staff, 'a', 'b').catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('BAD_REQUEST')
  })

  // Цепочки запрещены: читатель идёт ровно на один шаг, и переписка ветки, склеенной
  // в склеенное, не была бы видна нигде.
  it('в уже склеенное обращение склеивать нельзя', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst
      .mockResolvedValueOnce(ticket('author-1'))
      .mockResolvedValueOnce(ticket('author-1', 'c'))
    const err = await service.merge(staff, 'a', 'b').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })

  // BUG-059: ветки, склеенные в источник раньше, указывали бы на склеенное — и их переписку
  // не было бы видно нигде. Они переезжают в цель вместе с источником.
  it('ветки, склеенные в источник, переезжают в цель', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(ticket('author-1'))
    await service.merge(staff, 'a', 'b')
    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { supportMergedIntoId: 'a' },
      data: { supportMergedIntoId: 'b' },
    })
  })

  it('само с собой → BAD_REQUEST', async () => {
    const { service } = setup()
    const err = await service.merge(staff, 'a', 'a').catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  // Склеенная ветка больше не самостоятельное обращение: в очереди её быть не должно
  // ни среди открытых, ни среди закрытых.
  it('очередь не показывает склеенные', async () => {
    const { service, prisma } = setup()
    await service.queue(staff, { status: 'open', assignee: 'any', page: 1, limit: 30 })
    expect(prisma.chat.findMany.mock.calls.at(-1)?.[0].where).toMatchObject({
      supportMergedIntoId: null,
    })
  })
})

// ── Голосовой ответ (пункт 39) ──────────────────────────────────────────────
describe('SupportService.voiceReply', () => {
  const staff = who(Role.PLATFORM_ADMIN, 'staff-1')

  // Имя файла значимо: по нему чат распознаёт голосовое, потому что mime у webm-аудио
  // браузеры отдают как `video/webm`.
  it('отправляет аудио с именем голосового', async () => {
    const { service, chats } = setup()
    await service.voiceReply(staff, 'chat-1', { buffer: Buffer.from('x'), name: 'voice-msg.webm' })
    expect(chats.sendMessageRest).toHaveBeenCalledWith('staff-1', { chatId: 'chat-1' }, [
      { buffer: expect.any(Buffer), name: 'voice-msg.webm' },
    ])
  })

  it('без имени подставляет своё, а не отправляет безымянный файл', async () => {
    const { service, chats } = setup()
    await service.voiceReply(staff, 'chat-1', { buffer: Buffer.from('x') })
    expect(chats.sendMessageRest.mock.calls[0][2][0].name).toBe('voice-msg.webm')
  })

  // Правила текстового ответа действуют и здесь — их применяет onTicketMessage на пути
  // sendMessageRest. Повторять их в ручке значило бы держать две копии одних правил.
  it('правила обращения не дублирует — они срабатывают на общем пути отправки', async () => {
    const { service, prisma } = setup()
    await service.voiceReply(staff, 'chat-1', { buffer: Buffer.from('x') })
    expect(prisma.chat.updateMany).not.toHaveBeenCalled()
  })

  it('обычную роль к голосовому ответу не подпускает', async () => {
    const { service } = setup()
    const err = await service
      .voiceReply(who(Role.STUDENT), 'chat-1', { buffer: Buffer.from('x') })
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
  })
})
