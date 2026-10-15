import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import type { EnvVars } from '../../config/env.schema'
import { parseDurationMs } from '../../modules/auth/auth.constants'
import { REDIS_CLIENT } from './redis.constants'

const KEY_PREFIX = 'auth:revoked-before:'
// Запас к сроку access-токена: метка должна пережить последний выданный до неё токен.
const TTL_MARGIN_SEC = 60
// Проверка стоит на каждом запросе: подвисший Redis не должен превращать её в задержку
// всего API (commandTimeout клиента — 3 с), поэтому ждём недолго и пропускаем.
const CHECK_TIMEOUT_MS = 150

/**
 * Отзыв уже выданных access-токенов пользователя.
 *
 * Погасить refresh-цепочки мало: access-токен живёт до 15 минут, и заблокированный,
 * удалённый или сменивший пароль пользователь всё это время ходил в API и заново
 * подключал WS тем же токеном. Здесь хранится момент отзыва; токен, выпущенный раньше
 * (`iat` меньше метки), не принимают ни HTTP, ни WS. Метка живёт срок access-токена —
 * дольше незачем, к тому времени все старые токены истекли сами.
 *
 * При недоступном Redis проверка пропускает (fail-open): иначе сбой кэша положил бы
 * вход для всех. Отзыв в этом случае деградирует к прежнему поведению — до истечения токена.
 */
@Injectable()
export class SessionRevocationService {
  private readonly logger = new Logger(SessionRevocationService.name)
  private readonly ttlSec: number

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<EnvVars, true>,
  ) {
    const accessMs = parseDurationMs(config.get('JWT_ACCESS_EXPIRES_IN', { infer: true }))
    this.ttlSec = Math.ceil(accessMs / 1000) + TTL_MARGIN_SEC
  }

  /** Все access-токены пользователя, выданные до этого момента, перестают действовать. */
  async revokeIssuedBefore(userId: string, at: Date = new Date()): Promise<void> {
    const sec = Math.floor(at.getTime() / 1000)
    try {
      await this.redis.set(KEY_PREFIX + userId, String(sec), 'EX', this.ttlSec)
    } catch (e) {
      this.logger.warn(`Метка отзыва не записана user=${userId}: ${String(e)}`)
    }
  }

  /** Отозван ли токен с этим `iat` (секунды). Без `iat` токен считаем старым только при метке. */
  async isRevoked(userId: string, iat: number | undefined): Promise<boolean> {
    let raw: string | null
    let timer: NodeJS.Timeout | undefined
    try {
      raw = await Promise.race([
        this.redis.get(KEY_PREFIX + userId),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), CHECK_TIMEOUT_MS)
        }),
      ])
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
    if (raw === null) return false
    return (iat ?? 0) < Number(raw)
  }
}
