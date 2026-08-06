import { Injectable, Logger } from '@nestjs/common'
import { ComplaintStatus, ComplaintTargetType, Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  ComplaintListQueryInput,
  CreateComplaintInput,
  ResolveComplaintInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { UserService } from '../users/users.service'

const USER_MINI = { select: { id: true, firstName: true, lastName: true } }

const COMPLAINT_SELECT = {
  id: true,
  targetType: true,
  targetId: true,
  reason: true,
  status: true,
  universityId: true,
  resolution: true,
  resolvedAt: true,
  createdAt: true,
  reporter: USER_MINI,
  resolvedBy: USER_MINI,
} satisfies Prisma.ComplaintSelect

type ComplaintRow = Prisma.ComplaintGetPayload<{ select: typeof COMPLAINT_SELECT }>

interface TargetInfo {
  universityId: string | null
  ownerId: string | null
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly users: UserService,
  ) {}

  // ── Создание (11.2) ──────────────────────────────────────────────────────

  async create(reporter: JwtPayload, input: CreateComplaintInput, ctx: RequestContext) {
    const target = await this.getTarget(input.targetType as ComplaintTargetType, input.targetId)
    const complaint = await this.prisma.complaint.create({
      data: {
        reporterId: reporter.sub,
        targetType: input.targetType as ComplaintTargetType,
        targetId: input.targetId,
        reason: input.reason,
        universityId: target.universityId,
      },
      select: COMPLAINT_SELECT,
    })
    await this.audit.record({
      userId: reporter.sub,
      action: 'complaint_created',
      entity: 'Complaint',
      entityId: complaint.id,
      metadata: { targetType: input.targetType, targetId: input.targetId },
      ...ctx,
    })
    return complaint
  }

  // ── Очередь и просмотр (11.3) ────────────────────────────────────────────

  async list(viewer: JwtPayload, query: ComplaintListQueryInput): Promise<Paginated<ComplaintRow>> {
    const where: Prisma.ComplaintWhereInput = {
      ...this.scopeWhere(viewer),
      ...(query.status ? { status: query.status as ComplaintStatus } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.complaint.findMany({
        where,
        select: COMPLAINT_SELECT,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.complaint.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  async getById(viewer: JwtPayload, id: string): Promise<ComplaintRow> {
    return this.findScoped(viewer, id)
  }

  // ── Разрешение (11.4) ────────────────────────────────────────────────────

  async resolve(actor: JwtPayload, id: string, input: ResolveComplaintInput, ctx: RequestContext) {
    const complaint = await this.findScoped(actor, id)
    if (
      complaint.status === ComplaintStatus.RESOLVED ||
      complaint.status === ComplaintStatus.DISMISSED
    ) {
      throw new AppException('CONFLICT', 'Жалоба уже обработана')
    }
    const targetType = complaint.targetType

    if (input.action === 'DELETE_CONTENT') {
      if (targetType === ComplaintTargetType.USER) {
        throw new AppException('BAD_REQUEST', 'Для пользователя используйте блокировку')
      }
      await this.softDeleteTarget(targetType, complaint.targetId)
    } else if (input.action === 'BLOCK_USER') {
      const target = await this.getTarget(targetType, complaint.targetId).catch(() => null)
      const ownerId = target?.ownerId
      if (!ownerId)
        throw new AppException('BAD_REQUEST', 'Не удалось определить пользователя для блокировки')
      // UserService.setBlocked проверяет scope и рвёт сессии.
      await this.users.setBlocked(actor, ownerId, true)
    }

    const status = input.action === 'DISMISS' ? ComplaintStatus.DISMISSED : ComplaintStatus.RESOLVED
    const updated = await this.prisma.complaint.update({
      where: { id },
      data: { status, resolvedById: actor.sub, resolution: input.comment, resolvedAt: new Date() },
      select: COMPLAINT_SELECT,
    })

    await this.audit.record({
      userId: actor.sub,
      action: 'complaint_resolved',
      entity: 'Complaint',
      entityId: id,
      metadata: { action: input.action, targetType, targetId: complaint.targetId },
      ...ctx,
    })

    // Уведомить автора жалобы (11.4).
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.COMPLAINT_RESOLVED,
      {
        recipientIds: [complaint.reporter.id],
        type: 'SYSTEM',
        title: 'Жалоба рассмотрена',
        body:
          input.action === 'DISMISS'
            ? 'Ваша жалоба отклонена модератором'
            : 'По вашей жалобе приняты меры',
        data: { complaintId: id },
        dedupeKey: `complaint-resolved:${id}`,
      },
      { jobId: `complaint-resolved:${id}` },
    )
    return updated
  }

  // ── Доступ модератора к личному чату по жалобе (11.5) ──────────────────────

  /** Контекст сообщения-цели: доступен модератору ТОЛЬКО при наличии жалобы, всегда с аудитом. */
  async getMessageContext(actor: JwtPayload, id: string, ctx: RequestContext) {
    const complaint = await this.findScoped(actor, id)
    if (complaint.targetType !== ComplaintTargetType.MESSAGE) {
      throw new AppException('BAD_REQUEST', 'Жалоба не на сообщение')
    }
    const target = await this.prisma.message.findUnique({
      where: { id: complaint.targetId },
      select: { chatId: true },
    })
    if (!target) throw new AppException('NOT_FOUND', 'Сообщение не найдено')

    // §11.5/§14.8 — каждый доступ администратора к личному чату фиксируется в AuditLog.
    await this.audit.record({
      userId: actor.sub,
      action: 'moderator_chat_access',
      entity: 'Chat',
      entityId: target.chatId,
      metadata: { complaintId: id, messageId: complaint.targetId },
      ...ctx,
    })

    return this.prisma.message.findMany({
      where: { chatId: target.chatId },
      select: {
        id: true,
        senderId: true,
        content: true,
        createdAt: true,
        deletedAt: true,
        sender: USER_MINI,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────────

  private scopeWhere(viewer: JwtPayload): Prisma.ComplaintWhereInput {
    if (isPlatform(viewer.role)) return {}
    // UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR — только свой вуз.
    return { universityId: viewer.universityId ?? '__none__' }
  }

  private async findScoped(viewer: JwtPayload, id: string): Promise<ComplaintRow> {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
      select: COMPLAINT_SELECT,
    })
    if (!complaint) throw new AppException('NOT_FOUND', 'Жалоба не найдена')
    if (!isPlatform(viewer.role) && complaint.universityId !== viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Жалоба другого университета')
    }
    return complaint
  }

  /** Проверка существования цели и вычисление её вуза/владельца. */
  private async getTarget(type: ComplaintTargetType, targetId: string): Promise<TargetInfo> {
    switch (type) {
      case ComplaintTargetType.STORY:
        throw new AppException('BAD_REQUEST', 'Жалобы на истории пока не поддерживаются')
      case ComplaintTargetType.POST: {
        const p = await this.prisma.post.findFirst({
          where: { id: targetId, deletedAt: null },
          select: {
            authorId: true,
            universityId: true,
            author: { select: { universityId: true } },
          },
        })
        if (!p) throw new AppException('NOT_FOUND', 'Пост не найден')
        return { universityId: p.universityId ?? p.author.universityId, ownerId: p.authorId }
      }
      case ComplaintTargetType.COMMENT: {
        const c = await this.prisma.comment.findFirst({
          where: { id: targetId, deletedAt: null },
          select: { authorId: true, author: { select: { universityId: true } } },
        })
        if (!c) throw new AppException('NOT_FOUND', 'Комментарий не найден')
        return { universityId: c.author.universityId, ownerId: c.authorId }
      }
      case ComplaintTargetType.MESSAGE: {
        const m = await this.prisma.message.findFirst({
          where: { id: targetId, deletedAt: null },
          select: { senderId: true, sender: { select: { universityId: true } } },
        })
        if (!m) throw new AppException('NOT_FOUND', 'Сообщение не найдено')
        return { universityId: m.sender.universityId, ownerId: m.senderId }
      }
      case ComplaintTargetType.USER: {
        const u = await this.prisma.user.findFirst({
          where: { id: targetId, deletedAt: null },
          select: { id: true, universityId: true },
        })
        if (!u) throw new AppException('NOT_FOUND', 'Пользователь не найден')
        return { universityId: u.universityId, ownerId: u.id }
      }
      default:
        throw new AppException('BAD_REQUEST', 'Неизвестный тип цели')
    }
  }

  private async softDeleteTarget(type: ComplaintTargetType, targetId: string): Promise<void> {
    const now = new Date()
    if (type === ComplaintTargetType.POST) {
      await this.prisma.post.updateMany({ where: { id: targetId }, data: { deletedAt: now } })
    } else if (type === ComplaintTargetType.COMMENT) {
      await this.prisma.comment.updateMany({ where: { id: targetId }, data: { deletedAt: now } })
    } else if (type === ComplaintTargetType.MESSAGE) {
      await this.prisma.message.updateMany({ where: { id: targetId }, data: { deletedAt: now } })
    }
  }
}
