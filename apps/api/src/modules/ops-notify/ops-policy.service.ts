import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { OPS_JOBS, QUEUES, QueueService } from '../../common/queue'
import type { OpsEventData, OpsEventName, OpsEventSpec } from '../../common/monitoring'

// Единая политика доставки (docs/TELEGRAM_BOT.md §7.1.4): тишина, дедупликация, троттлинг.
// Вызывающий сообщает факт; решает, отправлять ли, эта служба. Размазать эти решения по
// местам вызова — гарантированный путь к каналу, который через месяц перестают открывать.
//
// Состояние — в Redis, а не в памяти процесса: на Railway инстанс может быть не один,
// и дедупликация в памяти дала бы по сообщению с каждого (§7.4.3). Тишина по той же
// причине обязана переживать рестарт (§3.5).

const QUIET_UNTIL_KEY = 'ops:quiet:until'
const QUIET_STATS_KEY = 'ops:quiet:stats'
const DEDUPE_PREFIX = 'ops:dedupe:'
const STATE_PREFIX = 'ops:state:'
const THROTTLE_PREFIX = 'ops:throttle:'

/** Сколько событий проглочено тишиной — для сводки при её снятии. */
export interface QuietSummary {
  total: number
  red: number
}

@Injectable()
export class OpsPolicyService {
  private readonly logger = new Logger(OpsPolicyService.name)

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly queue: QueueService,
  ) {}

  /**
   * Пропускать ли событие наружу.
   *
   * При недоступном Redis отвечаем «да» (fail-open) — тем же соображением, что в
   * `CronLockService`: лишнее сообщение в служебном канале переживаемо, потерянный алерт нет.
   */
  async allow(name: OpsEventName, spec: OpsEventSpec, data: OpsEventData): Promise<boolean> {
    try {
      if (await this.mutedByQuiet(spec)) return false
      if (!(await this.passesDedupe(name, spec, data))) return false
      return await this.passesThrottle(name, spec)
    } catch (error) {
      this.logger.warn(`Redis недоступен, политика пропускает ${name}: ${String(error)}`)
      return true
    }
  }

  /**
   * Включает тишину на `ms` и ставит отложенный job, который по её истечении отправит сводку.
   *
   * Отложенный job вместо таймера в процессе: таймер не переживёт рестарт и сработает
   * в каждой реплике. `jobId` включает момент окончания — при продлении тишины появится
   * новый job, а старый, сработав раньше, увидит незакончившуюся тишину и промолчит.
   */
  async startQuiet(ms: number): Promise<Date> {
    const until = new Date(Date.now() + ms)
    await this.redis.set(QUIET_UNTIL_KEY, String(until.getTime()))
    await this.redis.del(QUIET_STATS_KEY)
    await this.queue.enqueue(
      QUEUES.OPS_NOTIFY,
      OPS_JOBS.QUIET_ENDED,
      {},
      { delay: ms, jobId: `${OPS_JOBS.QUIET_ENDED}-${until.getTime()}` },
    )
    return until
  }

  /** Момент окончания тишины или `null`, если её нет. */
  async quietUntil(): Promise<Date | null> {
    const raw = await this.redis.get(QUIET_UNTIL_KEY)
    if (!raw) return null
    const until = Number(raw)
    return Number.isFinite(until) && until > Date.now() ? new Date(until) : null
  }

  /**
   * Снимает тишину и отдаёт сводку проглоченного (§3.5). `null` — тишины не было или
   * сводку уже забрал другой инстанс: удаление ключа атомарно, поэтому сводка уходит один раз.
   */
  async endQuiet(): Promise<QuietSummary | null> {
    const removed = await this.redis.del(QUIET_UNTIL_KEY)
    if (removed === 0) return null
    const stats = await this.redis.hgetall(QUIET_STATS_KEY)
    await this.redis.del(QUIET_STATS_KEY)
    return { total: Number(stats.total ?? 0), red: Number(stats.red ?? 0) }
  }

  /**
   * Подавление флаппинга для проверок по расписанию (§2.2).
   *
   * Возвращает `true` ровно один раз — когда состояние действительно сменилось. Без этого
   * канал звенит на каждой проверке: `up → down → up` за минуту дал бы три сообщения, а
   * проверка, идущая раз в пять минут, — по сообщению каждые пять минут всю аварию.
   *
   * `confirmations` — сколько подряд наблюдений нужно, чтобы поверить в новое состояние.
   * Первое в жизни наблюдение «всё хорошо» фиксируется молча: рассказывать о том, что
   * зависимость работает, при старте незачем.
   */
  async transitioned(
    key: string,
    state: string,
    healthyState: string,
    confirmations = 2,
  ): Promise<boolean> {
    const stateKey = `${STATE_PREFIX}${key}`
    const pendingKey = `${stateKey}:pending`
    try {
      const confirmed = await this.redis.get(stateKey)
      if (confirmed === state) {
        await this.redis.del(pendingKey)
        return false
      }
      if (confirmed === null && state === healthyState) {
        await this.redis.set(stateKey, state)
        return false
      }

      // Счётчик привязан к состоянию-кандидату: мигнуло обратно — счёт начинается заново.
      const pending = await this.redis.get(pendingKey)
      const seen = pending?.startsWith(`${state}:`) ? Number(pending.slice(state.length + 1)) : 0
      const next = seen + 1
      if (next < confirmations) {
        await this.redis.set(pendingKey, `${state}:${next}`, 'EX', 3600)
        return false
      }

      await this.redis.set(stateKey, state)
      await this.redis.del(pendingKey)
      return true
    } catch (error) {
      // В отличие от `allow`, здесь fail-open означал бы сообщение на КАЖДОЙ проверке,
      // пока Redis лежит. Молчим: недоступный Redis сам по себе придёт как деградация.
      this.logger.warn(`Не удалось оценить смену состояния ${key}: ${String(error)}`)
      return false
    }
  }

  /**
   * Заглушены ли события: во время работ проходят только 🔴 (§3.5). Заглушённое событие
   * не теряется — оно попадает в счётчик, который уйдёт сводкой при снятии тишины.
   * Красные считаем тоже, хоть они и прошли: в сводке важно «из них 2 красных».
   */
  private async mutedByQuiet(spec: OpsEventSpec): Promise<boolean> {
    if (!(await this.quietUntil())) return false
    const red = spec.status === 'error'
    await this.redis.hincrby(QUIET_STATS_KEY, 'total', 1)
    if (red) {
      await this.redis.hincrby(QUIET_STATS_KEY, 'red', 1)
    }
    return !red
  }

  /**
   * Идемпотентность по ключу дедупликации: та же авария в пределах окна = одно сообщение.
   * `SET NX PX` — атомарно, без гонки между «проверить» и «занять».
   */
  private async passesDedupe(
    name: OpsEventName,
    spec: OpsEventSpec,
    data: OpsEventData,
  ): Promise<boolean> {
    if (!spec.dedupeTtl) return true
    const parts = (spec.dedupe ?? []).map((f) => String(data[f] ?? ''))
    const key = `${DEDUPE_PREFIX}${name}:${parts.join('|')}`
    const acquired = await this.redis.set(key, '1', 'PX', spec.dedupeTtl * 1000, 'NX')
    if (acquired !== 'OK') {
      this.logger.debug(`ops-событие ${name} схлопнуто дедупликацией`)
      return false
    }
    return true
  }

  /**
   * Потолок частоты события независимо от ключа дедупликации: авария с постоянно новым
   * ключом (новый `deploymentId`, новый id группы Sentry) дедупликацией не гасится и
   * без потолка выливается в канал сплошной лентой.
   */
  private async passesThrottle(name: OpsEventName, spec: OpsEventSpec): Promise<boolean> {
    if (!spec.throttle) return true
    const key = `${THROTTLE_PREFIX}${name}`
    const count = await this.redis.incr(key)
    if (count === 1) {
      await this.redis.expire(key, spec.throttle.windowSec)
    }
    if (count > spec.throttle.max) {
      this.logger.debug(`ops-событие ${name} придержано троттлингом (${count})`)
      return false
    }
    return true
  }
}
