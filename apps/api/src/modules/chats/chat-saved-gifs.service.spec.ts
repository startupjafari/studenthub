import { SAVED_GIFS_LIMIT } from '@studenthub/shared-schemas'
import { ChatSavedGifsService, SAVED_GIFS_CHANGED_EVENT } from './chat-saved-gifs.service'

type Mock = jest.Mock

const NOW = new Date('2026-11-18T10:00:00Z')

function gifFile(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    bucket: 'chat-media',
    key: `${id}.mp4`,
    mime: 'video/mp4',
    size: 1000,
    name: null,
    width: 320,
    height: 240,
    durationMs: 2000,
    animation: true,
    asDocument: false,
    mediaStatus: 'READY',
    placeholder: 'data:image/webp;base64,AAA',
    variants: [],
    message: { chatId: 'c1', deletedAt: null },
    savedGif: null,
    ...patch,
  }
}

function savedRow(id: string, fileId: string) {
  return {
    id,
    sourceFileId: 'src-1',
    fingerprint: '1000:320:240',
    createdAt: NOW,
    file: gifFile(fileId),
  }
}

function setup() {
  const prisma = {
    file: { findUnique: jest.fn() as Mock },
    savedGif: {
      findMany: jest.fn().mockResolvedValue([]) as Mock,
      findFirst: jest.fn().mockResolvedValue(null) as Mock,
      create: jest.fn().mockResolvedValue({ id: 'sg-new' }) as Mock,
      update: jest.fn().mockResolvedValue({}) as Mock,
    },
  }
  const files = {
    cloneRecord: jest.fn().mockResolvedValue({ id: 'clone-1' }) as Mock,
    delete: jest.fn().mockResolvedValue(undefined) as Mock,
    getPresignedUrls: jest.fn(
      async (ids: string[]) => new Map(ids.map((id) => [id, `https://s3/${id}`])),
    ) as Mock,
  }
  const media = {
    describe: jest.fn(
      async (rows: { id: string }[]) =>
        new Map(rows.map((r) => [r.id, { poster: [{ width: 320, height: 240, url: 'p' }] }])),
    ) as Mock,
  }
  const chats = { assertMembership: jest.fn().mockResolvedValue(undefined) as Mock }
  const realtime = { emitToUser: jest.fn() as Mock }
  const service = new ChatSavedGifsService(
    prisma as never,
    files as never,
    media as never,
    chats as never,
    realtime as never,
  )
  return { service, prisma, files, media, chats, realtime }
}

