import { authenticator } from 'otplib'
import { TwoFactorService } from './two-factor.service'
import type { UserService, TwoFactorLoginRecord } from '../users/users.service'
import type { CryptoService } from '../../common/security/crypto.service'
import type { PasswordService } from '../../common/security/password.service'
import type { AuditService } from '../../common/audit/audit.service'

// Крипто мокаем «прозрачно»: encrypt(x)=enc(x), decrypt(enc(x))=x — секрет читается как есть.
function setup() {
  const users = {
    getTwoFactorState: jest.fn(),
    getTwoFactorForLogin: jest.fn(),
    findById: jest.fn().mockResolvedValue({ email: 'user@uni.io' }),
    setPendingTwoFactorSecret: jest.fn().mockResolvedValue(undefined),
    enableTwoFactor: jest.fn().mockResolvedValue(undefined),
    disableTwoFactor: jest.fn().mockResolvedValue(undefined),
    setBackupCodes: jest.fn().mockResolvedValue(undefined),
    consumeBackupCode: jest.fn().mockResolvedValue(true),
  }
  const crypto = {
    encrypt: jest.fn((s: string) => `enc(${s})`),
    decrypt: jest.fn((s: string) => s.replace(/^enc\(/, '').replace(/\)$/, '')),
  }
  const passwords = {
    hash: jest.fn(async (s: string) => `hash:${s}`),
    compare: jest.fn(async (plain: string, hash: string) => hash === `hash:${plain}`),
  }
  // Redis как Map: использованные шаги TOTP и счётчик неверных кодов.
  const store = new Map<string, string>()
  const redis = {
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1
      store.set(key, String(next))
      return next
    }),
    expire: jest.fn(async () => 1),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new TwoFactorService(
    users as unknown as UserService,
    crypto as unknown as CryptoService,
    passwords as unknown as PasswordService,
    redis as unknown as import('ioredis').default,
    audit as unknown as AuditService,
  )
  return { service, users, crypto, passwords, redis, store, audit }
}

function loginRecord(over: Partial<TwoFactorLoginRecord> = {}): TwoFactorLoginRecord {
  return {
    id: 'u1',
    role: 'STUDENT' as TwoFactorLoginRecord['role'],
    isBlocked: false,
    universityId: null,
    facultyId: null,
    groupId: null,
    twoFactorEnabled: true,
    twoFactorSecret: null,
    twoFactorBackupCodes: [],
    companyMembership: null,
    ...over,
  }
}

