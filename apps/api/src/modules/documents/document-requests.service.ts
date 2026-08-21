import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  CreateDocumentRequestInput,
  ReviewSubmissionItemInput,
  SaveSubmissionInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { DocumentsService } from './documents.service'
import { DocumentTypesService } from './document-types.service'

// Ролевая матрица §15.2 (задача 15.18). Запросы создают/проверяют только деканат/студ.офис
// и преподаватель; админ вуза — НЕ участвует в запросах (управляет типами/правами/сроками),
// студент/староста — только отвечают. Преподаватель ограничен учебными типами (см. createRequest).
// Адресаты запроса (вуз/факультет/группа/студент) — их задаёт сотрудник; потолок
// обязателен и здесь (BACKEND_RULES §7.2).
const REQUEST_TARGETS_LIMIT = 200

const REQUEST_STAFF_ROLES: ReadonlySet<Role> = new Set([
  Role.DEAN,
  Role.UNIVERSITY_MODERATOR,
  Role.TEACHER,
])

/**
 * Запросы вуза на документы (Ф15, под-фаза C: задачи 15.14–15.16).
 * Сотрудник создаёт запрос (позиции + адресаты + срок); студент отвечает комплектом,
 * привязывая свои документы к позициям; сотрудник проверяет каждую позицию и комплект.
 * Каждое значимое действие пишется в журнал DocumentEvent (по requestId).
 */
@Injectable()
export class DocumentRequestsService {
  private readonly logger = new Logger(DocumentRequestsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly queue: QueueService,
    private readonly types: DocumentTypesService,
  ) {}

  // Кому адресован запрос — раскрываем адресатов в конкретных студентов вуза (§15.19 уведомления).
  private async resolveTargetStudentIds(
    requestId: string,
    universityId: string,
  ): Promise<string[]> {
    const targets = await this.prisma.documentRequestTarget.findMany({
      where: { requestId },
      select: { targetType: true, targetId: true },
      take: REQUEST_TARGETS_LIMIT,
    })
    const or: Prisma.UserWhereInput[] = []
    for (const t of targets) {
      if (t.targetType === 'UNIVERSITY') or.push({})
      else if (t.targetType === 'FACULTY' && t.targetId) or.push({ facultyId: t.targetId })
      else if (t.targetType === 'GROUP' && t.targetId) or.push({ groupId: t.targetId })
      else if (t.targetType === 'USER' && t.targetId) or.push({ id: t.targetId })
    }
    if (or.length === 0) return []
    const students = await this.prisma.user.findMany({
      where: {
        universityId,
        deletedAt: null,
        isBlocked: false,
        role: { in: [Role.STUDENT, Role.STAROSTA] },
        OR: or,
      },
      select: { id: true },
      take: 5000,
    })
    return students.map((s) => s.id)
  }

  private assertStaff(actor: JwtPayload): void {
    if (!REQUEST_STAFF_ROLES.has(actor.role) || !actor.universityId) {
      throw new AppException('FORBIDDEN', 'Недостаточно прав для запросов документов')
    }
  }

  private async logEvent(
    actorId: string,
    requestId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.documentEvent.create({
      data: { actorId, requestId, action, metadata: metadata as Prisma.InputJsonValue | undefined },
    })
  }

  // Условие «запрос адресован этому студенту» (весь вуз / факультет / группа / персонально).
  private studentTargetWhere(actor: JwtPayload): Prisma.DocumentRequestWhereInput {
    const targetOr: Prisma.DocumentRequestTargetWhereInput[] = [{ targetType: 'UNIVERSITY' }]
    if (actor.facultyId) targetOr.push({ targetType: 'FACULTY', targetId: actor.facultyId })
    if (actor.groupId) targetOr.push({ targetType: 'GROUP', targetId: actor.groupId })
    targetOr.push({ targetType: 'USER', targetId: actor.sub })
    return {
      universityId: actor.universityId ?? '__none__',
      targets: { some: { OR: targetOr } },
    }
  }

  // ── Сотрудник: создание и просмотр запросов (15.14) ─────────────────────────

