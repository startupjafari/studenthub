import { Inject, Injectable, Logger } from '@nestjs/common'
import { OPS_NOTIFIER, type OpsNotifier } from '../../../common/monitoring'
import { OpsPolicyService } from '../ops-policy.service'
import { OpsStatusService } from '../ops-status.service'

// T-6 (docs/TELEGRAM_BOT.md §2.2): состояние Postgres, Redis и MinIO.
//
// Числа и вердикты берутся из `OpsStatusService` — единственного источника метрик (§7.1.5).
// Сама проверка отвечает только за одно: решить, стоит ли об этом рассказывать.
//
// Сообщаем о СМЕНЕ состояния, а не о каждой проверке (§2.2): подтверждение через
// `OpsPolicyService.transitioned` гасит мигание `up → down → up`, «выздоровление»
// приходит отдельным 🟢.

@Injectable()
export class DependenciesCheck {
  private readonly logger = new Logger(DependenciesCheck.name)

  constructor(
    private readonly status: OpsStatusService,
    private readonly policy: OpsPolicyService,
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {}

  async run(): Promise<void> {
    for (const dependency of await this.status.dependencies()) {
      const { name, up, reason } = dependency
      if (!(await this.policy.transitioned(`dep:${name}`, up ? 'up' : 'down', 'up'))) continue

      if (up) {
        this.notifier.emit('dependencyUp', { name })
        this.logger.log(`Зависимость ${name} восстановилась`)
      } else {
        this.notifier.emit('dependencyDown', { name, reason: reason || 'нет ответа' })
        this.logger.error(`Зависимость ${name} недоступна: ${reason}`)
      }
    }
  }
}
