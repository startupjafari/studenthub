import { forwardRef, Inject, Injectable } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { authenticator } from 'otplib'
import * as QRCode from 'qrcode'
import { AppException } from '../../common/exceptions/app.exception'
import { CryptoService } from '../../common/security/crypto.service'
import { PasswordService } from '../../common/security/password.service'
import { UserService, type TwoFactorLoginRecord } from '../users/users.service'

const ISSUER = 'StudentHub'
const BACKUP_CODES_COUNT = 10

export interface TwoFactorSetup {
  secret: string
  otpauthUrl: string
  qr: string
}

// TOTP-2FA: настройка (секрет+QR), подтверждение, отключение и проверка кода
// (TOTP или backup). Секрет хранится зашифрованным (CryptoService), backup-коды — bcrypt.
@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(forwardRef(() => UserService)) private readonly users: UserService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
  ) {
    // Допускаем расхождение часов на ±1 шаг (30 с) — стандартная практика.
    authenticator.options = { window: 1 }
  }

  /** Шаг 1: сгенерировать секрет, сохранить зашифрованным (pending), отдать QR + otpauth. */
  async setup(userId: string): Promise<TwoFactorSetup> {
    const state = await this.users.getTwoFactorState(userId)
    if (state?.twoFactorEnabled) {
      throw new AppException('CONFLICT', 'Двухфакторная аутентификация уже включена')
    }
    const user = await this.users.findById(userId)
    const secret = authenticator.generateSecret()
    const otpauthUrl = authenticator.keyuri(user.email, ISSUER, secret)
    const qr = await QRCode.toDataURL(otpauthUrl)
    await this.users.setPendingTwoFactorSecret(userId, this.crypto.encrypt(secret))
    return { secret, otpauthUrl, qr }
  }

  /** Шаг 2: подтвердить кодом → включить 2FA и выдать backup-коды (показываются один раз). */
  async enable(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const state = await this.users.getTwoFactorState(userId)
    if (!state?.twoFactorSecret) {
      throw new AppException('BAD_REQUEST', 'Сначала запустите настройку 2FA')
    }
    if (state.twoFactorEnabled) {
      throw new AppException('CONFLICT', 'Двухфакторная аутентификация уже включена')
    }
    const secret = this.crypto.decrypt(state.twoFactorSecret)
    if (!authenticator.verify({ token: code, secret })) {
      throw new AppException('INVALID_2FA_CODE', 'Неверный код')
    }
    const backupCodes = Array.from({ length: BACKUP_CODES_COUNT }, () => this.generateBackupCode())
    const hashes = await Promise.all(backupCodes.map((c) => this.passwords.hash(c)))
    await this.users.enableTwoFactor(userId, hashes)
    return { backupCodes }
  }

  /** Отключить 2FA (требует действующий TOTP или backup-код). */
  async disable(userId: string, code: string): Promise<void> {
    const rec = await this.users.getTwoFactorForLogin(userId)
    if (!rec?.twoFactorEnabled) {
      throw new AppException('BAD_REQUEST', 'Двухфакторная аутентификация не включена')
    }
    const ok = await this.verifyCode(rec, code)
    if (!ok) {
      throw new AppException('INVALID_2FA_CODE', 'Неверный код')
    }
    await this.users.disableTwoFactor(userId)
  }

  /**
   * Проверка кода на втором шаге входа / при отключении. 6 цифр → TOTP; иначе backup-код
   * (сверяем с bcrypt-хэшами и «сжигаем» использованный). Возвращает true при успехе.
   */
  async verifyCode(rec: TwoFactorLoginRecord, code: string): Promise<boolean> {
    if (/^\d{6}$/.test(code)) {
      if (!rec.twoFactorSecret) return false
      const secret = this.crypto.decrypt(rec.twoFactorSecret)
      return authenticator.verify({ token: code, secret })
    }
    // Backup-код: ищем совпадающий хэш; при успехе удаляем его из набора (одноразовость).
    for (const hash of rec.twoFactorBackupCodes) {
      if (await this.passwords.compare(code, hash)) {
        const remaining = rec.twoFactorBackupCodes.filter((h) => h !== hash)
        await this.users.setBackupCodes(rec.id, remaining)
        return true
      }
    }
    return false
  }

  // 8 hex-символов в верхнем регистре (например 3F9A2B7C). Показывается пользователю один раз.
  private generateBackupCode(): string {
    return randomBytes(4).toString('hex').toUpperCase()
  }
}
