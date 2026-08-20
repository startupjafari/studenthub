import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  AssignmentListQueryInput,
  CreateAssignmentInput,
  GradeSubmissionInput,
  ReturnSubmissionInput,
  SaveSubmissionDraftInput,
  UpdateAssignmentInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { QueueService } from '../../common/queue/queue.service'
import { QUEUES, NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

// Потолок на список студентов группы при рассылке (BACKEND_RULES §7.2).
const GROUP_STUDENTS_LIMIT = 500

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

const COURSE_MINI = {
  id: true,
  groupId: true,
  teacherId: true,
  subject: { select: { id: true, name: true } },
  group: { select: { id: true, name: true } },
} satisfies Prisma.CourseSelect

const SUBMISSION_SELECT = {
  id: true,
  status: true,
  text: true,
  linkUrl: true,
  attemptNumber: true,
  score: true,
  feedback: true,
  submittedAt: true,
  gradedAt: true,
  createdAt: true,
  student: { select: { id: true, firstName: true, lastName: true } },
  gradedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.SubmissionSelect

const ASSIGNMENT_SELECT = {
  id: true,
  title: true,
  description: true,
  type: true,
  submissionType: true,
  status: true,
  maxScore: true,
  maxAttempts: true,
  allowLate: true,
  publishAt: true,
  dueAt: true,
  createdAt: true,
  course: { select: COURSE_MINI },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.AssignmentSelect

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  // ── Assignments (чтение) ─────────────────────────────────────────────────

  async list(viewer: JwtPayload, query: AssignmentListQueryInput) {
    // AND, не spread: ?status=/?groupId= обязаны СУЖАТЬ scope. У студента scope фиксирует
    // status:{in:[PUBLISHED,CLOSED]} и course.groupId — spread по общим ключам status/course
    // дал бы чтение черновиков (?status=DRAFT) и заданий чужой группы. См. §14.
    const where: Prisma.AssignmentWhereInput = {
      AND: [
        this.scopeWhere(viewer),
        ...(query.courseId ? [{ courseId: query.courseId }] : []),
        ...(query.groupId ? [{ course: { is: { groupId: query.groupId } } }] : []),
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.mine ? [{ createdById: viewer.sub }] : []),
      ],
    }
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const withMine = STUDENT_ROLES.includes(viewer.role)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({
        where,
        select: withMine ? this.selectWithMine(viewer.sub) : ASSIGNMENT_SELECT,
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.assignment.count({ where }),
    ])
    return new Paginated(
      rows.map((r) => this.mapMine(r)),
      { total },
    )
  }

  async getById(viewer: JwtPayload, id: string) {
    const withMine = STUDENT_ROLES.includes(viewer.role)
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      select: withMine ? this.selectWithMine(viewer.sub) : ASSIGNMENT_SELECT,
    })
    if (!assignment) throw new AppException('NOT_FOUND', 'Задание не найдено')
    await this.assertRead(viewer, assignment.course)
    // Черновик виден только тем, кто ведёт дисциплину. Студенту/старосте getById не должен
    // раскрывать DRAFT (list его прячет через scope) — иначе утечка title/условий до публикации.
    if (STUDENT_ROLES.includes(viewer.role) && assignment.status === 'DRAFT') {
      throw new AppException('NOT_FOUND', 'Задание не найдено')
    }
    return this.mapMine(assignment)
  }

  /** Сдачи задания (преподаватель/декан/админ) — для workspace проверки. */
  async submissions(viewer: JwtPayload, assignmentId: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, course: { select: COURSE_MINI } },
    })
    if (!assignment) throw new AppException('NOT_FOUND', 'Задание не найдено')
    await this.assertManage(viewer, assignment.course)
    return this.prisma.submission.findMany({
      where: { assignmentId },
      select: SUBMISSION_SELECT,
      orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
      take: 500,
    })
  }

  // ── Assignments (мутации преподавателя) ───────────────────────────────────

  async create(actor: JwtPayload, input: CreateAssignmentInput, ctx: RequestContext) {
    const course = await this.resolveCourse(input.courseId)
    this.assertManageCourse(actor, course)
    const assignment = await this.prisma.assignment.create({
      data: {
        courseId: input.courseId,
        createdById: actor.sub,
        title: input.title,
        description: input.description,
        type: input.type,
        submissionType: input.submissionType,
        maxScore: input.maxScore,
        maxAttempts: input.maxAttempts,
        allowLate: input.allowLate ?? false,
        publishAt: input.publishAt ? new Date(input.publishAt) : undefined,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      },
      select: ASSIGNMENT_SELECT,
    })
    await this.record(actor, 'assignment_created', assignment.id, ctx)
    return assignment
  }

  async update(actor: JwtPayload, id: string, input: UpdateAssignmentInput, ctx: RequestContext) {
    await this.findManageable(actor, id)
    const assignment = await this.prisma.assignment.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        type: input.type,
        submissionType: input.submissionType,
        maxScore: input.maxScore,
        maxAttempts: input.maxAttempts,
        allowLate: input.allowLate,
        publishAt:
          input.publishAt === undefined
            ? undefined
            : input.publishAt
              ? new Date(input.publishAt)
              : null,
        dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
      },
      select: ASSIGNMENT_SELECT,
    })
    await this.record(actor, 'assignment_updated', id, ctx)
    return assignment
  }

  async setStatus(
    actor: JwtPayload,
    id: string,
    status: 'PUBLISHED' | 'CLOSED',
    ctx: RequestContext,
  ) {
    await this.findManageable(actor, id)
    const assignment = await this.prisma.assignment.update({
      where: { id },
      data: {
        status,
        ...(status === 'PUBLISHED' ? { publishAt: new Date() } : {}),
      },
      select: ASSIGNMENT_SELECT,
    })
    await this.record(actor, `assignment_${status.toLowerCase()}`, id, ctx)
    if (status === 'PUBLISHED') await this.notifyPublished(assignment)
    return assignment
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findManageable(actor, id)
    await this.prisma.assignment.delete({ where: { id } })
    await this.record(actor, 'assignment_deleted', id, ctx)
  }

  // ── Submissions (студент) ─────────────────────────────────────────────────

  async saveDraft(actor: JwtPayload, assignmentId: string, input: SaveSubmissionDraftInput) {
    await this.assertStudentCanSubmit(actor, assignmentId)
    const existing = await this.prisma.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: actor.sub } },
      select: { id: true, status: true },
    })
    if (existing && (existing.status === 'SUBMITTED' || existing.status === 'GRADED')) {
      throw new AppException('CONFLICT', 'Работа уже отправлена')
    }
    const submission = await this.prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId: actor.sub } },
      create: {
        assignmentId,
        studentId: actor.sub,
        status: 'DRAFT',
        text: input.text ?? undefined,
        linkUrl: input.linkUrl ?? undefined,
      },
      update: { text: input.text, linkUrl: input.linkUrl },
      select: SUBMISSION_SELECT,
    })
    return submission
  }

  async submit(actor: JwtPayload, assignmentId: string) {
    const assignment = await this.assertStudentCanSubmit(actor, assignmentId)
    const existing = await this.prisma.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: actor.sub } },
      select: { id: true, status: true, text: true, linkUrl: true, attemptNumber: true },
    })
    if (!existing || (existing.status !== 'DRAFT' && existing.status !== 'RETURNED')) {
      throw new AppException('BAD_REQUEST', 'Нет черновика для отправки')
    }
    if (!existing.text && !existing.linkUrl) {
      throw new AppException('VALIDATION_ERROR', 'Работа пустая')
    }
    // Просрочка без разрешения поздней сдачи.
    if (assignment.dueAt && !assignment.allowLate && new Date() > assignment.dueAt) {
      throw new AppException('CONFLICT', 'Срок сдачи истёк')
    }
    const nextAttempt =
      existing.status === 'RETURNED' ? existing.attemptNumber + 1 : existing.attemptNumber
    return this.prisma.submission.update({
      where: { id: existing.id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), attemptNumber: nextAttempt },
      select: SUBMISSION_SELECT,
    })
  }

  // ── Submissions (преподаватель) ──────────────────────────────────────────

  async grade(
    actor: JwtPayload,
    submissionId: string,
    input: GradeSubmissionInput,
    ctx: RequestContext,
  ) {
    const sub = await this.findGradableSubmission(actor, submissionId)
    if (sub.status !== 'SUBMITTED') throw new AppException('CONFLICT', 'Работа не на проверке')
    const graded = await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'GRADED',
        score: input.score,
        feedback: input.feedback,
        gradedById: actor.sub,
        gradedAt: new Date(),
      },
      select: SUBMISSION_SELECT,
    })
    await this.record(actor, 'submission_graded', submissionId, ctx)
    await this.notifyStudent(
      graded.student.id,
      NOTIFICATION_JOBS.ASSIGNMENT_GRADED,
      'Работа проверена',
      `${sub.assignment.course.subject.name}: ${sub.assignment.title}`,
      { url: '/assignments', submissionId },
      `submission-graded:${submissionId}:${graded.attemptNumber}`,
    )
    return graded
  }

  async returnForFix(
    actor: JwtPayload,
    submissionId: string,
    input: ReturnSubmissionInput,
    ctx: RequestContext,
  ) {
    const sub = await this.findGradableSubmission(actor, submissionId)
    if (sub.status !== 'SUBMITTED') throw new AppException('CONFLICT', 'Работа не на проверке')
    const returned = await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'RETURNED',
        feedback: input.feedback,
        gradedById: actor.sub,
        gradedAt: new Date(),
      },
      select: SUBMISSION_SELECT,
    })
    await this.record(actor, 'submission_returned', submissionId, ctx)
    await this.notifyStudent(
      returned.student.id,
      NOTIFICATION_JOBS.ASSIGNMENT_GRADED,
      'Работа возвращена на исправление',
      `${sub.assignment.course.subject.name}: ${sub.assignment.title}`,
      { url: '/assignments', submissionId },
      `submission-returned:${submissionId}:${returned.attemptNumber}`,
    )
    return returned
  }

  // ── select helpers ────────────────────────────────────────────────────────

  private selectWithMine(studentId: string) {
    return {
      ...ASSIGNMENT_SELECT,
      submissions: { where: { studentId }, select: SUBMISSION_SELECT },
    } satisfies Prisma.AssignmentSelect
  }

  // Свёртка отфильтрованной по студенту связи submissions в единичное поле mySubmission.
  private mapMine(row: object): Record<string, unknown> {
    const r = row as Record<string, unknown>
    if (Array.isArray(r.submissions)) {
      const { submissions, ...rest } = r
      return { ...rest, mySubmission: (submissions as unknown[])[0] ?? null }
    }
    return r
  }

  // ── scope ─────────────────────────────────────────────────────────────────

  private scopeWhere(viewer: JwtPayload): Prisma.AssignmentWhereInput {
    if (isPlatform(viewer.role)) return {}
    if (STUDENT_ROLES.includes(viewer.role)) {
      return {
        status: { in: ['PUBLISHED', 'CLOSED'] },
        course: { is: { groupId: viewer.groupId ?? '__none__' } },
      }
    }
    if (viewer.role === Role.TEACHER) {
      return { course: { is: { teacherId: viewer.sub } } }
    }
    if (viewer.role === Role.DEAN) {
      return { course: { is: { group: { is: { facultyId: viewer.facultyId ?? '__none__' } } } } }
    }
    return {
      course: {
        is: {
          group: { is: { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } } },
        },
      },
    }
  }

  private async assertRead(
    viewer: JwtPayload,
    course: { groupId: string; teacherId: string | null },
  ): Promise<void> {
    if (isPlatform(viewer.role)) return
    if (STUDENT_ROLES.includes(viewer.role)) {
      if (viewer.groupId === course.groupId) return
      throw new AppException('WRONG_SCOPE', 'Задание другой группы')
    }
    if (viewer.role === Role.TEACHER) {
      if (course.teacherId === viewer.sub) return
      throw new AppException('WRONG_SCOPE', 'Не ваша дисциплина')
    }
    const meta = await this.resolveGroup(course.groupId)
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === meta.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Другой факультет')
    }
    if (viewer.universityId === meta.universityId) return
    throw new AppException('WRONG_SCOPE', 'Другой университет')
  }

  private async assertManage(
    viewer: JwtPayload,
    course: { groupId: string; teacherId: string | null },
  ): Promise<void> {
    this.assertManageCourse(viewer, {
      groupId: course.groupId,
      teacherId: course.teacherId,
      ...(await this.resolveGroup(course.groupId)),
    })
  }

  private assertManageCourse(
    actor: JwtPayload,
    course: {
      groupId: string
      teacherId: string | null
      facultyId?: string
      universityId?: string
    },
  ): void {
    if (isPlatform(actor.role)) return
    if (actor.role === Role.TEACHER) {
      if (course.teacherId === actor.sub) return
      throw new AppException('FORBIDDEN', 'Можно управлять только своими дисциплинами')
    }
    if (actor.role === Role.DEAN) {
      if (course.facultyId && actor.facultyId === course.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Другой факультет')
    }
    if (actor.role === Role.UNIVERSITY_ADMIN) {
      if (course.universityId && actor.universityId === course.universityId) return
      throw new AppException('WRONG_SCOPE', 'Другой университет')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  private async findManageable(actor: JwtPayload, id: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      select: { id: true, course: { select: COURSE_MINI } },
    })
    if (!assignment) throw new AppException('NOT_FOUND', 'Задание не найдено')
    await this.assertManage(actor, assignment.course)
    return assignment
  }

  private async assertStudentCanSubmit(
    actor: JwtPayload,
    assignmentId: string,
  ): Promise<{ dueAt: Date | null; allowLate: boolean }> {
    if (!STUDENT_ROLES.includes(actor.role)) {
      throw new AppException('FORBIDDEN', 'Сдавать работы могут только студенты')
    }
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        status: true,
        dueAt: true,
        allowLate: true,
        course: { select: { groupId: true } },
      },
    })
    if (!assignment) throw new AppException('NOT_FOUND', 'Задание не найдено')
    if (assignment.course.groupId !== actor.groupId) {
      throw new AppException('WRONG_SCOPE', 'Задание другой группы')
    }
    if (assignment.status !== 'PUBLISHED') {
      throw new AppException('CONFLICT', 'Задание недоступно для сдачи')
    }
    return { dueAt: assignment.dueAt, allowLate: assignment.allowLate }
  }

  private async findGradableSubmission(actor: JwtPayload, submissionId: string) {
    const sub = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        status: true,
        assignment: { select: { title: true, course: { select: COURSE_MINI } } },
      },
    })
    if (!sub) throw new AppException('NOT_FOUND', 'Работа не найдена')
    await this.assertManage(actor, sub.assignment.course)
    return sub
  }

  // ── Уведомления (задача 24) ────────────────────────────────────────────────

  // Публикация задания → студентам группы (тип SYSTEM: важное, всегда доставляется).
  private async notifyPublished(a: {
    id: string
    title: string
    course: { group: { id: string }; subject: { name: string } }
  }): Promise<void> {
    const students = await this.prisma.user.findMany({
      where: {
        groupId: a.course.group.id,
        role: { in: ['STUDENT', 'STAROSTA'] },
        deletedAt: null,
        isBlocked: false,
      },
      select: { id: true },
      take: GROUP_STUDENTS_LIMIT,
    })
    if (students.length === 0) return
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.ASSIGNMENT_PUBLISHED,
      {
        recipientIds: students.map((s) => s.id),
        type: 'SYSTEM',
        title: 'Новое задание',
        body: `${a.course.subject.name}: ${a.title}`,
        data: { url: '/assignments', assignmentId: a.id },
        dedupeKey: `assignment-published:${a.id}`,
      },
      { jobId: `assignment-published:${a.id}` },
    )
  }

  private async notifyStudent(
    userId: string,
    jobName: string,
    title: string,
    body: string,
    data: Record<string, unknown>,
    dedupeKey: string,
  ): Promise<void> {
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      jobName,
      { recipientIds: [userId], type: 'SYSTEM', title, body, data, dedupeKey },
      { jobId: dedupeKey },
    )
  }

  private async resolveCourse(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        groupId: true,
        teacherId: true,
        group: { select: { facultyId: true, faculty: { select: { universityId: true } } } },
      },
    })
    if (!course) throw new AppException('NOT_FOUND', 'Дисциплина не найдена')
    return {
      groupId: course.groupId,
      teacherId: course.teacherId,
      facultyId: course.group.facultyId,
      universityId: course.group.faculty.universityId,
    }
  }

  private async resolveGroup(
    groupId: string,
  ): Promise<{ facultyId: string; universityId: string }> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { facultyId: true, faculty: { select: { universityId: true } } },
    })
    if (!group) throw new AppException('NOT_FOUND', 'Группа не найдена')
    return { facultyId: group.facultyId, universityId: group.faculty.universityId }
  }

  private async record(
    actor: JwtPayload,
    action: string,
    entityId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.audit.record({ userId: actor.sub, action, entity: 'Assignment', entityId, ...ctx })
  }
}
