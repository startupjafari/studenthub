import { InviteStatus } from '@prisma/client'
import { CleanupService } from './cleanup.service'
import { platformHour } from '../../common/telegram/telegram-notify.service'

type Mock = jest.Mock

function makeService() {
  const prisma = {
    invite: { findMany: jest.fn() as Mock, updateMany: jest.fn() as Mock },
    passwordResetToken: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    refreshToken: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    notification: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    auditLog: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    file: {
      findMany: jest.fn() as Mock,
      deleteMany: jest.fn() as Mock,
      groupBy: jest.fn(async () => []) as Mock,
    },
    // Счётчики суточной сводки.
    complaint: { count: jest.fn(async () => 0) as Mock },
    chat: { count: jest.fn(async () => 0) as Mock },
    // Снятие временных блокировок по сроку.
    user: {
      findMany: jest.fn(async () => []) as Mock,
      updateMany: jest.fn() as Mock,
      // Имя дежурного для сводки.
      findUnique: jest.fn(async () => null) as Mock,
    },
  }
  const minio = {
    listObjectsV2: jest.fn() as Mock,
    removeObject: jest.fn() as Mock,
    listIncompleteUploadsQuery: jest.fn() as Mock,
    abortMultipartUpload: jest.fn() as Mock,
  }
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
    del: jest.fn(async (key: string) => {
      store.delete(key)
      return 1
    }) as Mock,
  }
  // Доставка отложенных сообщений чатов: cron только делегирует, поэтому в тесте достаточно
  // счётчика — сама доставка проверяется в chats.service.spec.ts.
  const chats = { deliverDueScheduled: jest.fn(async () => 0) as Mock }
  const audit = { record: jest.fn(async () => undefined) as Mock }
  // Суточная сводка: cron спрашивает час отправки у состояния платформы и пишет в Telegram.
  const support = {
    closeStale: jest.fn(async () => 0) as Mock,
    queueStats: jest.fn(async () => ({ count: 0, oldestAt: null })) as Mock,
    dayStats: jest.fn(async () => ({ created: 0, closed: 0 })) as Mock,
  }
  // Размер очереди жалоб и движение за сутки считает владелец таблицы; планировщик только
  // спрашивает.
  const complaints = {
    queueStats: jest.fn(async () => ({ count: 0, oldestAt: null })) as Mock,
    dayStats: jest.fn(async () => ({ created: 0, closed: 0 })) as Mock,
  }
  // Уборка неподтверждённых заявок вузов: крон только делегирует владельцу таблицы.
  const demoRequests = { purgeUnconfirmed: jest.fn(async () => 0) as Mock }
  // Истёкшие сторисы чистит владелец домена; планировщик только делегирует.
  const stories = { deleteExpired: jest.fn(async () => 0) as Mock }
  const telegram = { notifyStaff: jest.fn(async () => undefined) as Mock }
  const platform = {
    maintenanceActive: jest.fn(async () => false) as Mock,
    rotateDuty: jest.fn(async () => null) as Mock,
    duty: jest.fn(async () => ({ dutyUserId: null, rotation: [] as string[] })) as Mock,
    notificationPolicy: jest.fn(async () => ({
      quietFrom: null,
      quietTo: null,
      muted: [],
      dutyUserId: null,
      digestHour: null,
    })) as Mock,
  }
  // Медиа-система: cron только ставит догонялку, сама постановка — в media.service.spec.ts.
  const media = {
    resumeAndBackfill: jest.fn(async () => ({ resumed: 1, backfilled: 2 })) as Mock,
  }
  // Истечение допусков компаний: cron только делегирует, каскад — в companies.service.spec.ts.
  const companies = { expireAccess: jest.fn(async () => 0) as Mock }
  const service = new CleanupService(
    prisma as never,
    minio as never,
    config as never,
    events as never,
    posts as never,
    stories as never,
    documents as never,
    chats as never,
    locks as never,
    audit as never,
    redis as never,
    support as never,
    complaints as never,
    demoRequests as never,
    telegram as never,
    platform as never,
    media as never,
    companies as never,
  )
  return {
    companies,
    service,
    media,
    prisma,
    audit,
    minio,
    config,
    events,
    posts,
    stories,
    documents,
    chats,
    locks,
    redis,
    store,
    support,
    telegram,
    platform,
  }
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

  describe('purgePasswordResetTokens', () => {
    it('удаляет истёкшие и использованные больше суток назад', async () => {
      const { service, prisma } = makeService()
      prisma.passwordResetToken.findMany
        .mockResolvedValueOnce([{ id: 't1' }])
        .mockResolvedValueOnce([])
      prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 1 })

      const total = await service.purgePasswordResetTokens()

      expect(total).toBe(1)
      const where = prisma.passwordResetToken.findMany.mock.calls[0][0].where
      const [expired, used] = where.OR
      // Свежая ссылка, которую ещё можно открыть, под удаление не попадает.
      expect(expired.expiresAt.lt.getTime()).toBeLessThan(Date.now() - 23 * 60 * 60 * 1000)
      expect(used.usedAt.lt.getTime()).toBeLessThan(Date.now() - 23 * 60 * 60 * 1000)
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['t1'] } },
      })
    })
  })

  describe('purgeRefreshTokens', () => {
    it('удаляет сессии, истёкшие больше суток назад', async () => {
      const { service, prisma } = makeService()
      prisma.refreshToken.findMany
        .mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }])
        .mockResolvedValueOnce([])
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 })

      const total = await service.purgeRefreshTokens()

      expect(total).toBe(2)
      const query = prisma.refreshToken.findMany.mock.calls[0][0]
      expect(query.take).toBe(500)
      expect(query.where.expiresAt.lt.getTime()).toBeLessThan(Date.now() - 23 * 60 * 60 * 1000)
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['r1', 'r2'] } },
      })
    })

    it('погашенные, но не истёкшие не трогает: на них держится детектор повтора', async () => {
      const { service, prisma } = makeService()
      prisma.refreshToken.findMany.mockResolvedValueOnce([])

      await service.purgeRefreshTokens()

      // Единственный критерий — срок; по revokedAt строки живой цепочки не удаляются.
      expect(prisma.refreshToken.findMany.mock.calls[0][0].where).toEqual({
        expiresAt: { lt: expect.any(Date) },
      })
      expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled()
    })

    it('за один прогон удаляет не больше 100 батчей — хвост доберёт следующий', async () => {
      const { service, prisma } = makeService()
      const full = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}` }))
      prisma.refreshToken.findMany.mockResolvedValue(full)
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 500 })

      const total = await service.purgeRefreshTokens()

      expect(prisma.refreshToken.findMany).toHaveBeenCalledTimes(100)
      expect(total).toBe(50_000)
    })
  })

  describe('cleanOldNotifications', () => {
    it('удаляет прочитанные старше 30 дней и непрочитанные старше 90', async () => {
      const { service, prisma } = makeService()
      prisma.notification.findMany
        .mockResolvedValueOnce([{ id: 'n1' }]) // прочитанные
        .mockResolvedValueOnce([{ id: 'n2' }]) // непрочитанные
      prisma.notification.deleteMany.mockResolvedValue({ count: 1 })

      const total = await service.cleanOldNotifications()

      expect(total).toBe(2)
      const day = 24 * 60 * 60 * 1000
      const read = prisma.notification.findMany.mock.calls[0][0].where
      expect(read.isRead).toBe(true)
      expect(Date.now() - read.createdAt.lt.getTime()).toBeGreaterThanOrEqual(30 * day)
      const unread = prisma.notification.findMany.mock.calls[1][0].where
      expect(unread.isRead).toBe(false)
      expect(Date.now() - unread.createdAt.lt.getTime()).toBeGreaterThanOrEqual(90 * day)
      // Удаление перепроверяет условие: поднятое тем временем уведомление не теряется.
      expect(prisma.notification.deleteMany.mock.calls[1][0].where).toMatchObject({
        id: { in: ['n2'] },
        isRead: false,
      })
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

  describe('cleanDetachedFiles', () => {
    it('снимает строки вложений удалённых чатов и материалов, только в их бакетах', async () => {
      const { service, prisma } = makeService()
      prisma.file.findMany
        .mockResolvedValueOnce([{ id: 'f1' }, { id: 'f2' }])
        .mockResolvedValueOnce([{ id: 'f3' }])
      prisma.file.deleteMany.mockImplementation(
        async ({ where }: { where: { id: { in: string[] } } }) => ({
          count: where.id.in.length,
        }),
      )
      await expect(service.cleanDetachedFiles()).resolves.toBe(3)
      const wheres = prisma.file.findMany.mock.calls.map((c: [{ where: unknown }]) => c[0].where)
      expect(wheres).toEqual([
        { bucket: 'MINIO_BUCKET_CHAT', messageId: null, createdAt: { lt: expect.any(Date) } },
        { bucket: 'MINIO_BUCKET_MATERIALS', materialId: null },
      ])
    })

    // Чат принимает файлы альбома до сообщения и привязывает их одной транзакцией: строка
    // без messageId в эти секунды — не сирота, и чистка в этот миг сорвала бы отправку.
    it('не трогает вложения чата моложе часа — они ждут привязки к сообщению', async () => {
      const { service, prisma } = makeService()
      prisma.file.findMany.mockResolvedValue([])
      const before = Date.now()

      await service.cleanDetachedFiles()
      const after = Date.now()

      const chatWhere = prisma.file.findMany.mock.calls[0][0].where as {
        createdAt: { lt: Date }
      }
      const cutoff = chatWhere.createdAt.lt.getTime()
      const hour = 60 * 60 * 1000
      expect(cutoff).toBeGreaterThanOrEqual(before - hour)
      expect(cutoff).toBeLessThanOrEqual(after - hour)
      expect(prisma.file.deleteMany).not.toHaveBeenCalled()
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

    it('не трогает постеры видео и обложки пользователей в profile-covers', async () => {
      const { service, prisma, minio } = makeService()
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
      minio.listObjectsV2.mockImplementation((bucket: string) =>
        bucket === 'MINIO_BUCKET_PROFILE_COVERS'
          ? objectStream([
              { name: 'poster.jpg', lastModified: old },
              { name: 'cover.jpg', lastModified: old },
              { name: 'junk.jpg', lastModified: old },
            ])
          : objectStream([]),
      )
      // Ни у одного из трёх нет File.key — это raw-объекты putAuxImage.
      prisma.file.findMany.mockImplementation(async (args: { where: { posterKey?: unknown } }) =>
        args.where.posterKey ? [{ posterKey: 'poster.jpg' }] : [],
      )
      prisma.user.findMany.mockResolvedValue([
        { coverUrl: 'https://old-minio.example/profile-covers/cover.jpg' },
      ])
      minio.removeObject.mockResolvedValue(undefined)

      const removed = await service.cleanOrphanFiles()

      expect(removed).toBe(1)
      expect(minio.removeObject).toHaveBeenCalledTimes(1)
      expect(minio.removeObject).toHaveBeenCalledWith('MINIO_BUCKET_PROFILE_COVERS', 'junk.jpg')
    })

    it('варианты медиа живут, пока жива запись File-владельца', async () => {
      const { service, prisma, minio } = makeService()
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const alive = '11111111-1111-4111-8111-111111111111'
      const gone = '22222222-2222-4222-8222-222222222222'
      minio.listObjectsV2.mockImplementation((bucket: string) =>
        bucket === 'MINIO_BUCKET_CHAT'
          ? objectStream([
              { name: `variants/${alive}/w640.webp`, lastModified: old },
              { name: `variants/${alive}/hls/720/seg-0001.ts`, lastModified: old },
              { name: `variants/${gone}/w640.webp`, lastModified: old },
            ])
          : objectStream([]),
      )
      prisma.file.findMany.mockImplementation(async (args: { where: { id?: unknown } }) =>
        args.where.id ? [{ id: alive }] : [],
      )
      minio.removeObject.mockResolvedValue(undefined)

      const removed = await service.cleanOrphanFiles()

      expect(removed).toBe(1)
      expect(minio.removeObject).toHaveBeenCalledWith(
        'MINIO_BUCKET_CHAT',
        `variants/${gone}/w640.webp`,
      )
    })

    it('недоступный бакет не роняет задачу', async () => {
      const { service, minio } = makeService()
      minio.listObjectsV2.mockImplementation(() => errorStream('minio down'))
      await expect(service.cleanOrphanFiles()).resolves.toBe(0)
    })
  })

  describe('resumeMediaProcessing', () => {
    it('делегирует догонялку медиа-системе под локом', async () => {
      const { service, media, locks } = makeService()
      await expect(service.resumeMediaProcessing()).resolves.toEqual({ resumed: 1, backfilled: 2 })
      expect(media.resumeAndBackfill).toHaveBeenCalledTimes(1)
      expect(locks.run).toHaveBeenCalledWith(
        'resumeMediaProcessing',
        expect.any(Number),
        expect.any(Function),
      )
    })
  })

  describe('sweepIncompleteUploads', () => {
    const page = (uploads: { key: string; uploadId: string; initiated: Date }[]) => ({
      uploads,
      prefixes: [],
      isTruncated: false,
      nextKeyMarker: '',
      nextUploadIdMarker: '',
    })

    it('отменяет брошенные загрузки и не трогает начатые только что', async () => {
      const { service, minio } = makeService()
      const stale = new Date(Date.now() - 30 * 60 * 60 * 1000)
      const fresh = new Date()
      minio.listIncompleteUploadsQuery
        .mockResolvedValueOnce(
          page([
            { key: 'user-1/a.mp4', uploadId: 'u1', initiated: stale },
            { key: 'user-2/b.mp4', uploadId: 'u2', initiated: fresh },
          ]),
        )
        .mockResolvedValue(page([]))
      minio.abortMultipartUpload.mockResolvedValue(undefined)

      const aborted = await service.sweepIncompleteUploads()

      expect(aborted).toBe(1)
      expect(minio.abortMultipartUpload).toHaveBeenCalledTimes(1)
      expect(minio.abortMultipartUpload).toHaveBeenCalledWith(
        'MINIO_BUCKET_AVATARS',
        'user-1/a.mp4',
        'u1',
      )
    })

    it('дочитывает список до конца: брошенные загрузки могут быть на второй странице', async () => {
      const { service, minio } = makeService()
      const stale = new Date(Date.now() - 30 * 60 * 60 * 1000)
      minio.listIncompleteUploadsQuery
        .mockResolvedValueOnce({
          ...page([{ key: 'user-1/a.mp4', uploadId: 'u1', initiated: stale }]),
          isTruncated: true,
          nextKeyMarker: 'user-1/a.mp4',
          nextUploadIdMarker: 'u1',
        })
        .mockResolvedValueOnce(page([{ key: 'user-1/b.mp4', uploadId: 'u2', initiated: stale }]))
        .mockResolvedValue(page([]))
      minio.abortMultipartUpload.mockResolvedValue(undefined)

      await expect(service.sweepIncompleteUploads()).resolves.toBe(2)
    })

    it('недоступный бакет не роняет задачу', async () => {
      const { service, minio } = makeService()
      minio.listIncompleteUploadsQuery.mockRejectedValue(new Error('minio down'))
      await expect(service.sweepIncompleteUploads()).resolves.toBe(0)
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
    await service.purgeRefreshTokens()
    await service.cleanOldNotifications()
    await service.cleanAuditLogs()
    await service.cleanOrphanFiles()

    expect(locks.run.mock.calls.map((c) => c[0])).toEqual([
      'scheduleEventReminders',
      'publishScheduledPosts',
      'sweepDocumentExpiry',
      'expireInvites',
      'purgeRefreshTokens',
      'cleanOldNotifications',
      'cleanAuditLogs',
      'cleanOrphanFiles',
    ])
  })
})

describe('CleanupService.sendDailyDigest', () => {
  /**
   * Cron ходит ежечасно, а отправляет только в выбранный админом час: держать время в
   * cron-выражении значило бы перезапускать приложение ради его смены.
   */
  it('молчит в чужой час', async () => {
    const c = makeService()
    c.platform.notificationPolicy.mockResolvedValue({
      quietFrom: null,
      quietTo: null,
      muted: [],
      dutyUserId: null,
      digestHour: (platformHour(new Date()) + 1) % 24,
    })

    await expect(c.service.sendDailyDigest()).resolves.toBe(0)
    expect(c.telegram.notifyStaff).not.toHaveBeenCalled()
  })

  it('не шлёт сводку, пока час не выбран', async () => {
    const c = makeService()

    await expect(c.service.sendDailyDigest()).resolves.toBe(0)
    expect(c.telegram.notifyStaff).not.toHaveBeenCalled()
  })

  // «Ноль и ноль» — тоже новость: по отсутствию сводки нельзя отличить спокойный день
  // от сломавшейся отправки.
  it('шлёт сводку и при пустой очереди', async () => {
    const c = makeService()
    c.platform.notificationPolicy.mockResolvedValue({
      quietFrom: null,
      quietTo: null,
      muted: [],
      dutyUserId: null,
      digestHour: platformHour(new Date()),
    })

    await expect(c.service.sendDailyDigest()).resolves.toBe(1)
    expect(c.telegram.notifyStaff).toHaveBeenCalledWith(
      'digest',
      expect.stringContaining('Жалобы: в очереди 0, пришло 0, разобрано 0'),
    )
  })
})

// ── Временные блокировки ────────────────────────────────────────────────────
describe('CleanupService.liftExpiredBlocks', () => {
  it('снимает блокировки, у которых вышел срок, и стирает сам срок', async () => {
    const c = makeService()
    c.prisma.user.findMany.mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
    c.prisma.user.updateMany.mockResolvedValueOnce({ count: 2 })

    await expect(c.service.liftExpiredBlocks()).resolves.toBe(2)
    expect(c.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'u2'] } },
      data: { isBlocked: false, blockedUntil: null },
    })
  })

  // Снятие блокировки — событие того же веса, что и сама блокировка: без записи человек
  // «разблокировался сам», и через месяц никто не объяснит, почему у него снова доступ.
  it('пишет снятие в журнал по каждому человеку', async () => {
    const c = makeService()
    c.prisma.user.findMany.mockResolvedValueOnce([{ id: 'u1' }])
    c.prisma.user.updateMany.mockResolvedValueOnce({ count: 1 })

    await c.service.liftExpiredBlocks()
    expect(c.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user_unblocked_expired', entityId: 'u1' }),
    )
  })

  // Бессрочная блокировка сроком не обладает: подмести её вместе с временными значило бы
  // возвращать доступ тем, у кого его отобрали навсегда.
  it('не трогает бессрочные: в выборке только те, у кого срок вышел', async () => {
    const c = makeService()
    await c.service.liftExpiredBlocks()
    expect(c.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isBlocked: true,
          blockedUntil: { lte: expect.any(Date) },
        }),
      }),
    )
  })
})

describe('CleanupService.rotateDuty', () => {
  // «По понедельникам в 9» — по часам команды: в UTC смена приходилась на 14:00 по Алматы.
  it('смена дежурства идёт по поясу платформы', () => {
    const options = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      CleanupService.prototype.rotateDuty,
    ) as { timeZone?: string }
    expect(options.timeZone).toBe('Asia/Almaty')
  })

  // Крон только зовёт владельца состояния: логика очереди живёт в PlatformService, и
  // дублировать её в планировщике значило бы завести второе место, где она разъедется.
  it('передаёт дежурство через состояние платформы', async () => {
    const c = makeService()
    c.platform.rotateDuty.mockResolvedValue('user-2')
    await expect(c.service.rotateDuty()).resolves.toBe('user-2')
    expect(c.platform.rotateDuty).toHaveBeenCalled()
  })
})

describe('reportStorageUsage', () => {
  // Гигабайт в байтах — порог задаётся в гигабайтах, объёмы в тесте считаем от него.
  const GB = 1024 * 1024 * 1024

  function withUsage(bytesByBucket: Record<string, number>, limitGb?: number) {
    const harness = makeService()
    harness.prisma.file.groupBy.mockResolvedValue(
      Object.entries(bytesByBucket).map(([bucket, size]) => ({ bucket, _sum: { size } })),
    )
    // Конфиг в общем моке отдаёт имя ключа — для порога это строка, а нужен либо number,
    // либо undefined.
    harness.config.get.mockImplementation((key: string) =>
      key === 'STORAGE_ALERT_GB' ? limitGb : key,
    )
    // Общий мок Redis всегда отвечает «OK», а сигнал держится на SET NX: без эмуляции
    // «ключ уже есть» второй прогон повторил бы сообщение, и тест этого не заметил бы.
    const taken = new Set<string>()
    harness.redis.set.mockImplementation(
      async (key: string, _value: string, _ex?: string, _ttl?: number, mode?: string) => {
        if (mode === 'NX' && taken.has(key)) return null
        taken.add(key)
        return 'OK'
      },
    )
    harness.redis.del.mockImplementation(async (key: string) => {
      taken.delete(key)
      return 1
    })
    return harness
  }

  it('без порога только считает и не сигналит', async () => {
    const { service, telegram } = withUsage({ documents: 5 * GB })

    await expect(service.reportStorageUsage()).resolves.toBe(5 * GB)
    expect(telegram.notifyStaff).not.toHaveBeenCalled()
  })

  it('ниже порога молчит и снимает прошлую паузу', async () => {
    const { service, telegram, redis } = withUsage({ 'chat-media': 2 * GB }, 10)

    await service.reportStorageUsage()

    expect(telegram.notifyStaff).not.toHaveBeenCalled()
    // Пауза снимается, иначе следующий подход к порогу был бы проглочен.
    expect(redis.del).toHaveBeenCalledWith('platform:storage-alerted')
  })

  it('выше порога сигналит один раз', async () => {
    const { service, telegram } = withUsage({ 'chat-media': 12 * GB, documents: 1 * GB }, 10)

    await service.reportStorageUsage()
    await service.reportStorageUsage()

    // Второй прогон упирается в SET NX по ключу паузы.
    expect(telegram.notifyStaff).toHaveBeenCalledTimes(1)
    expect(telegram.notifyStaff.mock.calls[0][1]).toContain('13.0 ГБ')
  })
})

describe('CleanupService.expireCompanyAccess', () => {
  it('делегирует истечение допусков владельцу домена под своим локом', async () => {
    const { service, companies, locks } = makeService()
    companies.expireAccess.mockResolvedValue(3)

    await expect(service.expireCompanyAccess()).resolves.toBe(3)

    expect(companies.expireAccess).toHaveBeenCalledTimes(1)
    expect(locks.run.mock.calls[0][0]).toBe('expireCompanyAccess')
  })
})
