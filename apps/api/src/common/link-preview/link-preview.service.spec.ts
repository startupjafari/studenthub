import { EventEmitter } from 'node:events'
import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import type { IncomingMessage, RequestOptions } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { LinkPreviewService } from './link-preview.service'

// Резолв хоста — без сети: настоящий DNS на CI отвечал секундами, и тест на скорость
// разбора падал по таймеру, хотя сам разбор укладывался в миллисекунды. По умолчанию
// хост резолвится в публичный адрес; проверки литералов IP до lookup не доходят.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}))
// Соединение — тоже без сети: сервис ходит через node:http(s) со своим резолвером, и тест
// подменяет сам запрос, отдавая заранее собранный ответ.
jest.mock('node:https', () => ({ request: jest.fn() }))
jest.mock('node:http', () => ({ request: jest.fn() }))

const lookupMock = lookup as unknown as jest.Mock
const httpsMock = httpsRequest as unknown as jest.Mock
const httpMock = httpRequest as unknown as jest.Mock
const service = new LinkPreviewService()

type FakeResponse = Readable & { statusCode: number; headers: Record<string, string> }

/** Ответ-поток: тело кусками, как настоящий сокет. */
function response(
  body: Buffer | string | Readable,
  headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' },
  status = 200,
): FakeResponse {
  const stream =
    body instanceof Readable ? body : Readable.from(chunksOf(Buffer.from(body as string | Buffer)))
  return Object.assign(stream, { statusCode: status, headers })
}

function chunksOf(bytes: Buffer, size = 64 * 1024): Buffer[] {
  const out: Buffer[] = []
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size))
  return out
}

/**
 * Подменить запрос: каждый вызов отдаёт следующий ответ. Сигнал срока рвёт ответ так же,
 * как настоящий http.request рвёт сокет.
 */
function serve(mock: jest.Mock, ...responses: FakeResponse[]): void {
  for (const res of responses) {
    mock.mockImplementationOnce(
      (_url: URL, options: RequestOptions, onResponse: (r: IncomingMessage) => void) => {
        const req = Object.assign(new EventEmitter(), {
          end: () => setImmediate(() => onResponse(res as unknown as IncomingMessage)),
        })
        options.signal?.addEventListener('abort', () => res.destroy(new Error('aborted')))
        return req
      },
    )
  }
}

/** Опции последнего запроса — в них резолвер, которым откроется сокет. */
function lastOptions(mock: jest.Mock): RequestOptions {
  return mock.mock.calls.at(-1)?.[1] as RequestOptions
}

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }]

afterEach(() => {
  httpsMock.mockReset()
  httpMock.mockReset()
  // Неизрасходованный «Once»-ответ DNS не должен переехать в следующий тест.
  lookupMock.mockReset()
  lookupMock.mockResolvedValue(PUBLIC_ADDRESS)
})

