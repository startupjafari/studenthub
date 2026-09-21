import { createHmac } from 'node:crypto'
import { Role } from '@studenthub/shared-types'
import { MiniService } from './mini.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtService } from '@nestjs/jwt'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type Redis from 'ioredis'
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
  const service = new MiniService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<EnvVars, true>,
    redis as unknown as Redis,
  )
  return { service, signed }
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
