import { Readable } from 'node:stream'
import { InviteStatus } from '@prisma/client'
import { CleanupService } from './cleanup.service'
import { platformHour } from '../../common/telegram/telegram-notify.service'

type Mock = jest.Mock

function makeService() {
  const prisma = {
    invite: { findMany: jest.fn() as Mock, updateManyAndReturn: jest.fn() as Mock },
    passwordResetToken: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    refreshToken: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    notification: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    auditLog: { findMany: jest.fn() as Mock, deleteMany: jest.fn() as Mock },
    file: {
      findMany: jest.fn() as Mock,
      deleteMany: jest.fn() as Mock,
      groupBy: jest.fn(async () => []) as Mock,
    },
    // Токены пушей: устаревшие и удалённых аккаунтов.
    deviceToken: { findMany: jest.fn(async () => []) as Mock, deleteMany: jest.fn() as Mock },
    pushSubscription: {
      findMany: jest.fn(async () => []) as Mock,
      deleteMany: jest.fn() as Mock,
    },
    // Сырые запросы: объём вариантов медиа по бакетам и «SELECT 1» наблюдения за базой.
    $queryRaw: jest.fn(async () => []) as Mock,
    // Счётчики суточной сводки.
    complaint: { count: jest.fn(async () => 0) as Mock },
    chat: { count: jest.fn(async () => 0) as Mock },
    // Обложки статей профиля — raw-объекты profile-covers, живые по ProfileArticle.coverUrl.
    profileArticle: { findMany: jest.fn(async () => []) as Mock },
    // Снятие временных блокировок по сроку.
    user: {
      findMany: jest.fn(async () => []) as Mock,
      updateMany: jest.fn() as Mock,
      // Имя дежурного для сводки.
      findUnique: jest.fn(async () => null) as Mock,
    },
  }
  const minio = {
    bucketExists: jest.fn(async () => true) as Mock,
    listObjectsV2: jest.fn() as Mock,
    removeObject: jest.fn() as Mock,
    // Сироты удаляются пачкой; в «тихом» режиме ответ — только неудавшиеся ключи.
    removeObjects: jest.fn(async () => []) as Mock,
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
    ping: jest.fn(async () => 'PONG') as Mock,
    // Счётчик серверных ошибок по минутам (countServerErrors).
    mget: jest.fn(async () => []) as Mock,
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
  const companies = {
    expireAccess: jest.fn(async () => 0) as Mock,
    purgeUnverified: jest.fn(async () => 0) as Mock,
  }
  // Сводка просрочки заявок: cron только делегирует, сборка — в application-notifier.spec.ts.
  const applications = { notifyOverdue: jest.fn(async () => 0) as Mock }
  // Запросы документов по сроку: cron только делегирует, закрытие — в document-requests.service.spec.ts.
  const documentRequests = { closeOverdue: jest.fn(async () => 0) as Mock }
  // Штатное удаление аккаунта — путь, который cron передаёт уборке неподтверждённых компаний.
  const users = { softDeleteSelf: jest.fn(async () => undefined) as Mock }
  // Напоминания библиотеки: cron только делегирует, отбор — в library-reminders.spec.ts.
  const libraryReminders = {
    remindDue: jest.fn(async () => ({ dueSoon: 0, dueToday: 0, overdue: 0 })) as Mock,
  }
  const libraryReservations = { expireDue: jest.fn(async () => 0) as Mock }
  // Сроки хранения ПДн: cron только делегирует с флагом dry-run, отбор — в pd-retention.service.spec.ts.
  const retention = {
    purgeClosedLoans: jest.fn(async () => ({ Loan: 0 })) as Mock,
    purgeViewLogs: jest.fn(async () => ({})) as Mock,
    purgeDepartedAcademicRecords: jest.fn(async () => ({})) as Mock,
    purgeDepartedApplications: jest.fn(async () => ({})) as Mock,
    purgeDepartedMessages: jest.fn(async () => ({})) as Mock,
    purgeDepartedDocuments: jest.fn(async () => ({})) as Mock,
    purgeDepartedProfiles: jest.fn(async () => ({})) as Mock,
    purgeAccountTombstones: jest.fn(async () => ({})) as Mock,
  }
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
    applications as never,
    documentRequests as never,
    users as never,
    libraryReminders as never,
    libraryReservations as never,
    retention as never,
  )
  return {
    retention,
    companies,
    applications,
    documentRequests,
    users,
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

// Поток MinIO listObjectsV2: сервис читает его `for await`, как настоящий объектный Readable.
function objectStream(objects: Iterable<{ name: string; lastModified: Date }>) {
  return Readable.from(objects)
}

// Поток, падающий на первом чтении.
function errorStream(message: string) {
  return new Readable({
    objectMode: true,
    read() {
      this.destroy(new Error(message))
    },
  })
}

describe('CleanupService', () => {
  describe('expireInvites', () => {
    it('помечает просроченные PENDING как EXPIRED, возвращает счётчик', async () => {
      const { service, prisma } = makeService()
      prisma.invite.findMany
        .mockResolvedValueOnce([{ id: 'i1' }, { id: 'i2' }])
        .mockResolvedValueOnce([])
      prisma.invite.updateManyAndReturn.mockResolvedValue([{ id: 'i1' }, { id: 'i2' }])

      const total = await service.expireInvites()

      expect(total).toBe(2)
      const where = prisma.invite.findMany.mock.calls[0][0].where
      expect(where.status).toBe(InviteStatus.PENDING)
      expect(where.expiresAt.lt).toBeInstanceOf(Date)
      expect(prisma.invite.updateManyAndReturn).toHaveBeenCalledWith({
        where: { id: { in: ['i1', 'i2'] }, status: InviteStatus.PENDING },
        data: { status: InviteStatus.EXPIRED },
        select: { id: true },
      })
    })

    // A-F19: регистрация между выборкой и записью занимает инвайт (USED) — безусловная запись
    // переписывала его в EXPIRED. Истечение пишется в журнал одной записью на пачку.
    it('занятый регистрацией инвайт не трогает, истёкшие — в аудит одной записью', async () => {
      const { service, prisma, audit } = makeService()
      prisma.invite.findMany
        .mockResolvedValueOnce([{ id: 'i1' }, { id: 'used-meanwhile' }])
        .mockResolvedValueOnce([])
      // Второй к моменту записи уже USED: условие по статусу его не выбирает.
      prisma.invite.updateManyAndReturn.mockResolvedValue([{ id: 'i1' }])

      const total = await service.expireInvites()

      expect(total).toBe(1)
      expect(audit.record).toHaveBeenCalledTimes(1)
      expect(audit.record).toHaveBeenCalledWith({
        action: 'invites_expired',
        entity: 'Invite',
        metadata: { count: 1, inviteIds: ['i1'] },
      })
    })

    it('нет просроченных — 0 без записи и без аудита', async () => {
      const { service, prisma, audit } = makeService()
      prisma.invite.findMany.mockResolvedValueOnce([])
      const total = await service.expireInvites()
      expect(total).toBe(0)
      expect(prisma.invite.updateManyAndReturn).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
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
        .mockResolvedValue([])
        .mockResolvedValueOnce([{ id: 'f1' }, { id: 'f2' }])
        .mockResolvedValueOnce([{ id: 'f3' }])
      prisma.file.deleteMany.mockImplementation(
        async ({ where }: { where: { id: { in: string[] } } }) => ({
          count: where.id.in.length,
        }),
      )
      await expect(service.cleanDetachedFiles()).resolves.toBe(3)
      const wheres = prisma.file.findMany.mock.calls.map((c: [{ where: unknown }]) => c[0].where)
      expect(wheres.slice(0, 2)).toEqual([
        { bucket: 'MINIO_BUCKET_CHAT', messageId: null, createdAt: { lt: expect.any(Date) } },
        { bucket: 'MINIO_BUCKET_MATERIALS', materialId: null },
      ])
      // Условие цели стоит и в удалении: строку могли привязать между выборкой и DELETE.
      expect(prisma.file.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['f1', 'f2'] }, ...(wheres[0] as object) },
      })
    })

    // F-F21: «удалить для всех» скрывало вложение, но байты хранились бессрочно.
    it('снимает вложения сообщений, удалённых больше 30 дней назад', async () => {
      const { service, prisma } = makeService()
      prisma.file.findMany.mockResolvedValue([])
      const before = Date.now()

      await service.cleanDetachedFiles()

      const wheres = prisma.file.findMany.mock.calls.map(
        (c: [{ where: Record<string, unknown> }]) => c[0].where,
      )
      const deleted = wheres.find((w) => 'message' in w) as {
        bucket: string
        message: { deletedAt: { lt: Date } }
      }
      expect(deleted.bucket).toBe('MINIO_BUCKET_CHAT')
      const month = 30 * 24 * 60 * 60 * 1000
      expect(deleted.message.deletedAt.lt.getTime()).toBeGreaterThanOrEqual(before - month)
      expect(deleted.message.deletedAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - month)
    })

    // F-F21: загрузили через /files, а пост, сторис или работу так и не создали.
    it('снимает непривязанные за сутки загрузки постов, сторис и заявок — по всем связям', async () => {
      const { service, prisma } = makeService()
      prisma.file.findMany.mockResolvedValue([])
      const before = Date.now()

      await service.cleanDetachedFiles()

      const wheres = prisma.file.findMany.mock.calls.map(
        (c: [{ where: Record<string, unknown> }]) => c[0].where,
      )
      const uploads = wheres.find((w) => 'postId' in w) as Record<string, unknown> & {
        createdAt: { lt: Date }
      }
      expect(uploads).toMatchObject({
        bucket: { in: ['MINIO_BUCKET_POSTS', 'MINIO_BUCKET_STORIES', 'MINIO_BUCKET_APPLICATIONS'] },
        postId: null,
        messageId: null,
        materialId: null,
        albumId: null,
        documentId: null,
        submissionId: null,
        stories: { none: {} },
        albumsCovered: { none: {} },
      })
      const day = 24 * 60 * 60 * 1000
      expect(uploads.createdAt.lt.getTime()).toBeGreaterThanOrEqual(before - day)
      expect(uploads.createdAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - day)
      // Аватары и медиа профиля не трогаем: там строка без связей — норма.
      for (const where of wheres) {
        expect(JSON.stringify(where)).not.toMatch(/AVATARS|PROFILE_MEDIA/)
      }
    })

    // E-F15: удалённый пост скрывал медиа, но байты хранились бессрочно.
    it('снимает медиа постов, удалённых больше 30 дней назад, если на файл не ссылается ничто другое', async () => {
      const { service, prisma } = makeService()
      prisma.file.findMany.mockResolvedValue([])
      const before = Date.now()

      await service.cleanDetachedFiles()

      const wheres = prisma.file.findMany.mock.calls.map(
        (c: [{ where: Record<string, unknown> }]) => c[0].where,
      )
      const deleted = wheres.find((w) => 'post' in w) as Record<string, unknown> & {
        post: { deletedAt: { lt: Date } }
      }
      expect(deleted).toMatchObject({
        bucket: 'MINIO_BUCKET_POSTS',
        messageId: null,
        materialId: null,
        albumId: null,
        documentId: null,
        submissionId: null,
        stories: { none: {} },
        albumsCovered: { none: {} },
      })
      // Сама связь с постом есть — её условие «пост удалён», а не «поста нет».
      expect(deleted).not.toHaveProperty('postId')
      const month = 30 * 24 * 60 * 60 * 1000
      expect(deleted.post.deletedAt.lt.getTime()).toBeGreaterThanOrEqual(before - month)
      expect(deleted.post.deletedAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - month)
    })

    // D-F21: сканы удалённых документов и брошенных в мастере загрузок жили вечно.
    it('снимает сканы документов, удалённых больше 30 дней назад', async () => {
      const { service, prisma } = makeService()
      prisma.file.findMany.mockResolvedValue([])
      const before = Date.now()

      await service.cleanDetachedFiles()

      const wheres = prisma.file.findMany.mock.calls.map(
        (c: [{ where: Record<string, unknown> }]) => c[0].where,
      )
      const deleted = wheres.find((w) => 'document' in w) as {
        bucket: string
        document: { deletedAt: { lt: Date } }
      }
      expect(deleted.bucket).toBe('MINIO_BUCKET_DOCUMENTS')
      const month = 30 * 24 * 60 * 60 * 1000
      expect(deleted.document.deletedAt.lt.getTime()).toBeGreaterThanOrEqual(before - month)
      expect(deleted.document.deletedAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - month)
    })

    it('снимает сканы, не привязанные к документу за неделю, — по всем связям', async () => {
      const { service, prisma } = makeService()
      prisma.file.findMany.mockResolvedValue([])
      const before = Date.now()

      await service.cleanDetachedFiles()

      const wheres = prisma.file.findMany.mock.calls.map(
        (c: [{ where: Record<string, unknown> }]) => c[0].where,
      )
      const detached = wheres.find(
        (w) => w.bucket === 'MINIO_BUCKET_DOCUMENTS' && 'documentId' in w,
      ) as Record<string, unknown> & { createdAt: { lt: Date } }
      expect(detached).toMatchObject({
        postId: null,
        messageId: null,
        materialId: null,
        albumId: null,
        documentId: null,
        submissionId: null,
        stories: { none: {} },
        albumsCovered: { none: {} },
      })
      const week = 7 * 24 * 60 * 60 * 1000
      expect(detached.createdAt.lt.getTime()).toBeGreaterThanOrEqual(before - week)
      expect(detached.createdAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - week)
    })

    it('условие цели документов стоит и в удалении: скан могли привязать между выборкой и DELETE', async () => {
      const { service, prisma } = makeService()
      prisma.file.findMany.mockImplementation(async ({ where }: { where: { bucket?: unknown } }) =>
        where.bucket === 'MINIO_BUCKET_DOCUMENTS' ? [{ id: 'doc-file' }] : [],
      )
      prisma.file.deleteMany.mockResolvedValue({ count: 1 })

      await expect(service.cleanDetachedFiles()).resolves.toBe(2)

      const deletes = prisma.file.deleteMany.mock.calls.map(
        (c: [{ where: Record<string, unknown> }]) => c[0].where,
      )
      expect(deletes).toHaveLength(2)
      for (const where of deletes) {
        expect(where).toMatchObject({ id: { in: ['doc-file'] }, bucket: 'MINIO_BUCKET_DOCUMENTS' })
      }
      expect(deletes[0]).toHaveProperty('document')
      expect(deletes[1]).toMatchObject({ documentId: null, createdAt: { lt: expect.any(Date) } })
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
      // Наполняем только первый бакет, остальные пустые.
      minio.listObjectsV2
        .mockReturnValueOnce(
          objectStream([
            { name: 'orphan.png', lastModified: old },
            { name: 'known.png', lastModified: old },
            { name: 'inflight.png', lastModified: fresh },
          ]),
        )
        .mockImplementation(() => objectStream([]))
      // known.png есть в File, orphan.png — нет.
      prisma.file.findMany.mockResolvedValue([{ key: 'known.png' }])

      const removed = await service.cleanOrphanFiles()

      expect(removed).toBe(1)
      expect(minio.removeObjects).toHaveBeenCalledTimes(1)
      expect(minio.removeObjects).toHaveBeenCalledWith('MINIO_BUCKET_AVATARS', ['orphan.png'])
      expect(minio.removeObject).not.toHaveBeenCalled()
    })

    it('не трогает постеры видео, обложки пользователей и статей в profile-covers', async () => {
      const { service, prisma, minio } = makeService()
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
      minio.listObjectsV2.mockImplementation((bucket: string) =>
        bucket === 'MINIO_BUCKET_PROFILE_COVERS'
          ? objectStream([
              { name: 'poster.jpg', lastModified: old },
              { name: 'cover.jpg', lastModified: old },
              { name: 'article.jpg', lastModified: old },
              { name: 'junk.jpg', lastModified: old },
            ])
          : objectStream([]),
      )
      // Ни у одного из четырёх нет File.key — это raw-объекты putAuxImage.
      prisma.file.findMany.mockImplementation(async (args: { where: { posterKey?: unknown } }) =>
        args.where.posterKey ? [{ posterKey: 'poster.jpg' }] : [],
      )
      prisma.user.findMany.mockResolvedValue([
        { coverUrl: 'https://old-minio.example/profile-covers/cover.jpg' },
      ])
      // Обложка статьи: брошенная или заменённая сюда не попадает и уходит как junk.jpg.
      prisma.profileArticle.findMany.mockResolvedValue([
        { coverUrl: 'https://minio.example/profile-covers/article.jpg' },
      ])

      const removed = await service.cleanOrphanFiles()

      expect(removed).toBe(1)
      expect(minio.removeObjects).toHaveBeenCalledTimes(1)
      expect(minio.removeObjects).toHaveBeenCalledWith('MINIO_BUCKET_PROFILE_COVERS', ['junk.jpg'])
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

      const removed = await service.cleanOrphanFiles()

      expect(removed).toBe(1)
      expect(minio.removeObjects).toHaveBeenCalledWith('MINIO_BUCKET_CHAT', [
        `variants/${gone}/w640.webp`,
      ])
      // Ключи вариантов не гоняются через File.key — у них своей строки нет.
      const byKey = prisma.file.findMany.mock.calls
        .map(([args]) => (args as { where: { key?: { in: string[] } } }).where.key)
        .filter(Boolean)
      expect(byKey).toEqual([])
    })

    // Главное в F-F11: листинг не копится в память — порция разбирается и удаляется, пока
    // остальной листинг ещё не прочитан.
    it('разбирает листинг порциями по 500 по ходу чтения и удаляет их пачкой', async () => {
      const { service, prisma, minio } = makeService()
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
      let produced = 0
      function* listing() {
        for (let i = 0; i < 1200; i += 1) {
          produced += 1
          yield { name: `junk-${String(i).padStart(4, '0')}.png`, lastModified: old }
        }
      }
      minio.listObjectsV2.mockImplementation((bucket: string) =>
        bucket === 'MINIO_BUCKET_POSTS' ? objectStream(listing()) : objectStream([]),
      )
      prisma.file.findMany.mockResolvedValue([])
      const producedAtRemove: number[] = []
      minio.removeObjects.mockImplementation(async () => {
        producedAtRemove.push(produced)
        return []
      })

      const removed = await service.cleanOrphanFiles()

      expect(removed).toBe(1200)
      const sizes = minio.removeObjects.mock.calls.map(([, keys]) => (keys as string[]).length)
      expect(sizes).toEqual([500, 500, 200])
      // Первая пачка ушла, когда поток выдал чуть больше одной порции, а не все 1200.
      expect(producedAtRemove[0]).toBeLessThan(600)
    })

    it('владелец вариантов сверяется один раз на файл, а не на каждый сегмент', async () => {
      const { service, prisma, minio } = makeService()
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const alive = '11111111-1111-4111-8111-111111111111'
      const gone = '22222222-2222-4222-8222-222222222222'
      // 700 сегментов живого видео (две порции) и 300 — удалённого.
      const segments = (id: string, n: number) =>
        Array.from({ length: n }, (_, i) => ({
          name: `variants/${id}/hls/720/seg-${String(i).padStart(4, '0')}.ts`,
          lastModified: old,
        }))
      minio.listObjectsV2.mockImplementation((bucket: string) =>
        bucket === 'MINIO_BUCKET_CHAT'
          ? objectStream([...segments(alive, 700), ...segments(gone, 300)])
          : objectStream([]),
      )
      prisma.file.findMany.mockImplementation(async (args: { where: { id?: { in: string[] } } }) =>
        args.where.id?.in.includes(alive) ? [{ id: alive }] : [],
      )

      const removed = await service.cleanOrphanFiles()

      expect(removed).toBe(300)
      const asked = prisma.file.findMany.mock.calls
        .map(([args]) => (args as { where: { id?: { in: string[] } } }).where.id?.in)
        .filter(Boolean)
      // Живой — один раз за две порции, удалённый — один раз.
      expect(asked).toEqual([[alive], [gone]])
    })

    it('недоступный бакет не роняет задачу', async () => {
      const { service, minio } = makeService()
      minio.listObjectsV2.mockImplementation(() => errorStream('minio down'))
      await expect(service.cleanOrphanFiles()).resolves.toBe(0)
    })

    it('ключи, которые хранилище не удалило, не считаются удалёнными', async () => {
      const { service, prisma, minio } = makeService()
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
      minio.listObjectsV2
        .mockReturnValueOnce(
          objectStream([
            { name: 'a.png', lastModified: old },
            { name: 'b.png', lastModified: old },
          ]),
        )
        .mockImplementation(() => objectStream([]))
      prisma.file.findMany.mockResolvedValue([])
      minio.removeObjects.mockResolvedValueOnce([{ Code: 'AccessDenied', Key: 'b.png' }])

      await expect(service.cleanOrphanFiles()).resolves.toBe(1)
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
      where: { id: { in: ['u1', 'u2'] }, isBlocked: true, blockedUntil: { lte: expect.any(Date) } },
      data: { isBlocked: false, blockedUntil: null },
    })
  })

  // Блокировку продлили между выборкой и записью — крон её не снимает и снятия не пишет.
  it('продлённую после выборки блокировку не снимает', async () => {
    const c = makeService()
    c.prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
      .mockResolvedValueOnce([{ id: 'u2' }])
    c.prisma.user.updateMany.mockResolvedValueOnce({ count: 1 })

    await expect(c.service.liftExpiredBlocks()).resolves.toBe(1)
    expect(c.audit.record).toHaveBeenCalledTimes(1)
    expect(c.audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'u1' }))
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

  // F-F21: рендишны HLS, постеры и WebP-копии по объёму сопоставимы с оригиналом.
  it('варианты медиа входят в объём своего бакета', async () => {
    const { service, prisma, telegram } = withUsage({ 'chat-media': 8 * GB }, 10)
    prisma.$queryRaw.mockResolvedValue([{ bucket: 'chat-media', bytes: BigInt(3 * GB) }])

    await expect(service.reportStorageUsage()).resolves.toBe(11 * GB)
    expect(telegram.notifyStaff).toHaveBeenCalledTimes(1)
    expect(telegram.notifyStaff.mock.calls[0][1]).toContain('chat-media 11.0 ГБ')
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

describe('CleanupService.closeOverdueDocumentRequests', () => {
  it('делегирует закрытие запросов по сроку владельцу домена под своим локом', async () => {
    const { service, documentRequests, locks } = makeService()
    documentRequests.closeOverdue.mockResolvedValue(2)

    await expect(service.closeOverdueDocumentRequests()).resolves.toBe(2)

    expect(documentRequests.closeOverdue).toHaveBeenCalledTimes(1)
    expect(locks.run.mock.calls[0][0]).toBe('closeOverdueDocumentRequests')
  })
})

describe('CleanupService.purgeUnverifiedEmployers', () => {
  it('отдаёт владельцу домена срок в 30 дней и штатный путь удаления аккаунта', async () => {
    const { service, companies, users, locks } = makeService()
    companies.purgeUnverified.mockImplementation(
      async (_cutoff: Date, deleteAccount: (userId: string) => Promise<void>) => {
        await deleteAccount('u-emp')
        return 1
      },
    )
    const before = Date.now()

    await expect(service.purgeUnverifiedEmployers()).resolves.toBe(1)

    expect(locks.run.mock.calls[0][0]).toBe('purgeUnverifiedEmployers')
    const cutoff = (companies.purgeUnverified.mock.calls[0] as [Date])[0].getTime()
    const month = 30 * 24 * 60 * 60 * 1000
    expect(cutoff).toBeGreaterThanOrEqual(before - month)
    expect(cutoff).toBeLessThanOrEqual(Date.now() - month)
    expect(users.softDeleteSelf).toHaveBeenCalledWith('u-emp')
  })

  it('лок занят — уборки нет', async () => {
    const { service, companies, locks } = makeService()
    locks.run.mockResolvedValue(null)

    await expect(service.purgeUnverifiedEmployers()).resolves.toBeNull()
    expect(companies.purgeUnverified).not.toHaveBeenCalled()
  })

  it('без флага CLEANUP_PURGE_UNVERIFIED_EMPLOYERS аккаунты не удаляются', async () => {
    const { service, companies, locks, config } = makeService()
    config.get.mockImplementation((k: string) =>
      k === 'CLEANUP_PURGE_UNVERIFIED_EMPLOYERS' ? false : k,
    )

    await expect(service.purgeUnverifiedEmployers()).resolves.toBeNull()
    expect(locks.run).not.toHaveBeenCalled()
    expect(companies.purgeUnverified).not.toHaveBeenCalled()
  })
})

describe('CleanupService — сроки хранения ПДн', () => {
  const tasks = [
    'purgeClosedLoans',
    'purgeViewLogs',
    'purgeDepartedAcademicRecords',
    'purgeDepartedApplications',
    'purgeDepartedMessages',
    'purgeDepartedDocuments',
    'purgeDepartedProfiles',
    'purgeAccountTombstones',
  ] as const

  it.each(tasks)('%s: без флага — dry-run под своим локом', async (task) => {
    const { service, retention, locks, config } = makeService()
    config.get.mockImplementation((k: string) => (k === 'PD_RETENTION_ENABLED' ? false : k))

    await service[task]()

    expect(locks.run.mock.calls[0][0]).toBe(task)
    expect(retention[task]).toHaveBeenCalledWith(true)
  })

  it.each(tasks)('%s: PD_RETENTION_ENABLED=true — удаляет', async (task) => {
    const { service, retention, config } = makeService()
    config.get.mockImplementation((k: string) => (k === 'PD_RETENTION_ENABLED' ? true : k))

    await service[task]()

    expect(retention[task]).toHaveBeenCalledWith(false)
  })

  it('флаг не задан строго как true (опечатка, строка) — остаётся dry-run', async () => {
    const { service, retention, config } = makeService()
    config.get.mockImplementation((k: string) => (k === 'PD_RETENTION_ENABLED' ? 'true' : k))

    await service.purgeDepartedMessages()

    expect(retention.purgeDepartedMessages).toHaveBeenCalledWith(true)
  })

  it('лок занят — задача не идёт', async () => {
    const { service, retention, locks } = makeService()
    locks.run.mockResolvedValue(null)

    await expect(service.purgeDepartedProfiles()).resolves.toBeNull()
    expect(retention.purgeDepartedProfiles).not.toHaveBeenCalled()
  })
})

describe('CleanupService.notifyOverdueApplications', () => {
  it('делегирует сводку просрочки заявок владельцу домена под своим локом', async () => {
    const { service, applications, locks } = makeService()
    applications.notifyOverdue.mockResolvedValue(4)

    await expect(service.notifyOverdueApplications()).resolves.toBe(4)

    expect(applications.notifyOverdue).toHaveBeenCalledTimes(1)
    expect(locks.run.mock.calls[0][0]).toBe('notifyOverdueApplications')
  })
})

describe('CleanupService.watchServices', () => {
  // F-F26: признак «упало» живёт в Redis — и при упавшем Redis не читался и не писался,
  // так что «Не отвечает: Redis» уходило каждые пять минут.
  it('лежащий Redis сигналит один раз, подъём — тоже один раз', async () => {
    const { service, redis, telegram } = makeService()
    const redisDown = (): void => {
      redis.ping.mockRejectedValue(new Error('ECONNREFUSED'))
      redis.get.mockRejectedValue(new Error('ECONNREFUSED'))
      redis.set.mockRejectedValue(new Error('ECONNREFUSED'))
      redis.del.mockRejectedValue(new Error('ECONNREFUSED'))
    }
    redisDown()

    await service.watchServices()
    await service.watchServices()
    await service.watchServices()

    expect(telegram.notifyStaff).toHaveBeenCalledTimes(1)
    expect(telegram.notifyStaff.mock.calls[0][1]).toBe('Не отвечает: Redis')

    // Redis поднялся пустым: отметки «упало» в нём нет — записать её было некуда.
    redis.ping.mockResolvedValue('PONG')
    redis.get.mockResolvedValue(null)
    redis.set.mockResolvedValue('OK')
    redis.del.mockResolvedValue(1)

    await service.watchServices()
    await service.watchServices()

    expect(telegram.notifyStaff).toHaveBeenCalledTimes(2)
    expect(telegram.notifyStaff.mock.calls[1][1]).toBe('Все сервисы снова отвечают')
  })

  it('сбой, объявленный другим инстансом, не повторяется; подъём объявляется один раз', async () => {
    const { service, telegram, minio, store } = makeService()
    minio.bucketExists.mockRejectedValue(new Error('down'))
    store.set('platform:services-down', 'хранилище')

    await service.watchServices()
    expect(telegram.notifyStaff).not.toHaveBeenCalled()

    minio.bucketExists.mockResolvedValue(true)
    await service.watchServices()
    await service.watchServices()

    expect(telegram.notifyStaff).toHaveBeenCalledTimes(1)
    expect(telegram.notifyStaff.mock.calls[0][1]).toBe('Все сервисы снова отвечают')
  })

  it('подъём, объявленный другим инстансом, этот не дублирует', async () => {
    const { service, telegram, minio, store } = makeService()
    minio.bucketExists.mockRejectedValue(new Error('down'))
    await service.watchServices()
    expect(telegram.notifyStaff).toHaveBeenCalledTimes(1)

    // Другой инстанс увидел подъём, объявил его и снял отметку.
    store.delete('platform:services-down')
    minio.bucketExists.mockResolvedValue(true)
    await service.watchServices()

    expect(telegram.notifyStaff).toHaveBeenCalledTimes(1)
  })
})

describe('CleanupService.purgeDeviceTokens', () => {
  // F-F25: схема обещала чистку по lastSeenAt, но задачи не было.
  it('удаляет токены, не подтверждённые 90 дней, и адреса удалённых аккаунтов', async () => {
    const { service, prisma, locks } = makeService()
    prisma.deviceToken.findMany.mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }])
    prisma.deviceToken.deleteMany.mockResolvedValue({ count: 2 })
    prisma.pushSubscription.findMany.mockResolvedValueOnce([{ id: 's1' }])
    prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 })
    const before = Date.now()

    await expect(service.purgeDeviceTokens()).resolves.toBe(3)

    expect(locks.run.mock.calls[0][0]).toBe('purgeDeviceTokens')
    const deviceWhere = prisma.deviceToken.findMany.mock.calls[0][0].where as {
      OR: [{ lastSeenAt: { lt: Date } }, { user: { deletedAt: { not: null } } }]
    }
    const stale = 90 * 24 * 60 * 60 * 1000
    expect(deviceWhere.OR[0].lastSeenAt.lt.getTime()).toBeGreaterThanOrEqual(before - stale)
    expect(deviceWhere.OR[0].lastSeenAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - stale)
    expect(deviceWhere.OR[1]).toEqual({ user: { deletedAt: { not: null } } })
    // Условие повторяется в удалении: подтверждённый за это время токен остаётся.
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['d1', 'd2'] }, ...deviceWhere },
    })
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1'] }, user: { deletedAt: { not: null } } },
    })
  })
})
