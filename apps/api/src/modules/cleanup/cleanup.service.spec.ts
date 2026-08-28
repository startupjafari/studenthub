import { InviteStatus } from '@prisma/client'
import { CleanupService } from './cleanup.service'

type Mock = jest.Mock

function makeService() {
  const prisma = {
    invite: { findMany: jest.fn() as Mock, updateMany: jest.fn() as Mock },
    notification: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    auditLog: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    file: { findMany: jest.fn() as Mock },
  }
  const minio = { listObjectsV2: jest.fn() as Mock, removeObject: jest.fn() as Mock }
  const config = { get: jest.fn((k: string) => k) as Mock } // возвращает имя ключа как имя бакета
  const events = { remindDue: jest.fn().mockResolvedValue(0) as Mock }
  const posts = { publishDueScheduled: jest.fn().mockResolvedValue(0) as Mock }
  const documents = {
    sweepExpiry: jest.fn().mockResolvedValue({ expired: 0, expiring: 0 }) as Mock,
  }
  // Лок по умолчанию свободен: проверяем сами задачи. Поведение занятого лока — в
  // cron-lock.service.spec.ts, здесь только то, что задача под ним не запускается.
  const locks = {
    run: jest.fn((_name: string, _ttl: number, task: () => Promise<unknown>) => task()) as Mock,
  }
  // Итог уборки сирот запоминается в Redis для суточной сводки — в тесте это Map.
  const store = new Map<string, string>()
  const redis = {
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }) as Mock,
    get: jest.fn(async (key: string) => store.get(key) ?? null) as Mock,
  }
  const service = new CleanupService(
    prisma as never,
    minio as never,
    config as never,
    events as never,
    posts as never,
    documents as never,
    locks as never,
    redis as never,
  )
  return { service, prisma, minio, config, events, posts, documents, locks, redis, store }
}

// Поток MinIO listObjectsV2 → синхронно эмитим data+end при подписке на 'end'
// (сервис навешивает 'data' раньше 'end', так что к этому моменту все слушатели готовы).
function objectStream(objects: { name: string; lastModified: Date }[]) {
  const handlers: Record<string, (arg?: unknown) => void> = {}
  const s = {
    on(event: string, cb: (arg?: unknown) => void) {
      handlers[event] = cb
      if (event === 'end') {
        for (const o of objects) handlers.data?.(o)
        handlers.end?.()
      }
      return s
    },
  }
  return s
}

// Поток, немедленно эмитящий ошибку при подписке на 'error'.
function errorStream(message: string) {
  const handlers: Record<string, (arg?: unknown) => void> = {}
  const s = {
    on(event: string, cb: (arg?: unknown) => void) {
      handlers[event] = cb
      if (event === 'error') cb(new Error(message))
      return s
    },
  }
  return s
}

describe('CleanupService', () => {
  describe('expireInvites', () => {
    it('помечает просроченные PENDING как EXPIRED, возвращает счётчик', async () => {
      const { service, prisma } = makeService()
      prisma.invite.findMany
        .mockResolvedValueOnce([{ id: 'i1' }, { id: 'i2' }])
        .mockResolvedValueOnce([])
      prisma.invite.updateMany.mockResolvedValue({ count: 2 })

      const total = await service.expireInvites()

      expect(total).toBe(2)
      const where = prisma.invite.findMany.mock.calls[0][0].where
      expect(where.status).toBe(InviteStatus.PENDING)
      expect(where.expiresAt.lt).toBeInstanceOf(Date)
      expect(prisma.invite.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['i1', 'i2'] } },
        data: { status: InviteStatus.EXPIRED },
      })
    })

    it('нет просроченных — 0 без updateMany', async () => {
      const { service, prisma } = makeService()
      prisma.invite.findMany.mockResolvedValueOnce([])
      const total = await service.expireInvites()
      expect(total).toBe(0)
      expect(prisma.invite.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('cleanOldNotifications', () => {
    it('удаляет прочитанные старше 30 дней с cutoff в прошлом', async () => {
      const { service, prisma } = makeService()
      prisma.notification.findMany.mockResolvedValueOnce([{ id: 'n1' }]).mockResolvedValueOnce([])
      prisma.notification.deleteMany.mockResolvedValue({ count: 1 })

      const total = await service.cleanOldNotifications()

      expect(total).toBe(1)
      const where = prisma.notification.findMany.mock.calls[0][0].where
      expect(where.isRead).toBe(true)
      expect(where.createdAt.lt.getTime()).toBeLessThan(Date.now())
    })
  })

  describe('cleanAuditLogs', () => {
    it('удаляет логи старше 90 дней', async () => {
      const { service, prisma } = makeService()
      prisma.auditLog.findMany
        .mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }])
        .mockResolvedValueOnce([])
      prisma.auditLog.deleteMany.mockResolvedValue({ count: 2 })
      const total = await service.cleanAuditLogs()
      expect(total).toBe(2)
    })
  })

  describe('cleanOrphanFiles', () => {
    it('удаляет только объекты без записи File и старше окна безопасности', async () => {
      const { service, prisma, minio } = makeService()
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2ч назад — кандидат
      const fresh = new Date() // свежий — пропускаем
      // 4 бакета: наполняем только первый, остальные пустые.
      minio.listObjectsV2
        .mockReturnValueOnce(
          objectStream([
            { name: 'orphan.png', lastModified: old },
            { name: 'known.png', lastModified: old },
            { name: 'inflight.png', lastModified: fresh },
          ]),
        )
        .mockReturnValue(objectStream([]))
      // known.png есть в File, orphan.png — нет.
      prisma.file.findMany.mockResolvedValue([{ key: 'known.png' }])
      minio.removeObject.mockResolvedValue(undefined)

      const removed = await service.cleanOrphanFiles()

      expect(removed).toBe(1)
      expect(minio.removeObject).toHaveBeenCalledTimes(1)
      expect(minio.removeObject).toHaveBeenCalledWith('MINIO_BUCKET_AVATARS', 'orphan.png')
    })

    it('недоступный бакет не роняет задачу', async () => {
      const { service, minio } = makeService()
      minio.listObjectsV2.mockImplementation(() => errorStream('minio down'))
      await expect(service.cleanOrphanFiles()).resolves.toBe(0)
    })
  })
})

describe('CleanupService — Redis-лок задач (Ф13.9)', () => {
  it('лок занят другим инстансом → задача не работает с БД и отдаёт null', async () => {
    const { service, prisma, locks } = makeService()
    locks.run.mockResolvedValue(null)

    await expect(service.expireInvites()).resolves.toBeNull()
    expect(prisma.invite.findMany).not.toHaveBeenCalled()
  })

  it('каждая cron-задача берёт лок под своим именем', async () => {
    const { service, locks } = makeService()
    locks.run.mockResolvedValue(null)

    await service.scheduleEventReminders()
    await service.publishScheduledPosts()
    await service.sweepDocumentExpiry()
    await service.expireInvites()
    await service.cleanOldNotifications()
    await service.cleanAuditLogs()
    await service.cleanOrphanFiles()

    expect(locks.run.mock.calls.map((c) => c[0])).toEqual([
      'scheduleEventReminders',
      'publishScheduledPosts',
      'sweepDocumentExpiry',
      'expireInvites',
      'cleanOldNotifications',
      'cleanAuditLogs',
      'cleanOrphanFiles',
    ])
  })
})
