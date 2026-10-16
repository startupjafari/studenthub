import { NotificationType } from '@prisma/client'
import { NotificationsProcessor } from './notifications.processor'

// Мокаем только используемые методы Prisma (BACKEND_RULES §11).
type Mock = jest.Mock

function makeDeps() {
  const prisma = {
    user: { findMany: jest.fn() as Mock },
    notification: {
      findMany: jest.fn() as Mock,
      createMany: jest.fn() as Mock,
      updateMany: jest.fn() as Mock,
    },
  }
  const realtime = {
    emitToUser: jest.fn() as Mock,
    emitEventToUser: jest.fn() as Mock,
    getOnlineUserIds: jest.fn() as Mock,
  }
  const queue = { enqueue: jest.fn() as Mock }
  const notifications = {
    invalidateUnread: jest.fn().mockResolvedValue(undefined) as Mock,
    claimEmailSlot: jest.fn().mockResolvedValue(true) as Mock,
  }
  const push = { sendToUser: jest.fn().mockResolvedValue(undefined) as Mock }
  const processor = new NotificationsProcessor(
    prisma as never,
    realtime as never,
    queue as never,
    notifications as never,
    push as never,
  )
  return { processor, prisma, realtime, queue, notifications, push }
}

function job(data: Record<string, unknown>, name = 'new-message') {
  return {
    name,
    id: 'job-1',
    data: { ...data, _meta: { requestId: 'req-1', enqueuedAt: 'now' } },
  } as never
}

const baseSettings = {
  emailEnabled: true,
  pushEnabled: false,
  scheduleChangeEnabled: true,
  appUpdateEnabled: true,
  messageEnabled: true,
  postEnabled: true,
  eventEnabled: true,
  systemEnabled: true,
}

