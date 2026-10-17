import { createHmac } from 'node:crypto'
import { Role } from '@studenthub/shared-types'
import { MiniService } from './mini.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtService } from '@nestjs/jwt'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type Redis from 'ioredis'
import type { TelegramNotifyService } from '../../common/telegram/telegram-notify.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const BOT_TOKEN = '123456:test-token'

/** Валидная строка initData: подпись считается тем же алгоритмом, что и в Telegram. */
function initData(telegramId = 555): string {
  const params: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: telegramId, first_name: 'Админ' }),
  }
  const check = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const hash = createHmac('sha256', secret).update(check).digest('hex')
  return new URLSearchParams({ ...params, hash }).toString()
}

function setup(twoFactorEnabled: boolean) {
  const prisma = {
    telegramAccount: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'acc-1',
        revokedAt: null,
        user: {
          id: 'admin-1',
          firstName: 'Админ',
          role: Role.PLATFORM_ADMIN,
          isBlocked: false,
          deletedAt: null,
          twoFactorEnabled,
        },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const signed: JwtPayload[] = []
  const jwt = {
    sign: jest.fn((payload: JwtPayload) => {
      signed.push(payload)
      return 'signed-token'
    }),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn(() => BOT_TOKEN) }
  const redis = { multi: jest.fn(), get: jest.fn(), del: jest.fn() }
  const telegram = { notifyOne: jest.fn().mockResolvedValue(undefined) }
  const service = new MiniService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<EnvVars, true>,
    redis as unknown as Redis,
    telegram as unknown as TelegramNotifyService,
  )
  return { service, signed, prisma }
}

describe('MiniService.session — признак 2FA в токене', () => {
  /**
   * Регрессия: без `tfa` глобальный TwoFactorGuard отдавал 403 на каждом рабочем запросе
   * мини-аппа. Сессия при этом выдавалась (маршрут публичный, пользователя в запросе ещё
   * нет), поэтому приложение выглядело живым, а очередь жалоб не открывалась никогда.
   */
  it('кладёт tfa в токен, когда у администратора включена 2FA', async () => {
    const { service, signed } = setup(true)

    await service.session(initData())

    expect(signed[0]).toMatchObject({ client: 'mini', role: Role.PLATFORM_ADMIN, tfa: true })
  })

  // Признак означает «2FA включена», и врать в нём нельзя: администратор без неё получит
  // тот же отказ, что и в вебе, — это задуманное поведение, а не поломка.
  it('не выдаёт tfa, если 2FA у администратора не включена', async () => {
    const { service, signed } = setup(false)

    await service.session(initData())

    expect(signed[0]).toMatchObject({ tfa: false })
  })
})

describe('MiniService.session — кому сессия не выдаётся', () => {
  function withUser(patch: Record<string, unknown>) {
    const ctx = setup(true)
    ctx.prisma.telegramAccount.findUnique.mockResolvedValue({
      id: 'acc-1',
      revokedAt: null,
      user: {
        id: 'admin-1',
        firstName: 'Удалённый',
        role: Role.PLATFORM_ADMIN,
        isBlocked: false,
        deletedAt: null,
        twoFactorEnabled: true,
        ...patch,
      },
    })
    return ctx
  }

  /**
   * Удаление снимает привязку само, но роль удалённому сохраняется: забытая привязка
   * выдавала бы ему рабочий токен при выключенном форсе 2FA. Отказ — тот же 401.
   */
  it('удалённому аккаунту — отказ, токен не подписывается', async () => {
    const { service, signed, prisma } = withUser({ deletedAt: new Date('2026-10-01') })

    await expect(service.session(initData())).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(signed).toHaveLength(0)
    expect(prisma.telegramAccount.update).not.toHaveBeenCalled()
  })

  it('заблокированному — отказ', async () => {
    const { service, signed } = withUser({ isBlocked: true })

    await expect(service.session(initData())).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(signed).toHaveLength(0)
  })
})

