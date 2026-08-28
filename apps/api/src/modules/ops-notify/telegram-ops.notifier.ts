import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OPS_JOBS, QUEUES, QueueService } from '../../common/queue'
import { opsEventSpec } from '../../common/monitoring'
import type { OpsEventData, OpsEventName, OpsNotifier } from '../../common/monitoring'
import type { EnvVars } from '../../config/env.schema'
import { OpsMessageBuilder } from './ops-message.builder'
import { OpsPolicyService } from './ops-policy.service'

// Боевая реализация порта `OpsNotifier` (docs/TELEGRAM_BOT.md §4.1).
//
// Путь события: политика решает → билдер собирает текст → очередь доставляет.
// Порядок именно такой: дедупликация должна отработать в момент события, иначе всплеск
// в сто одинаковых аварий сначала создаст сто job'ов, а схлопнутся они уже в воркере.
//
// `emit` синхронный по контракту порта, а политика ходит в Redis — поэтому обещание
// сознательно не ожидается: вызывающий доменный код не ждёт ни Redis, ни сети (§0.1.3).

@Injectable()
export class TelegramOpsNotifier implements OpsNotifier, OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramOpsNotifier.name)

  constructor(
    private readonly policy: OpsPolicyService,
    private readonly builder: OpsMessageBuilder,
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /**
   * Старт инстанса — он же тестовое событие при первой настройке бота: задал переменные,
   * перезапустил API, увидел строку в теме «Деплой». Дедупликация по версии гасит
   * рестарт-шторм (реестр, `appStarted`).
   */
  onApplicationBootstrap(): void {
    this.emit('appStarted', {
      release: this.config.get('SENTRY_RELEASE', { infer: true }) ?? 'dev',
    })
  }

  emit(event: OpsEventName, data: OpsEventData = {}): void {
    void this.deliver(event, data).catch((error: unknown) => {
      // Единственная реакция на сбой служебного канала — лог. Событие об ошибке отправки
      // породило бы петлю (§7.2.6).
      this.logger.warn(`ops-событие ${event} не доставлено: ${String(error)}`)
    })
  }

  private async deliver(event: OpsEventName, data: OpsEventData): Promise<void> {
    const spec = opsEventSpec(event)
    if (!(await this.policy.allow(event, spec, data))) return
    const message = this.builder.build(spec, data)
    await this.queue.enqueue(QUEUES.OPS_NOTIFY, OPS_JOBS.SEND, { message })
  }
}
