import { NotificationType } from '@prisma/client'
import { NotificationsProcessor } from './notifications.processor'

// Мокаем только используемые методы Prisma (BACKEND_RULES §11).
type Mock = jest.Mock

function makeDeps() {
  const prisma = {
    user: { findMany: jest.fn() as Mock },
    notification: { findMany: jest.fn() as Mock, createMany: jest.fn() as Mock },
  }
  const realtime = {
    emitToUser: jest.fn() as Mock,
    emitEventToUser: jest.fn() as Mock,
    getOnlineUserIds: jest.fn() as Mock,
  }
  const queue = { enqueue: jest.fn() as Mock }
  const notifications = { invalidateUnread: jest.fn().mockResolvedValue(undefined) as Mock }
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
})
