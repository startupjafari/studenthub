import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { InviteStatus, Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { TTL } from '@studenthub/shared-config'
import type { CreateInviteInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { QueueService, QUEUES, EMAIL_JOBS } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import type { RequestContext } from '../auth/auth.service'
import { resolveInviteTarget } from './invite-hierarchy'

// Человекочитаемые названия ролей для писем (основной язык — русский, полноценный i18n
// писем — Ф13.1; синхронизировано с apps/web/messages/ru.json → "Roles").
const ROLE_LABELS_RU: Record<Role, string> = {
  [Role.PLATFORM_ADMIN]: 'Администратор платформы',
  [Role.PLATFORM_MODERATOR]: 'Модератор платформы',
  [Role.UNIVERSITY_ADMIN]: 'Администратор университета',
  [Role.UNIVERSITY_MODERATOR]: 'Модератор университета',
  [Role.DEAN]: 'Декан',
  [Role.TEACHER]: 'Преподаватель',
  [Role.STAROSTA]: 'Староста',
  [Role.STUDENT]: 'Студент',
}

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /** Создание инвайта: проверка иерархии+scope, одноразовый токен, срок 48ч. */
  async create(issuer: JwtPayload, input: CreateInviteInput, ctx: RequestContext) {
    const scope = resolveInviteTarget(issuer, input)
    const token = randomUUID()
    const expiresAt = new Date(Date.now() + TTL.INVITE_HOURS * 3_600_000)

    const invite = await this.prisma.invite.create({
      data: {
        token,
        role: input.role,
        email: input.email,
        universityId: scope.universityId,
        facultyId: scope.facultyId,
        groupId: scope.groupId,
        expiresAt,
        createdById: issuer.sub,
      },
      select: {
        id: true,
        token: true,
        role: true,
        universityId: true,
        facultyId: true,
        groupId: true,
        expiresAt: true,
        status: true,
      },
    })

    await this.audit.record({
      userId: issuer.sub,
      action: 'invite_created',
      entity: 'Invite',
      entityId: invite.id,
      metadata: { role: invite.role },
      ...ctx,
    })

    // Письмо со ссылкой-приглашением (docs/PROJECT.md §7.3, §10.1) — только если известен
    // адрес получателя. Отправка асинхронна (§9.1): HTTP-ответ её не ждёт.
    if (input.email) {
      await this.enqueueInviteEmail(input.email, token, invite.role, expiresAt)
    }

    // Токен возвращается ТОЛЬКО здесь — создателю в момент выдачи (§11.9).
    return invite
  }

  /**
   * Best-effort постановка письма-приглашения в очередь `email`. Инвайт уже сохранён,
   * поэтому сбой Redis не должен ронять HTTP-ответ (docs/RUNBOOK: HTTP не блокируется
   * очередью) — токен всё равно вернётся создателю, ссылку можно передать вручную.
   * jobId = invite:{token} обеспечивает идемпотентность (§9.2): дубль не создаётся.
   */
  private async enqueueInviteEmail(
    email: string,
    token: string,
    role: Role,
    expiresAt: Date,
  ): Promise<void> {
    const origin = this.config.get('CORS_ORIGIN', { infer: true }).replace(/\/+$/, '')
    const inviteUrl = `${origin}/register?token=${token}`
    try {
      await this.queue.enqueue(
        QUEUES.EMAIL,
        EMAIL_JOBS.SEND_INVITE,
        {
          to: email,
          inviteUrl,
          roleLabel: ROLE_LABELS_RU[role],
          expiresAt: new Intl.DateTimeFormat('ru-RU', {
            dateStyle: 'long',
            timeStyle: 'short',
          }).format(expiresAt),
        },
        { jobId: `invite:${token}` },
      )
    } catch (err) {
      this.logger.warn(
        `Не удалось поставить письмо-приглашение в очередь (token уже выдан): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  /** Публичный preview по токену. Не раскрывает email получателя и создателя (§7). */
  async preview(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { token },
      select: {
        role: true,
        status: true,
        universityId: true,
        facultyId: true,
        groupId: true,
        expiresAt: true,
      },
    })
    if (!invite) {
      throw new AppException('NOT_FOUND', 'Инвайт не найден')
    }
    this.assertUsable(invite.status, invite.expiresAt)

    return {
      role: invite.role,
      universityId: invite.universityId,
      facultyId: invite.facultyId,
      groupId: invite.groupId,
      expiresAt: invite.expiresAt,
    }
  }

  /** Отзыв инвайта: создатель, платформенный админ или админ вуза в своём scope. Только PENDING. */
  async revoke(issuer: JwtPayload, id: string, ctx: RequestContext) {
    const invite = await this.prisma.invite.findUnique({
      where: { id },
      select: { id: true, status: true, createdById: true, universityId: true },
    })
    if (!invite) {
      throw new AppException('NOT_FOUND', 'Инвайт не найден')
    }

    const canRevoke =
      invite.createdById === issuer.sub ||
      issuer.role === Role.PLATFORM_ADMIN ||
      (issuer.role === Role.UNIVERSITY_ADMIN && invite.universityId === issuer.universityId)
    if (!canRevoke) {
      throw new AppException('FORBIDDEN', 'Нет прав на отзыв этого инвайта')
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new AppException('CONFLICT', 'Отозвать можно только ожидающий инвайт')
    }

    await this.prisma.invite.update({ where: { id }, data: { status: InviteStatus.REVOKED } })
    await this.audit.record({
      userId: issuer.sub,
      action: 'invite_revoked',
      entity: 'Invite',
      entityId: id,
      ...ctx,
    })
    return { id, status: InviteStatus.REVOKED }
  }

  /** Список инвайтов, созданных пользователем. Offset-пагинация (админская таблица). */
  async list(issuer: JwtPayload, page: number, limit: number) {
    const where = { createdById: issuer.sub }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.invite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          role: true,
          email: true,
          status: true,
          universityId: true,
          facultyId: true,
          groupId: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      this.prisma.invite.count({ where }),
    ])
    return new Paginated(items, { total })
  }

  /**
   * Атомарно «занимает» инвайт в транзакции регистрации (защита от двойного клика):
   * помечает USED только если он PENDING и не просрочен. Иначе — точный код ошибки.
   * Вызывается из AuthService.registerByInvite внутри его $transaction.
   */
  async claimInvite(tx: Prisma.TransactionClient, token: string) {
    const now = new Date()
    const claim = await tx.invite.updateMany({
      where: { token, status: InviteStatus.PENDING, expiresAt: { gt: now } },
      data: { status: InviteStatus.USED, usedAt: now },
    })
    if (claim.count === 0) {
      const existing = await tx.invite.findUnique({ where: { token }, select: { status: true } })
      if (!existing) {
        throw new AppException('NOT_FOUND', 'Инвайт не найден')
      }
      if (existing.status === InviteStatus.USED) {
        throw new AppException('INVITE_USED', 'Инвайт уже использован')
      }
      if (existing.status === InviteStatus.REVOKED) {
        throw new AppException('INVITE_REVOKED', 'Инвайт отозван')
      }
      throw new AppException('INVITE_EXPIRED', 'Срок инвайта истёк')
    }
    return tx.invite.findUniqueOrThrow({ where: { token } })
  }

  /** Привязывает созданного пользователя к использованному инвайту (аудит). */
  markUsed(tx: Prisma.TransactionClient, inviteId: string, userId: string) {
    return tx.invite.update({ where: { id: inviteId }, data: { usedById: userId } })
  }

  private assertUsable(status: InviteStatus, expiresAt: Date): void {
    if (status === InviteStatus.USED) {
      throw new AppException('INVITE_USED', 'Инвайт уже использован')
    }
    if (status === InviteStatus.REVOKED) {
      throw new AppException('INVITE_REVOKED', 'Инвайт отозван')
    }
    if (status === InviteStatus.EXPIRED || expiresAt.getTime() < Date.now()) {
      throw new AppException('INVITE_EXPIRED', 'Срок инвайта истёк')
    }
  }
}
