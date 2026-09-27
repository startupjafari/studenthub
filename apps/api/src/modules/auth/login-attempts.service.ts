import { Inject, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { AppException } from '../../common/exceptions/app.exception'

/**
 * Счётчик неудачных входов ПО УЧЁТНОЙ ЗАПИСИ.
 *
 * Зачем отдельно от throttler'а. Лимит на `/auth/login` (5 попыток за 15 минут) считается
 * по IP-адресу. Это защищает от перебора «с одного адреса по всем аккаунтам», но ничего не
 * говорит про обратное — перебор ОДНОГО аккаунта с тысячи адресов. Для закрытой платформы
 * это не теоретический сценарий: список логинов у вуза предсказуем (почта вида
 * `фамилия@вуз`), а пять попыток с адреса при ротации адресов не ограничивают ничего.
 *
 * Считаем по идентификатору из формы, а не по найденному пользователю. Так порог работает
 * и для несуществующих логинов, а главное — ответ не зависит от того, есть такой аккаунт
 * или нет: иначе разное поведение («заблокировано» против «неверный пароль») само по себе
 * отвечало бы на вопрос, какие логины на платформе заведены.
 *
 * В Redis уходит хэш идентификатора, а не сам идентификатор: в кэше незачем держать
 * список почт, а для счётчика достаточно, чтобы ключ был стабильным.
 *
 * Блокировка нарастает: разовая опечатка серии не создаёт, а упорный перебор с каждым
 * разом ждёт дольше. Полностью запирать аккаунт нельзя — это превращается в отказ в
 * обслуживании, который любой желающий устраивает чужой учётке десятком неверных паролей.
 *
 * Redis недоступен — пропускаем проверку с предупреждением. Вход не должен зависеть от
 * кэша, а лимит по адресу в это время продолжает работать (rate limit при сбое Redis
 * считается в памяти процесса, см. ResilientThrottlerStorage).
 */

/** Окно, за которое копятся неудачи. */
const FAIL_WINDOW_SECONDS = 15 * 60
/** Сколько неудач подряд в окне включают блокировку. */
const FAIL_THRESHOLD = 10
/** Длительность блокировки по счёту срабатываний подряд: 5 мин → 15 мин → час. */
const LOCK_STEPS_SECONDS = [5 * 60, 15 * 60, 60 * 60]
/** Сколько помнить, что аккаунт уже блокировали (для нарастания). */
const LOCK_COUNT_TTL_SECONDS = 24 * 60 * 60

@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger(LoginAttemptsService.name)

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Бросает `LOGIN_LOCKED`, если по этому идентификатору вход сейчас закрыт.
   * Вызывается ДО сверки пароля: верный пароль в окне блокировки сессию не выдаёт,
   * иначе блокировка не мешала бы тому, кто пароль уже подобрал.
   */
  async assertNotLocked(identifier: string): Promise<void> {
    const ttl = await this.safe(() => this.redis.ttl(this.lockKey(identifier)), -2)
    if (ttl <= 0) return
    throw new AppException(
      'LOGIN_LOCKED',
      `Слишком много неудачных попыток входа. Повторите через ${describeWait(ttl)}`,
    )
  }

  /**
   * Учесть неудачную попытку. По достижении порога ставит блокировку и обнуляет счётчик,
   * чтобы следующая серия считалась заново.
   */
  async registerFailure(identifier: string): Promise<void> {
    const failKey = this.failKey(identifier)
    const failures = await this.safe(async () => {
      const count = await this.redis.incr(failKey)
      // EXPIRE только на первой неудаче: иначе окно продлевалось бы каждой попыткой и
      // счётчик не сбрасывался бы никогда — достаточно стучаться раз в 14 минут.
      if (count === 1) await this.redis.expire(failKey, FAIL_WINDOW_SECONDS)
      return count
    }, 0)

    if (failures < FAIL_THRESHOLD) return

    await this.safe(async () => {
      const lockCount = await this.redis.incr(this.lockCountKey(identifier))
      await this.redis.expire(this.lockCountKey(identifier), LOCK_COUNT_TTL_SECONDS)
      const seconds = LOCK_STEPS_SECONDS[Math.min(lockCount, LOCK_STEPS_SECONDS.length) - 1]
      await this.redis.set(this.lockKey(identifier), '1', 'EX', seconds)
      await this.redis.del(failKey)
      this.logger.warn(
        `Вход временно закрыт после ${failures} неудачных попыток (блокировка №${lockCount}, ${seconds} с)`,
      )
      return null
    }, null)
  }

  /** Успешный вход — счётчик неудач сбрасывается. Историю блокировок не трогаем. */
  async reset(identifier: string): Promise<void> {
    await this.safe(() => this.redis.del(this.failKey(identifier)), 0)
  }

  // --- приватные ---

  private hash(identifier: string): string {
    return createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex').slice(0, 32)
  }

  private failKey(identifier: string): string {
    return `login:fail:${this.hash(identifier)}`
  }

  private lockKey(identifier: string): string {
    return `login:lock:${this.hash(identifier)}`
  }

  private lockCountKey(identifier: string): string {
    return `login:locks:${this.hash(identifier)}`
  }

  /** Любая ошибка Redis — предупреждение и значение по умолчанию, вход не ломаем. */
  private async safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run()
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Redis недоступен — счётчик неудачных входов по аккаунту не ведётся',
      )
      return fallback
    }
  }
}

/** «через 5 минут» читается лучше, чем «через 300 секунд». */
function describeWait(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  return `${Math.ceil(minutes / 60)} ч`
}
