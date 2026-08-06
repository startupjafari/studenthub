import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApplicationStatus, AppType, Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  ApplicationListQueryInput,
  CreateApplicationInput,
  TransitionApplicationInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { FileService } from '../files/file.service'
import type { EnvVars } from '../../config/env.schema'

// Конечный автомат статусов заявки (docs/PROJECT.md §3.2).
// Явная матрица допустимых переходов — источник истины для transitionStatus (задача 7.2).
//   NEW → PROCESSING → CLARIFICATION → PROCESSING
//                    ↓
//              APPROVED → READY → CLOSED
//                    ↓
//              REJECTED → CLOSED
export const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  [ApplicationStatus.NEW]: [ApplicationStatus.PROCESSING],
  [ApplicationStatus.PROCESSING]: [
    ApplicationStatus.CLARIFICATION,
    ApplicationStatus.APPROVED,
    ApplicationStatus.REJECTED,
  ],
  [ApplicationStatus.CLARIFICATION]: [ApplicationStatus.PROCESSING],
  [ApplicationStatus.APPROVED]: [ApplicationStatus.READY],
  [ApplicationStatus.REJECTED]: [ApplicationStatus.CLOSED],
  [ApplicationStatus.READY]: [ApplicationStatus.CLOSED],
  [ApplicationStatus.CLOSED]: [],
}

// Статусы, в которых студент ещё может приложить файлы (создание/уточнение).
const ATTACHABLE_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.NEW,
  ApplicationStatus.CLARIFICATION,
]

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  NEW: 'Новая',
  PROCESSING: 'В обработке',
  CLARIFICATION: 'Требуется уточнение',
  APPROVED: 'Одобрена',
  REJECTED: 'Отклонена',
  READY: 'Готова',
  CLOSED: 'Закрыта',
}

const APP_SELECT = {
  id: true,
  type: true,
  subject: true,
  status: true,
  studentId: true,
  facultyId: true,
  createdAt: true,
  updatedAt: true,
  faculty: { select: { universityId: true } },
} satisfies Prisma.ApplicationRequestSelect

