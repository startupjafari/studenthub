import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  CreateExamInput,
  ExamListQueryInput,
  SetExamResultsInput,
  UpdateExamInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

const RESULT_SELECT = {
  id: true,
  admitted: true,
  status: true,
  score: true,
  attempt: true,
  note: true,
  student: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ExamResultSelect

const EXAM_SELECT = {
  id: true,
  date: true,
  format: true,
  maxScore: true,
  note: true,
  createdAt: true,
  groupId: true,
  course: { select: { id: true, teacherId: true, subject: { select: { id: true, name: true } } } },
  group: { select: { id: true, name: true } },
  room: { select: { id: true, name: true } },
  examiner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ExamSelect

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(viewer: JwtPayload, query: ExamListQueryInput) {
    const where: Prisma.ExamWhereInput = {
      ...this.scopeWhere(viewer),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.mine ? { OR: [{ examinerId: viewer.sub }, { createdById: viewer.sub }] } : {}),
    }
    const withMine = STUDENT_ROLES.includes(viewer.role)
    const rows = await this.prisma.exam.findMany({
      where,
      select: withMine ? this.selectWithMine(viewer.sub) : EXAM_SELECT,
      orderBy: { date: 'asc' },
      take: 200,
    })
    return rows.map((r) => this.mapMine(r))
  }

  async getById(viewer: JwtPayload, id: string) {
    const withMine = STUDENT_ROLES.includes(viewer.role)
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      select: withMine ? this.selectWithMine(viewer.sub) : EXAM_SELECT,
    })
    if (!exam) throw new AppException('NOT_FOUND', 'Экзамен не найден')
    await this.assertRead(viewer, { groupId: exam.groupId, teacherId: exam.course.teacherId })
    return this.mapMine(exam)
  }

  /** Ведомость экзамена: студенты группы + их результаты (декан/экзаменатор). */
  async results(viewer: JwtPayload, examId: string) {
    const exam = await this.findManageable(viewer, examId)
    const [students, results] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: {
          groupId: exam.groupId,
          role: { in: ['STUDENT', 'STAROSTA'] },
          deletedAt: null,
          isBlocked: false,
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.examResult.findMany({ where: { examId }, select: RESULT_SELECT }),
    ])
    const byStudent = new Map(results.map((r) => [r.student.id, r]))
    return {
      examId,
      students: students.map((s) => {
        const r = byStudent.get(s.id)
        return {
          studentId: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          admitted: r?.admitted ?? true,
          status: r?.status ?? 'SCHEDULED',
          score: r?.score ?? null,
          attempt: r?.attempt ?? 1,
          note: r?.note ?? null,
        }
      }),
    }
  }

  async create(actor: JwtPayload, input: CreateExamInput, ctx: RequestContext) {
    const course = await this.resolveCourse(input.courseId)
    this.assertManageCourse(actor, course)
    if (input.examinerId) await this.assertSameUniversity(input.examinerId, course.universityId)
    if (input.roomId) await this.assertRoomUniversity(input.roomId, course.universityId)
    const exam = await this.prisma.exam.create({
      data: {
        courseId: input.courseId,
        groupId: course.groupId,
        createdById: actor.sub,
        examinerId: input.examinerId ?? course.teacherId,
        roomId: input.roomId,
        date: new Date(input.date),
        format: input.format,
        maxScore: input.maxScore,
        note: input.note,
      },
      select: EXAM_SELECT,
    })
    await this.record(actor, 'exam_created', exam.id, ctx)
    return exam
  }

  async update(actor: JwtPayload, id: string, input: UpdateExamInput, ctx: RequestContext) {
    const exam = await this.findManageable(actor, id)
    if (input.examinerId)
      await this.assertSameUniversity(input.examinerId, await this.universityOfGroup(exam.groupId))
    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        date: input.date ? new Date(input.date) : undefined,
        format: input.format,
        roomId: input.roomId,
        examinerId: input.examinerId,
        maxScore: input.maxScore,
        note: input.note,
      },
      select: EXAM_SELECT,
    })
    await this.record(actor, 'exam_updated', id, ctx)
    return updated
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findManageable(actor, id)
    await this.prisma.exam.delete({ where: { id } })
    await this.record(actor, 'exam_deleted', id, ctx)
  }

  async setResults(actor: JwtPayload, input: SetExamResultsInput, ctx: RequestContext) {
    const exam = await this.findManageable(actor, input.examId)
    const groupStudents = await this.prisma.user.findMany({
      where: { groupId: exam.groupId, role: { in: ['STUDENT', 'STAROSTA'] } },
      select: { id: true },
    })
    const allowed = new Set(groupStudents.map((s) => s.id))
    for (const e of input.entries) {
      if (!allowed.has(e.studentId))
        throw new AppException('WRONG_SCOPE', 'Студент не из этой группы')
    }
    await this.prisma.$transaction(
      input.entries.map((e) =>
        this.prisma.examResult.upsert({
          where: { examId_studentId: { examId: input.examId, studentId: e.studentId } },
          create: {
            examId: input.examId,
            studentId: e.studentId,
            admitted: e.admitted,
            status: e.status,
            score: e.score ?? null,
            note: e.note ?? null,
          },
          update: {
            admitted: e.admitted,
            status: e.status,
            score: e.score ?? null,
            note: e.note ?? null,
          },
        }),
      ),
    )
    await this.audit.record({
      userId: actor.sub,
      action: 'exam_results_set',
      entity: 'Exam',
      entityId: input.examId,
      metadata: { count: input.entries.length },
      ...ctx,
    })
    return this.results(actor, input.examId)
  }

  // ── select helpers ──────────────────────────────────────────────────────

  private selectWithMine(studentId: string) {
    return {
      ...EXAM_SELECT,
      results: { where: { studentId }, select: RESULT_SELECT },
    } satisfies Prisma.ExamSelect
  }

  private mapMine(row: object): Record<string, unknown> {
    const r = row as Record<string, unknown>
    if (Array.isArray(r.results)) {
      const { results, ...rest } = r
      return { ...rest, myResult: (results as unknown[])[0] ?? null }
    }
    return r
  }

  // ── scope ─────────────────────────────────────────────────────────────────

  private scopeWhere(viewer: JwtPayload): Prisma.ExamWhereInput {
    if (isPlatform(viewer.role)) return {}
    if (STUDENT_ROLES.includes(viewer.role)) return { groupId: viewer.groupId ?? '__none__' }
    if (viewer.role === Role.TEACHER) {
      return { OR: [{ course: { is: { teacherId: viewer.sub } } }, { examinerId: viewer.sub }] }
    }
    if (viewer.role === Role.DEAN) {
      return { group: { is: { facultyId: viewer.facultyId ?? '__none__' } } }
    }
    return {
      group: { is: { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } } },
    }
  }

  private async assertRead(
    viewer: JwtPayload,
    exam: { groupId: string; teacherId: string | null },
  ): Promise<void> {
    if (isPlatform(viewer.role)) return
    if (STUDENT_ROLES.includes(viewer.role)) {
      if (viewer.groupId === exam.groupId) return
      throw new AppException('WRONG_SCOPE', 'Экзамен другой группы')
    }
    const meta = await this.resolveGroup(exam.groupId)
    if (viewer.role === Role.TEACHER) {
      if (exam.teacherId === viewer.sub) return
      if (meta.universityId === viewer.universityId) return
      throw new AppException('WRONG_SCOPE', 'Другой университет')
    }
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === meta.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Другой факультет')
    }
    if (viewer.universityId === meta.universityId) return
    throw new AppException('WRONG_SCOPE', 'Другой университет')
  }

  private assertManageCourse(
    actor: JwtPayload,
    course: { teacherId: string | null; facultyId: string; universityId: string },
  ): void {
    if (isPlatform(actor.role)) return
    if (actor.role === Role.TEACHER) {
      if (course.teacherId === actor.sub) return
      throw new AppException('FORBIDDEN', 'Только свои дисциплины')
    }
    if (actor.role === Role.DEAN) {
      if (actor.facultyId === course.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Другой факультет')
    }
    if (actor.role === Role.UNIVERSITY_ADMIN) {
      if (actor.universityId === course.universityId) return
      throw new AppException('WRONG_SCOPE', 'Другой университет')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  private async findManageable(
    actor: JwtPayload,
    id: string,
  ): Promise<{ id: string; groupId: string }> {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      select: {
        id: true,
        groupId: true,
        course: {
          select: {
            teacherId: true,
            group: { select: { facultyId: true, faculty: { select: { universityId: true } } } },
          },
        },
      },
    })
    if (!exam) throw new AppException('NOT_FOUND', 'Экзамен не найден')
    this.assertManageCourse(actor, {
      teacherId: exam.course.teacherId,
      facultyId: exam.course.group.facultyId,
      universityId: exam.course.group.faculty.universityId,
    })
    return { id: exam.id, groupId: exam.groupId }
  }

  private async resolveCourse(courseId: string): Promise<{
    groupId: string
    teacherId: string | null
    facultyId: string
    universityId: string
  }> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
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

  private async universityOfGroup(groupId: string): Promise<string> {
    return (await this.resolveGroup(groupId)).universityId
  }

  private async assertSameUniversity(userId: string, universityId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { universityId: true },
    })
    if (!user || user.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Экзаменатор другого университета')
    }
  }

  private async assertRoomUniversity(roomId: string, universityId: string): Promise<void> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { universityId: true },
    })
    if (!room || room.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Аудитория другого университета')
    }
  }

  private async record(
    actor: JwtPayload,
    action: string,
    entityId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.audit.record({ userId: actor.sub, action, entity: 'Exam', entityId, ...ctx })
  }
}
