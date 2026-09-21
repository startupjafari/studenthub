import { TelegramNotifyService } from './telegram-notify.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'

function setup(env: Partial<Record<string, string>> = {}, accounts = [{ telegramId: 111n }]) {
  const prisma = { telegramAccount: { findMany: jest.fn().mockResolvedValue(accounts) } }
  const config = { get: jest.fn((key: string) => env[key]) }
  const service = new TelegramNotifyService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
  global.fetch = fetchMock as unknown as typeof fetch
  return { service, prisma, fetchMock }
}

describe('TelegramNotifyService', () => {
  afterEach(() => jest.restoreAllMocks())

  it('без токена бота молчит — мини-апп просто выключен', async () => {
    const { service, fetchMock, prisma } = setup({})

    await service.notifyStaff('Срочная жалоба')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(prisma.telegramAccount.findMany).not.toHaveBeenCalled()
  })

  it('без привязанных аккаунтов не ходит в сеть', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [])

    await service.notifyStaff('Срочная жалоба')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('пишет каждому привязанному сотруднику', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [
      { telegramId: 111n },
      { telegramId: 222n },
    ])

    await service.notifyStaff('Новое обращение')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      chat_id: string
      text: string
    }
    expect(body).toMatchObject({ chat_id: '111', text: 'Новое обращение' })
  })

  // Ссылка, ведущая в никуда, хуже её отсутствия.
  it('без адреса мини-аппа отправляет без кнопки', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' })

    await service.notifyStaff('Срочная жалоба', 'complaint_42')

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body.reply_markup).toBeUndefined()
  })

  it('с адресом мини-аппа кладёт кнопку, открывающую нужную карточку', async () => {
    const { service, fetchMock } = setup({
      TELEGRAM_BOT_TOKEN: 'tok',
      MINI_APP_URL: 'https://mini.example',
    })

    await service.notifyStaff('Срочная жалоба', 'complaint_42')

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      reply_markup: { inline_keyboard: { text: string; web_app: { url: string } }[][] }
    }
    expect(body.reply_markup.inline_keyboard[0]?.[0]?.web_app.url).toBe(
      'https://mini.example?startapp=complaint_42',
    )
  })

  // Уведомление — довесок: недоступный Telegram не должен мешать человеку пожаловаться.
  it('не пробрасывает ошибку сети наружу', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' })
    fetchMock.mockRejectedValue(new Error('network is unreachable'))

    await expect(service.notifyStaff('Срочная жалоба')).resolves.toBeUndefined()
  })

  it('не пробрасывает отказ Telegram (человек не начинал диалог с ботом)', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' })
    fetchMock.mockResolvedValue({ ok: false, status: 403 })

    await expect(service.notifyStaff('Срочная жалоба')).resolves.toBeUndefined()
  })
})