describe('TwoFactorService', () => {
  it('setup: генерит секрет, сохраняет зашифрованным (pending), отдаёт QR', async () => {
    const { service, users, crypto } = setup()
    users.getTwoFactorState.mockResolvedValue(null)
    const res = await service.setup('u1')
    expect(res.secret).toBeTruthy()
    expect(res.otpauthUrl).toContain('otpauth://totp/')
    expect(res.qr.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(crypto.encrypt).toHaveBeenCalledWith(res.secret)
    expect(users.setPendingTwoFactorSecret).toHaveBeenCalledWith('u1', `enc(${res.secret})`)
  })

  it('setup: повторный вызов отдаёт тот же секрет и не перезаписывает pending', async () => {
    // Иначе перезагрузка страницы настройки обесценивает уже отсканированный QR:
    // приложение считает коды от старого секрета, сервер ждёт от нового.
    const { service, users } = setup()
    const secret = authenticator.generateSecret()
    users.getTwoFactorState.mockResolvedValue({
      twoFactorEnabled: false,
      twoFactorSecret: `enc(${secret})`,
    })
    const res = await service.setup('u1')
    expect(res.secret).toBe(secret)
    expect(users.setPendingTwoFactorSecret).not.toHaveBeenCalled()
  })

  it('setup: нечитаемый pending-секрет → новый секрет, а не 500', async () => {
    const { service, users, crypto } = setup()
    crypto.decrypt.mockImplementation(() => {
      throw new Error('Некорректный формат шифртекста')
    })
    users.getTwoFactorState.mockResolvedValue({ twoFactorEnabled: false, twoFactorSecret: 'мусор' })
    const res = await service.setup('u1')
    expect(res.secret).toBeTruthy()
    expect(users.setPendingTwoFactorSecret).toHaveBeenCalledWith('u1', `enc(${res.secret})`)
  })

  it('setup: если 2FA уже включена → CONFLICT', async () => {
    const { service, users } = setup()
    users.getTwoFactorState.mockResolvedValue({ twoFactorEnabled: true, twoFactorSecret: 'x' })
    await expect(service.setup('u1')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('enable: верный TOTP → включает 2FA и отдаёт 10 backup-кодов', async () => {
    const { service, users } = setup()
    const secret = authenticator.generateSecret()
    users.getTwoFactorState.mockResolvedValue({
      twoFactorEnabled: false,
      twoFactorSecret: `enc(${secret})`,
    })
    const token = authenticator.generate(secret)
    const res = await service.enable('u1', token)
    expect(res.backupCodes).toHaveLength(10)
    expect(users.enableTwoFactor).toHaveBeenCalledWith(
      'u1',
      expect.arrayContaining([expect.stringMatching(/^hash:/)]),
    )
  })

  it('enable: неверный код → INVALID_2FA_CODE, 2FA не включается', async () => {
    const { service, users } = setup()
    users.getTwoFactorState.mockResolvedValue({
      twoFactorEnabled: false,
      twoFactorSecret: `enc(${authenticator.generateSecret()})`,
    })
    await expect(service.enable('u1', '000000')).rejects.toMatchObject({ code: 'INVALID_2FA_CODE' })
    expect(users.enableTwoFactor).not.toHaveBeenCalled()
  })

  it('enable: без предварительного setup → BAD_REQUEST', async () => {
    const { service, users } = setup()
    users.getTwoFactorState.mockResolvedValue({ twoFactorEnabled: false, twoFactorSecret: null })
    await expect(service.enable('u1', '123456')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('verifyCode: валидный TOTP → true', async () => {
    const { service } = setup()
    const secret = authenticator.generateSecret()
    const rec = loginRecord({ twoFactorSecret: `enc(${secret})` })
    expect(await service.verifyCode(rec, authenticator.generate(secret))).toBe(true)
  })

  it('verifyCode: валидный backup-код → true и «сжигается»', async () => {
    const { service, users } = setup()
    const rec = loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234', 'hash:EEEE9999'] })
    const ok = await service.verifyCode(rec, 'ABCD1234')
    expect(ok).toBe(true)
    // Использованный код сжигается условной записью — не перезаписью всего набора.
    expect(users.consumeBackupCode).toHaveBeenCalledWith('u1', 'hash:ABCD1234')
  })

  it('verifyCode: backup-код, уже сожжённый параллельным входом → false', async () => {
    const { service, users } = setup()
    users.consumeBackupCode.mockResolvedValue(false)
    const rec = loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] })
    expect(await service.verifyCode(rec, 'ABCD1234')).toBe(false)
  })

  it('verifyCode: тот же TOTP-код второй раз не принимается', async () => {
    const { service } = setup()
    const secret = authenticator.generateSecret()
    const rec = loginRecord({ twoFactorSecret: `enc(${secret})` })
    const token = authenticator.generate(secret)
    expect(await service.verifyCode(rec, token)).toBe(true)
    expect(await service.verifyCode(rec, token)).toBe(false)
  })

  it('verifyForUser: после пяти неверных кодов — RATE_LIMIT, даже с верным', async () => {
    const { service, users } = setup()
    const secret = authenticator.generateSecret()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({ twoFactorEnabled: true, twoFactorSecret: `enc(${secret})` }),
    )
    for (let i = 0; i < 5; i++) {
      await expect(service.verifyForUser('u1', '000000')).resolves.toBe(false)
    }
    await expect(service.verifyForUser('u1', authenticator.generate(secret))).rejects.toMatchObject(
      { code: 'RATE_LIMIT' },
    )
  })

  // BUG-077: попытка занимается до проверки — пачка одновременных запросов не видит пустой
  // счётчик, и кодов проверяется не больше порога.
  it('verifyForUser: параллельная пачка проверяет не больше пяти кодов', async () => {
    const { service, users, passwords } = setup()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] }),
    )

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => service.verifyForUser('u1', 'WRONGONE')),
    )

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
    expect(passwords.compare).toHaveBeenCalledTimes(5)
  })

  it('verifyForUser: верный код возвращает попытку — счётчик стирается', async () => {
    const { service, users, store } = setup()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] }),
    )
    await service.verifyForUser('u1', 'WRONGONE')

    await expect(service.verifyForUser('u1', 'ABCD1234')).resolves.toBe(true)
    expect(store.has('2fa:confirm-fails:u1')).toBe(false)
  })

  // BUG-347: обязательную 2FA привилегированная роль не снимает сама — даже верным кодом.
  it('disable: роли с обязательной 2FA — FORBIDDEN, 2FA остаётся', async () => {
    const { service, users } = setup()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({
        role: 'DEAN' as TwoFactorLoginRecord['role'],
        twoFactorBackupCodes: ['hash:ABCD1234'],
      }),
    )
    await expect(service.disable('u1', 'ABCD1234')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(users.disableTwoFactor).not.toHaveBeenCalled()
    expect(users.consumeBackupCode).not.toHaveBeenCalled()
  })

  it('verifyCode: неверный код → false', async () => {
    const { service } = setup()
    const rec = loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] })
    expect(await service.verifyCode(rec, 'WRONGONE')).toBe(false)
  })

  it('disable: неверный код → INVALID_2FA_CODE, 2FA не выключается', async () => {
    const { service, users } = setup()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({ twoFactorBackupCodes: ['hash:ZZZZ'] }),
    )
    await expect(service.disable('u1', '000000')).rejects.toMatchObject({
      code: 'INVALID_2FA_CODE',
    })
    expect(users.disableTwoFactor).not.toHaveBeenCalled()
  })

  it('regenerateBackupCodes: верный TOTP → новый набор из 10 кодов заменяет прежний', async () => {
    const { service, users } = setup()
    const secret = authenticator.generateSecret()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({ twoFactorSecret: `enc(${secret})`, twoFactorBackupCodes: ['hash:OLD00001'] }),
    )
    const res = await service.regenerateBackupCodes('u1', authenticator.generate(secret))
    expect(res.backupCodes).toHaveLength(10)
    expect(users.setBackupCodes).toHaveBeenCalledWith(
      'u1',
      res.backupCodes.map((c) => `hash:${c}`),
    )
  })

  it('regenerateBackupCodes: подходит и backup-код', async () => {
    const { service, users } = setup()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] }),
    )
    await expect(service.regenerateBackupCodes('u1', 'ABCD1234')).resolves.toMatchObject({
      backupCodes: expect.any(Array),
    })
    expect(users.setBackupCodes).toHaveBeenCalled()
  })

  it('regenerateBackupCodes: неверный код → INVALID_2FA_CODE, коды не меняются', async () => {
    const { service, users } = setup()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] }),
    )
    await expect(service.regenerateBackupCodes('u1', 'WRONGONE')).rejects.toMatchObject({
      code: 'INVALID_2FA_CODE',
    })
    expect(users.setBackupCodes).not.toHaveBeenCalled()
  })

  it('regenerateBackupCodes: 2FA не включена → BAD_REQUEST', async () => {
    const { service, users } = setup()
    users.getTwoFactorForLogin.mockResolvedValue(loginRecord({ twoFactorEnabled: false }))
    await expect(service.regenerateBackupCodes('u1', '123456')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })
})

