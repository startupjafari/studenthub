import { forwardRef, Inject, Injectable } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type Redis from 'ioredis'
import { authenticator } from 'otplib'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { renderQrDataUrl } from '../../common/qr/qr-image'
import { AppException } from '../../common/exceptions/app.exception'
import { CryptoService } from '../../common/security/crypto.service'
import { PasswordService } from '../../common/security/password.service'
import { UserService, type TwoFactorLoginRecord } from '../users/users.service'

const ISSUER = 'StudentHub'
const BACKUP_CODES_COUNT = 10
const TOTP_STEP_SEC = 30
// Использованный шаг помним дольше окна проверки (±1 шаг): повтор кода внутри окна отсекается.
const USED_STEP_TTL_SEC = 4 * TOTP_STEP_SEC
// Подтверждение действия и отключение 2FA: столько неверных кодов за окно — и проверка
// закрыта до конца окна. У входа свой счётчик (три попытки на challenge).
const CONFIRM_MAX_FAILS = 5
const CONFIRM_FAIL_WINDOW_SEC = 15 * 60

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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
    const { backupCodes, hashes } = await this.newBackupCodes()
    await this.users.enableTwoFactor(userId, hashes)
    return { backupCodes }
  }

  /**
   * Перевыпустить backup-коды (нужен действующий TOTP или backup-код). Коды показываются
   * один раз при включении, и тот, кто их не сохранил или истратил, до этого мог получить
   * новые только отключив и заново настроив 2FA. Прежний набор заменяется целиком: старые
   * коды, где бы они ни были записаны, больше не действуют.
   */
  async regenerateBackupCodes(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const rec = await this.users.getTwoFactorForLogin(userId)
    if (!rec?.twoFactorEnabled) {
      throw new AppException('BAD_REQUEST', 'Двухфакторная аутентификация не включена')
    }
    const ok = await this.verifyWithLimit(userId, () => this.verifyCode(rec, code))
    if (!ok) {
      throw new AppException('INVALID_2FA_CODE', 'Неверный код')
    }
    const { backupCodes, hashes } = await this.newBackupCodes()
    await this.users.setBackupCodes(userId, hashes)
    return { backupCodes }
  }

  // Новый набор backup-кодов: открытые — показать человеку один раз, хэши — в базу.
  private async newBackupCodes(): Promise<{ backupCodes: string[]; hashes: string[] }> {
    const backupCodes = Array.from({ length: BACKUP_CODES_COUNT }, () => this.generateBackupCode())
    const hashes = await Promise.all(backupCodes.map((c) => this.passwords.hash(c)))
    return { backupCodes, hashes }
  }

  /** Отключить 2FA (требует действующий TOTP или backup-код). */
  async disable(userId: string, code: string): Promise<void> {
    const rec = await this.users.getTwoFactorForLogin(userId)
    if (!rec?.twoFactorEnabled) {
      throw new AppException('BAD_REQUEST', 'Двухфакторная аутентификация не включена')
    }
    const ok = await this.verifyWithLimit(userId, () => this.verifyCode(rec, code))
    if (!ok) {
      throw new AppException('INVALID_2FA_CODE', 'Неверный код')
    }
    await this.users.disableTwoFactor(userId)
  }

  /**
   * Подтверждение отдельного действия вторым фактором — не входа, а операции, которую
   * нельзя совершить одним промахом по экрану (остановка платформы, блокировка человека).
   *
   * Если 2FA у человека не включена, ответ — «нет», а не «можно»: привилегированным ролям
   * она обязательна (TwoFactorGuard), и попасть сюда без неё значит, что что-то не так.
   */
  async verifyForUser(userId: string, code: string): Promise<boolean> {
    const rec = await this.users.getTwoFactorForLogin(userId)
    if (!rec?.twoFactorEnabled) return false
    return this.verifyWithLimit(userId, () => this.verifyCode(rec, code))
  }

  /**
   * Счётчик неверных кодов на пользователя. Без него подтверждение действия и отключение
   * 2FA перебирались под общим лимитом 100 запросов в минуту — миллион кодов за пару недель
   * с одной сессии. Redis недоступен — проверяем без счётчика: запереть админов из-за сбоя
   * кэша хуже.
   */
  private async verifyWithLimit(userId: string, check: () => Promise<boolean>): Promise<boolean> {
    const key = `2fa:confirm-fails:${userId}`
    const fails = Number((await this.redis.get(key).catch(() => null)) ?? 0)
    if (fails >= CONFIRM_MAX_FAILS) {
      throw new AppException('RATE_LIMIT', 'Слишком много неверных кодов — попробуйте позже')
    }
    const ok = await check()
    if (ok) {
      await this.redis.del(key).catch(() => undefined)
    } else {
      await this.redis
        .multi()
        .incr(key)
        .expire(key, CONFIRM_FAIL_WINDOW_SEC)
        .exec()
        .catch(() => undefined)
    }
    return ok
  }

  /**
   * Проверка кода на втором шаге входа / при отключении. 6 цифр → TOTP; иначе backup-код
   * (сверяем с bcrypt-хэшами и «сжигаем» использованный). Возвращает true при успехе.
   */
  async verifyCode(rec: TwoFactorLoginRecord, code: string): Promise<boolean> {
    if (/^\d{6}$/.test(code)) {
      if (!rec.twoFactorSecret) return false
      const secret = this.crypto.decrypt(rec.twoFactorSecret)
      const delta = authenticator.checkDelta(code, secret)
      if (delta === null) return false
      return this.claimStep(rec.id, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC) + delta)
    }
    // Backup-код: ищем совпадающий хэш и сжигаем его условной записью — из двух
    // одновременных входов с одним кодом пройдёт один.
    for (const hash of rec.twoFactorBackupCodes) {
      if (await this.passwords.compare(code, hash)) {
        return this.users.consumeBackupCode(rec.id, hash)
      }
    }
    return false
  }

  /**
   * TOTP-код одноразовый: шаг, которым уже вошли или подтвердили действие, второй раз не
   * принимается. Иначе подсмотренный код (плечо, запись экрана) ещё ~90 секунд годился для
   * нового входа, отключения 2FA или подтверждения опасного действия. `SET NX` атомарен —
   * из двух одновременных запросов с одним кодом пройдёт один. При недоступном Redis
   * пропускаем (как было до проверки), чтобы сбой кэша не запирал вход.
   */
  private async claimStep(userId: string, step: number): Promise<boolean> {
    try {
      const res = await this.redis.set(
        `2fa:used-step:${userId}:${step}`,
        '1',
        'EX',
        USED_STEP_TTL_SEC,
        'NX',
      )
      return res === 'OK'
    } catch {
      return true
    }
  }

  // 8 hex-символов в верхнем регистре (например 3F9A2B7C). Показывается пользователю один раз.
  private generateBackupCode(): string {
    return randomBytes(4).toString('hex').toUpperCase()
  }
}
