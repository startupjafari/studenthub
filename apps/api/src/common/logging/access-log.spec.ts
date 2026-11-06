import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PinoLogger } from 'nestjs-pino'
import { accessLogEntry, registerAccessLog } from './access-log'
import { serializeRequest } from './logger.config'

function entry(url: string, statusCode = 200, headers: Record<string, string> = {}) {
  const request = { method: 'GET', url, id: 'req-1', headers } as unknown as FastifyRequest
  const reply = { statusCode, elapsedTime: 12.4 } as unknown as FastifyReply
  return accessLogEntry(request, reply)
}

describe('access-лог — секреты в адресе (§13)', () => {
  it('токен инвайта в пути не попадает в лог', () => {
    const { fields, message } = entry('/api/v1/invites/0f8c2b7e-secret/preview')
    expect(JSON.stringify(fields)).not.toContain('0f8c2b7e-secret')
    expect(message).not.toContain('0f8c2b7e-secret')
    expect(fields.path).toBe('/api/v1/invites/[token]/preview')
  })

  it('?token= и ?code= заменяются, остальной query остаётся', () => {
    const { fields } = entry('/api/v1/student-id/verify?token=abc123&lang=ru')
    expect(fields.path).toBe('/api/v1/student-id/verify?token=[Filtered]&lang=ru')
  })

  it('HLS-токен ?t= не попадает в лог', () => {
    const { fields } = entry('/api/v1/media/f1/hls/master.m3u8?t=hls-secret')
    expect(fields.path).toBe('/api/v1/media/f1/hls/master.m3u8?t=[Filtered]')
  })
})

describe('access-лог — статус ответа', () => {
  it('пишет статус, который ушёл клиенту, а не угаданный по исключению', () => {
    expect(entry('/api/v1/auth/login', 429).fields.statusCode).toBe(429)
    expect(entry('/api/v1/posts', 201).fields.statusCode).toBe(201)
    expect(entry('/api/v1/posts', 422).message).toBe('GET /api/v1/posts 422')
  })

  it('длительность — из elapsedTime Fastify, целыми миллисекундами', () => {
    expect(entry('/api/v1/posts').fields.durationMs).toBe(12)
  })

  it('регистрируется хуком onResponse — его видят и отказы guard-ов', () => {
    const addHook = jest.fn()
    const info = jest.fn()
    registerAccessLog({ addHook } as unknown as FastifyInstance, { info } as unknown as PinoLogger)
    expect(addHook).toHaveBeenCalledWith('onResponse', expect.any(Function))

    const [, hook] = addHook.mock.calls[0] as [
      string,
      (req: unknown, reply: unknown, done: () => void) => void,
    ]
    const done = jest.fn()
    hook(
      { method: 'POST', url: '/api/v1/auth/login', id: 'r', headers: {} },
      { statusCode: 401, elapsedTime: 3 },
      done,
    )
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
      'POST /api/v1/auth/login 401',
    )
    expect(done).toHaveBeenCalled()
  })
})

describe('сериализатор запроса pino (§13)', () => {
  it('чистит адрес и вырезает секретные заголовки', () => {
    const out = serializeRequest({
      id: 'r',
      method: 'POST',
      url: '/api/v1/invites/tok-123/preview?t=hls',
      headers: {
        authorization: 'Bearer a',
        cookie: 'refresh=b',
        'x-telegram-bot-api-secret-token': 'tg-secret',
        'user-agent': 'jest',
      },
    })
    const text = JSON.stringify(out)
    expect(text).not.toContain('tok-123')
    expect(text).not.toContain('tg-secret')
    expect(text).not.toContain('Bearer')
    expect(out.url).toBe('/api/v1/invites/[token]/preview?t=[Filtered]')
    expect(out.headers).toEqual({ 'user-agent': 'jest' })
  })
})
