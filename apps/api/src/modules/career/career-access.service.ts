import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { isAccessActive, type CompanyAccessStatus } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

/**
 * Единственная точка, отвечающая на вопрос «видит ли эта компания студентов этого вуза».
 *
 * Почему отдельный сервис, а не ScopeGuard: у работодателя нет одного скоупа. Он видит
 * студентов ровно тех вузов, где у его компании активен допуск, и набор этот меняется
 * решением вуза. Класть его в токен нельзя — отзыв допуска обязан действовать немедленно,
 * а не после истечения access-токена (15 минут доступа к чужим студентам после отзыва —
 * это инцидент, а не задержка).
 *
 * Поэтому набор читается из БД на каждый запрос. Чтобы это не стоило запроса к базе на
 * каждое обращение, держим короткий кэш в Redis и сбрасываем его при любом изменении
 * допуска (CompaniesService вызывает invalidate).
 */
@Injectable()
export class CareerAccessService {
  private readonly logger = new Logger(CareerAccessService.name)

  /**
   * Кэш живёт минуту. Верхняя граница задержки при отзыве, если сброс кэша не случился
   * (упал Redis, гонка) — минута, а не время жизни токена. Точечный сброс всё равно есть,
   * TTL здесь — страховка.
   */
  private static readonly CACHE_TTL_SECONDS = 60

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private key(companyId: string): string {
    return `career:access:${companyId}`
  }

  /** Вузы, к студентам которых компания допущена прямо сейчас. */
  async allowedUniversityIds(companyId: string): Promise<string[]> {
    const cached = await this.readCache(companyId)
    if (cached) return cached

    const rows = await this.prisma.companyUniversityAccess.findMany({
      where: { companyId, status: 'APPROVED' },
      select: { universityId: true, status: true, expiresAt: true },
      // Компания не может быть допущена в тысячи вузов; take страхует от промаха в фильтре
      // (BACKEND_RULES §5.3 — findMany без take запрещён).
      take: 500,
    })

    // Срок проверяем в коде, а не в WHERE: та же функция работает и на фронте, и её
    // единственная реализация лежит в shared-schemas — иначе «истёк» разъедется.
    const ids = rows
      .filter((r) =>
        isAccessActive({ status: r.status as CompanyAccessStatus, expiresAt: r.expiresAt }),
      )
      .map((r) => r.universityId)

    await this.writeCache(companyId, ids)
    return ids
  }

  /** Есть ли у компании активный допуск в конкретный вуз. */
  async canAccessUniversity(companyId: string, universityId: string): Promise<boolean> {
    const allowed = await this.allowedUniversityIds(companyId)
    return allowed.includes(universityId)
  }

  /**
   * Барьер для любого обращения работодателя к данным студентов.
   * Бросает WRONG_SCOPE — тот же код, что у остальных ролей при выходе за свой скоуп.
   */
  async assertCanAccessUniversity(viewer: JwtPayload, universityId: string): Promise<void> {
    // Платформенные роли смотрят всё — как и в ScopeGuard.
    if (viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR) return

    const companyId = this.requireCompany(viewer)
    if (!(await this.canAccessUniversity(companyId, universityId))) {
      throw new AppException('WRONG_SCOPE', 'Компания не допущена к студентам этого университета')
    }
  }

  /**
   * companyId из токена. Работодатель без компании — сломанное состояние (аккаунт есть,
   * членства нет): такое возможно только при ручной правке БД, но пускать его дальше нельзя.
   */
  requireCompany(viewer: JwtPayload): string {
    if (viewer.role !== Role.EMPLOYER) {
      throw new AppException('FORBIDDEN', 'Действие доступно только работодателю')
    }
    if (!viewer.companyId) {
      throw new AppException('FORBIDDEN', 'Аккаунт не привязан к компании')
    }
    return viewer.companyId
  }

  /** Сбросить кэш допусков компании. Вызывается при любом изменении CompanyUniversityAccess. */
  async invalidate(companyId: string): Promise<void> {
    try {
      await this.redis.del(this.key(companyId))
    } catch (error) {
      // Кэш — ускорение, а не источник истины: при недоступном Redis работаем по БД.
      // Молчать нельзя (иначе отзыв допуска подвиснет на TTL), падать — тоже.
      this.logger.warn({ err: error, companyId }, 'Не удалось сбросить кэш допусков компании')
    }
  }

  private async readCache(companyId: string): Promise<string[] | null> {
    try {
      const raw = await this.redis.get(this.key(companyId))
      return raw ? (JSON.parse(raw) as string[]) : null
    } catch {
      return null
    }
  }

  private async writeCache(companyId: string, ids: string[]): Promise<void> {
    try {
      await this.redis.set(
        this.key(companyId),
        JSON.stringify(ids),
        'EX',
        CareerAccessService.CACHE_TTL_SECONDS,
      )
    } catch {
      /* кэш необязателен */
    }
  }
}
