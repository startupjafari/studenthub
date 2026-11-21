import { STICKER_LIMITS } from '@studenthub/shared-schemas'
import { ChatStickersService } from './chat-stickers.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { FileService } from '../files/file.service'

// Лёгкий каталог для панели (полоса наборов сразу, стикеры набора — по требованию). Главное,
// за что держится выдача: подписываются только обложки, а не каждая картинка каталога.

const sticker = (id: string, fileId: string | null = `f-${id}`) => ({
  id,
  emoji: '🙂',
  width: 512,
  height: 512,
  order: 0,
  fileId,
  animated: false,
})

function setup() {
  const prisma = {
    stickerSet: { findMany: jest.fn(), findFirst: jest.fn() },
  }
  const files = {
    getPresignedUrls: jest
      .fn()
      .mockImplementation((ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, `https://s3/${id}`]))),
      ),
  }
  const service = new ChatStickersService(
    prisma as unknown as PrismaService,
    files as unknown as FileService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { service, prisma, files }
}

describe('Каталог стикеров: лёгкая выдача', () => {
  it('отдаёт обложку и число стикеров, подписывая только обложки', async () => {
    const { service, prisma, files } = setup()
    prisma.stickerSet.findMany.mockResolvedValue([
      { id: 's1', title: 'Один', slug: 'one', _count: { stickers: 30 }, stickers: [sticker('a')] },
      { id: 's2', title: 'Пусто', slug: 'empty', _count: { stickers: 0 }, stickers: [] },
    ])

    const out = await service.listPublishedSummary()

    expect(out).toEqual([
      {
        id: 's1',
        title: 'Один',
        slug: 'one',
        count: 30,
        cover: expect.objectContaining({ id: 'a', url: 'https://s3/f-a' }),
      },
      { id: 's2', title: 'Пусто', slug: 'empty', count: 0, cover: null },
    ])
    expect(files.getPresignedUrls).toHaveBeenCalledTimes(1)
    expect(files.getPresignedUrls).toHaveBeenCalledWith(['f-a'])
    // Только опубликованный каталог, тот же порядок и потолок, что у полной выдачи.
    const args = prisma.stickerSet.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ kind: 'CATALOG', isPublished: true })
    expect(args.take).toBe(STICKER_LIMITS.SETS_MAX)
    expect(args.select.stickers.take).toBe(1)
  })

  it('число стикеров не больше того, что отдаст набор целиком', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findMany.mockResolvedValue([
      { id: 's1', title: 'Т', slug: 't', _count: { stickers: 500 }, stickers: [sticker('a')] },
    ])
    const [set] = await service.listPublishedSummary()
    expect(set?.count).toBe(STICKER_LIMITS.STICKERS_PER_SET_MAX)
  })

  it('обложка без готовой картинки — null', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findMany.mockResolvedValue([
      { id: 's1', title: 'Т', slug: 't', _count: { stickers: 1 }, stickers: [sticker('a', null)] },
    ])
    const [set] = await service.listPublishedSummary()
    expect(set?.cover).toBeNull()
  })
})

describe('Каталог стикеров: один набор', () => {
  it('отдаёт опубликованный набор в форме элемента полной выдачи', async () => {
    const { service, prisma, files } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({
      id: 's1',
      title: 'Один',
      slug: 'one',
      stickers: [sticker('a'), sticker('b')],
    })

    const out = await service.publishedSet('s1')

    expect(out.id).toBe('s1')
    expect(out.stickers.map((s) => s.id)).toEqual(['a', 'b'])
    expect(out.stickers[0]).toMatchObject({ url: 'https://s3/f-a', expiresAt: expect.any(String) })
    expect(files.getPresignedUrls).toHaveBeenCalledWith(['f-a', 'f-b'])
    const args = prisma.stickerSet.findFirst.mock.calls[0][0]
    expect(args.where).toEqual({ id: 's1', kind: 'CATALOG', isPublished: true })
    expect(args.select.stickers.take).toBe(STICKER_LIMITS.STICKERS_PER_SET_MAX)
  })

  it('неопубликованный, личный или несуществующий набор — NOT_FOUND', async () => {
    const { service, prisma, files } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue(null)
    await expect(service.publishedSet('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(files.getPresignedUrls).not.toHaveBeenCalled()
  })
})
