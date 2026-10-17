import { Logger } from '@nestjs/common'
import { TelegramNotifyService, isQuiet, platformHour } from './telegram-notify.service'
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
    // Ротацию дежурства уведомления не трогают — заглушка нужна лишь для полноты токена.
    rotateDuty: jest.fn().mockResolvedValue(null),
    duty: jest.fn(async () => ({ dutyUserId: null, rotation: [] })),
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

describe('platformHour', () => {
  // Процесс API живёт в UTC, команда — в Алматы (UTC+5).
  it('считает час по поясу платформы, а не сервера', () => {
    expect(platformHour(new Date('2026-09-21T17:00:00Z'))).toBe(22)
    expect(platformHour(new Date('2026-09-21T04:05:00Z'))).toBe(9)
  })

  it('полночь — это 0, а не 24', () => {
    expect(platformHour(new Date('2026-09-21T19:00:00Z'))).toBe(0)
  })

  it('пояс можно задать явно', () => {
    expect(platformHour(new Date('2026-09-21T17:00:00Z'), 'UTC')).toBe(17)
  })
})

describe('isQuiet', () => {
  // Момент по часам команды: «23 часа» — это 23:00 в Алматы, где бы ни работал сервер.
  const at = (hour: number) => new Date(`2026-09-21T${String(hour).padStart(2, '0')}:00:00+05:00`)

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

  // По UTC «тишина 22–8» глушила с 03:00 до 13:00 по Алматы: будила ночью, молчала утром.
  it('тишина 22–8 — это ночь по Алматы, а не по UTC', () => {
    expect(isQuiet(22, 8, new Date('2026-09-21T20:00:00Z'))).toBe(true) // 01:00 в Алматы
    expect(isQuiet(22, 8, new Date('2026-09-21T05:00:00Z'))).toBe(false) // 10:00 в Алматы
  })
})

describe('TelegramNotifyService — политика уведомлений', () => {
  it('молчит в тихие часы', async () => {
    const { service, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [{ telegramId: 111n }], {
      quietFrom: 0,
      quietTo: 23,
    })

    await service.notifyStaff(
      'complaint',
      'Срочная жалоба',
      undefined,
      new Date('2026-09-21T03:00:00+05:00'),
    )

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

  // Дежурный отвязал Telegram, заблокирован или удалён: «только дежурному» без запасного
  // адресата означало бы «никому», и жалоба терялась бы молча.
  it('если дежурному не дойти — пишет всей команде и предупреждает в логе', async () => {
    const { service, prisma, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [], {
      dutyUserId: 'staff-7',
    })
    prisma.telegramAccount.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ telegramId: 222n }, { telegramId: 333n }])
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await service.notifyStaff('complaint', 'Срочная жалоба')

    expect(prisma.telegramAccount.findMany).toHaveBeenCalledTimes(2)
    const fallback = prisma.telegramAccount.findMany.mock.calls[1]?.[0] as {
      where: Record<string, unknown>
    }
    expect(fallback.where).not.toHaveProperty('userId')
    expect(fallback.where).toMatchObject({
      revokedAt: null,
      user: { isBlocked: false, deletedAt: null },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('staff-7'))
    warn.mockRestore()
  })

  it('дежурный доступен — команду не трогает', async () => {
    const { service, prisma, fetchMock } = setup({ TELEGRAM_BOT_TOKEN: 'tok' }, [], {
      dutyUserId: 'staff-7',
    })
    prisma.telegramAccount.findMany.mockResolvedValueOnce([{ telegramId: 111n }])

    await service.notifyStaff('complaint', 'Срочная жалоба')

    expect(prisma.telegramAccount.findMany).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // Роль удалённому сохраняется — без условия по deletedAt привязка, пережившая удаление,
  // получала бы уведомления о жалобах и обращениях.
  it('удалённым и заблокированным не пишет', async () => {
    const { service, prisma } = setup({ TELEGRAM_BOT_TOKEN: 'tok' })

    await service.notifyStaff('complaint', 'Срочная жалоба')
    await service.notifyStaff('ticket', 'Эскалация', undefined, new Date(), true)

    for (const [args] of prisma.telegramAccount.findMany.mock.calls) {
      expect(args).toMatchObject({
        where: { revokedAt: null, user: { isBlocked: false, deletedAt: null } },
      })
    }
    expect(prisma.telegramAccount.findMany).toHaveBeenCalledTimes(2)
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