// SSRF-гарды выборки превью: без сети — проверяем отказ по протоколу и приватным IP-литералам
// (для таких хостов сервис не должен делать исходящий запрос вообще).
describe('LinkPreviewService — SSRF-гарды', () => {
  it('не-http(s) протокол → null, без запроса', async () => {
    expect(await service.fetch('ftp://example.com/file')).toBeNull()
    expect(await service.fetch('javascript:alert(1)')).toBeNull()
    expect(httpsMock).not.toHaveBeenCalled()
    expect(httpMock).not.toHaveBeenCalled()
  })

  it('хост, резолвящийся в приватный адрес → null, без запроса', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.7', family: 4 }])
    expect(await service.fetch('https://intranet.example.com/')).toBeNull()
    expect(httpsMock).not.toHaveBeenCalled()
  })

  it('loopback IP → null, без запроса', async () => {
    expect(await service.fetch('http://127.0.0.1/admin')).toBeNull()
    expect(await service.fetch('http://[::1]/')).toBeNull()
    expect(httpMock).not.toHaveBeenCalled()
  })

  it('приватные диапазоны (10/172.16-31/192.168/169.254) → null, без запроса', async () => {
    for (const ip of ['10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254']) {
      expect(await service.fetch(`http://${ip}/`)).toBeNull()
    }
    expect(httpMock).not.toHaveBeenCalled()
  })

  it('служебные IPv6 и IPv4-диапазоны → null, без запроса', async () => {
    for (const host of [
      '[::]', // «неуказанный»: на Linux подключение к нему попадает в loopback
      '[::ffff:127.0.0.1]', // IPv4-mapped loopback
      '[::ffff:a9fe:a9fe]', // IPv4-mapped 169.254.169.254 (метаданные облака)
      '[64:ff9b::a00:1]', // NAT64 → 10.0.0.1
      '[fe80::1]',
      '[febf::1]', // конец fe80::/10 — прежняя проверка по префиксу «fe80» его пропускала
      '[fd12::1]',
      '[ff02::1]',
      '224.0.0.1',
      '240.0.0.1',
      '198.18.0.1',
      '100.64.0.1',
    ]) {
      expect(await service.fetch(`http://${host}/`)).toBeNull()
    }
    expect(httpMock).not.toHaveBeenCalled()
  })

  it('битый URL → null', async () => {
    expect(await service.fetch('not a url')).toBeNull()
    expect(httpsMock).not.toHaveBeenCalled()
  })

  it('редирект на внутренний адрес → второго запроса нет', async () => {
    serve(httpsMock, response('', { location: 'http://10.0.0.1/admin' }, 302))

    expect(await service.fetch('https://example.com/go')).toBeNull()
    expect(httpsMock).toHaveBeenCalledTimes(1)
    expect(httpMock).not.toHaveBeenCalled()
  })
})

// DNS rebinding: имя резолвится один раз, и сокет открывается ровно на проверенный адрес.
// Прежде проверка и fetch резолвили имя каждый своим запросом, и между ними адрес мог
// смениться на внутренний.
describe('LinkPreviewService — соединение на проверенный адрес', () => {
  it('резолвер соединения отдаёт только адрес, прошедший проверку', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    // Второй ответ DNS был бы внутренним — но второго резолва быть не должно.
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
    serve(httpsMock, response('<html><head><title>Пример</title></head>'))

    const preview = await service.fetch('https://rebind.example.com/')

    expect(preview?.title).toBe('Пример')
    expect(lookupMock).toHaveBeenCalledTimes(1)
    const { lookup: connectLookup, agent } = lastOptions(httpsMock)
    // Своё соединение, а не сокет из пула, открытый когда-то к другому адресу.
    expect(agent).toBe(false)

    const one = await new Promise<[string, number | undefined]>((resolve, reject) => {
      connectLookup?.('rebind.example.com', { family: 0 }, (err, address, family) =>
        err ? reject(err) : resolve([address as string, family]),
      )
    })
    expect(one).toEqual(['93.184.216.34', 4])

    // autoSelectFamily спрашивает все адреса сразу — и получает те же проверенные.
    const all = await new Promise<LookupAddress[]>((resolve, reject) => {
      connectLookup?.('rebind.example.com', { all: true }, (err, addresses) =>
        err ? reject(err) : resolve(addresses as LookupAddress[]),
      )
    })
    expect(all).toEqual([{ address: '93.184.216.34', family: 4 }])
  })

  it('нет проверенного адреса нужного семейства — ошибка подключения, а не новый резолв', async () => {
    serve(httpsMock, response('<html><head><title>x</title></head>'))
    await service.fetch('https://example.com/')
    const connectLookup = lastOptions(httpsMock).lookup

    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      connectLookup?.('example.com', { family: 6 }, (err) => resolve(err))
    })
    expect(error?.code).toBe('ENOTFOUND')
    expect(lookupMock).toHaveBeenCalledTimes(1)
  })
})

