import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { isAccessActive, type CompanyAccessStatus } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

/**
 * Допуск компании в вуз действует прямо сейчас — правило `isAccessActive` (shared-schemas),
 * записанное условием для Prisma. Нужно там, где компания встречается со студентами внутри
 * одного запроса (витрина, карточка вакансии, отклик): читать набор вузов отдельно и
 * склеивать руками — лишний запрос и второе место, где «истёк» может разъехаться.
 */
export function activeAccessWhere(
  universityId: string,
  now: Date = new Date(),
): Prisma.CompanyUniversityAccessWhereInput {
  return {
    universityId,
    status: 'APPROVED',
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }
}

/**
 * Вакансия видна студентам вуза: опубликована, одобрена ЭТИМ вузом, и компания допущена в
 * него прямо сейчас. Одно условие на витрину, карточку и отклик.
 *
 * Одобрения вуза мало: истёкший срок допуска решений по вакансиям не трогает (каскад есть
 * только у отзыва, а cron `expireCompanyAccess` догоняет истечение не мгновенно), и без
 * проверки допуска компания продолжала бы собирать отклики вуза, к которому её уже не пускают.
 */
export function vacancyVisibleWhere(
  universityId: string,
  now: Date = new Date(),
): Prisma.VacancyWhereInput {
  return {
    deletedAt: null,
    status: 'PUBLISHED',
    reviews: { some: { universityId, status: 'APPROVED' } },
    company: { universityAccess: { some: activeAccessWhere(universityId, now) } },
  }
}

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

  /**
   * Какие отклики компания видит в воронке и может двигать по ней.
   *
   * Вузы с активным допуском — все отклики. Вуз, где допуска больше нет, — только поданные
   * ДО того, как он закончился: начатый диалог переживает отзыв (PROJECT.md, § Карьера —
   * человек мог дойти до интервью), а нового кандидата оттуда компания видеть не должна.
   *
   * Момент конца допуска: у истёкшего — его срок; у отозванного — срок, если отзыв поставил
   * cron по истечении, иначе момент решения; у заявки, поданной после потери допуска
   * (REQUESTED/REJECTED), — момент новой заявки: допуска к тому времени уже не было.
   *
   * Без кэша: воронку открывают редко, а нужны все строки допуска, не только активные.
   */
  async applicationScopeWhere(
    companyId: string,
    now: Date = new Date(),
  ): Promise<Prisma.CareerApplicationWhereInput> {
    const rows = await this.prisma.companyUniversityAccess.findMany({
      where: { companyId },
      select: {
        universityId: true,
        status: true,
        expiresAt: true,
        decidedAt: true,
        requestedAt: true,
      },
      take: 500,
    })

    const active: string[] = []
    const ended: Prisma.CareerApplicationWhereInput[] = []
    for (const row of rows) {
      const status = row.status as CompanyAccessStatus
      if (isAccessActive({ status, expiresAt: row.expiresAt }, now)) {
        active.push(row.universityId)
        continue
      }
      const endedAt =
        status === 'APPROVED'
          ? row.expiresAt
          : status === 'REVOKED'
            ? (row.expiresAt ?? row.decidedAt)
            : row.requestedAt
      if (endedAt) ended.push({ universityId: row.universityId, createdAt: { lte: endedAt } })
    }

    const scope = [...(active.length > 0 ? [{ universityId: { in: active } }] : []), ...ended]
    // Компания без единого допуска откликов не видит — явно, а не через трактовку пустого OR.
    return scope.length > 0 ? { OR: scope } : { id: { in: [] } }
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
