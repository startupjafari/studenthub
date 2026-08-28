import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OPS_NOTIFIER, type OpsNotifier } from '../../../common/monitoring'
import type { EnvVars } from '../../../config/env.schema'
import { OpsPolicyService } from '../ops-policy.service'

// T-6 (docs/TELEGRAM_BOT.md §2.2): синтетический пинг внешнего адреса.
//
// Смысл проверки в том, что она идёт СНАРУЖИ, точнее — по тому же публичному пути, что и
// браузер пользователя. `/health` изнутри отвечает и тогда, когда приложение недоступно:
// упал прокси, протух сертификат, домен не резолвится. Внутренняя проверка на такое слепа.
//
// Не задан `OPS_PUBLIC_URL` — проверка не заводится вовсе (см. `OpsScheduleService`).

const TIMEOUT_MS = 5000

@Injectable()
export class PublicPingCheck {
  private readonly logger = new Logger(PublicPingCheck.name)

  constructor(
    private readonly config: ConfigService<EnvVars, true>,
    private readonly policy: OpsPolicyService,
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {}

  async run(): Promise<void> {
    const url = this.config.get('OPS_PUBLIC_URL', { infer: true })
    if (!url) return

    let up = false
    let reason = ''
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      // 2xx и 3xx считаем живым: редирект на канонический домен — нормальная конфигурация,
      // а не авария. Проверяем доступность приложения, а не корректность одного маршрута.
      up = res.status < 400
      if (!up) reason = `HTTP ${res.status}`
    } catch (error) {
      reason = String(error)
    }

    if (!(await this.policy.transitioned('public-url', up ? 'up' : 'down', 'up'))) return

    if (up) {
      this.notifier.emit('publicUrlUp', { url })
      this.logger.log(`Внешний адрес снова отвечает: ${url}`)
    } else {
      this.notifier.emit('publicUrlDown', { url, reason: reason || 'нет ответа' })
      this.logger.error(`Внешний адрес недоступен (${url}): ${reason}`)
    }
  }
}