// Чтение тела: OG-теги у крупных сайтов лежат глубоко в <head> (у YouTube — за 700 КБ),
// и прежний потолок в 512 КБ обрезал ответ до них — превью молча не появлялось.
describe('LinkPreviewService — чтение <head>', () => {
  it('og-теги за пределами прежнего лимита в 512 КБ всё равно разбираются', async () => {
    const filler = '<!-- '.padEnd(700 * 1024, 'x') + ' -->'
    const html = `<html><head>${filler}<meta property="og:title" content="Глубокий заголовок"><meta property="og:image" content="https://cdn.example.com/a.jpg"></head><body></body></html>`
    serve(httpsMock, response(html))

    const preview = await service.fetch('https://example.com/page')

    expect(preview?.title).toBe('Глубокий заголовок')
    expect(preview?.image).toBe('https://cdn.example.com/a.jpg')
  })

  it('чтение останавливается на </head> — тело страницы не выкачивается', async () => {
    const tail = 'y'.repeat(3 * 1024 * 1024)
    const html = `<html><head><meta property="og:title" content="Ранний заголовок"></head><body>${tail}</body></html>`
    const res = response(html)
    serve(httpsMock, res)

    const preview = await service.fetch('https://example.com/page')

    expect(preview?.title).toBe('Ранний заголовок')
    // Соединение закрыто, остаток тела не читается.
    expect(res.destroyed).toBe(true)
  })

  it('сжатый ответ (gzip) распаковывается', async () => {
    const html = '<html><head><meta property="og:title" content="Сжатый"></head>'
    serve(
      httpsMock,
      response(gzipSync(html), {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
      }),
    )

    expect((await service.fetch('https://example.com/gz'))?.title).toBe('Сжатый')
  })

  it('страница из тысяч незакрытых «<meta » разбирается быстро (ReDoS)', async () => {
    // Прежняя регулярка `<meta[^>]+…` перебирала такую строку квадратично: 2 МБ держали
    // цикл событий минутами. Теперь — линейно: локально доли секунды.
    //
    // Порог щедрый намеренно. На раннере CI тесты идут с покрытием и параллельно с
    // десятками других наборов, и линейный разбор там занимал 3 с — порог в 2 с ронял
    // сборку на ровном месте. Квадратичный разбор на этом объёме — минуты, так что 15 с
    // по-прежнему отделяют исправленный код от ReDoS.
    const html = `<html><head>${'<meta '.repeat(300_000)}`
    serve(httpsMock, response(html))

    const startedAt = Date.now()
    const preview = await service.fetch('https://example.com/evil')

    expect(Date.now() - startedAt).toBeLessThan(15_000)
    expect(preview?.title).toBeNull()
  }, 30_000)

  it('атрибуты тега в любом порядке и с пробелами вокруг «=»', async () => {
    const html =
      '<html><head><meta content="Описание" name = "description"><title>Заголовок</title></head>'
    serve(httpsMock, response(html))

    const preview = await service.fetch('https://example.com/page')

    expect(preview?.description).toBe('Описание')
    expect(preview?.title).toBe('Заголовок')
  })
})

// Срок покрывает и чтение тела: прежний таймер гасился с приходом заголовков, и сайт,
// отдающий тело по байту, держал обработчик минутами.
describe('LinkPreviewService — срок выборки', () => {
  class QuickPreview extends LinkPreviewService {
    protected override readonly timeoutMs = 50
  }

  it('тело, которое не кончается, обрывается по сроку → null', async () => {
    // Заголовки пришли, тело — нет и никогда не придёт.
    const stalled = response(new Readable({ read() {} }))
    serve(httpsMock, stalled)

    const startedAt = Date.now()
    const preview = await new QuickPreview().fetch('https://slow.example.com/')

    expect(preview).toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(stalled.destroyed).toBe(true)
  })

  it('зависший резолв DNS тоже ограничен сроком', async () => {
    lookupMock.mockReturnValueOnce(new Promise(() => undefined))

    expect(await new QuickPreview().fetch('https://dns-hang.example.com/')).toBeNull()
    expect(httpsMock).not.toHaveBeenCalled()
  })
})
