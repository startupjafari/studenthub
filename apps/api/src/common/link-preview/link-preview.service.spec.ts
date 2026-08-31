import { LinkPreviewService } from './link-preview.service'

// Один шпион на весь файл: два jest.spyOn на один и тот же globalThis.fetch вкладываются
// друг в друга, и mockRestore из первого блока снимает мок второго — дальше тесты молча
// уходят в реальную сеть.
const fetchSpy = jest.spyOn(globalThis, 'fetch')
const service = new LinkPreviewService()

afterEach(() => fetchSpy.mockReset())
afterAll(() => fetchSpy.mockRestore())

// SSRF-гарды выборки превью: без сети — проверяем отказ по протоколу и приватным IP-литералам
// (для таких хостов сервис не должен делать исходящий запрос вообще).
describe('LinkPreviewService — SSRF-гарды', () => {
  it('не-http(s) протокол → null, без запроса', async () => {
    expect(await service.fetch('ftp://example.com/file')).toBeNull()
    expect(await service.fetch('javascript:alert(1)')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('loopback IP → null, без запроса', async () => {
    expect(await service.fetch('http://127.0.0.1/admin')).toBeNull()
    expect(await service.fetch('http://[::1]/')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('приватные диапазоны (10/172.16-31/192.168/169.254) → null, без запроса', async () => {
    for (const ip of ['10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254']) {
      expect(await service.fetch(`http://${ip}/`)).toBeNull()
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('битый URL → null', async () => {
    expect(await service.fetch('not a url')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// Чтение тела: OG-теги у крупных сайтов лежат глубоко в <head> (у YouTube — за 700 КБ),
// и прежний потолок в 512 КБ обрезал ответ до них — превью молча не появлялось.
describe('LinkPreviewService — чтение <head>', () => {
  /** Ответ-заглушка: html отдаётся кусками по 64 КБ, как настоящий поток. */
  function htmlResponse(html: string): Response {
    const bytes = Buffer.from(html, 'utf8')
    let offset = 0
    const body = {
      getReader: () => ({
        read: () => {
          if (offset >= bytes.length) return Promise.resolve({ done: true, value: undefined })
          const chunk = bytes.subarray(offset, offset + 64 * 1024)
          offset += chunk.length
          return Promise.resolve({ done: false, value: new Uint8Array(chunk) })
        },
        cancel: () => Promise.resolve(),
      }),
    }
    return {
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      body,
    } as unknown as Response
  }

  it('og-теги за пределами прежнего лимита в 512 КБ всё равно разбираются', async () => {
    const filler = '<!-- '.padEnd(700 * 1024, 'x') + ' -->'
    const html = `<html><head>${filler}<meta property="og:title" content="Глубокий заголовок"><meta property="og:image" content="https://cdn.example.com/a.jpg"></head><body></body></html>`
    fetchSpy.mockResolvedValue(htmlResponse(html))

    const preview = await service.fetch('https://example.com/page')

    expect(preview?.title).toBe('Глубокий заголовок')
    expect(preview?.image).toBe('https://cdn.example.com/a.jpg')
  })

  it('чтение останавливается на </head> — тело страницы не выкачивается', async () => {
    const tail = 'y'.repeat(3 * 1024 * 1024)
    const html = `<html><head><meta property="og:title" content="Ранний заголовок"></head><body>${tail}</body></html>`
    fetchSpy.mockResolvedValue(htmlResponse(html))

    const preview = await service.fetch('https://example.com/page')

    expect(preview?.title).toBe('Ранний заголовок')
  })
})
