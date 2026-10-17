import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  CreateDocumentRequestInput,
  CursorPaginationInput,
  ReviewSubmissionItemInput,
  SaveSubmissionInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { Paginated } from '../../common/http/paginated'
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

// Позиций в запросе не больше, чем разрешает схема создания (30).
const REQUEST_ITEMS_LIMIT = 30
// Адресаты уведомления о новом запросе читаются и рассылаются пачками без общего потолка:
// прежний `take: 5000` молча оставлял без уведомления студентов большого вуза (D-F25).
const RECIPIENTS_BATCH = 1000
// Комплектов в карточке запроса — первые N; остальные листаются отдельной ручкой
// (`GET manage/:id/submissions`). Запрос «на весь вуз» иначе отдавался тысячами строк разом.
const MANAGE_SUBMISSIONS_LIMIT = 200
// Пачка крона закрытия запросов по сроку.
const CLOSE_BATCH = 500

// Кто сейчас ведёт комплект. Студент меняет и отправляет его, пока комплект не отправлен
// (DRAFT) или возвращён ему после проверки (REJECTED; PARTIAL — проверены не все позиции).
// Отправленный и принятый комплект студенту не изменить: раньше замена документа после
// ACCEPTED оставляла комплект «принятым» уже с другим файлом внутри.
const STUDENT_EDITABLE = ['DRAFT', 'REJECTED', 'PARTIAL']
// Сотрудник проверяет только отправленный комплект: черновик студент ещё не сдавал, а
// принятый или отклонённый ждёт повторной отправки. PARTIAL — проверку можно продолжить.
const STAFF_REVIEWABLE = ['SUBMITTED', 'PARTIAL']

const DAY_MS = 24 * 60 * 60 * 1000
// Из каких статусов принятый в запросе сертификат становится подтверждённым: просроченный,
// отклонённый (в т.ч. отозванный вузом), архивный и черновик подтверждением не становятся.
const VERIFIABLE_STATUSES = ['UPLOADED', 'IN_REVIEW', 'NEEDS_REPLACEMENT', 'ACCEPTED']

// Строка комплекта в карточке запроса у сотрудника.
const SUBMISSION_SUMMARY_SELECT = {
  id: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  student: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { items: true } },
} satisfies Prisma.DocumentSubmissionSelect

function submissionSummary(
  s: Prisma.DocumentSubmissionGetPayload<{ select: typeof SUBMISSION_SUMMARY_SELECT }>,
) {
  return {
    id: s.id,
    status: s.status,
    submittedAt: s.submittedAt,
    reviewedAt: s.reviewedAt,
    studentId: s.student.id,
    studentName: `${s.student.lastName} ${s.student.firstName}`.trim(),
    itemCount: s._count.items,
  }
}

/**
 * Принимает ли запрос ответы: открыт и срок не истёк. Срок из веба приходит датой без
 * времени (полночь UTC), а «до 20.10» значит весь день 20-го, поэтому такой срок длится
 * до конца дня. Срок с явным временем действует до этой минуты.
 */