  async createRequest(actor: JwtPayload, input: CreateDocumentRequestInput) {
    this.assertStaff(actor)
    // Типы позиций — из эффективного каталога вуза (15.20: учитывает вкл/выкл и custom-типы).
    // Преподаватель (§15.2) вправе запрашивать только учебные типы.
    for (const item of input.items) {
      const category = await this.types.resolveUsable(actor.universityId ?? null, item.documentType)
      if (actor.role === Role.TEACHER && category !== 'ACADEMIC') {
        throw new AppException(
          'FORBIDDEN',
          'Преподаватель может запрашивать только учебные документы',
        )
      }
    }
    // Адресаты: targetId обязателен для FACULTY/GROUP/USER.
    for (const tgt of input.targets) {
      if (tgt.targetType !== 'UNIVERSITY' && !tgt.targetId) {
        throw new AppException('BAD_REQUEST', 'Для адресата не указан получатель')
      }
    }
    const created = await this.prisma.documentRequest.create({
      data: {
        universityId: actor.universityId!,
        createdById: actor.sub,
        title: input.title,
        description: input.description || null,
        dueAt: input.dueAt ?? null,
        items: {
          create: input.items.map((it, i) => ({
            documentType: it.documentType,
            title: it.title,
            required: it.required ?? true,
            order: i,
          })),
        },
        targets: {
          create: input.targets.map((t) => ({
            targetType: t.targetType,
            targetId: t.targetType === 'UNIVERSITY' ? null : (t.targetId ?? null),
          })),
        },
      },
      select: { id: true },
    })
    await this.logEvent(actor.sub, created.id, 'REQUEST_CREATE', { items: input.items.length })
    // Уведомляем адресованных студентов о новом запросе (§15.19).
    const recipientIds = await this.resolveTargetStudentIds(created.id, actor.universityId!)
    if (recipientIds.length > 0) {
      await this.queue.enqueue(
        QUEUES.NOTIFICATIONS,
        NOTIFICATION_JOBS.DOCUMENT_REQUEST,
        {
          recipientIds,
          type: 'SYSTEM',
          title: 'Новый запрос документов',
          body: `«${input.title}»`,
          data: { requestId: created.id, url: '/documents' },
          dedupeKey: `doc-request:${created.id}`,
        },
        { jobId: `doc-request:${created.id}` },
      )
    }
    return this.getRequestForStaff(actor, created.id)
  }

