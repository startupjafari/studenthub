import { Injectable, Logger } from '@nestjs/common'
import type { OpsEventName, OpsNotifier } from '../../common/monitoring'

// Реализация порта, когда служебный бот выключен (нет TELEGRAM_BOT_TOKEN) —
// docs/TELEGRAM_BOT.md §1, §7.3.5.
//
// Заглушка нужна именно как провайдер, а не как «не инжектить порт вовсе»: доменные модули
// зависят от `OpsNotifier` безусловно, и локальная разработка, тесты и CI не должны знать,
// настроен бот или нет. Ни сети, ни Redis, ни таймеров здесь нет по определению.

@Injectable()
export class NoopOpsNotifier implements OpsNotifier {
  private readonly logger = new Logger('OpsNotify')

  emit(event: OpsEventName): void {
    this.logger.debug(`ops-событие ${event} пропущено: служебный Telegram выключен`)
  }
}