// A-F12: по журналу должно быть видно, кто и когда менял второй фактор — это первое, что
// спрашивают при разборе угона учётки. Кодов и секрета в записи нет.
describe('TwoFactorService — аудит смены второго фактора', () => {
  const ctx = { ip: '203.0.113.5', userAgent: 'jest' }

  it('enable пишет 2fa_enabled с адресом, без кодов', async () => {
    const { service, users, audit } = setup()
    const secret = authenticator.generateSecret()
    users.getTwoFactorState.mockResolvedValue({
      twoFactorEnabled: false,
      twoFactorSecret: `enc(${secret})`,
    })
    const { backupCodes } = await service.enable('u1', authenticator.generate(secret), ctx)
    expect(audit.record).toHaveBeenCalledWith({
      userId: 'u1',
      action: '2fa_enabled',
      entity: 'User',
      entityId: 'u1',
      ...ctx,
    })
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(backupCodes[0])
  })

  it('disable пишет 2fa_disabled; неверный код — без записи', async () => {
    const { service, users, audit } = setup()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] }),
    )
    await expect(service.disable('u1', 'WRONGONE', ctx)).rejects.toMatchObject({
      code: 'INVALID_2FA_CODE',
    })
    expect(audit.record).not.toHaveBeenCalled()

    await service.disable('u1', 'ABCD1234', ctx)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', action: '2fa_disabled', ip: ctx.ip }),
    )
  })

  it('перевыпуск backup-кодов пишет 2fa_backup_codes_regenerated', async () => {
    const { service, users, audit } = setup()
    users.getTwoFactorForLogin.mockResolvedValue(
      loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] }),
    )
    await service.regenerateBackupCodes('u1', 'ABCD1234', ctx)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: '2fa_backup_codes_regenerated', entityId: 'u1' }),
    )
  })
})

describe('TwoFactorService.checkCode — проверка без списания', () => {
  it('верный backup-код не списывается, пока не вызвано списание', async () => {
    const { service, users } = setup()
    const rec = loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] })
    const consume = await service.checkCode(rec, 'ABCD1234')
    expect(consume).toEqual(expect.any(Function))
    expect(users.consumeBackupCode).not.toHaveBeenCalled()

    await expect(consume?.()).resolves.toBe(true)
    expect(users.consumeBackupCode).toHaveBeenCalledWith('u1', 'hash:ABCD1234')
  })

  it('неверный код → null', async () => {
    const { service } = setup()
    const rec = loginRecord({ twoFactorBackupCodes: ['hash:ABCD1234'] })
    expect(await service.checkCode(rec, 'WRONGONE')).toBeNull()
  })

  it('TOTP: шаг занимается сразу, повтор того же кода → null', async () => {
    const { service } = setup()
    const secret = authenticator.generateSecret()
    const rec = loginRecord({ twoFactorSecret: `enc(${secret})` })
    const token = authenticator.generate(secret)
    expect(await service.checkCode(rec, token)).toEqual(expect.any(Function))
    expect(await service.checkCode(rec, token)).toBeNull()
  })
})