  async listAuthored(actor: JwtPayload) {
    this.assertStaff(actor)
    const rows = await this.prisma.documentRequest.findMany({
      where: { universityId: actor.universityId!, createdById: actor.sub },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        dueAt: true,
        status: true,
        createdAt: true,
        _count: { select: { items: true, targets: true, submissions: true } },
        submissions: { select: { status: true } },
      },
    })
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      dueAt: r.dueAt,
      status: r.status,
      createdAt: r.createdAt,
      itemCount: r._count.items,
      targetCount: r._count.targets,
      submissionCount: r._count.submissions,
      submittedCount: r.submissions.filter((s) => s.status !== 'DRAFT').length,
    }))
  }

  private async findAuthoredOrThrow(actor: JwtPayload, id: string): Promise<{ id: string }> {
    // §15.2/15.18: сотрудник управляет и проверяет только СВОИ запросы (его подразделение),
    // не заглядывая в чужие. Scope сужен с «того же вуза» до автора запроса.
    const req = await this.prisma.documentRequest.findFirst({
      where: { id, createdById: actor.sub },
      select: { id: true },
    })
    if (!req) throw new AppException('NOT_FOUND', 'Запрос не найден')
    return req
  }

  async getRequestForStaff(actor: JwtPayload, id: string) {
    this.assertStaff(actor)
    await this.findAuthoredOrThrow(actor, id)
    const req = await this.prisma.documentRequest.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        dueAt: true,
        status: true,
        createdAt: true,
        items: {
          orderBy: { order: 'asc' },
          select: { id: true, documentType: true, title: true, required: true, order: true },
        },
        targets: { select: { id: true, targetType: true, targetId: true } },
        submissions: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            submittedAt: true,
            reviewedAt: true,
            student: { select: { id: true, firstName: true, lastName: true } },
            _count: { select: { items: true } },
          },
        },
      },
    })
    if (!req) throw new AppException('NOT_FOUND', 'Запрос не найден')
    return {
      ...req,
      submissions: req.submissions.map((s) => ({
        id: s.id,
        status: s.status,
        submittedAt: s.submittedAt,
        reviewedAt: s.reviewedAt,
        studentId: s.student.id,
        studentName: `${s.student.lastName} ${s.student.firstName}`.trim(),
        itemCount: s._count.items,
      })),
    }
  }

  // ── Сотрудник: проверка комплекта (15.16) ───────────────────────────────────

  async getSubmissionForStaff(actor: JwtPayload, submissionId: string) {
    this.assertStaff(actor)
    const sub = await this.prisma.documentSubmission.findFirst({
      where: { id: submissionId, request: { createdById: actor.sub } },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        request: { select: { id: true, title: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
        items: {
          select: {
            id: true,
            status: true,
            rejectionReason: true,
            requestItem: {
              select: { id: true, title: true, documentType: true, required: true, order: true },
            },
            document: {
              select: {
                id: true,
                title: true,
                type: true,
                numberLast4: true,
                files: { select: { id: true, mime: true }, orderBy: { order: 'asc' } },
                _count: { select: { files: true } },
              },
            },
          },
        },
      },
    })
    if (!sub) throw new AppException('NOT_FOUND', 'Комплект не найден')
    return {
      id: sub.id,
      status: sub.status,
      submittedAt: sub.submittedAt,
      reviewedAt: sub.reviewedAt,
      requestId: sub.request.id,
      requestTitle: sub.request.title,
      studentId: sub.student.id,
      studentName: `${sub.student.lastName} ${sub.student.firstName}`.trim(),
      items: sub.items
        .sort((a, b) => a.requestItem.order - b.requestItem.order)
        .map((it) => ({
          id: it.id,
          status: it.status,
          rejectionReason: it.rejectionReason,
          requestItemId: it.requestItem.id,
          requestItemTitle: it.requestItem.title,
          documentType: it.requestItem.documentType,
          required: it.requestItem.required,
          document: it.document
            ? {
                id: it.document.id,
                title: it.document.title,
                type: it.document.type,
                numberMasked: it.document.numberLast4 ? `******${it.document.numberLast4}` : null,
                fileCount: it.document._count.files,
                files: it.document.files.map((f) => ({ id: f.id, mime: f.mime })),
              }
            : null,
        })),
    }
  }

  /** Presigned-URL к файлу приложенного документа для проверяющего сотрудника (с логом VIEW). */
  async getSubmissionFileUrl(
    actor: JwtPayload,
    submissionItemId: string,
    fileId: string,
  ): Promise<string> {
    this.assertStaff(actor)
    const item = await this.prisma.documentSubmissionItem.findFirst({
      where: {
        id: submissionItemId,
        documentId: { not: null },
        submission: { request: { createdById: actor.sub } },
      },
      select: { documentId: true, submission: { select: { requestId: true } } },
    })
    if (!item?.documentId) throw new AppException('NOT_FOUND', 'Документ не найден')
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, documentId: item.documentId },
      select: { id: true },
    })
    if (!file) throw new AppException('NOT_FOUND', 'Файл не найден')
    await this.prisma.documentEvent.create({
      data: {
        actorId: actor.sub,
        documentId: item.documentId,
        requestId: item.submission.requestId,
        action: 'VIEW',
        metadata: { fileId, viaSubmission: submissionItemId },
      },
    })
    return this.documents.presign(fileId)
  }

  async reviewItem(actor: JwtPayload, submissionItemId: string, input: ReviewSubmissionItemInput) {
    this.assertStaff(actor)
    const item = await this.prisma.documentSubmissionItem.findFirst({
      where: { id: submissionItemId, submission: { request: { createdById: actor.sub } } },
      select: { id: true, submission: { select: { id: true, requestId: true } } },
    })
    if (!item) throw new AppException('NOT_FOUND', 'Позиция не найдена')
    await this.prisma.documentSubmissionItem.update({
      where: { id: submissionItemId },
      data: {
        status: input.status,
        rejectionReason: input.status === 'REJECTED' ? (input.rejectionReason ?? null) : null,
        reviewedById: actor.sub,
        reviewedAt: new Date(),
      },
    })
    await this.logEvent(
      actor.sub,
      item.submission.requestId,
      input.status === 'ACCEPTED' ? 'ACCEPT' : 'REJECT',
      {
        submissionItemId,
      },
    )
    return this.getSubmissionForStaff(actor, item.submission.id)
  }

  /** Завершить проверку комплекта: статус выводится из вердиктов позиций. */
  async finalizeSubmission(actor: JwtPayload, submissionId: string) {
    this.assertStaff(actor)
    const sub = await this.prisma.documentSubmission.findFirst({
      where: { id: submissionId, request: { createdById: actor.sub } },
      select: {
        id: true,
        requestId: true,
        studentId: true,
        request: { select: { title: true } },
        items: { select: { status: true } },
      },
    })
    if (!sub) throw new AppException('NOT_FOUND', 'Комплект не найден')
    const statuses = sub.items.map((i) => i.status)
    const hasRejected = statuses.includes('REJECTED')
    const allAccepted = statuses.length > 0 && statuses.every((s) => s === 'ACCEPTED')
    const status = hasRejected ? 'REJECTED' : allAccepted ? 'ACCEPTED' : 'PARTIAL'
    await this.prisma.documentSubmission.update({
      where: { id: submissionId },
      data: { status, reviewedById: actor.sub, reviewedAt: new Date() },
    })
    await this.logEvent(actor.sub, sub.requestId, 'REVIEW', { status })
    // Уведомляем студента о результате проверки (§15.19). dedupeKey включает статус,
    // чтобы повторная проверка (изменение вердикта) дошла новым уведомлением.
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.DOCUMENT_RESULT,
      {
        recipientIds: [sub.studentId],
        type: 'SYSTEM',
        title: 'Результат проверки документов',
        body: `«${sub.request.title}»`,
        data: { requestId: sub.requestId, status, url: '/documents' },
        dedupeKey: `doc-result:${submissionId}:${status}`,
      },
      { jobId: `doc-result:${submissionId}:${status}` },
    )
    return this.getSubmissionForStaff(actor, submissionId)
  }

  // ── Студент: свои запросы и ответы (15.15) ──────────────────────────────────

  async listForStudent(actor: JwtPayload) {
    const rows = await this.prisma.documentRequest.findMany({
      where: { status: 'OPEN', ...this.studentTargetWhere(actor) },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        title: true,
        dueAt: true,
        status: true,
        createdAt: true,
        _count: { select: { items: true } },
        items: { where: { required: true }, select: { id: true } },
        submissions: {
          where: { studentId: actor.sub },
          select: {
            status: true,
            items: { where: { documentId: { not: null } }, select: { requestItemId: true } },
          },
        },
      },
    })
    return rows.map((r) => {
      const sub = r.submissions[0] ?? null
      const requiredIds = new Set(r.items.map((i) => i.id))
      const filledRequired = sub
        ? sub.items.filter((si) => requiredIds.has(si.requestItemId)).length
        : 0
      return {
        id: r.id,
        title: r.title,
        dueAt: r.dueAt,
        status: r.status,
        createdAt: r.createdAt,
        itemCount: r._count.items,
        requiredCount: requiredIds.size,
        filledRequired,
        submissionStatus: sub?.status ?? null,
      }
    })
  }

  async getForStudent(actor: JwtPayload, id: string) {
    const req = await this.prisma.documentRequest.findFirst({
      where: { id, ...this.studentTargetWhere(actor) },
      select: {
        id: true,
        title: true,
        description: true,
        dueAt: true,
        status: true,
        createdAt: true,
        items: {
          orderBy: { order: 'asc' },
          select: { id: true, documentType: true, title: true, required: true, order: true },
        },
        submissions: {
          where: { studentId: actor.sub },
          select: {
            id: true,
            status: true,
            submittedAt: true,
            items: {
              select: {
                requestItemId: true,
                status: true,
                rejectionReason: true,
                document: { select: { id: true, title: true, type: true } },
              },
            },
          },
        },
      },
    })
    if (!req) throw new AppException('NOT_FOUND', 'Запрос не найден')
    const sub = req.submissions[0] ?? null
    return {
      id: req.id,
      title: req.title,
      description: req.description,
      dueAt: req.dueAt,
      status: req.status,
      createdAt: req.createdAt,
      items: req.items,
      submission: sub
        ? {
            id: sub.id,
            status: sub.status,
            submittedAt: sub.submittedAt,
            items: sub.items.map((it) => ({
              requestItemId: it.requestItemId,
              status: it.status,
              rejectionReason: it.rejectionReason,
              document: it.document,
            })),
          }
        : null,
    }
  }

  /** Сохранить черновик ответа: привязать выбранные документы к позициям запроса. */
  async saveSubmission(actor: JwtPayload, requestId: string, input: SaveSubmissionInput) {
    const req = await this.prisma.documentRequest.findFirst({
      where: { id: requestId, status: 'OPEN', ...this.studentTargetWhere(actor) },
      select: { id: true, items: { select: { id: true } } },
    })
    if (!req) throw new AppException('NOT_FOUND', 'Запрос не найден')
    const itemIds = new Set(req.items.map((i) => i.id))
    for (const it of input.items) {
      if (!itemIds.has(it.requestItemId)) {
        throw new AppException('BAD_REQUEST', 'Позиция не принадлежит запросу')
      }
    }
    // Проверяем, что выбранные документы принадлежат студенту.
    const docIds = input.items.map((i) => i.documentId).filter((d): d is string => !!d)
    if (docIds.length > 0) {
      const owned = await this.prisma.document.count({
        where: { id: { in: docIds }, ownerId: actor.sub, deletedAt: null },
      })
      if (owned !== new Set(docIds).size) {
        throw new AppException('BAD_REQUEST', 'Некоторые документы недоступны')
      }
    }
    const submission = await this.prisma.documentSubmission.upsert({
      where: { requestId_studentId: { requestId, studentId: actor.sub } },
      create: { requestId, studentId: actor.sub, status: 'DRAFT' },
      update: {},
      select: { id: true },
    })
    // Апсертим позиции; отвязка при documentId=null.
    await this.prisma.$transaction(
      input.items.map((it) =>
        it.documentId === null
          ? this.prisma.documentSubmissionItem.deleteMany({
              where: { submissionId: submission.id, requestItemId: it.requestItemId },
            })
          : this.prisma.documentSubmissionItem.upsert({
              where: {
                submissionId_requestItemId: {
                  submissionId: submission.id,
                  requestItemId: it.requestItemId,
                },
              },
              create: {
                submissionId: submission.id,
                requestItemId: it.requestItemId,
                documentId: it.documentId,
                status: 'PENDING',
              },
              update: { documentId: it.documentId, status: 'PENDING', rejectionReason: null },
            }),
      ),
    )
    return this.getForStudent(actor, requestId)
  }

  /** Отправить комплект на проверку: все обязательные позиции должны быть заполнены. */
  async submitSubmission(actor: JwtPayload, requestId: string) {
    const req = await this.prisma.documentRequest.findFirst({
      where: { id: requestId, status: 'OPEN', ...this.studentTargetWhere(actor) },
      select: {
        id: true,
        items: { where: { required: true }, select: { id: true } },
        submissions: {
          where: { studentId: actor.sub },
          select: {
            id: true,
            items: { where: { documentId: { not: null } }, select: { requestItemId: true } },
          },
        },
      },
    })
    if (!req) throw new AppException('NOT_FOUND', 'Запрос не найден')
    const sub = req.submissions[0]
    if (!sub) throw new AppException('BAD_REQUEST', 'Черновик ответа не создан')
    const filled = new Set(sub.items.map((i) => i.requestItemId))
    const missing = req.items.filter((i) => !filled.has(i.id))
    if (missing.length > 0) {
      throw new AppException('BAD_REQUEST', 'Заполните все обязательные позиции')
    }
    await this.prisma.documentSubmission.update({
      where: { id: sub.id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
        items: { updateMany: { where: {}, data: { status: 'PENDING', rejectionReason: null } } },
      },
    })
    await this.logEvent(actor.sub, requestId, 'SUBMIT', { submissionId: sub.id })
    return this.getForStudent(actor, requestId)
  }
}
