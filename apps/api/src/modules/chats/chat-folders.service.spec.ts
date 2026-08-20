import { CHAT_FOLDER_LIMITS } from '@studenthub/shared-schemas'
import { Prisma } from '@prisma/client'
import { ChatFoldersService } from './chat-folders.service'

function setup() {
  const models = {
    chatFolder: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    chatFolderItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    chatMember: { findMany: jest.fn().mockResolvedValue([]) },
  }
  // $transaction прогоняет колбэк на том же наборе моков: сервис внутри транзакции работает
  // с tx, и подменять его отдельным объектом значило бы проверять не то, что выполняется.
  const prisma = {
    ...models,
    $transaction: jest.fn((fn: (tx: typeof models) => Promise<unknown>) => fn(models)),
  }
  return { service: new ChatFoldersService(prisma as never), prisma }
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

describe('ChatFoldersService', () => {
  it('list отдаёт папки с составом', async () => {
    const { service, prisma } = setup()
    prisma.chatFolder.findMany.mockResolvedValue([
      { id: 'f1', name: 'Учёба', position: 0, items: [{ chatId: 'c1' }, { chatId: 'c2' }] },
    ])

    await expect(service.list('me')).resolves.toEqual([
      { id: 'f1', name: 'Учёба', position: 0, chatIds: ['c1', 'c2'] },
    ])
    // Папка — личная: выборка всегда по владельцу.
    expect(prisma.chatFolder.findMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'me' })
  })

  it('create: новая папка уходит в конец списка вкладок', async () => {
    const { service, prisma } = setup()
    prisma.chatFolder.count.mockResolvedValue(3)
    prisma.chatMember.findMany.mockResolvedValue([{ chatId: 'c1' }])
    prisma.chatFolder.create.mockResolvedValue({ id: 'f9', name: 'Кураторы', position: 3 })

    const res = await service.create('me', { name: 'Кураторы', chatIds: ['c1'] })

    expect(res).toEqual({ id: 'f9', name: 'Кураторы', position: 3, chatIds: ['c1'] })
    expect(prisma.chatFolder.create.mock.calls[0]?.[0]?.data?.position).toBe(3)
  })

  it('create: чужой чат в составе → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    // Участник только в одном из двух присланных чатов.
    prisma.chatMember.findMany.mockResolvedValue([{ chatId: 'c1' }])

    const err = await service
      .create('me', { name: 'Папка', chatIds: ['c1', 'c-чужой'] })
      .catch((e) => e)

    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.chatFolder.create).not.toHaveBeenCalled()
  })

  it('create: лимит папок → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.chatFolder.count.mockResolvedValue(CHAT_FOLDER_LIMITS.MAX_FOLDERS)

    const err = await service.create('me', { name: 'Ещё одна' }).catch((e) => e)

    expect(err.code).toBe('CONFLICT')
  })

  it('create: имя занято (P2002) → CONFLICT, а не 500', async () => {
    const { service, prisma } = setup()
    prisma.chatFolder.create.mockRejectedValue(p2002())

    const err = await service.create('me', { name: 'Учёба' }).catch((e) => e)

    expect(err.code).toBe('CONFLICT')
  })

  it('update: состав заменяется целиком, а не дополняется', async () => {
    const { service, prisma } = setup()
    prisma.chatFolder.findFirst.mockResolvedValue({ id: 'f1' })
    prisma.chatMember.findMany.mockResolvedValue([{ chatId: 'c2' }])
    prisma.chatFolder.findMany.mockResolvedValue([
      { id: 'f1', name: 'Учёба', position: 0, items: [{ chatId: 'c2' }] },
    ])

    const res = await service.update('me', 'f1', { chatIds: ['c2'] })

    expect(prisma.chatFolderItem.deleteMany).toHaveBeenCalledWith({ where: { folderId: 'f1' } })
    expect(res.chatIds).toEqual(['c2'])
  })

  it('update: чужая папка → NOT_FOUND (существование чужой папки не подтверждаем)', async () => {
    const { service, prisma } = setup()
    prisma.chatFolder.findFirst.mockResolvedValue(null)

    const err = await service.update('me', 'f-чужая', { name: 'Моя' }).catch((e) => e)

    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.chatFolder.update).not.toHaveBeenCalled()
  })

  it('remove: удаление фильтруется по владельцу; ничего не удалено → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.chatFolder.deleteMany.mockResolvedValue({ count: 0 })

    const err = await service.remove('me', 'f-чужая').catch((e) => e)

    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.chatFolder.deleteMany).toHaveBeenCalledWith({
      where: { id: 'f-чужая', userId: 'me' },
    })
  })
})
