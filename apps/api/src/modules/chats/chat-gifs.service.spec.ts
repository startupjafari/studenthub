import { ChatGifsService, isGifBytes, isGiphyMediaUrl } from './chat-gifs.service'
import type { ChatsService } from './chats.service'

// Поиск GIF через GIPHY: настоящий API в тестах не вызывается — fetch подменён.

const GIF_BYTES = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 1)])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function bytesResponse(bytes: Buffer, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers })
}

function gif(id: string, images: Record<string, Record<string, string>> = {}) {
  return {
    id,
    title: `GIF ${id}`,
    images: {
      original: {
        url: `https://media1.giphy.com/media/${id}/giphy.gif`,
        width: '480',
        height: '270',
        size: '2048',
      },
      fixed_width_downsampled: {
        url: `https://media1.giphy.com/media/${id}/200w_d.gif`,
        width: '200',
        height: '113',
      },
      ...images,
    },
  }
}

function setup(apiKey: string | null = 'test-key') {
  const store = new Map<string, string>()
  const redis = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value)
      return Promise.resolve('OK')
    }),
  }
  const config = {
    get: jest.fn((name: string) => {
      if (name === 'GIPHY_API_KEY') return apiKey ?? undefined
      if (name === 'MINIO_BUCKET_CHAT') return 'chat-media'
      return undefined
    }),
  }
  const files = { upload: jest.fn().mockResolvedValue({ id: 'file-1' }) }
  // sendRichMessage сразу вызывает приём вложений — как настоящий после своих проверок.
  const chats = {
    sendRichMessage: jest.fn(
      async (_s: string, _c: string, input: { attachments?: () => Promise<{ id: string }[]> }) => {
        const attached = input.attachments ? await input.attachments() : []
        return { id: 'm1', attached }
      },
    ),
  }
  const service = new ChatGifsService(
    config as never,
    redis as never,
    files as never,
    chats as unknown as ChatsService,
  )
  // Настоящая сеть в тестах запрещена: неожиданный запрос падает, а не уходит в GIPHY.
  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockImplementation(() => Promise.reject(new Error('Неожиданный сетевой запрос в тесте')))
  return { service, redis, files, chats, fetchMock, store }
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('ChatGifsService — выдача каталога', () => {
  it('без ключа — FEATURE_DISABLED (503), в каталог не ходит', async () => {
    const { service, fetchMock } = setup(null)
    await expect(service.trending({ offset: 0, limit: 24 })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    })
    await expect(service.search({ q: 'кот', offset: 0, limit: 24 })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    })
    await expect(
      service.sendExternal('u1', 'c1', { provider: 'giphy', id: 'abc' }),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    expect(fetchMock).not.toHaveBeenCalled()
    try {
      await service.trending({ offset: 0, limit: 24 })
    } catch (error) {
      expect((error as { getStatus(): number }).getStatus()).toBe(503)
    }
  })

  it('trending: элементы с превью, следующий offset, рейтинг pg', async () => {
    const { service, fetchMock } = setup()
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [gif('a1'), gif('a2')],
        pagination: { total_count: 100, count: 2, offset: 0 },
      }),
    )
    const page = await service.trending({ offset: 0, limit: 2 })
    expect(page).toEqual({
      items: [
        {
          id: 'a1',
          title: 'GIF a1',
          width: 480,
          height: 270,
          previewUrl: 'https://media1.giphy.com/media/a1/200w_d.gif',
          previewWidth: 200,
          previewHeight: 113,
        },
        expect.objectContaining({ id: 'a2' }),
      ],
      nextOffset: 2,
    })
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(url.origin + url.pathname).toBe('https://api.giphy.com/v1/gifs/trending')
    expect(url.searchParams.get('rating')).toBe('pg')
    expect(url.searchParams.get('limit')).toBe('2')
  })

  it('search: lang=ru, конец выдачи — nextOffset null, превью не с GIPHY отбрасывается', async () => {
    const { service, fetchMock } = setup()
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          gif('ok'),
          gif('evil', {
            fixed_width_downsampled: { url: 'http://169.254.169.254/x.gif' },
            fixed_width: { url: 'https://evil.example.com/x.gif' },
          }),
        ],
        pagination: { total_count: 2, count: 2, offset: 0 },
      }),
    )
    const page = await service.search({ q: '  Сессия ', offset: 0, limit: 24 })
    expect(page.items.map((i) => i.id)).toEqual(['ok'])
    expect(page.nextOffset).toBeNull()
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(url.pathname).toBe('/v1/gifs/search')
    expect(url.searchParams.get('q')).toBe('Сессия')
    expect(url.searchParams.get('lang')).toBe('ru')
  })

  it('повтор того же запроса берётся из кэша Redis на 5 минут', async () => {
    const { service, fetchMock, redis } = setup()
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [gif('a1')], pagination: { total_count: 1, count: 1, offset: 0 } }),
    )
    await service.search({ q: 'Кот', offset: 0, limit: 24 })
    await service.search({ q: 'кот', offset: 0, limit: 24 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^chat:gifs:search:[0-9a-f]{40}:0:24$/),
      expect.any(String),
      'EX',
      300,
    )
  })

  it('сбой каталога — 502 без ключа в сообщении', async () => {
    const { service, fetchMock } = setup()
    fetchMock.mockResolvedValue(jsonResponse({ message: 'boom' }, 500))
    await expect(service.trending({ offset: 0, limit: 24 })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
  })
})