export function acceptsSubmissions(
  req: { status: string; dueAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (req.status !== 'OPEN') return false
  if (!req.dueAt) return true
  const due = req.dueAt.getTime()
  const deadline = due % DAY_MS === 0 ? due + DAY_MS : due
  return now.getTime() < deadline
}

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

  /**
   * Уведомить адресатов нового запроса (§15.19): адресаты раскрываются в студентов вуза и
   * рассылаются пачками по курсору id — без потолка на весь запрос. Job на пачку: dedupeKey
   * один (идемпотентность у получателя), jobId — с номером пачки.
   */
  private async notifyTargets(
    requestId: string,
    universityId: string,
    title: string,
  ): Promise<number> {
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
    if (or.length === 0) return 0
    const where: Prisma.UserWhereInput = {
      universityId,
      deletedAt: null,
      isBlocked: false,
      role: { in: [Role.STUDENT, Role.STAROSTA] },
      OR: or,
    }
    let total = 0
    let afterId: string | null = null
    for (let batch = 0; ; batch++) {
      const page: { id: string }[] = await this.prisma.user.findMany({
        where: afterId ? { AND: [where, { id: { gt: afterId } }] } : where,
        orderBy: { id: 'asc' },
        select: { id: true },
        take: RECIPIENTS_BATCH,
      })
      if (page.length === 0) break
      await this.queue.enqueue(
        QUEUES.NOTIFICATIONS,
        NOTIFICATION_JOBS.DOCUMENT_REQUEST,
        {
          recipientIds: page.map((u) => u.id),
          type: 'SYSTEM',
          titleKey: 'documents.request.title',
          bodyKey: 'documents.named.body',
          params: { title },
          data: { requestId, url: '/documents' },
          dedupeKey: `doc-request:${requestId}`,
        },
        { jobId: `doc-request:${requestId}:${batch}` },
      )
      total += page.length
      if (page.length < RECIPIENTS_BATCH) break
      afterId = page[page.length - 1]!.id
    }
    return total
  }

  private assertStaff(actor: JwtPayload): void {
    if (!REQUEST_STAFF_ROLES.has(actor.role) || !actor.universityId) {
      throw new AppException('FORBIDDEN', 'Недостаточно прав для запросов документов')
    }
  }

  /**
   * Чьи запросы сотрудник видит и проверяет (D-F25). Раньше — только свои: сменившийся декан
   * не видел и не мог проверить запросы предшественника, а ответы студентов повисали.
   * Модератор вуза — весь вуз; декан — свои и запросы сотрудников своего факультета, кроме
   * преподавательских (те — учебные запросы дисциплины, их ведёт сам преподаватель);
   * преподаватель — только свои.
   */
  private staffScopeWhere(actor: JwtPayload): Prisma.DocumentRequestWhereInput {
    const universityId = actor.universityId!
    if (actor.role === Role.UNIVERSITY_MODERATOR) return { universityId }
    if (actor.role === Role.DEAN && actor.facultyId) {
      return {
        universityId,
        OR: [
          { createdById: actor.sub },
          { createdBy: { facultyId: actor.facultyId, role: { not: Role.TEACHER } } },
        ],
      }
    }
    return { universityId, createdById: actor.sub }
  }

  /**
   * Адресаты — только в области автора. Запрос на документы собирает паспорта и дипломы,
   * поэтому сужения «до своего вуза» мало: декан факультета A иначе адресовал запрос
   * факультету B (или всему вузу, или любому студенту по id) и получал их документы.
   * Весь вуз — модератор вуза; декан — свой факультет, его группы и студентов; преподаватель —
   * группы, где ведёт дисциплины, и их студентов.
   */
  private async assertTargetsInScope(
    actor: JwtPayload,
    targets: CreateDocumentRequestInput['targets'],
  ): Promise<void> {
    const universityId = actor.universityId!
    const isModerator = actor.role === Role.UNIVERSITY_MODERATOR
    let taughtGroups: Set<string> | null = null
    const teacherGroups = async (): Promise<Set<string>> => {
      if (taughtGroups) return taughtGroups
      const courses = await this.prisma.course.findMany({
        where: { teacherId: actor.sub },
        select: { groupId: true },
        take: 500,
      })
      taughtGroups = new Set(courses.map((c) => c.groupId))
      return taughtGroups
    }
    const deny = (): never => {
      throw new AppException('WRONG_SCOPE', 'Адресат вне вашей области')
    }

    for (const tgt of targets) {
      const id = tgt.targetId ?? ''
      if (tgt.targetType === 'UNIVERSITY') {
        if (!isModerator) deny()
      } else if (tgt.targetType === 'FACULTY') {
        if (actor.role === Role.TEACHER) deny()
        if (actor.role === Role.DEAN && id !== actor.facultyId) deny()
        const faculty = await this.prisma.faculty.findFirst({
          where: { id, universityId },
          select: { id: true },
        })
        if (!faculty) deny()
      } else if (tgt.targetType === 'GROUP') {
        const group = await this.prisma.group.findFirst({
          where: { id, faculty: { universityId } },
          select: { facultyId: true },
        })
        if (!group) return deny()
        if (actor.role === Role.DEAN && group.facultyId !== actor.facultyId) deny()
        if (actor.role === Role.TEACHER && !(await teacherGroups()).has(id)) deny()
      } else {
        const student = await this.prisma.user.findFirst({
          where: {
            id,
            universityId,
            deletedAt: null,
            role: { in: [Role.STUDENT, Role.STAROSTA] },
          },
          select: { facultyId: true, groupId: true },
        })
        if (!student) return deny()
        if (actor.role === Role.DEAN && student.facultyId !== actor.facultyId) deny()
        if (
          actor.role === Role.TEACHER &&
          !(student.groupId && (await teacherGroups()).has(student.groupId))
        ) {
          deny()
        }
      }
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

  // Сдача закрыта: запрос закрыт автором или истёк срок.
  private assertAcceptsSubmissions(req: { status: string; dueAt: Date | null }): void {
    if (req.status !== 'OPEN') {
      throw new AppException('CONFLICT', 'Запрос закрыт — ответы больше не принимаются')
    }
    if (!acceptsSubmissions(req)) {
      throw new AppException('CONFLICT', 'Срок сдачи истёк — ответы больше не принимаются')
    }
  }

  private assertStudentEditable(status: string): void {
    if (!STUDENT_EDITABLE.includes(status)) {
      throw new AppException('CONFLICT', 'Комплект уже отправлен на проверку или принят')
    }
  }

  private assertReviewable(status: string): void {
    if (!STAFF_REVIEWABLE.includes(status)) {
      throw new AppException(
        'CONFLICT',
        status === 'DRAFT'
          ? 'Комплект ещё не отправлен студентом'
          : 'Проверка комплекта уже завершена',
      )
    }
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
    await this.assertTargetsInScope(actor, input.targets)
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
    await this.notifyTargets(created.id, actor.universityId!, input.title)
    return this.getRequestForStaff(actor, created.id)
  }

  /**
   * Запросы в области сотрудника (свои и подразделения, см. staffScopeWhere). Имя ручки
   * осталось прежним (`authored`); чужой запрос помечен `mine: false` и именем автора.
   * Счётчики — агрегатами, а не статусами всех комплектов каждого из 200 запросов.
   */
  async listAuthored(actor: JwtPayload) {
    this.assertStaff(actor)
    const rows = await this.prisma.documentRequest.findMany({
      where: this.staffScopeWhere(actor),
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        dueAt: true,
        status: true,
        createdAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { items: true, targets: true, submissions: true } },
      },
    })
    const submitted = rows.length
      ? await this.prisma.documentSubmission.groupBy({
          by: ['requestId'],
          where: { requestId: { in: rows.map((r) => r.id) }, status: { not: 'DRAFT' } },
          _count: { _all: true },
        })
      : []
    const submittedBy = new Map(submitted.map((g) => [g.requestId, g._count._all]))
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      dueAt: r.dueAt,
      status: r.status,
      createdAt: r.createdAt,
      itemCount: r._count.items,
      targetCount: r._count.targets,
      submissionCount: r._count.submissions,
      submittedCount: submittedBy.get(r.id) ?? 0,
      mine: r.createdBy.id === actor.sub,
      authorName: `${r.createdBy.lastName} ${r.createdBy.firstName}`.trim(),
    }))
  }

  private async findInScopeOrThrow(actor: JwtPayload, id: string): Promise<{ id: string }> {
    // §15.2/15.18: сотрудник управляет и проверяет запросы своего подразделения, не
    // заглядывая в чужие (staffScopeWhere).
    const req = await this.prisma.documentRequest.findFirst({
      where: { id, ...this.staffScopeWhere(actor) },
      select: { id: true },
    })
    if (!req) throw new AppException('NOT_FOUND', 'Запрос не найден')
    return req
  }

  async getRequestForStaff(actor: JwtPayload, id: string) {
    this.assertStaff(actor)
    await this.findInScopeOrThrow(actor, id)
    const req = await this.prisma.documentRequest.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        dueAt: true,
        status: true,
        createdAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        items: {
          orderBy: { order: 'asc' },
          select: { id: true, documentType: true, title: true, required: true, order: true },
        },
        targets: { select: { id: true, targetType: true, targetId: true } },
        submissions: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: SUBMISSION_SUMMARY_SELECT,
          take: MANAGE_SUBMISSIONS_LIMIT,
        },
        _count: { select: { submissions: true } },
      },
    })
    if (!req) throw new AppException('NOT_FOUND', 'Запрос не найден')
    const { createdBy, _count, submissions, ...rest } = req
    return {
      ...rest,
      mine: createdBy.id === actor.sub,
      authorName: `${createdBy.lastName} ${createdBy.firstName}`.trim(),
      // Всего комплектов: если больше, чем в `submissions`, остальные — постранично.
      submissionCount: _count.submissions,
      submissions: submissions.map(submissionSummary),
    }
  }

  /** Комплекты запроса постранично (cursor по id, в порядке создания). */
  async listSubmissionsForStaff(actor: JwtPayload, id: string, query: CursorPaginationInput) {
    this.assertStaff(actor)
    await this.findInScopeOrThrow(actor, id)
    const rows = await this.prisma.documentSubmission.findMany({
      where: { requestId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: SUBMISSION_SUMMARY_SELECT,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = rows.length > query.limit
    const page = hasNext ? rows.slice(0, query.limit) : rows
    return new Paginated(page.map(submissionSummary), {
      cursor: hasNext ? page[page.length - 1]?.id : undefined,
      hasNext,
    })
  }

  /**
   * Закрыть запрос (D-F25): ответы больше не принимаются, у студентов он пропадает из списка.
   * Повторное закрытие ничего не меняет.
   */
  async closeRequest(actor: JwtPayload, id: string) {
    this.assertStaff(actor)
    await this.findInScopeOrThrow(actor, id)
    const { count } = await this.prisma.documentRequest.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'CLOSED' },
    })
    if (count > 0) await this.logEvent(actor.sub, id, 'REQUEST_CLOSE')
    return this.getRequestForStaff(actor, id)
  }

  /**
   * Закрыть запросы с прошедшим сроком (для ночного крона; D-F25). Сдача после срока и так
   * отклоняется (acceptsSubmissions), но статус OPEN держал такие запросы в списках студентов.
   * Срок-дата длится до конца дня — ту же границу проверяет acceptsSubmissions.
   */
  async closeOverdue(now: Date = new Date()): Promise<number> {
    let closed = 0
    let afterId: string | null = null
    for (;;) {
      const batch: { id: string; status: string; dueAt: Date | null }[] =
        await this.prisma.documentRequest.findMany({
          where: {
            status: 'OPEN',
            dueAt: { lt: now },
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          orderBy: { id: 'asc' },
          select: { id: true, status: true, dueAt: true },
          take: CLOSE_BATCH,
        })
      if (batch.length === 0) break
      const due = batch.filter((r) => !acceptsSubmissions(r, now)).map((r) => r.id)
      if (due.length > 0) {
        const { count } = await this.prisma.documentRequest.updateMany({
          where: { id: { in: due }, status: 'OPEN' },
          data: { status: 'CLOSED' },
        })
        closed += count
      }
      if (batch.length < CLOSE_BATCH) break
      afterId = batch[batch.length - 1]!.id
    }
    if (closed > 0) this.logger.log(`closeOverdue: закрыто запросов ${closed}`)
    return closed
  }

  // ── Сотрудник: проверка комплекта (15.16) ───────────────────────────────────

  async getSubmissionForStaff(actor: JwtPayload, submissionId: string) {
    this.assertStaff(actor)
    const sub = await this.prisma.documentSubmission.findFirst({
      where: { id: submissionId, request: this.staffScopeWhere(actor) },
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
        submission: { request: this.staffScopeWhere(actor) },
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
      where: { id: submissionItemId, submission: { request: this.staffScopeWhere(actor) } },
      select: {
        id: true,
        documentId: true,
        submission: { select: { id: true, requestId: true, status: true } },
        requestItem: { select: { documentType: true } },
        document: { select: { category: true, type: true } },
      },
    })
    if (!item) throw new AppException('NOT_FOUND', 'Позиция не найдена')
    this.assertReviewable(item.submission.status)
    // Условие на статус комплекта и документ — в самом UPDATE: студент мог вернуть комплект в
    // черновик и заменить документ между чтением и записью — тогда вердикт относился бы к
    // другому файлу.
    const updated = await this.prisma.documentSubmissionItem.updateMany({
      where: {
        id: submissionItemId,
        documentId: item.documentId,
        submission: { status: { in: STAFF_REVIEWABLE } },
      },
      data: {
        status: input.status,
        rejectionReason: input.status === 'REJECTED' ? (input.rejectionReason ?? null) : null,
        reviewedById: actor.sub,
        reviewedAt: new Date(),
      },
    })
    if (updated.count === 0) {
      throw new AppException('CONFLICT', 'Комплект изменился — обновите страницу')
    }
    await this.logEvent(
      actor.sub,
      item.submission.requestId,
      input.status === 'ACCEPTED' ? 'ACCEPT' : 'REJECT',
      {
        submissionItemId,
      },
    )
    if (input.status === 'ACCEPTED') await this.verifyCertificate(actor, item)
    return this.getSubmissionForStaff(actor, item.submission.id)
  }

  /**
   * Сценарий верификации сертификатов (D-F30): принятый сотрудником вуза в запросе документ
   * категории «Сертификаты» становится VERIFIED — так он попадает в «подтверждённые
   * сертификаты» резюме и карточки кандидата, которые раньше в продакшене были всегда пусты.
   * Только если тип документа совпадает с требуемым в позиции: сертификат, приложенный не к
   * своей позиции (например, к учебной позиции преподавателя), этим не подтверждается.
   * Правка содержимого владельцем снимает отметку (DocumentsService).
   */
  private async verifyCertificate(
    actor: JwtPayload,
    item: {
      documentId: string | null
      submission: { requestId: string }
      requestItem: { documentType: string }
      document: { category: string; type: string } | null
    },
  ): Promise<void> {
    const doc = item.document
    if (!item.documentId || !doc || doc.category !== 'CERTIFICATE') return
    if (doc.type !== item.requestItem.documentType) return
    const { count } = await this.prisma.document.updateMany({
      where: { id: item.documentId, deletedAt: null, status: { in: VERIFIABLE_STATUSES } },
      data: { status: 'VERIFIED' },
    })
    if (count === 0) return
    await this.prisma.documentEvent.create({
      data: {
        actorId: actor.sub,
        documentId: item.documentId,
        requestId: item.submission.requestId,
        action: 'ACCEPT',
        metadata: { verified: true },
      },
    })
  }

  /** Завершить проверку комплекта: статус выводится из вердиктов позиций. */
  async finalizeSubmission(actor: JwtPayload, submissionId: string) {
    this.assertStaff(actor)
    const sub = await this.prisma.documentSubmission.findFirst({
      where: { id: submissionId, request: this.staffScopeWhere(actor) },
      select: {
        id: true,
        status: true,
        requestId: true,
        studentId: true,
        request: { select: { title: true } },
        items: { select: { status: true } },
      },
    })
    if (!sub) throw new AppException('NOT_FOUND', 'Комплект не найден')
    this.assertReviewable(sub.status)
    const statuses = sub.items.map((i) => i.status)
    const hasRejected = statuses.includes('REJECTED')
    const allAccepted = statuses.length > 0 && statuses.every((s) => s === 'ACCEPTED')
    const status = hasRejected ? 'REJECTED' : allAccepted ? 'ACCEPTED' : 'PARTIAL'
    // Условный UPDATE: если студент успел вернуть комплект в черновик (заменить документ),
    // итог по прочитанным вердиктам уже неверен — отвечаем 409, а не «принимаем» новый файл.
    const updated = await this.prisma.documentSubmission.updateMany({
      where: { id: submissionId, status: { in: STAFF_REVIEWABLE } },
      data: { status, reviewedById: actor.sub, reviewedAt: new Date() },
    })
    if (updated.count === 0) {
      throw new AppException('CONFLICT', 'Комплект изменился — обновите страницу')
    }
    await this.logEvent(actor.sub, sub.requestId, 'REVIEW', { status })
    // Уведомляем студента о результате проверки (§15.19). dedupeKey включает статус,
    // чтобы повторная проверка (изменение вердикта) дошла новым уведомлением.
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.DOCUMENT_RESULT,
      {
        recipientIds: [sub.studentId],
        type: 'SYSTEM',
        titleKey: 'documents.result.title',
        bodyKey: 'documents.named.body',
        params: { title: sub.request.title },
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
        acceptsSubmissions: acceptsSubmissions(r),
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
      // Можно ли ещё сдавать: запрос открыт и срок не истёк (клиент блокирует форму).
      acceptsSubmissions: acceptsSubmissions(req),
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

  /**
   * Сохранить черновик ответа: привязать выбранные документы к позициям запроса.
   * Менять можно только свой комплект в черновике или возвращённый после проверки, и только
   * пока запрос принимает ответы (D-F07).
   */
  async saveSubmission(actor: JwtPayload, requestId: string, input: SaveSubmissionInput) {
    const req = await this.prisma.documentRequest.findFirst({
      where: { id: requestId, ...this.studentTargetWhere(actor) },
      select: {
        id: true,
        status: true,
        dueAt: true,
        items: { select: { id: true } },
        submissions: {
          where: { studentId: actor.sub },
          select: {
            id: true,
            status: true,
            items: { select: { requestItemId: true, documentId: true } },
          },
        },
      },
    })
    if (!req) throw new AppException('NOT_FOUND', 'Запрос не найден')
    this.assertAcceptsSubmissions(req)
    const existing = req.submissions[0] ?? null
    if (existing) this.assertStudentEditable(existing.status)
    const itemIds = new Set(req.items.map((i) => i.id))
    for (const it of input.items) {
      if (!itemIds.has(it.requestItemId)) {
        throw new AppException('BAD_REQUEST', 'Позиция не принадлежит запросу')
      }
    }
    // Проверяем, что выбранные документы принадлежат студенту. Отозванная вузом справка
    // (issuedByUniversity + REJECTED) в кабинете остаётся, но подтверждением уже не служит —
    // приложить её к запросу нельзя, как и к заявке (P2-D-services-followup).
    const docIds = input.items.map((i) => i.documentId).filter((d): d is string => !!d)
    if (docIds.length > 0) {
      const owned = await this.prisma.document.findMany({
        where: { id: { in: docIds }, ownerId: actor.sub, deletedAt: null },
        select: { id: true, status: true, issuedByUniversity: true },
        take: REQUEST_ITEMS_LIMIT,
      })
      if (owned.length !== new Set(docIds).size) {
        throw new AppException('BAD_REQUEST', 'Некоторые документы недоступны')
      }
      if (owned.some((d) => d.issuedByUniversity && d.status === 'REJECTED')) {
        throw new AppException('BAD_REQUEST', 'Документ отозван университетом')
      }
    }
    // Пишем только позиции, где выбран другой документ: веб присылает весь чек-лист при
    // каждом сохранении, и у нетронутых позиций сохраняются вердикт и причина отклонения.
    const current = new Map((existing?.items ?? []).map((i) => [i.requestItemId, i.documentId]))
    const changes = input.items.filter(
      (it) => (current.get(it.requestItemId) ?? null) !== it.documentId,
    )
    if (existing && changes.length === 0) return this.getForStudent(actor, requestId)

    await this.prisma.$transaction(async (tx) => {
      const submission = await tx.documentSubmission.upsert({
        where: { requestId_studentId: { requestId, studentId: actor.sub } },
        create: { requestId, studentId: actor.sub, status: 'DRAFT' },
        update: {},
        select: { id: true },
      })
      // Правка возвращает комплект в черновик до повторной отправки: сотрудник не проверит
      // и не примет состав, который студент меняет. Условие на статус — в самом UPDATE:
      // если комплект тем временем отправили или приняли, он не меняется (409).
      const reopened = await tx.documentSubmission.updateMany({
        where: { id: submission.id, status: { in: STUDENT_EDITABLE } },
        data: { status: 'DRAFT' },
      })
      if (reopened.count === 0) {
        throw new AppException('CONFLICT', 'Комплект уже отправлен на проверку или принят')
      }
      // Отвязка при documentId=null; новый документ в позиции ждёт проверки заново.
      for (const it of changes) {
        if (it.documentId === null) {
          await tx.documentSubmissionItem.deleteMany({
            where: { submissionId: submission.id, requestItemId: it.requestItemId },
          })
        } else {
          await tx.documentSubmissionItem.upsert({
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
            update: {
              documentId: it.documentId,
              status: 'PENDING',
              rejectionReason: null,
              reviewedById: null,
              reviewedAt: null,
            },
          })
        }
      }
    })
    return this.getForStudent(actor, requestId)
  }

  /** Отправить комплект на проверку: все обязательные позиции должны быть заполнены. */
  async submitSubmission(actor: JwtPayload, requestId: string) {
    const req = await this.prisma.documentRequest.findFirst({
      where: { id: requestId, ...this.studentTargetWhere(actor) },
      select: {
        id: true,
        title: true,
        status: true,
        dueAt: true,
        createdById: true,
        items: { where: { required: true }, select: { id: true } },
        submissions: { where: { studentId: actor.sub }, select: { id: true, status: true } },
      },
    })
    if (!req) throw new AppException('NOT_FOUND', 'Запрос не найден')
    this.assertAcceptsSubmissions(req)
    const sub = req.submissions[0]
    if (!sub) throw new AppException('BAD_REQUEST', 'Черновик ответа не создан')
    this.assertStudentEditable(sub.status)
    await this.prisma.$transaction(async (tx) => {
      // Условный UPDATE: двойная отправка и отправка уже отправленного или принятого
      // комплекта отвечают 409, а не сбрасывают вердикты проверяющего. Он же блокирует строку
      // комплекта, поэтому параллельное сохранение черновика ждёт, и проверка обязательных
      // позиций ниже видит ровно тот состав, что уходит на проверку.
      const moved = await tx.documentSubmission.updateMany({
        where: { id: sub.id, status: { in: STUDENT_EDITABLE } },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          reviewedById: null,
          reviewedAt: null,
        },
      })
      if (moved.count === 0) {
        throw new AppException('CONFLICT', 'Комплект уже отправлен на проверку или принят')
      }
      const filled = await tx.documentSubmissionItem.findMany({
        where: { submissionId: sub.id, documentId: { not: null } },
        select: { requestItemId: true },
        take: REQUEST_ITEMS_LIMIT,
      })
      const have = new Set(filled.map((i) => i.requestItemId))
      if (req.items.some((i) => !have.has(i.id))) {
        throw new AppException('BAD_REQUEST', 'Заполните все обязательные позиции')
      }
      // Отправка — новая проверка всего комплекта: прежние вердикты сбрасываются.
      await tx.documentSubmissionItem.updateMany({
        where: { submissionId: sub.id },
        data: { status: 'PENDING', rejectionReason: null },
      })
    })
    await this.logEvent(actor.sub, requestId, 'SUBMIT', { submissionId: sub.id })
    await this.notifyAuthorSubmitted(actor, req, sub.id)
    return this.getForStudent(actor, requestId)
  }

  /**
   * Автору запроса — о сданном комплекте (D-F25): иначе он узнавал о сдаче, только открыв
   * запрос. Свёрнуто по запросу (одна строка в колокольчике на запрос, а не на каждого
   * студента) и без письма-зеркала: запрос «на весь вуз» иначе засыпал бы почту.
   */
  private async notifyAuthorSubmitted(
    actor: JwtPayload,
    req: { id: string; title: string; createdById: string },
    submissionId: string,
  ): Promise<void> {
    const student = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { firstName: true, lastName: true },
    })
    const name = student ? `${student.lastName} ${student.firstName}`.trim() : ''
    const event = `doc-submitted:${submissionId}:${Date.now()}`
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.DOCUMENT_SUBMITTED,
      {
        recipientIds: [req.createdById],
        type: 'SYSTEM',
        titleKey: 'documents.submitted.title',
        bodyKey: 'documents.submitted.body',
        params: { name, title: req.title },
        data: { requestId: req.id, submissionId, event, url: '/documents?section=requests' },
        dedupeKey: event,
        collapseKey: `doc-submitted:${req.id}`,
        emailFallback: false,
      },
      { jobId: event },
    )
  }
}