const APP_DETAIL_SELECT = {
  ...APP_SELECT,
  body: true,
  student: { select: { id: true, firstName: true, lastName: true } },
  attachments: { select: { id: true, mime: true, size: true, createdAt: true } },
  history: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      comment: true,
      createdAt: true,
      changedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ApplicationRequestSelect

type AppRow = Prisma.ApplicationRequestGetPayload<{ select: typeof APP_SELECT }>

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

function isStaff(role: Role): boolean {
  return (
    role === Role.DEAN ||
    role === Role.UNIVERSITY_ADMIN ||
    role === Role.UNIVERSITY_MODERATOR ||
    isPlatform(role)
  )
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  // ── Создание (7.4) — только STUDENT, факультет из профиля ──────────────────

  async create(actor: JwtPayload, input: CreateApplicationInput, ctx: RequestContext) {
    if (!actor.facultyId) {
      throw new AppException('BAD_REQUEST', 'Студент не привязан к факультету')
    }
    const facultyId = actor.facultyId
    const app = await this.prisma.$transaction(async (tx) => {
      const created = await tx.applicationRequest.create({
        data: {
          studentId: actor.sub,
          facultyId,
          type: input.type as AppType,
          subject: input.subject,
          body: input.body,
          status: ApplicationStatus.NEW,
        },
        select: APP_SELECT,
      })
      // Начальная запись истории: null → NEW.
      await tx.applicationStatusHistory.create({
        data: {
          applicationId: created.id,
          fromStatus: null,
          toStatus: ApplicationStatus.NEW,
          changedById: actor.sub,
        },
      })
      return created
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'application_created',
      entity: 'ApplicationRequest',
      entityId: app.id,
      metadata: { facultyId, type: input.type },
      ...ctx,
    })
    return app
  }

  // ── Список (7.4/7.5) — по scope роли ──────────────────────────────────────

  async list(viewer: JwtPayload, query: ApplicationListQueryInput): Promise<Paginated<AppRow>> {
    const where: Prisma.ApplicationRequestWhereInput = {
      deletedAt: null,
      ...this.scopeWhere(viewer),
      ...(query.status ? { status: query.status as ApplicationStatus } : {}),
      ...(query.type ? { type: query.type as AppType } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.applicationRequest.findMany({
        where,
        select: APP_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.applicationRequest.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  async getById(viewer: JwtPayload, id: string) {
    const app = await this.prisma.applicationRequest.findFirst({
      where: { id, deletedAt: null },
      select: APP_DETAIL_SELECT,
    })
    if (!app) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    this.assertReadScope(viewer, app)
    return app
  }

  // ── Конечный автомат (7.2) ─────────────────────────────────────────────────

  async transitionStatus(
    actor: JwtPayload,
    id: string,
    input: TransitionApplicationInput,
    ctx: RequestContext,
  ) {
    const app = await this.prisma.applicationRequest.findFirst({
      where: { id, deletedAt: null },
      select: APP_SELECT,
    })
    if (!app) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    this.assertStaffScope(actor, app)

    const from = app.status
    const to = input.toStatus as ApplicationStatus
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new AppException('BAD_REQUEST', `Недопустимый переход статуса: ${from} → ${to}`)
    }

    // Обновление статуса + запись истории — атомарно (docs/BACKEND_RULES.md §5.3).
    const [updated, history] = await this.prisma.$transaction([
      this.prisma.applicationRequest.update({
        where: { id },
        data: { status: to },
        select: APP_SELECT,
      }),
      this.prisma.applicationStatusHistory.create({
        data: {
          applicationId: id,
          fromStatus: from,
          toStatus: to,
          changedById: actor.sub,
          comment: input.comment,
        },
        select: { id: true },
      }),
    ])

    await this.audit.record({
      userId: actor.sub,
      action: 'application_status_changed',
      entity: 'ApplicationRequest',
      entityId: id,
      metadata: { from, to },
      ...ctx,
    })

    // Уведомление студенту (7.6): in-app + email офлайн через очередь `notifications`.
    await this.notifyStudent(app.studentId, id, app.subject, to, history.id)

    return updated
  }

  private async notifyStudent(
    studentId: string,
    applicationId: string,
    subject: string,
    to: ApplicationStatus,
    historyId: string,
  ): Promise<void> {
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.APPLICATION_UPDATED,
      {
        recipientIds: [studentId],
        type: 'APP_UPDATE',
        title: 'Обновление по заявке',
        body: `«${subject}»: ${STATUS_LABEL[to]}`,
        data: { applicationId, status: to, url: `/applications/${applicationId}` },
        // Идемпотентность: одно уведомление на переход (docs/BACKEND_RULES.md §9.2).
        dedupeKey: `application-updated:${historyId}`,
      },
      { jobId: `application-updated:${historyId}` },
    )
  }

  // ── Отзыв заявки (7.4) — только владелец и только в NEW ────────────────────

  async withdraw(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const app = await this.prisma.applicationRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, studentId: true, status: true },
    })
    if (!app) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    if (app.studentId !== actor.sub) {
      throw new AppException('WRONG_SCOPE', 'Можно отозвать только свою заявку')
    }
    if (app.status !== ApplicationStatus.NEW) {
      throw new AppException('BAD_REQUEST', 'Отозвать можно только заявку в статусе «Новая»')
    }
    await this.prisma.applicationRequest.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'application_withdrawn',
      entity: 'ApplicationRequest',
      entityId: id,
      ...ctx,
    })
  }

  // ── Вложения (7.4) ─────────────────────────────────────────────────────────

  async addAttachment(actor: JwtPayload, id: string, buffer: Buffer, ctx: RequestContext) {
    const app = await this.prisma.applicationRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, studentId: true, status: true },
    })
    if (!app) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    if (app.studentId !== actor.sub) {
      throw new AppException('WRONG_SCOPE', 'Можно прикреплять файлы только к своей заявке')
    }
    if (!ATTACHABLE_STATUSES.includes(app.status)) {
      throw new AppException(
        'BAD_REQUEST',
        'Вложения доступны только в статусах «Новая»/«Уточнение»',
      )
    }
    const bucket = this.config.get('MINIO_BUCKET_APPLICATIONS', { infer: true })
    const file = await this.files.upload({
      buffer,
      bucket,
      ownerId: actor.sub,
      applicationId: id,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'application_attachment_added',
      entity: 'ApplicationRequest',
      entityId: id,
      metadata: { fileId: file.id },
      ...ctx,
    })
    return { id: file.id, mime: file.mime, size: file.size, createdAt: file.createdAt }
  }

  /** Presigned-ссылка на вложение: доступ владельцу и деканату факультета (scope проверяем здесь). */
  async getAttachmentUrl(viewer: JwtPayload, id: string, fileId: string): Promise<{ url: string }> {
    const app = await this.prisma.applicationRequest.findFirst({
      where: { id, deletedAt: null },
      select: APP_SELECT,
    })
    if (!app) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    this.assertReadScope(viewer, app)
    const file = await this.files.findOrThrow(fileId)
    if (file.applicationId !== id) {
      throw new AppException('NOT_FOUND', 'Вложение не найдено')
    }
    // requesterId не передаём: владение проверено на уровне scope заявки (docs FileService §8).
    const url = await this.files.getPresignedUrl(fileId)
    return { url }
  }

  // ── scope (7.5) ─────────────────────────────────────────────────────────────

  private scopeWhere(viewer: JwtPayload): Prisma.ApplicationRequestWhereInput {
    // Студент и староста видят ТОЛЬКО свои заявки (староста не видит заявки одногруппников — §7.5).
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      return { studentId: viewer.sub }
    }
    if (viewer.role === Role.DEAN) {
      return { facultyId: viewer.facultyId ?? '__none__' }
    }
    if (viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR) {
      return { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } }
    }
    if (isPlatform(viewer.role)) {
      return {}
    }
    // TEACHER и прочие — заявок не имеют и чужие не видят.
    return { id: '__none__' }
  }

  private assertReadScope(viewer: JwtPayload, app: AppRow): void {
    if (isPlatform(viewer.role)) return
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      if (app.studentId === viewer.sub) return
      throw new AppException('WRONG_SCOPE', 'Доступна только своя заявка')
    }
    if (viewer.role === Role.DEAN) {
      if (app.facultyId === viewer.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Заявка другого факультета')
    }
    if (viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR) {
      if (app.faculty.universityId === viewer.universityId) return
      throw new AppException('WRONG_SCOPE', 'Заявка другого университета')
    }
    throw new AppException('FORBIDDEN', 'Нет доступа к заявкам')
  }

  // Смена статуса — только деканат/админ своего scope (роли гейтит @Roles на контроллере).
  private assertStaffScope(actor: JwtPayload, app: AppRow): void {
    if (!isStaff(actor.role)) {
      throw new AppException('FORBIDDEN', 'Смена статуса доступна только деканату')
    }
    if (isPlatform(actor.role)) return
    if (actor.role === Role.DEAN) {
      if (actor.facultyId === app.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Заявка другого факультета')
    }
    // UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR
    if (actor.universityId === app.faculty.universityId) return
    throw new AppException('WRONG_SCOPE', 'Заявка другого университета')
  }
}
