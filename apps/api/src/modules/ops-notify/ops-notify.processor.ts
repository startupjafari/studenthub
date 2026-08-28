import { Inject, Logger } from '@nestjs/common'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import type Redis from 'ioredis'
import { OPS_JOBS, QUEUES, type JobPayload } from '../../common/queue'
import {
  OPS_NOTIFIER,
  reportJobFailure,
  type OpsEventData,
  type OpsEventName,
  type OpsNotifier,
} from '../../common/monitoring'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import type { OpsCommand } from './hooks/telegram.mapper'
import type { OpsMessage } from './ops-message.builder'
import { OpsPolicyService } from './ops-policy.service'
import { TelegramOpsService } from './telegram-ops.service'
import { CronSilenceCheck } from './checks/cron-silence.check'
import { DependenciesCheck } from './checks/dependencies.check'
import { DeployTrackerService } from './deploy-tracker.service'
import { OpsCommandService } from './ops-command.service'
import { BranchDriftCheck } from './checks/branch-drift.check'
import { DigestCheck } from './checks/digest.check'
import { PinnedStatusCheck } from './checks/pinned-status.check'
import { PublicPingCheck } from './checks/public-ping.check'
import { SecurityCheck } from './checks/security.check'
import { QueuesCheck } from './checks/queues.check'

// Воркер служебного канала (docs/TELEGRAM_BOT.md §4.3, §7.4.1).
//
// `concurrency: 1` и лимитер — не про производительность, а про читаемость канала:
// сообщения обязаны идти в том порядке, в каком случились, а всплеск в сто событий не
// должен упереться в rate limit Telegram (30 сообщений в секунду на бота, и заметно
// строже — в одну группу). Вызывающий код сети не ждёт вовсе.
@Processor(QUEUES.OPS_NOTIFY, { concurrency: 1, limiter: { max: 20, duration: 60_000 } })
export class OpsNotifyProcessor extends WorkerHost {
  private readonly logger = new Logger(OpsNotifyProcessor.name)

  constructor(
    private readonly telegram: TelegramOpsService,
    private readonly policy: OpsPolicyService,
    private readonly cronSilence: CronSilenceCheck,
    private readonly queues: QueuesCheck,
    private readonly dependencies: DependenciesCheck,
    private readonly publicPing: PublicPingCheck,
    private readonly pinnedStatus: PinnedStatusCheck,
    private readonly security: SecurityCheck,
    private readonly digest: DigestCheck,
    private readonly branchDrift: BranchDriftCheck,
    private readonly deploys: DeployTrackerService,
    private readonly commands: OpsCommandService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    // Сводку по окончании тишины отправляем через тот же порт, что и всё остальное:
    // никакой второй дороги к Telegram у модуля нет (§7.1.1).
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {
    super()
  }

  // Падение job'а в служебном канале не должно порождать ops-событие (§7.2.6) —
  // только штатный лог и Sentry, как у остальных воркеров.
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    reportJobFailure(this.logger, QUEUES.OPS_NOTIFY, job, error)
  }

  async process(job: Job<JobPayload>): Promise<void> {
    switch (job.name) {
      case OPS_JOBS.SEND: {
        const { message } = job.data as unknown as { message: OpsMessage }
        await this.deliver(message)
        return
      }
      case OPS_JOBS.EMIT: {
        // Событие из вебхука: контроллер ответил внешнему сервису сразу, обработка здесь (§5).
        const { event, data } = job.data as unknown as {
          event: OpsEventName
          data: OpsEventData
        }
        this.notifier.emit(event, data)
        await this.deploys.onDeployEvent(event, data)
        return
      }
      case OPS_JOBS.COMMAND: {
        // Команда из чата: Telegram уже получил ответ, здесь собирается сам ответ (§6).
        const { _meta, ...command } = job.data
        await this.commands.handle(command as unknown as OpsCommand)
        return
      }
      case OPS_JOBS.QUIET_ENDED: {
        await this.finishQuiet()
        return
      }
      // Проверки по расписанию (§7.3.4). Каждая работает и падает независимо: упавшая
      // проверка очередей не должна унести с собой наблюдение за зависимостями.
      case OPS_JOBS.CHECK_CRON_SILENCE:
        return this.cronSilence.run()
      case OPS_JOBS.CHECK_QUEUES:
        return this.queues.run()
      case OPS_JOBS.CHECK_DEPENDENCIES:
        return this.dependencies.run()
      case OPS_JOBS.CHECK_PUBLIC_PING:
        return this.publicPing.run()
      case OPS_JOBS.CHECK_PINNED_STATUS:
        return this.pinnedStatus.run()
      case OPS_JOBS.CHECK_SECURITY:
        return this.security.run()
      case OPS_JOBS.CHECK_DIGEST:
        return this.digest.run()
      case OPS_JOBS.CHECK_BRANCH_DRIFT:
        return this.branchDrift.run()
      default:
        this.logger.warn(`Неизвестный ops-job ${job.name} — пропуск`)
    }
  }

  /**
   * Отправляет сообщение или переписывает ранее отправленное с тем же `editKey` (§3.2).
   *
   * `message_id` живёт в Redis с часовым TTL: он обязан пережить рестарт инстанса, иначе
   * второй статус деплоя придёт новой строкой. Не нашли (рестарт затянулся, TTL истёк) —
   * отправляем новое сообщение, а не теряем событие.
   */
  private async deliver(message: OpsMessage): Promise<void> {
    if (!message.editKey) {
      // `send` не бросает по контракту — job не уйдёт в failed из-за недоступного Telegram.
      await this.telegram.send(message)
      return
    }

    const key = `${EDIT_KEY_PREFIX}${message.editKey}`
    const known = await this.redis.get(key).catch(() => null)
    if (known) {
      const outcome = await this.telegram.edit(Number(known), message)
      // `failed` — сеть моргнула: дубликат хуже пропуска, ждём следующего статуса.
      if (outcome !== 'gone') return
    }

    const messageId = await this.telegram.send(message)
    if (messageId) {
      await this.redis.set(key, String(messageId), 'EX', EDIT_KEY_TTL_SEC).catch(() => undefined)
    }
  }

  /**
   * Завершение тишины (§3.5). Job мог сработать раньше срока — если тишину продлили,
   * актуальный момент окончания лежит в Redis, и текущий job просто молчит: сводку
   * отправит job, поставленный при продлении.
   */
  private async finishQuiet(): Promise<void> {
    if (await this.policy.quietUntil()) return
    const summary = await this.policy.endQuiet()
    if (!summary) return
    this.notifier.emit('quietEnded', {
      summary: `${summary.total} событий, из них ${summary.red} красных`,
    })
  }
}

// Ключ переписываемого сообщения живёт час: деплой столько не идёт, а вечный ключ
// после смены темы или чистки чата указывал бы на несуществующее сообщение.
const EDIT_KEY_PREFIX = 'ops:msg:'
const EDIT_KEY_TTL_SEC = 60 * 60