describe('NotificationsProcessor', () => {
  it('онлайн-получатель: WS-эмит, без письма', async () => {
    const { processor, prisma, realtime, queue } = makeDeps()
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'u1@x.co', firstName: 'У1', notificationSettings: baseSettings },
    ])
    prisma.notification.findMany
      .mockResolvedValueOnce([]) // existing
      .mockResolvedValueOnce([{ id: 'n1', userId: 'u1', title: 'T', body: 'B' }]) // created
    prisma.notification.createMany.mockResolvedValue({ count: 1 })
    realtime.getOnlineUserIds.mockResolvedValue(new Set(['u1']))

    await processor.process(
      job({
        recipientIds: ['u1'],
        type: NotificationType.MESSAGE,
        title: 'T',
        body: 'B',
        dedupeKey: 'k1',
      }),
    )

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1)
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'notification:new', {
      notification: { id: 'n1', userId: 'u1', title: 'T', body: 'B' },
    })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('офлайн-получатель с email: ставит письмо send-notification', async () => {
    const { processor, prisma, realtime, queue } = makeDeps()
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'u1@x.co', firstName: 'У1', notificationSettings: baseSettings },
    ])
    prisma.notification.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'n1', userId: 'u1', title: 'T', body: 'B' }])
    prisma.notification.createMany.mockResolvedValue({ count: 1 })
    realtime.getOnlineUserIds.mockResolvedValue(new Set()) // офлайн

    await processor.process(
      job({
        recipientIds: ['u1'],
        type: NotificationType.MESSAGE,
        title: 'T',
        body: 'B',
        dedupeKey: 'k1',
      }),
    )

    expect(realtime.emitToUser).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledTimes(1)
    const [q, jobName, payload, opts] = queue.enqueue.mock.calls[0]
    expect(q).toBe('email')
    expect(jobName).toBe('send-notification')
    expect(payload).toMatchObject({
      to: 'u1@x.co',
      firstName: 'У1',
      notificationTitle: 'T',
      notificationBody: 'B',
    })
    expect(opts.jobId).toBe('notif-email:k1:u1')
    // Письмо-зеркало приоритетное: транзакционные письма (без приоритета) идут раньше.
    expect(opts.priority).toBeGreaterThan(0)
  })

  it('офлайн + email выключен: письмо не ставится', async () => {
    const { processor, prisma, realtime, queue } = makeDeps()
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u1',
        email: 'u1@x.co',
        firstName: 'У1',
        notificationSettings: { ...baseSettings, emailEnabled: false },
      },
    ])
    prisma.notification.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'n1', userId: 'u1', title: 'T', body: 'B' }])
    prisma.notification.createMany.mockResolvedValue({ count: 1 })
    realtime.getOnlineUserIds.mockResolvedValue(new Set())

    await processor.process(
      job({
        recipientIds: ['u1'],
        type: NotificationType.MESSAGE,
        title: 'T',
        body: 'B',
        dedupeKey: 'k1',
      }),
    )

    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('отключённый тип: получатель отфильтрован, ничего не создаётся', async () => {
    const { processor, prisma, realtime, queue } = makeDeps()
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u1',
        email: 'u1@x.co',
        firstName: 'У1',
        notificationSettings: { ...baseSettings, messageEnabled: false },
      },
    ])

    await processor.process(
      job({
        recipientIds: ['u1'],
        type: NotificationType.MESSAGE,
        title: 'T',
        body: 'B',
        dedupeKey: 'k1',
      }),
    )

    expect(prisma.notification.createMany).not.toHaveBeenCalled()
    expect(realtime.emitToUser).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('SYSTEM доставляется, даже если systemEnabled=false', async () => {
    const { processor, prisma, realtime } = makeDeps()
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u1',
        email: 'u1@x.co',
        firstName: 'У1',
        notificationSettings: { ...baseSettings, systemEnabled: false },
      },
    ])
    prisma.notification.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'n1', userId: 'u1', title: 'T', body: 'B' }])
    prisma.notification.createMany.mockResolvedValue({ count: 1 })
    realtime.getOnlineUserIds.mockResolvedValue(new Set(['u1']))

    await processor.process(
      job({
        recipientIds: ['u1'],
        type: NotificationType.SYSTEM,
        title: 'T',
        body: 'B',
        dedupeKey: 'k1',
      }),
    )

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1)
    expect(realtime.emitToUser).toHaveBeenCalled()
  })

  it('идемпотентность: если dedupeKey уже доставлен — ни записи, ни рассылки', async () => {
    const { processor, prisma, realtime, queue } = makeDeps()
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'u1@x.co', firstName: 'У1', notificationSettings: baseSettings },
    ])
    prisma.notification.findMany.mockResolvedValueOnce([{ userId: 'u1' }]) // уже есть

    await processor.process(
      job({
        recipientIds: ['u1'],
        type: NotificationType.MESSAGE,
        title: 'T',
        body: 'B',
        dedupeKey: 'k1',
      }),
    )

    expect(prisma.notification.createMany).not.toHaveBeenCalled()
    expect(realtime.emitToUser).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('пустой список получателей — тихий выход', async () => {
    const { processor, prisma } = makeDeps()
    await processor.process(
      job({
        recipientIds: [],
        type: NotificationType.MESSAGE,
        title: 'T',
        body: 'B',
        dedupeKey: 'k1',
      }),
    )
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('сбой push одному адресату не роняет job и не мешает остальным', async () => {
    const { processor, prisma, realtime, push } = makeDeps()
    const pushOn = { ...baseSettings, pushEnabled: true, emailEnabled: false }
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'u1@x.co', firstName: 'У1', notificationSettings: pushOn },
      { id: 'u2', email: 'u2@x.co', firstName: 'У2', notificationSettings: pushOn },
    ])
    prisma.notification.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'n1', userId: 'u1', title: 'T', body: 'B' },
      { id: 'n2', userId: 'u2', title: 'T', body: 'B' },
    ])
    prisma.notification.createMany.mockResolvedValue({ count: 2 })
    realtime.getOnlineUserIds.mockResolvedValue(new Set())
    push.sendToUser.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(undefined)

    await expect(
      processor.process(
        job({
          recipientIds: ['u1', 'u2'],
          type: NotificationType.POST,
          title: 'T',
          dedupeKey: 'k1',
        }),
      ),
    ).resolves.toBeUndefined()

    expect(push.sendToUser).toHaveBeenCalledTimes(2)
  })
})

