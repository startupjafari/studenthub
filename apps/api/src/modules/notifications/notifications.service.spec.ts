import { NotificationsService } from './notifications.service'
import { AppException } from '../../common/exceptions/app.exception'

type Mock = jest.Mock

function makeService() {
  const prisma = {
    notification: {
      findMany: jest.fn() as Mock,
      count: jest.fn() as Mock,
      updateMany: jest.fn() as Mock,
      deleteMany: jest.fn() as Mock,
      findFirst: jest.fn() as Mock,
    },
    notificationSettings: {
      findUnique: jest.fn() as Mock,
      create: jest.fn() as Mock,
      upsert: jest.fn() as Mock,
    },
  }
  const redis = { get: jest.fn() as Mock, set: jest.fn() as Mock, del: jest.fn() as Mock }
  const service = new NotificationsService(prisma as never, redis as never)
  return { service, prisma, redis }
}

describe('NotificationsService', () => {
  describe('unreadCount', () => {
    it('кэш-хит: возвращает из Redis, не считает в БД', async () => {
      const { service, prisma, redis } = makeService()
      redis.get.mockResolvedValue('7')
      const res = await service.unreadCount('u1')
      expect(res).toEqual({ count: 7 })
      expect(prisma.notification.count).not.toHaveBeenCalled()
    })

    it('кэш-мисс: считает в БД и кладёт в Redis', async () => {
      const { service, prisma, redis } = makeService()
      redis.get.mockResolvedValue(null)
      prisma.notification.count.mockResolvedValue(3)
      const res = await service.unreadCount('u1')
      expect(res).toEqual({ count: 3 })
      expect(redis.set).toHaveBeenCalledWith('notif:unread:u1', '3', 'EX', expect.any(Number))
    })
  })

  describe('list', () => {
    it('hasNext=true и cursor выставляются при переполнении лимита', async () => {
      const { service, prisma } = makeService()
      // limit 2 → запрашиваем 3; вернулось 3 → есть следующая
      prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }])
      const res = await service.list('u1', { limit: 2 })
      expect(res.items).toHaveLength(2)
      expect(res.meta).toEqual({ cursor: 'n2', hasNext: true })
    })

    it('последняя страница: hasNext=false, cursor undefined', async () => {
      const { service, prisma } = makeService()
      prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }])
      const res = await service.list('u1', { limit: 2 })
      expect(res.items).toHaveLength(1)
      expect(res.meta).toEqual({ cursor: undefined, hasNext: false })
    })
  })

  describe('markRead', () => {
    it('не найдено (или чужое) → NOT_FOUND', async () => {
      const { service, prisma } = makeService()
      prisma.notification.updateMany.mockResolvedValue({ count: 0 })
      prisma.notification.findFirst.mockResolvedValue(null)
      await expect(service.markRead('u1', 'nX')).rejects.toBeInstanceOf(AppException)
    })

    it('успех → инвалидирует кэш', async () => {
      const { service, prisma, redis } = makeService()
      prisma.notification.updateMany.mockResolvedValue({ count: 1 })
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1', isRead: true })
      await service.markRead('u1', 'n1')
      expect(redis.del).toHaveBeenCalledWith('notif:unread:u1')
    })
  })

  describe('remove', () => {
    it('нет своей записи → NOT_FOUND', async () => {
      const { service, prisma } = makeService()
      prisma.notification.deleteMany.mockResolvedValue({ count: 0 })
      await expect(service.remove('u1', 'nX')).rejects.toBeInstanceOf(AppException)
    })

    it('удаление своей → инвалидирует кэш', async () => {
      const { service, prisma, redis } = makeService()
      prisma.notification.deleteMany.mockResolvedValue({ count: 1 })
      await service.remove('u1', 'n1')
      expect(redis.del).toHaveBeenCalledWith('notif:unread:u1')
    })
  })

  describe('settings', () => {
    it('getSettings: нет строки → создаётся дефолтная', async () => {
      const { service, prisma } = makeService()
      prisma.notificationSettings.findUnique.mockResolvedValue(null)
      prisma.notificationSettings.create.mockResolvedValue({ emailEnabled: true })
      await service.getSettings('u1')
      expect(prisma.notificationSettings.create).toHaveBeenCalled()
    })

    it('updateSettings: upsert c патчем', async () => {
      const { service, prisma } = makeService()
      prisma.notificationSettings.upsert.mockResolvedValue({ emailEnabled: false })
      await service.updateSettings('u1', { emailEnabled: false })
      const arg = prisma.notificationSettings.upsert.mock.calls[0][0]
      expect(arg.where).toEqual({ userId: 'u1' })
      expect(arg.update).toEqual({ emailEnabled: false })
    })
  })
})
