import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { AuditService } from '../../../common/audit/audit.service'
import { HttpStatusCounter, OPS_NOTIFIER, type OpsNotifier } from '../../../common/monitoring'
import { REDIS_CLIENT } from '../../../common/redis/redis.constants'
import type { EnvVars } from '../../../config/env.schema'

// T-12 (docs/TELEGRAM_BOT.md §2.4): всплеск неудачных авторизаций и админские действия.
//
// Обе половины про одно: заметить чужие руки. Первая — снаружи (перебор паролей), вторая —
// изнутри (кто-то распоряжается в админке). Ни в той, ни в другой не должно быть логинов,
// ФИО и email: в сообщении только агрегаты, типы действий и `id` сущностей (§2.4, §7.2.5).
//
// IP допустимы именно здесь и только в виде числа различных адресов: это не персональные
// данные пользователя платформы, а признак атаки. Сами адреса не хранятся и не печатаются.

/** Окно наблюдения за отказами. Совпадает с периодом проверки — считаем то, что произошло. */
const WINDOW_MINUTES = 5

/** Сколько действий из аудита показываем: канал читают с телефона. */
const ACTIONS_SHOWN = 5

/** Потолок выборки из аудита — `findMany` без `take` запрещён и здесь (§7.4.4). */
const AUDIT_TAKE = 50

/**
 * Действия, за которыми имеет смысл следить: необратимые или массовые.
 *
 * Смены роли в списке нет, потому что менять роль через API нельзя вовсе — эндпоинта не
 * существует. Появится — строка добавляется сюда, и больше нигде.
 */
const SENSITIVE_ACTIONS = [
  'user_blocked',
  'user_unblocked',
  'invite_bulk_created',
  'invite_revoked',
  'university_status_changed',
  'moderator_chat_access',
  'refresh_reuse_detected',
] as const

const LAST_SEEN_KEY = 'ops:security:audit-since'

@Injectable()
export class SecurityCheck {
  private readonly logger = new Logger(SecurityCheck.name)

  constructor(
    private readonly statusCounter: HttpStatusCounter,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {}

  async run(): Promise<void> {
    await Promise.all([this.checkAuthFailures(), this.checkAdminActions()])
  }

  private async checkAuthFailures(): Promise<void> {
    const threshold = this.config.get('OPS_AUTH_FAILURE_THRESHOLD', { infer: true })
    const window = await this.statusCounter.authFailures(WINDOW_MINUTES)
    if (window.total < threshold) return

    this.notifier.emit('authFailureSpike', {
      total: window.total,
      window: `${window.windowMinutes} мин`,
      ips: window.distinctIps,
      throttled: window.throttled,
    })
    this.logger.warn(
      `Всплеск отказов авторизации: ${window.total} за ${window.windowMinutes} мин с ${window.distinctIps} IP`,
    )
  }

  /**
   * Действия с прошлой проверки. Граница хранится в Redis, а не берётся как «минус пять
   * минут»: проверка может пропустить такт (рестарт, затор в очереди), и окно по часам
   * молча потеряло бы всё, что случилось в пропуск.
   */
  private async checkAdminActions(): Promise<void> {
    const now = new Date()
    const raw = await this.redis.get(LAST_SEEN_KEY)
    await this.redis.set(LAST_SEEN_KEY, now.toISOString())
    // Первый запуск: границы нет — задаём её и молчим, иначе в канал уехала бы вся история.
    if (!raw) return

    const entries = await this.audit.recentSensitive(SENSITIVE_ACTIONS, new Date(raw), AUDIT_TAKE)
    if (!entries.length) return

    // Одно сообщение на окно, а не строка на находку (§7.4.7).
    const byAction = new Map<string, number>()
    for (const entry of entries) {
      byAction.set(entry.action, (byAction.get(entry.action) ?? 0) + 1)
    }
    const summary = [...byAction.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, ACTIONS_SHOWN)
      .map(([action, count]) => (count > 1 ? `${action} ×${count}` : action))
      .join(', ')

    this.notifier.emit('adminActions', {
      count: entries.length,
      actions: summary,
      // Один id для зацепки при разборе. Больше не нужно: остальное — в журнале админки.
      sample: entries[0]?.entityId ?? '—',
    })
  }
}
