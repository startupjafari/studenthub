import { authenticator } from 'otplib'
import { TwoFactorService } from './two-factor.service'
import type { UserService, TwoFactorLoginRecord } from '../users/users.service'
import type { CryptoService } from '../../common/security/crypto.service'
import type { PasswordService } from '../../common/security/password.service'

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
  }
  const crypto = {
    encrypt: jest.fn((s: string) => `enc(${s})`),
    decrypt: jest.fn((s: string) => s.replace(/^enc\(/, '').replace(/\)$/, '')),
  }
  const passwords = {
    hash: jest.fn(async (s: string) => `hash:${s}`),
    compare: jest.fn(async (plain: string, hash: string) => hash === `hash:${plain}`),
  }
  const service = new TwoFactorService(
    users as unknown as UserService,
    crypto as unknown as CryptoService,
    passwords as unknown as PasswordService,
  )
  return { service, users, crypto, passwords }
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
    // Использованный код удаляется из набора.
    expect(users.setBackupCodes).toHaveBeenCalledWith('u1', ['hash:EEEE9999'])
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
})