// F-F07/F-F08: сообщения чата — одна строка на чат у получателя, письмо не на каждое сообщение.
describe('NotificationsProcessor — свёрнутое уведомление (collapseKey)', () => {
  const collapsed = (messageId: string) =>
    job({
      recipientIds: ['u1'],
      type: NotificationType.MESSAGE,
      title: 'Иванов Иван',
      bodyKey: 'chats.message.body',
      data: { chatId: 'c1', messageId, url: '/chats?c=c1' },
      dedupeKey: `new-message:${messageId}`,
      collapseKey: 'new-message:chat:c1',
    })
  const user = {
    id: 'u1',
    email: 'u1@x.co',
    firstName: 'У1',
    locale: 'ru',
    notificationSettings: { ...baseSettings, pushEnabled: true },
  }
  const row = (isRead: boolean, messageId: string) => ({
    userId: 'u1',
    isRead,
    data: { url: '/chats?c=c1', messageId, chatId: 'c1' },
  })
  const stored = { id: 'n1', userId: 'u1', title: 'Иванов Иван', body: 'Новое сообщение' }

  it('первое сообщение: строка под ключом чата, push и письмо офлайн-адресату', async () => {
    const { processor, prisma, realtime, queue, push, notifications } = makeDeps()
    prisma.user.findMany.mockResolvedValue([user])
    prisma.notification.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stored])
    prisma.notification.createMany.mockResolvedValue({ count: 1 })
    realtime.getOnlineUserIds.mockResolvedValue(new Set())

    await processor.process(collapsed('m1'))

    const created = prisma.notification.createMany.mock.calls[0][0].data[0]
    expect(created.dedupeKey).toBe('new-message:chat:c1')
    expect(created.body).toBe('Новое сообщение')
    expect(prisma.notification.updateMany).not.toHaveBeenCalled()
    expect(push.sendToUser).toHaveBeenCalledTimes(1)
    expect(notifications.claimEmailSlot).toHaveBeenCalledWith('u1', 'new-message:chat:c1')
    expect(queue.enqueue).toHaveBeenCalledTimes(1)
    expect(queue.enqueue.mock.calls[0][3].jobId).toBe('notif-email:new-message:m1:u1')
  })

  it('следующее сообщение поверх непрочитанной строки: та же строка, push есть, письма нет', async () => {
    const { processor, prisma, realtime, queue, push, notifications } = makeDeps()
    prisma.user.findMany.mockResolvedValue([user])
    prisma.notification.findMany
      .mockResolvedValueOnce([row(false, 'm1')])
      .mockResolvedValueOnce([stored])
    prisma.notification.updateMany.mockResolvedValue({ count: 1 })
    realtime.getOnlineUserIds.mockResolvedValue(new Set())

    await processor.process(collapsed('m2'))

    expect(prisma.notification.createMany).not.toHaveBeenCalled()
    const update = prisma.notification.updateMany.mock.calls[0][0]
    expect(update.where).toEqual({ userId: { in: ['u1'] }, dedupeKey: 'new-message:chat:c1' })
    expect(update.data).toMatchObject({
      isRead: false,
      readAt: null,
      data: { chatId: 'c1', messageId: 'm2', url: '/chats?c=c1' },
    })
    expect(update.data.createdAt).toBeInstanceOf(Date)
    expect(push.sendToUser).toHaveBeenCalledTimes(1)
    expect(notifications.claimEmailSlot).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('прочитанная строка поднимается снова; письмо — только если окно по чату свободно', async () => {
    const { processor, prisma, realtime, queue, notifications } = makeDeps()
    prisma.user.findMany.mockResolvedValue([user])
    prisma.notification.findMany
      .mockResolvedValueOnce([row(true, 'm1')])
      .mockResolvedValueOnce([stored])
    prisma.notification.updateMany.mockResolvedValue({ count: 1 })
    realtime.getOnlineUserIds.mockResolvedValue(new Set())
    notifications.claimEmailSlot.mockResolvedValueOnce(false) // письмо по чату уже было недавно

    await processor.process(collapsed('m2'))

    expect(prisma.notification.updateMany).toHaveBeenCalledTimes(1)
    expect(notifications.invalidateUnread).toHaveBeenCalledWith('u1')
    expect(notifications.claimEmailSlot).toHaveBeenCalledTimes(1)
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('онлайн-адресат получает WS с той же строкой', async () => {
    const { processor, prisma, realtime } = makeDeps()
    prisma.user.findMany.mockResolvedValue([user])
    prisma.notification.findMany
      .mockResolvedValueOnce([row(false, 'm1')])
      .mockResolvedValueOnce([stored])
    prisma.notification.updateMany.mockResolvedValue({ count: 1 })
    realtime.getOnlineUserIds.mockResolvedValue(new Set(['u1']))

    await processor.process(collapsed('m2'))

    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'notification:new', {
      notification: stored,
    })
  })

  it('повтор того же job: строка уже несёт это сообщение — ничего не делаем', async () => {
    const { processor, prisma, realtime, queue, push } = makeDeps()
    prisma.user.findMany.mockResolvedValue([user])
    prisma.notification.findMany.mockResolvedValueOnce([row(false, 'm2')])

    await processor.process(collapsed('m2'))

    expect(prisma.notification.createMany).not.toHaveBeenCalled()
    expect(prisma.notification.updateMany).not.toHaveBeenCalled()
    expect(realtime.emitToUser).not.toHaveBeenCalled()
    expect(push.sendToUser).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})
