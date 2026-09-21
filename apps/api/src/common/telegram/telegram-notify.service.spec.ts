import { TelegramNotifyService, isQuiet } from './telegram-notify.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'

interface Policy {
  quietFrom: number | null
  quietTo: number | null
  muted: string[]
  dutyUserId: string | null
}

const OPEN_POLICY: Policy = { quietFrom: null, quietTo: null, muted: [], dutyUserId: null }

function setup(
  env: Partial<Record<string, string>> = {},
  accounts = [{ telegramId: 111n }],
  policy: Partial<Policy> = {},
) {
  const prisma = { telegramAccount: { findMany: jest.fn().mockResolvedValue(accounts) } }
  const config = { get: jest.fn((key: string) => env[key]) }
  const platform = {
    maintenanceActive: jest.fn().mockResolvedValue(false),
    notificationPolicy: jest.fn().mockResolvedValue({ ...OPEN_POLICY, ...policy }),
  }
  const service = new TelegramNotifyService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService<EnvVars, true>,
    platform,
  )
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
  global.fetch = fetchMock as unknown as typeof fetch
  return { service, prisma, fetchMock, platform }
}

describe('TelegramNotifyService', () => {
  afterEach(() => jest.restoreAllMocks())

  it('без токена бота молчит — мини-апп просто выключен', async () => {
    const { service, fetchMock, prisma } = setup({})

    await service.notifyStaff('complaint', 'Срочная жалоба')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(prisma.telegramAccount.findMany).not.toHaveBeenCalled()
  })

  it('без привязанных аккаунтов не ходит в сеть', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [])

    await service.notifyStaff('complaint', 'Срочная жалоба')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('пишет каждому привязанному сотруднику', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [
      { telegramId: 111n },
      { telegramId: 222n },
    ])

    await service.notifyStaff('complaint', 'Новое обращение')

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

    await service.notifyStaff('complaint', 'Срочная жалоба', 'complaint_42')

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body.reply_markup).toBeUndefined()
  })

  it('с адресом мини-аппа кладёт кнопку, открывающую нужную карточку', async () => {
    const { service, fetchMock } = setup({
      TELEGRAM_BOT_TOKEN: 'tok',
      MINI_APP_URL: 'https://mini.example',
    })

    await service.notifyStaff('complaint', 'Срочная жалоба', 'complaint_42')

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

    await expect(service.notifyStaff('complaint', 'Срочная жалоба')).resolves.toBeUndefined()
  })

  it('не пробрасывает отказ Telegram (человек не начинал диалог с ботом)', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' })
    fetchMock.mockResolvedValue({ ok: false, status: 403 })

    await expect(service.notifyStaff('complaint', 'Срочная жалоба')).resolves.toBeUndefined()
  })
})

describe('isQuiet', () => {
  const at = (hour: number) => new Date(2026, 8, 21, hour, 0, 0)

  it('без настроек тишины нет', () => {
    expect(isQuiet(null, null, at(3))).toBe(false)
  })

  // Окно почти всегда задают через полночь — «с 22 до 8».
  it('понимает окно через полночь', () => {
    expect(isQuiet(22, 8, at(23))).toBe(true)
    expect(isQuiet(22, 8, at(3))).toBe(true)
    expect(isQuiet(22, 8, at(12))).toBe(false)
  })

  it('понимает обычное окно внутри суток', () => {
    expect(isQuiet(9, 18, at(12))).toBe(true)
    expect(isQuiet(9, 18, at(20))).toBe(false)
  })

  // Так уведомления выключают целиком, не стирая настройку.
  it('одинаковые границы — тишина круглые сутки', () => {
    expect(isQuiet(8, 8, at(15))).toBe(true)
  })
})

describe('TelegramNotifyService — политика уведомлений', () => {
  it('молчит в тихие часы', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [{ telegramId: 111n }], {
      quietFrom: 0,
      quietTo: 23,
    })

    await service.notifyStaff('complaint', 'Срочная жалоба', undefined, new Date(2026, 8, 21, 3))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('не шлёт выключенный вид уведомления', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [{ telegramId: 111n }], {
      muted: ['reply'],
    })

    await service.notifyStaff('reply', 'Ответ в обращении')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Сообщение всей команде означает, что не среагирует никто: каждый решит, что возьмёт другой.
  it('с дежурным пишет только ему', async () => {
    const { service, prisma } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [{ telegramId: 111n }], {
      dutyUserId: 'staff-7',
    })

    await service.notifyStaff('ticket', 'Новое обращение')

    expect(prisma.telegramAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'staff-7' }) }),
    )
  })

  // Настройки — не условие доступа: их недоступность не должна глушить уведомления.
  it('при отказе чтения настроек всё равно отправляет', async () => {
    const { service, fetchMock, platform } = setup({ TELEGRAM_BOT_TOKEN: 'tok' })
    platform.notificationPolicy.mockRejectedValue(new Error('db down'))

    await service.notifyStaff('complaint', 'Срочная жалоба')

    expect(fetchMock).toHaveBeenCalled()
  })
})

describe('TelegramNotifyService — эскалация', () => {
  it('не спрашивает политику и пишет администраторам', async () => {
    const { service, prisma, platform } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [
      { telegramId: 111n },
    ])

    await service.notifyStaff('ticket', 'Эскалация', undefined, new Date(), true)

    expect(platform.notificationPolicy).not.toHaveBeenCalled()
    const where = prisma.telegramAccount.findMany.mock.calls[0]?.[0]?.where as {
      user: { role: { in: string[] } }
    }
    expect(where.user.role.in).toEqual(['PLATFORM_ADMIN'])
  })

  // Тихие часы для эскалации не действуют — иначе ночная беда ждала бы до утра.
  it('доходит и в тихие часы', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [{ telegramId: 111n }], {
      quietFrom: 0,
      quietTo: 23,
    })

    await service.notifyStaff('ticket', 'Эскалация', undefined, new Date(2026, 8, 21, 3), true)

    expect(fetchMock).toHaveBeenCalled()
  })
})
