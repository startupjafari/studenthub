import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from './redis.constants'

// Снимаем лок только если он всё ещё наш: за время работы задачи TTL мог истечь, лок мог
// перейти другому инстансу, и слепой DEL погасил бы чужую задачу.
const RELEASE_IF_MINE = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`

const KEY_PREFIX = 'cron:lock:'

/**
 * Взаимное исключение cron-задач между инстансами API (docs/BACKEND_RULES.md §9.3).
 *
 * `@Cron` живёт в каждом процессе, поэтому при нескольких инстансах одна и та же задача
 * стартует одновременно везде: удаления пойдут по одним и тем же записям, а `cleanOrphanFiles`
 * может удалить объект, для которого другой инстанс в этот момент ещё только создаёт `File`.
 *
 * Лок берётся через `SET NX PX` — атомарно, без гонки между «проверить» и «занять». TTL —
 * страховка от инстанса, умершего с локом в руках: он не держит задачу навсегда.
 */
@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name)

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Выполняет задачу, если удалось взять лок `name`. Если лок занят — возвращает `null`:
   * задача уже идёт на другом инстансе, это норма, а не ошибка.
   *
   * При недоступном Redis задача **выполняется** (fail-open). Молча переставшая работать
   * чистка хуже двойного прогона: задачи идемпотентны (удаление по собранным id, перевод
   * статуса), а копящиеся годами уведомления и осиротевшие объекты — нет.
   *
   * @param ttlMs страховочный TTL: с запасом больше ожидаемого времени работы задачи,
   *              но меньше интервала между её запусками.
   */
  async run<T>(name: string, ttlMs: number, task: () => Promise<T>): Promise<T | null> {
    const key = `${KEY_PREFIX}${name}`
    const token = randomUUID()

    let acquired: boolean
    try {
      acquired = (await this.redis.set(key, token, 'PX', ttlMs, 'NX')) === 'OK'
    } catch (error) {
      this.logger.warn(`Redis недоступен, ${name} идёт без лока: ${(error as Error).message}`)
      return task()
    }

    if (!acquired) {
      this.logger.log(`${name} пропущена — задача уже идёт на другом инстансе`)
      return null
    }

    try {
      return await task()
    } finally {
      await this.release(key, token)
    }
  }

  /** Снятие лока не должно ломать результат задачи — она уже отработала. */
  private async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_IF_MINE, 1, key, token)
    } catch (error) {
      this.logger.warn(`Не удалось снять лок ${key}: ${(error as Error).message}`)
    }
  }
}