describe('MiniService — отзыв привязки', () => {
  function revokeSetup(existing: boolean) {
    const prisma = {
      telegramAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: existing ? 1 : 0 }),
        findUnique: jest.fn(),
      },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const telegram = { notifyOne: jest.fn().mockResolvedValue(undefined) }
    const service = new MiniService(
      prisma as unknown as PrismaService,
      { sign: jest.fn() } as unknown as JwtService,
      audit as unknown as AuditService,
      { get: jest.fn(() => BOT_TOKEN) } as unknown as ConfigService<EnvVars, true>,
      {} as unknown as Redis,
      telegram as unknown as TelegramNotifyService,
    )
    return { service, prisma, audit }
  }

  /**
   * Единственный способ отобрать доступ у потерянного телефона: токен мини-аппа живёт
   * в памяти 15 минут и сам не отзывается, а следующая сессия по отозванной привязке
   * уже не выдаётся.
   */
  it('проставляет отметку отзыва и пишет в журнал', async () => {
    const { service, prisma, audit } = revokeSetup(true)

    await expect(service.revoke('admin-1')).resolves.toEqual({ revoked: true })

    expect(prisma.telegramAccount.updateMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mini.link.revoke' }),
    )
  })

  // Строка остаётся с `revokedAt`, а не удаляется: перепривязка должна быть осознанной,
  // и история «этот Telegram здесь уже был» для этого нужна.
  it('не удаляет запись', async () => {
    const { service, prisma } = revokeSetup(true)

    await service.revoke('admin-1')

    expect(prisma.telegramAccount).not.toHaveProperty('delete')
  })

  it('без привязки отвечает «нечего отзывать» и не шумит в журнале', async () => {
    const { service, audit } = revokeSetup(false)

    await expect(service.revoke('admin-1')).resolves.toEqual({ revoked: false })
    expect(audit.record).not.toHaveBeenCalled()
  })
})

// A-F23: telegramId уникален, и отозванная чужая привязка держала его навсегда — другой
// админ получал 409 «запись уже существует», а одноразовый код при этом сгорал.
describe('MiniService.link — перепривязка Telegram после отзыва', () => {
  function linkSetup(existing: Record<string, unknown> | null) {
    const tx = {
      telegramAccount: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    }
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-b',
          firstName: 'Бэ',
          role: Role.PLATFORM_ADMIN,
          isBlocked: false,
          deletedAt: null,
          twoFactorEnabled: true,
        }),
      },
      telegramAccount: { findUnique: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    }
    // Код привязки читается и гасится одной MULTI: GET → владелец кода, DEL → 1.
    const multi: { get: jest.Mock; del: jest.Mock; exec: jest.Mock } = {
      get: jest.fn(() => multi),
      del: jest.fn(() => multi),
      exec: jest.fn().mockResolvedValue([
        [null, 'admin-b'],
        [null, 1],
      ]),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const service = new MiniService(
      prisma as unknown as PrismaService,
      { sign: jest.fn(() => 'signed-token') } as unknown as JwtService,
      audit as unknown as AuditService,
      { get: jest.fn(() => BOT_TOKEN) } as unknown as ConfigService<EnvVars, true>,
      { multi: jest.fn(() => multi) } as unknown as Redis,
      { notifyOne: jest.fn().mockResolvedValue(undefined) } as unknown as TelegramNotifyService,
    )
    return { service, tx, audit }
  }

  const foreign = (patch: Record<string, unknown>) => ({
    id: 'acc-a',
    userId: 'admin-a',
    revokedAt: null,
    user: { deletedAt: null },
    ...patch,
  })

  it('отозванная чужая привязка уступает место новому владельцу', async () => {
    const { service, tx, audit } = linkSetup(foreign({ revokedAt: new Date('2026-10-01') }))

    await expect(service.link(initData(), 'CODE2345')).resolves.toMatchObject({
      token: 'signed-token',
    })

    expect(tx.telegramAccount.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'acc-a', userId: 'admin-a' }),
    })
    expect(tx.telegramAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'admin-b' } }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'telegram.linked',
        metadata: { source: 'telegram', replacedUserId: 'admin-a' },
      }),
    )
  })

  it('привязка удалённого аккаунта тоже уступает место', async () => {
    const { service, tx } = linkSetup(foreign({ user: { deletedAt: new Date('2026-10-01') } }))

    await service.link(initData(), 'CODE2345')

    expect(tx.telegramAccount.deleteMany).toHaveBeenCalled()
  })

  it('действующая чужая привязка — по-прежнему 409, ничего не трогаем', async () => {
    const { service, tx } = linkSetup(foreign({}))

    await expect(service.link(initData(), 'CODE2345')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(tx.telegramAccount.deleteMany).not.toHaveBeenCalled()
    expect(tx.telegramAccount.upsert).not.toHaveBeenCalled()
  })

  it('свою отозванную привязку перепривязывает без удаления строк', async () => {
    const { service, tx } = linkSetup(
      foreign({ userId: 'admin-b', revokedAt: new Date('2026-10-01') }),
    )

    await service.link(initData(), 'CODE2345')

    expect(tx.telegramAccount.deleteMany).not.toHaveBeenCalled()
    expect(tx.telegramAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ revokedAt: null }) }),
    )
  })
})
