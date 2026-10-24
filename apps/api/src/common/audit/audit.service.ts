import { Injectable, Logger } from '@nestjs/common'
import { Prisma, type AuditLog } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { AuditListQueryInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../prisma/prisma.service'
import { Paginated } from '../http/paginated'
import type { JwtPayload } from '../auth/jwt-payload.type'

/**
 * Срок хранения журнала (CleanupService.cleanAuditLogs). Общая константа: отчёты, которые
 * считают показатели по журналу, должны знать, за какой период он ещё полон.
 */
export const AUDIT_RETENTION_DAYS = 90

export interface AuditEntry {
  userId?: string | null
  action: string
  entity?: string
  entityId?: string
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
}

// Пишет запись в audit_logs (docs/BACKEND_RULES.md §13). Никогда не логирует пароли/токены.
// Перехватчика аудита нет намеренно (IMPLEMENTATION_PLAN 11.6): запись делает сервис в той же
// операции, что и действие, — только он знает, что изменилось. GET /audit читает отсюда же.
// Сортировка журнала: колонка таблицы → orderBy Prisma, через белый список (произвольное
// поле из query в orderBy не попадает). Вторая ступень — createdAt desc: при равных
// значениях порядок внутри страницы обязан быть стабильным, иначе строки прыгают между
// страницами. По умолчанию — свежие сверху.
function auditOrderBy(query: AuditListQueryInput): Prisma.AuditLogOrderByWithRelationInput[] {
  const dir = query.order ?? 'asc'
  switch (query.sort) {
    case 'createdAt':
      return [{ createdAt: dir }]
    case 'action':
      return [{ action: dir }, { createdAt: 'desc' }]
    case 'entity':
      return [{ entity: dir }, { createdAt: 'desc' }]
    case 'userId':
      return [{ userId: dir }, { createdAt: 'desc' }]
    default:
      return [{ createdAt: 'desc' }]
  }
}

// То же, что auditOrderBy, для SQL журнала вуза (listUniversity). Колонки и направление —
// только из белого списка, значения query в текст запроса не попадают.
const AUDIT_SORT_COLUMNS: Record<NonNullable<AuditListQueryInput['sort']>, Prisma.Sql> = {
  createdAt: Prisma.sql`a.created_at`,
  action: Prisma.sql`a.action`,
  entity: Prisma.sql`a.entity`,
  userId: Prisma.sql`a.user_id`,
}
function auditOrderSql(query: AuditListQueryInput): Prisma.Sql {
  if (!query.sort) return Prisma.sql`a.created_at DESC`
  const dir = query.order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`
  const column = AUDIT_SORT_COLUMNS[query.sort]
  return query.sort === 'createdAt'
    ? Prisma.sql`${column} ${dir}`
    : Prisma.sql`${column} ${dir}, a.created_at DESC`
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          metadata: entry.metadata as Prisma.InputJsonValue | undefined,
          ip: entry.ip,
          userAgent: entry.userAgent,
        },
      })
    } catch (error) {
      // Сбой аудита не должен ронять бизнес-операцию, но обязан быть виден.
      this.logger.error({ err: error, action: entry.action }, 'Не удалось записать AuditLog')
    }
  }

  // Журнал действий по scope (docs/PROJECT.md §11, задача 11.6). Роли гейтит контроллер.
  async list(viewer: JwtPayload, query: AuditListQueryInput): Promise<Paginated<unknown>> {
    if (viewer.role === Role.UNIVERSITY_ADMIN) return this.listUniversity(viewer, query)
    // scope и клиентские фильтры комбинируем через AND: клиентский ?userId= обязан
    // СУЖАТЬ scope, а не перезаписывать его (иначе модератор/админ вуза прочитал бы чужой
    // журнал — object-spread по одному ключу «userId» затирал scope). См. §11.
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        this.scopeWhere(viewer),
        ...(query.action ? [{ action: query.action }] : []),
        ...(query.userId ? [{ userId: query.userId }] : []),
      ],
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: auditOrderBy(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  // Админ вуза — действия пользователей своего вуза (§2.2 «Журнал действий — ✅ свои»).
  //
  // У AuditLog нет FK на пользователя (запись переживает его удаление), поэтому условие
  // «автор из моего вуза» Prisma не выражает ни связью, ни подзапросом. Раньше сюда
  // подставлялся список id первых 5000 пользователей вуза, взятых без порядка: в крупном вузе
  // действия остальных молча пропадали из журнала. Теперь вуз проверяется JOIN'ом на users
  // в самой выборке; фильтры клиента так же СУЖАЮТ её (AND), как и в list.
  private async listUniversity(
    viewer: JwtPayload,
    query: AuditListQueryInput,
  ): Promise<Paginated<unknown>> {
    const conditions: Prisma.Sql[] = [Prisma.sql`u.university_id = ${viewer.universityId}`]
    if (query.action) conditions.push(Prisma.sql`a.action = ${query.action}`)
    if (query.userId) conditions.push(Prisma.sql`a.user_id = ${query.userId}`)
    const from = Prisma.sql`FROM audit_logs a JOIN users u ON u.id = a.user_id
      WHERE ${Prisma.join(conditions, ' AND ')}`

    const [rows, counted] = await this.prisma.$transaction([
      this.prisma.$queryRaw<AuditLog[]>`
        SELECT a.id, a.user_id AS "userId", a.action, a.entity, a.entity_id AS "entityId",
               a.metadata, a.ip, a.user_agent AS "userAgent", a.created_at AS "createdAt"
        ${from}
        ORDER BY ${auditOrderSql(query)}
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${from}`,
    ])
    return new Paginated(rows, { total: counted[0]?.total ?? 0 })
  }

  // Платформа-админ — весь журнал; платформа/вуз-модератор — только свои действия.
  // Админ вуза сюда не приходит — его журнал собирает listUniversity.
  private scopeWhere(viewer: JwtPayload): Prisma.AuditLogWhereInput {
    if (viewer.role === Role.PLATFORM_ADMIN) return {}
    // PLATFORM_MODERATOR / UNIVERSITY_MODERATOR — только собственные действия (§2.2 «⚠️ свои»).
    return { userId: viewer.sub }
  }
}
