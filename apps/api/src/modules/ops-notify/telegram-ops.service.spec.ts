import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { OpsMessage } from './ops-message.builder'
import { TelegramOpsService } from './telegram-ops.service'

// docs/TELEGRAM_BOT.md §7.5: «сбой транспорта не бросает исключение». Это гарантия §0.1.3 —
// падение Telegram не имеет права уронить cron-задачу или запрос, из которого пришло событие.

const env: Partial<EnvVars> = {
  TELEGRAM_BOT_TOKEN: '123456:test-token',
  TELEGRAM_OPS_CHAT_ID: '-1001',
}

function setup(overrides: Partial<EnvVars> = env) {
  const config = {
    get: jest.fn((key: keyof EnvVars) => overrides[key]),
  }
  return new TelegramOpsService(config as unknown as ConfigService<EnvVars, true>)
}

const message: OpsMessage = {
  text: '🔴 Деплой api — упал',
  threadId: 12,
  buttons: [{ text: 'Логи', url: 'https://railway.app/logs' }],
  silent: false,
}

function mockFetch(impl: jest.Mock) {
  global.fetch = impl as unknown as typeof fetch
  return impl
}

function okResponse(messageId = 77) {
  return { json: async () => ({ ok: true, result: { message_id: messageId } }), status: 200 }
}

describe('TelegramOpsService', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('без токена не ходит в сеть вовсе', async () => {
    const fetchMock = mockFetch(jest.fn())
    const service = setup({})

    expect(service.enabled).toBe(false)
    expect(await service.send(message)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('без chat_id тоже молчит — забытая переменная не повод падать', async () => {
    const fetchMock = mockFetch(jest.fn())
    const service = setup({ TELEGRAM_BOT_TOKEN: 'x' })

    expect(await service.send(message)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('возвращает message_id — без него нельзя править сообщение о деплое (§3.2)', async () => {
    mockFetch(jest.fn(async () => okResponse(77)))

    expect(await setup().send(message)).toBe(77)
  })

  it('шлёт тему, кнопки и признак «без звука»', async () => {
    const fetchMock = mockFetch(jest.fn(async () => okResponse()))
    await setup().send({ ...message, silent: true })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.message_thread_id).toBe(12)
    expect(body.disable_notification).toBe(true)
    expect(body.reply_markup.inline_keyboard[0][0].url).toBe('https://railway.app/logs')
  })

  it('санитайзер стоит на пути наружу: email не уедет, даже если его положили в текст', async () => {
    const fetchMock = mockFetch(jest.fn(async () => okResponse()))
    await setup().send({ ...message, text: 'упал деплой от aigerim@univer.kz' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.text).not.toContain('aigerim@univer.kz')
  })

  it('сетевая ошибка не бросает наружу — вызывающий продолжает работать', async () => {
    mockFetch(jest.fn(async () => Promise.reject(new Error('ECONNRESET'))))

    await expect(setup().send(message)).resolves.toBeNull()
  })

  it('на сетевой сбой делает ровно одну повторную попытку', async () => {
    const fetchMock = mockFetch(jest.fn(async () => Promise.reject(new Error('timeout'))))

    await setup().send(message)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('на 4xx не повторяет: битый chat_id повтором не чинится', async () => {
    const fetchMock = mockFetch(
      jest.fn(async () => ({ status: 400, json: async () => ({ ok: false, description: 'bad' }) })),
    )

    expect(await setup().send(message)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('после успешного повтора отдаёт результат', async () => {
    const fetchMock = mockFetch(
      jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(okResponse(5)),
    )

    expect(await setup().send(message)).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('edit и pin так же не бросают', async () => {
    mockFetch(jest.fn(async () => Promise.reject(new Error('down'))))
    const service = setup()

    await expect(service.edit(1, message)).resolves.toBe('failed')
    await expect(service.pin(1)).resolves.toBe(false)
  })

  // Различие важно для закреплённого статуса (§3.3): на `failed` ждём следующей проверки,
  // на `gone` публикуем новое сообщение. Свести их в false — либо дубликаты при каждом
  // сбое сети, либо вечное молчание после одного удалённого сообщения.
  it('удалённое сообщение — gone, сетевой сбой — failed', async () => {
    mockFetch(jest.fn(async () => ({ status: 400, json: async () => ({ ok: false }) })))
    expect(await setup().edit(1, message)).toBe('gone')

    mockFetch(jest.fn(async () => ({ status: 500, json: async () => ({ ok: false }) })))
    expect(await setup().edit(1, message)).toBe('failed')
  })

  it('успешная правка — ok', async () => {
    mockFetch(jest.fn(async () => ({ status: 200, json: async () => ({ ok: true }) })))

    expect(await setup().edit(1, message)).toBe('ok')
  })
})
