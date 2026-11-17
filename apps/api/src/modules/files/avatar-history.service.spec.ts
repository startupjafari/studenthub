import { AVATAR_HISTORY_MAX, AvatarHistoryService } from './avatar-history.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { FileService } from './file.service'

// История фото профиля и групп (§8.3): текущее первым, потолок, удаление вместе с файлом.

function setup(rows: { id: string; url: string; createdAt: Date; fileId: string | null }[] = []) {
  const prisma = {
    avatarPhoto: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }
  const files = { delete: jest.fn().mockResolvedValue(undefined) }
  const history = new AvatarHistoryService(
    prisma as unknown as PrismaService,
    files as unknown as FileService,
  )
  return { history, prisma, files }
}

const at = (n: number) => new Date(2026, 0, n)

describe('AvatarHistoryService', () => {
  it('list: текущее (по URL) — первым, остальные свежими первыми', async () => {
    const { history } = setup([
      { id: 'p3', url: 'u3', createdAt: at(3), fileId: 'f3' },
      { id: 'p2', url: 'u2', createdAt: at(2), fileId: 'f2' },
      { id: 'p1', url: 'u1', createdAt: at(1), fileId: 'f1' },
    ])
    const list = await history.list({ userId: 'u' }, 'u2')
    expect(list.map((p) => [p.id, p.current])).toEqual([
      ['p2', true],
      ['p3', false],
      ['p1', false],
    ])
  })

  it('list: аватар старше истории (строки нет) показывается первым без id', async () => {
    const { history } = setup([{ id: 'p1', url: 'u1', createdAt: at(1), fileId: 'f1' }])
    const list = await history.list({ chatId: 'c' }, 'legacy')
    expect(list[0]).toEqual(expect.objectContaining({ id: '', url: 'legacy', current: true }))
    expect(list).toHaveLength(2)
  })

  it('add: новая строка, сверх потолка самые старые уходят вместе с файлами', async () => {
    const { history, prisma, files } = setup()
    prisma.avatarPhoto.findMany.mockResolvedValueOnce([{ id: 'old' }])
    prisma.avatarPhoto.findUnique.mockResolvedValue({ fileId: 'f-old' })
    await history.add({ userId: 'u' }, 'f-new', 'url')
    expect(prisma.avatarPhoto.create).toHaveBeenCalledWith({
      data: { userId: 'u', fileId: 'f-new', url: 'url' },
    })
    expect(prisma.avatarPhoto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: AVATAR_HISTORY_MAX }),
    )
    expect(files.delete).toHaveBeenCalledWith('f-old')
  })

  it('remove: файл уже снят мимо истории — строка всё равно уходит', async () => {
    const { history, prisma, files } = setup()
    prisma.avatarPhoto.findUnique.mockResolvedValue({ fileId: 'f1' })
    files.delete.mockRejectedValue(new Error('NOT_FOUND'))
    await history.remove('p1')
    expect(prisma.avatarPhoto.deleteMany).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })
})
