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
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'staff-1' }, { id: 'staff-2' }]) },
  }
  const chats = {
    createMessage: jest.fn().mockResolvedValue({ message: { id: 'msg-1' }, recipientIds: [] }),
    getMessages: jest.fn().mockResolvedValue({ items: [], meta: {} }),
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
  // Человек с уточняющим вопросом иначе остался бы без канала и завёл бы второе обращение.
  it('ответ в закрытое обращение открывает его снова', async () => {
    const { service, prisma } = setup()

    await service.reply(who(Role.PLATFORM_ADMIN, 'staff-1'), 'ticket-1', { text: 'готово' })

    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', supportClosedAt: { not: null } },
      data: { supportClosedAt: null },
    })
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

    expect(telegram.notifyStaff).toHaveBeenCalledWith(
      'ticket',
      'Новое обращение в поддержку',
      'support_ticket-1',
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

describe('SupportService.reply — кого будить', () => {
  it('ответ автора будит команду платформы', async () => {
    const { service, telegram } = setup()

    await service.reply(who(Role.STUDENT), 'ticket-1', { text: 'всё ещё не работает' })

    expect(telegram.notifyStaff).toHaveBeenCalledWith(
      'reply',
      'Ответ в обращении поддержки',
      'support_ticket-1',
    )
  })

  // Иначе поддержка уведомляла бы сама себя на каждый свой ответ.
  it('ответ команды никого не будит', async () => {
    const { service, telegram } = setup()

    await service.reply(who(Role.PLATFORM_ADMIN, 'staff-1'), 'ticket-1', { text: 'проверяем' })

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

describe('SupportService.reply — время первого ответа', () => {
  // Отметка ставится один раз: повторное открытие обращения не делает первый ответ
  // быстрее, и переписывать её значило бы улучшать метрику задним числом.
  it('проставляется только при пустом значении', async () => {
    const { service, prisma } = setup()

    await service.reply(who(Role.PLATFORM_ADMIN, 'staff-1'), 'ticket-1', { text: 'смотрим' })

    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', supportFirstReplyAt: null },
      data: { supportFirstReplyAt: expect.any(Date) },
    })
  })

  it('ответ автора временем первого ответа не считается', async () => {
    const { service, prisma } = setup()

    await service.reply(who(Role.STUDENT), 'ticket-1', { text: 'жду' })

    const calls = prisma.chat.updateMany.mock.calls.map((call) => call[0])
    expect(calls.some((call) => 'supportFirstReplyAt' in (call.data ?? {}))).toBe(false)
  })
})