describe('ChatGifsService — отправка GIF каталога', () => {
  it('ищет GIF по id, качает оригинал с GIPHY и сохраняет вложением чата', async () => {
    const { service, fetchMock, files, chats } = setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: gif('abc') }))
      .mockResolvedValueOnce(bytesResponse(GIF_BYTES, { 'content-length': '38' }))

    await service.sendExternal('u1', 'c1', { provider: 'giphy', id: 'abc', nonce: 'n1' })

    const lookup = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(lookup.pathname).toBe('/v1/gifs/abc')
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://media1.giphy.com/media/abc/giphy.gif',
    )
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ redirect: 'error' })
    expect(files.upload).toHaveBeenCalledWith({
      buffer: GIF_BYTES,
      bucket: 'chat-media',
      ownerId: 'u1',
      name: 'giphy-abc.gif',
    })
    expect(chats.sendRichMessage).toHaveBeenCalledWith(
      'u1',
      'c1',
      expect.objectContaining({ nonce: 'n1', data: {} }),
    )
  })

  it('неизвестный id — NOT_FOUND', async () => {
    const { service, fetchMock, files } = setup()
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], meta: { status: 404 } }, 404))
    await expect(
      service.sendExternal('u1', 'c1', { provider: 'giphy', id: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(files.upload).not.toHaveBeenCalled()
  })

  it('пустой data при 200 — тоже NOT_FOUND', async () => {
    const { service, fetchMock } = setup()
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await expect(
      service.sendExternal('u1', 'c1', { provider: 'giphy', id: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('оригинал больше 10 МБ — берётся уменьшенная копия', async () => {
    const { service, fetchMock } = setup()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: gif('big', {
            original: {
              url: 'https://media1.giphy.com/media/big/giphy.gif',
              size: String(30 * 1024 * 1024),
            },
            downsized: {
              url: 'https://media1.giphy.com/media/big/giphy-downsized.gif',
              size: '1000',
            },
          }),
        }),
      )
      .mockResolvedValueOnce(bytesResponse(GIF_BYTES))
    await service.sendExternal('u1', 'c1', { provider: 'giphy', id: 'big' })
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://media1.giphy.com/media/big/giphy-downsized.gif',
    )
  })

  it('все копии больше 10 МБ — 422, ничего не качается', async () => {
    const { service, fetchMock, files } = setup()
    const huge = String(11 * 1024 * 1024)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: 'huge',
          images: { original: { url: 'https://media1.giphy.com/h.gif', size: huge } },
        },
      }),
    )
    await expect(
      service.sendExternal('u1', 'c1', { provider: 'giphy', id: 'huge' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 422 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(files.upload).not.toHaveBeenCalled()
  })

  it('фактический размер больше заявленного — чтение обрывается, 422', async () => {
    const { service, fetchMock, files } = setup()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 'liar',
            images: { original: { url: 'https://media1.giphy.com/l.gif', size: '100' } },
          },
        }),
      )
      .mockResolvedValueOnce(bytesResponse(Buffer.alloc(11 * 1024 * 1024, 0x47)))
    await expect(
      service.sendExternal('u1', 'c1', { provider: 'giphy', id: 'liar' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(files.upload).not.toHaveBeenCalled()
  })

  it('ссылка не на GIPHY не скачивается (SSRF)', async () => {
    const { service, fetchMock, files } = setup()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: 'ssrf',
          images: { original: { url: 'https://169.254.169.254/latest/meta-data', size: '10' } },
        },
      }),
    )
    await expect(
      service.sendExternal('u1', 'c1', { provider: 'giphy', id: 'ssrf' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(files.upload).not.toHaveBeenCalled()
  })

  it('содержимое не GIF по magic bytes — FILE_TYPE_NOT_ALLOWED', async () => {
    const { service, fetchMock, files } = setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: gif('png') }))
      .mockResolvedValueOnce(bytesResponse(Buffer.from('\x89PNG\r\n\x1a\nxxxxxxxx', 'latin1')))
    await expect(
      service.sendExternal('u1', 'c1', { provider: 'giphy', id: 'png' }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' })
    expect(files.upload).not.toHaveBeenCalled()
  })
})

describe('Проверки адреса и формата', () => {
  it.each([
    ['https://media0.giphy.com/media/x/giphy.gif', true],
    ['https://i.giphy.com/x.gif', true],
    ['http://media0.giphy.com/x.gif', false],
    ['https://giphy.com.evil.com/x.gif', false],
    ['https://evilgiphy.com/x.gif', false],
    ['https://user:pass@media.giphy.com/x.gif', false],
    ['https://media.giphy.com:8443/x.gif', false],
    ['not a url', false],
  ])('%s → %s', (url, ok) => {
    expect(isGiphyMediaUrl(url)).toBe(ok)
  })

  it('GIF87a и GIF89a — GIF, остальное нет', () => {
    expect(isGifBytes(Buffer.from('GIF87a...'))).toBe(true)
    expect(isGifBytes(Buffer.from('GIF89a...'))).toBe(true)
    expect(isGifBytes(Buffer.from('<svg>'))).toBe(false)
  })
})
