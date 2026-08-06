import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { AuditListQueryInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../prisma/prisma.service'
import { Paginated } from '../http/paginated'
import type { JwtPayload } from '../auth/jwt-payload.type'

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
// Ф11 добавит AuditInterceptor и GET /audit поверх этого сервиса.
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
    const where: Prisma.AuditLogWhereInput = {
      ...(await this.scopeWhere(viewer)),
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  // Платформа-админ — весь журнал; платформа/вуз-модератор — только свои действия;
  // админ вуза — действия пользователей своего вуза (AuditLog без FK universityId — фильтр по userId).
  private async scopeWhere(viewer: JwtPayload): Promise<Prisma.AuditLogWhereInput> {
    if (viewer.role === Role.PLATFORM_ADMIN) return {}
    if (viewer.role === Role.UNIVERSITY_ADMIN) {
      const users = await this.prisma.user.findMany({
        where: { universityId: viewer.universityId ?? '__none__' },
        select: { id: true },
        take: 5000,
      })
      return { userId: { in: users.map((u) => u.id) } }
    }
    // PLATFORM_MODERATOR / UNIVERSITY_MODERATOR — только собственные действия (§2.2 «⚠️ свои»).
    return { userId: viewer.sub }
  }
}
