import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'
import {
  OPS_NOTIFIER,
  type OpsEventData,
  type OpsEventName,
  type OpsNotifier,
} from '../../common/monitoring'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { GithubApiService } from './github-api.service'

// Что уехало на прод и когда был последний релиз (docs/TELEGRAM_BOT.md §2.1, T-9).
//
// Единственный источник правды о деплое (§7.1.6): SHA последнего успешного деплоя лежит
// здесь, и changelog с дрейфом веток читают его отсюда, а не вычисляют каждый по-своему.
// Хранить историю не нужно — достаточно одной строки на сервис.
//
// Уточнение шага упавшего CI живёт тоже здесь: это та же работа «дочитать у GitHub то,
// чего не было в вебхуке», и держать её в двух местах незачем.

const LAST_SHA_PREFIX = 'ops:deploy:sha:'
const LAST_RELEASE_KEY = 'ops:deploy:at'

/** SHA релиза живёт долго: между релизами бывают недели, а сравнивать нужно с предыдущим. */
const SHA_TTL_SEC = 180 * 24 * 60 * 60

@Injectable()
export class DeployTrackerService {
  private readonly logger = new Logger(DeployTrackerService.name)

  constructor(
    private readonly github: GithubApiService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {}

  /**
   * Дообработка события, приехавшего из вебхука. Вызывается воркером сразу после `emit`,
   * поэтому сообщение о деплое приходит первым, а changelog — следом.
   */
  async onDeployEvent(event: OpsEventName, data: OpsEventData): Promise<void> {
    try {
      if (event === 'deploySucceeded') await this.onDeploySucceeded(data)
      if (event === 'ciFailed') await this.onCiFailed(data)
    } catch (error) {
      // Дополнение к сообщению не имеет права уронить job: само событие уже доставлено.
      this.logger.warn(`Не удалось дополнить событие ${event}: ${String(error)}`)
    }
  }

  /** SHA последнего успешного деплоя — его же читает проверка дрейфа веток. */
  async lastDeployedSha(service: string): Promise<string | null> {
    return this.redis.get(`${LAST_SHA_PREFIX}${service}`)
  }

  /** Когда прошёл последний успешный деплой. `null` — с подключения бота релизов не было. */
  async lastReleaseAt(): Promise<Date | null> {
    const raw = await this.redis.get(LAST_RELEASE_KEY)
    return raw ? new Date(raw) : null
  }

  /**
   * После успешного деплоя: запомнить SHA и рассказать, что уехало.
   *
   * Список коммитов — между предыдущим успешным деплоем и текущим. Первого деплоя это
   * не касается: сравнивать не с чем, и «уехало 500 коммитов» никому не поможет.
   */
  private async onDeploySucceeded(data: OpsEventData): Promise<void> {
    const service = String(data.service ?? 'api')
    const sha = typeof data.fullSha === 'string' ? data.fullSha : null

    await this.redis.set(LAST_RELEASE_KEY, new Date().toISOString())
    if (!sha) return

    const previous = await this.lastDeployedSha(service)
    await this.redis.set(`${LAST_SHA_PREFIX}${service}`, sha, 'EX', SHA_TTL_SEC)
    if (!previous || previous === sha) return

    const comparison = await this.github.compare(previous, sha)
    if (!comparison?.commits.length) return

    this.notifier.emit('deployChangelog', {
      count: comparison.aheadBy,
      commits: comparison.commits.join('\n'),
      compareUrl: comparison.compareUrl,
    })
  }

  /**
   * Уточняет шаг упавшего CI. Вебхук знает только имя workflow, а чинить помогает шаг —
   * `Lint` и `Test (e2e)` требуют разного (§2.1). Не удалось дочитать — в канале уже
   * лежит сообщение с именем workflow, и это лучше, чем ничего.
   */
  private async onCiFailed(data: OpsEventData): Promise<void> {
    const runId = typeof data.runId === 'string' ? data.runId : null
    if (!runId) return

    const step = await this.github.failedStep(runId)
    if (!step || step === data.step) return

    // Отдельным сообщением не шлём — правим то же: у ciFailed есть editKey по runId.
    this.notifier.emit('ciFailed', { ...data, step })
  }
}
