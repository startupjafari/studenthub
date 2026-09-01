import { forwardRef, Inject, Injectable } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { authenticator } from 'otplib'
import { renderQrDataUrl } from '../../common/qr/qr-image'
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

  /**
   * Шаг 1: отдать секрет + QR (otpauth). Секрет генерится ОДИН раз и переиспользуется,
   * пока 2FA не подтверждена.
   *
   * Почему не новый секрет на каждый вызов: экран настройки легко открыть повторно —
   * перезагрузка страницы (состояние шага живёт в useState), вторая вкладка, возврат к
   * «Настроить» после неверного кода. Каждый новый секрет молча обесценивал уже
   * отсканированный QR: приложение-аутентификатор показывает коды от старого секрета,
   * сервер ждёт от нового — пользователь получает бесконечный INVALID_2FA_CODE и не может
   * понять, почему «правильный» код не подходит. Pending-секрет не даёт доступа, пока 2FA
   * не включена, так что переиспользовать его безопасно.
   */
  async setup(userId: string): Promise<TwoFactorSetup> {
    const state = await this.users.getTwoFactorState(userId)
    if (state?.twoFactorEnabled) {
      throw new AppException('CONFLICT', 'Двухфакторная аутентификация уже включена')
    }
    const user = await this.users.findById(userId)
    const pending = state?.twoFactorSecret ? this.decryptPending(state.twoFactorSecret) : null
    const secret = pending ?? authenticator.generateSecret()
    const otpauthUrl = authenticator.keyuri(user.email, ISSUER, secret)
    const qr = renderQrDataUrl(otpauthUrl)
    // Сохраняем только новый секрет: у переиспользованного в БД уже лежит тот же шифртекст.
    if (!pending) {
      await this.users.setPendingTwoFactorSecret(userId, this.crypto.encrypt(secret))
    }
    return { secret, otpauthUrl, qr }
  }

  // Расшифровать pending-секрет. Нечитаемый (сменили TOTP_ENCRYPTION_KEY, битая запись)
  // не должен ронять настройку 500-й: он всё равно никому не пригодится — начинаем заново.
  private decryptPending(encrypted: string): string | null {
    try {
      return this.crypto.decrypt(encrypted)
    } catch {
      return null
    }
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