describe('ChatSavedGifsService.save', () => {
  it('GIF из чата, где я участник: своя запись File на тот же объект и событие своим', async () => {
    const { service, prisma, files, chats, realtime } = setup()
    prisma.file.findUnique.mockResolvedValue(gifFile('src-1'))
    prisma.savedGif.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(savedRow('sg-new', 'clone-1'))

    const dto = await service.save('u1', 'src-1')

    expect(chats.assertMembership).toHaveBeenCalledWith('u1', 'c1')
    expect(files.cloneRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'src-1' }), 'u1')
    expect(prisma.savedGif.create).toHaveBeenCalledWith({
      data: { userId: 'u1', fileId: 'clone-1', sourceFileId: 'src-1', fingerprint: '1000:320:240' },
      select: { id: true },
    })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', SAVED_GIFS_CHANGED_EVENT, {})
    expect(dto).toMatchObject({
      id: 'sg-new',
      fileId: 'clone-1',
      mime: 'video/mp4',
      animation: true,
      url: 'https://s3/clone-1',
      poster: 'p',
      sourceFileId: 'src-1',
    })
  })

  it('тот же GIF (вложение или отпечаток) — поднимается наверх, копии не делается', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findUnique.mockResolvedValue(gifFile('src-2'))
    prisma.savedGif.findFirst
      .mockResolvedValueOnce({ id: 'sg-old' })
      .mockResolvedValueOnce(savedRow('sg-old', 'clone-0'))

    await service.save('u1', 'src-2')

    expect(prisma.savedGif.findFirst.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      OR: [{ sourceFileId: 'src-2' }, { fingerprint: '1000:320:240' }],
    })
    expect(prisma.savedGif.update).toHaveBeenCalledWith({
      where: { id: 'sg-old' },
      data: { createdAt: expect.any(Date) },
    })
    expect(files.cloneRecord).not.toHaveBeenCalled()
  })

  it('сверх лимита самые давние уходят вместе со своими записями File', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findUnique.mockResolvedValue(gifFile('src-1'))
    prisma.savedGif.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(savedRow('sg-new', 'clone-1'))
    prisma.savedGif.findMany.mockResolvedValueOnce([{ fileId: 'old-1' }])

    await service.save('u1', 'src-1')

    expect(prisma.savedGif.findMany.mock.calls[0][0]).toMatchObject({
      skip: SAVED_GIFS_LIMIT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    expect(files.delete).toHaveBeenCalledWith('old-1')
  })

  it.each([
    ['нет файла', null],
    ['не GIF (обычное видео)', gifFile('v', { animation: false })],
    ['отправлен файлом', gifFile('d', { mime: 'image/gif', animation: false, asDocument: true })],
    ['сообщение удалено', gifFile('x', { message: { chatId: 'c1', deletedAt: NOW } })],
    ['не вложение', gifFile('y', { message: null })],
  ])('%s — NOT_FOUND', async (_label, file) => {
    const { service, prisma, files } = setup()
    prisma.file.findUnique.mockResolvedValue(file)
    await expect(service.save('u1', 'f')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(files.cloneRecord).not.toHaveBeenCalled()
  })

  it('старый GIF (image/gif) тоже сохраняется', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findUnique.mockResolvedValue(gifFile('g', { mime: 'image/gif', animation: false }))
    prisma.savedGif.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(savedRow('sg-new', 'clone-1'))
    await service.save('u1', 'g')
    expect(files.cloneRecord).toHaveBeenCalled()
  })

  it('не участник чата источника — отказ проверки членства, копии нет', async () => {
    const { service, prisma, files, chats } = setup()
    prisma.file.findUnique.mockResolvedValue(gifFile('src-1'))
    chats.assertMembership.mockRejectedValue(Object.assign(new Error('x'), { code: 'WRONG_SCOPE' }))
    await expect(service.save('u1', 'src-1')).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
    expect(files.cloneRecord).not.toHaveBeenCalled()
  })

  it('не записалось — копия File убирается', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findUnique.mockResolvedValue(gifFile('src-1'))
    prisma.savedGif.create.mockRejectedValue(new Error('db'))
    await expect(service.save('u1', 'src-1')).rejects.toThrow('db')
    expect(files.delete).toHaveBeenCalledWith('clone-1')
  })
})

describe('ChatSavedGifsService.remove и list', () => {
  it('убирает свою запись вместе с файлом и шлёт событие', async () => {
    const { service, prisma, files, realtime } = setup()
    prisma.savedGif.findFirst.mockResolvedValue({ fileId: 'clone-1' })
    await service.remove('u1', 'sg-1')
    expect(prisma.savedGif.findFirst).toHaveBeenCalledWith({
      where: { id: 'sg-1', userId: 'u1' },
      select: { fileId: true },
    })
    expect(files.delete).toHaveBeenCalledWith('clone-1')
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', SAVED_GIFS_CHANGED_EVENT, {})
  })

  it('чужая или несуществующая — тихо ничего', async () => {
    const { service, files, realtime } = setup()
    await service.remove('u1', 'sg-x')
    expect(files.delete).not.toHaveBeenCalled()
    expect(realtime.emitToUser).not.toHaveBeenCalled()
  })

  it('список — свежие сверху, с потолком, без файлов без ссылки', async () => {
    const { service, prisma, files } = setup()
    prisma.savedGif.findMany.mockResolvedValue([savedRow('a', 'fa'), savedRow('b', 'fb')])
    files.getPresignedUrls.mockResolvedValue(new Map([['fa', 'https://s3/fa']]))
    const list = await service.list('u1')
    expect(prisma.savedGif.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1' },
      take: SAVED_GIFS_LIMIT,
    })
    expect(list.map((g) => g.id)).toEqual(['a'])
  })
})
