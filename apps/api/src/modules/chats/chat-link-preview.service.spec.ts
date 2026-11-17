import { LinkPreviewQuerySchema } from '@studenthub/shared-schemas'
import { ChatLinkPreviewService } from './chat-link-preview.service'
import type { LinkPreview } from '../../common/link-preview/link-preview.service'

// Превью ссылки для черновика и для job отправленного сообщения: кеш, склейка одинаковых
// запросов, картинка никогда не отдаётся (F-F29). Сами защиты выборки (SSRF, сроки, размер)
// проверяет link-preview.service.spec.ts — здесь важно, что путь идёт только через неё.

function setup() {
  const store = new Map<string, string>()
  const redis = {
    store,
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string, ..._args: unknown[]) => {
      store.set(key, value)
      return Promise.resolve('OK')
    }),
  }
  const links = { fetch: jest.fn<Promise<LinkPreview | null>, [string]>() }
  const service = new ChatLinkPreviewService(links as never, redis as never)
  return { service, redis, links }
}

const page: LinkPreview = {
  url: 'https://example.com/a',
  title: 'Заголовок',
  description: 'Описание',
  image: 'https://cdn.example.com/og.png',
  siteName: 'Example',
}

describe('ChatLinkPreviewService', () => {
  it('выборка через LinkPreviewService, картинка снимается, ответ кешируется на час', async () => {
    const { service, links, redis } = setup()
    links.fetch.mockResolvedValue(page)
    const res = await service.preview('https://example.com/a')
    expect(links.fetch).toHaveBeenCalledWith('https://example.com/a')
    expect(res).toEqual({ ...page, image: null })
    const [key, value, ex, ttl] = redis.set.mock.calls[0] as unknown as [
      string,
      string,
      string,
      number,
    ]
    // В ключе — хеш, а не сама ссылка: адреса из личных переписок в именах ключей не лежат.
    expect(key).toMatch(/^chat:link-preview:[0-9a-f]{64}$/)
    expect(key).not.toContain('example')
    expect(JSON.parse(value)).toEqual({ ...page, image: null })
    expect([ex, ttl]).toEqual(['EX', 3600])
  })

  it('повтор той же ссылки берётся из кеша, в сеть не ходит', async () => {
    const { service, links } = setup()
    links.fetch.mockResolvedValue(page)
    await service.preview('https://example.com/a')
    const again = await service.preview('https://example.com/a')
    expect(links.fetch).toHaveBeenCalledTimes(1)
    expect(again).toEqual({ ...page, image: null })
  })

  it('старая запись кеша с картинкой картинку не возвращает', async () => {
    const { service, links, redis } = setup()
    links.fetch.mockResolvedValue(page)
    await service.preview('https://example.com/a')
    const key = redis.set.mock.calls[0]?.[0] as string
    redis.store.set(key, JSON.stringify(page))
    expect((await service.preview('https://example.com/a'))?.image).toBeNull()
  })

  it('пустой ответ (SSRF-блок, не HTML, без заголовка) — null и короткая метка в кеше', async () => {
    const { service, links, redis } = setup()
    links.fetch.mockResolvedValueOnce(null)
    expect(await service.preview('http://10.0.0.1/')).toBeNull()
    expect(redis.set.mock.calls[0]?.slice(1)).toEqual(['-', 'EX', 600])

    links.fetch.mockResolvedValueOnce({ ...page, title: null })
    expect(await service.preview('https://example.com/untitled')).toBeNull()

    // Метка «нет превью» отдаётся из кеша, повторной выборки нет.
    expect(await service.preview('http://10.0.0.1/')).toBeNull()
    expect(links.fetch).toHaveBeenCalledTimes(2)
  })

  it('одновременные запросы одной ссылки склеиваются в одну выборку', async () => {
    const { service, links } = setup()
    let release: (v: LinkPreview) => void = () => undefined
    links.fetch.mockReturnValue(new Promise((resolve) => (release = resolve)))
    const a = service.preview('https://example.com/a')
    const b = service.preview('https://example.com/a')
    // Чтение кеша асинхронное: даём обоим запросам дойти до выборки.
    await new Promise((r) => setImmediate(r))
    release(page)
    expect(await a).toEqual(await b)
    expect(links.fetch).toHaveBeenCalledTimes(1)
  })

  it('Redis недоступен — превью всё равно строится (fail-open)', async () => {
    const { service, links, redis } = setup()
    redis.get.mockRejectedValue(new Error('down'))
    redis.set.mockRejectedValue(new Error('down'))
    links.fetch.mockResolvedValue(page)
    expect(await service.preview('https://example.com/a')).toEqual({ ...page, image: null })
  })
})

describe('LinkPreviewQuerySchema', () => {
  it.each(['https://example.com', 'http://example.com/путь?q=1'])('принимает %s', (url) => {
    expect(LinkPreviewQuerySchema.safeParse({ url }).success).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'ftp://example.com/file',
    'file:///etc/passwd',
    'example.com',
    '',
    `https://example.com/${'a'.repeat(2050)}`,
  ])('отклоняет %s', (url) => {
    expect(LinkPreviewQuerySchema.safeParse({ url }).success).toBe(false)
  })

  it('лишние поля отклоняются', () => {
    expect(
      LinkPreviewQuerySchema.safeParse({ url: 'https://example.com', chatId: 'c1' }).success,
    ).toBe(false)
  })
})
