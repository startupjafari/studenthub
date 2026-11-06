import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { AppException } from '../exceptions/app.exception'
import { MAINTENANCE_EXEMPT_KEY } from '../decorators/maintenance-exempt.decorator'
import { PLATFORM_STATE, type PlatformStateReader } from '../../modules/platform/platform.constants'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Режим техработ на стороне сервера (docs/PROJECT.md §Состояние платформы).
//
// Заглушка в вебе — половина дела: она объясняет человеку, что происходит, но не мешает
// записи. Останавливает её этот guard, и именно он делает рычаг настоящим.
//
// Кто проходит. Платформенные роли — они и есть те, кто чинит. Маршруты с
// @MaintenanceExempt() — те, без которых режим не снять: вход, мини-апп, чтение состояния
// и health. Всё остальное получает 503.
//
// Регистрируется сразу после JwtAuthGuard: роль читается из request.user, а считать
// scope и права на маршруте остановленной платформы уже незачем.
const STAFF_ROLES: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

// Сбой проверки повторяется на каждом запросе; в журнал хватит строки в минуту.
const FAILURE_LOG_INTERVAL_MS = 60_000

@Injectable()
export class MaintenanceGuard implements CanActivate {
  private readonly logger = new Logger(MaintenanceGuard.name)
  private failureLoggedAt = 0

  constructor(
    private readonly reflector: Reflector,
    // По токену, а не по классу: импорт PlatformService втянул бы сюда домен auth целиком
    // и замкнул кольцо импортов (см. platform.constants.ts).
    @Inject(PLATFORM_STATE) private readonly platform: PlatformStateReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true

    const exempt = this.reflector.getAllAndOverride<boolean | undefined>(MAINTENANCE_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (exempt) return true

    if (!(await this.maintenanceActive())) return true

    const user = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: CurrentUserData }>().user
    if (user && STAFF_ROLES.includes(user.role)) return true

    throw new AppException('MAINTENANCE', 'Платформа остановлена на технические работы')
  }

  /**
   * Сбой самой проверки = «техработ нет», та же сторона, что у отказа чтения БД в
   * PlatformService.read(). Guard стоит на каждом запросе: исключение отсюда — это 500 у
   * всех ролей разом, включая платформенные, то есть у тех, кто пришёл бы чинить.
   */
  private async maintenanceActive(): Promise<boolean> {
    try {
      return await this.platform.maintenanceActive()
    } catch (error: unknown) {
      if (Date.now() - this.failureLoggedAt > FAILURE_LOG_INTERVAL_MS) {
        this.failureLoggedAt = Date.now()
        this.logger.error(`Проверка техработ упала, запрос пропущен: ${String(error)}`)
      }
      return false
    }
  }
}
