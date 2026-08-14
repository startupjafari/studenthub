import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  REALTIME_EVENTS,
  type CreateGradeColumnInput,
  type SaveGradesInput,
  type UpdateGradeColumnInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { RealtimeGateway } from '../../common/realtime'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

const COLUMN_SELECT = {
  id: true,
  title: true,
  kind: true,
  maxScore: true,
  position: true,
  published: true,
  createdAt: true,
} satisfies Prisma.GradeColumnSelect

@Injectable()
export class GradebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Журнал дисциплины (преподаватель): колонки + студенты + матрица оценок. */
  async gradebook(viewer: JwtPayload, courseId: string) {
    const course = await this.resolveCourse(courseId)
    this.assertManage(viewer, course)
    const [columns, students, grades] = await this.prisma.$transaction([
      this.prisma.gradeColumn.findMany({
        where: { courseId },
        select: COLUMN_SELECT,
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.user.findMany({
        where: {
          groupId: course.groupId,
          role: { in: ['STUDENT', 'STAROSTA'] },
          deletedAt: null,
          isBlocked: false,
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.grade.findMany({
        where: { column: { courseId } },
        select: { columnId: true, studentId: true, score: true },
      }),
    ])
    return { courseId, columns, students, grades }
  }

  async createColumn(actor: JwtPayload, input: CreateGradeColumnInput, ctx: RequestContext) {
    const course = await this.resolveCourse(input.courseId)
    this.assertManage(actor, course)
    const count = await this.prisma.gradeColumn.count({ where: { courseId: input.courseId } })
    const column = await this.prisma.gradeColumn.create({
      data: {
        courseId: input.courseId,
        createdById: actor.sub,
        title: input.title,
        kind: input.kind,
        maxScore: input.maxScore,
        position: count,
      },
      select: COLUMN_SELECT,
    })
    await this.record(actor, 'grade_column_created', column.id, ctx)
    return column
  }

  async updateColumn(
    actor: JwtPayload,
    id: string,
    input: UpdateGradeColumnInput,
    ctx: RequestContext,
  ) {
    await this.findManageableColumn(actor, id)
    const column = await this.prisma.gradeColumn.update({
      where: { id },
      data: {
        title: input.title,
        kind: input.kind,
        maxScore: input.maxScore,
        position: input.position,
      },
      select: COLUMN_SELECT,
    })
    await this.record(actor, 'grade_column_updated', id, ctx)
    return column
  }

  async setPublished(actor: JwtPayload, id: string, published: boolean, ctx: RequestContext) {
    await this.findManageableColumn(actor, id)
    const column = await this.prisma.gradeColumn.update({
      where: { id },
      data: { published },
      select: COLUMN_SELECT,
    })
    await this.record(
      actor,
      published ? 'grade_column_published' : 'grade_column_unpublished',
      id,
      ctx,
    )
    // Realtime: при публикации колонки точечно уведомляем студентов, у кого есть оценка в ней —
    // экран «Оценки» обновляется вживую. Payload минимальный (только columnId), без значений.
    if (published) {
      const graded = await this.prisma.grade.findMany({
        where: { columnId: id },
        select: { studentId: true },
      })
      for (const g of graded) {
        this.realtime.emitEventToUser(g.studentId, REALTIME_EVENTS.gradePublished, id, {
          columnId: id,
        })
      }
    }
    return column
  }

  async deleteColumn(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findManageableColumn(actor, id)
    await this.prisma.gradeColumn.delete({ where: { id } })
    await this.record(actor, 'grade_column_deleted', id, ctx)
  }

  /** Массовое сохранение оценок колонки (inline-редактирование). score=null очищает ячейку. */
  async saveGrades(actor: JwtPayload, input: SaveGradesInput, ctx: RequestContext) {
    const col = await this.findManageableColumn(actor, input.columnId)
    const groupStudents = await this.prisma.user.findMany({
      where: { groupId: col.course.groupId, role: { in: ['STUDENT', 'STAROSTA'] } },
      select: { id: true },
    })
    const allowed = new Set(groupStudents.map((s) => s.id))
    for (const e of input.entries) {
      if (!allowed.has(e.studentId))
        throw new AppException('WRONG_SCOPE', 'Студент не из этой группы')
    }
    await this.prisma.$transaction(
      input.entries.map((e) =>
        e.score === null
          ? this.prisma.grade.deleteMany({
              where: { columnId: input.columnId, studentId: e.studentId },
            })
          : this.prisma.grade.upsert({
              where: {
                columnId_studentId: { columnId: input.columnId, studentId: e.studentId },
              },
              create: { columnId: input.columnId, studentId: e.studentId, score: e.score },
              update: { score: e.score },
            }),
      ),
    )
    await this.audit.record({
      userId: actor.sub,
      action: 'grades_saved',
      entity: 'GradeColumn',
      entityId: input.columnId,
      metadata: { count: input.entries.length },
      ...ctx,
    })
    return this.prisma.grade.findMany({
      where: { columnId: input.columnId },
      select: { columnId: true, studentId: true, score: true },
    })
  }

  /** Оценки студента по его дисциплинам (только опубликованные колонки). Задача 8. */
  async myGrades(viewer: JwtPayload) {
    if (!STUDENT_ROLES.includes(viewer.role)) {
      throw new AppException('FORBIDDEN', 'Только для студентов')
    }
    const courses = await this.prisma.course.findMany({
      where: { groupId: viewer.groupId ?? '__none__' },
      select: {
        id: true,
        credits: true,
        subject: { select: { id: true, name: true } },
        gradeColumns: {
          where: { published: true },
          select: {
            id: true,
            title: true,
            kind: true,
            maxScore: true,
            position: true,
            grades: { where: { studentId: viewer.sub }, select: { score: true } },
          },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { subject: { name: 'asc' } },
    })
    return courses.map((c) => ({
      courseId: c.id,
      subject: c.subject,
      credits: c.credits,
      columns: c.gradeColumns.map((col) => ({
        id: col.id,
        title: col.title,
        kind: col.kind,
        maxScore: col.maxScore,
        position: col.position,
        score: col.grades[0]?.score ?? null,
      })),
    }))
  }

  // ── scope ─────────────────────────────────────────────────────────────────

  private assertManage(
    actor: JwtPayload,
    course: { teacherId: string | null; facultyId: string; universityId: string },
  ): void {
    if (isPlatform(actor.role)) return
    if (actor.role === Role.TEACHER) {
      if (course.teacherId === actor.sub) return
      throw new AppException('FORBIDDEN', 'Можно вести журнал только своих дисциплин')
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

  private async findManageableColumn(actor: JwtPayload, id: string) {
    const column = await this.prisma.gradeColumn.findUnique({
      where: { id },
      select: {
        id: true,
        course: {
          select: {
            id: true,
            groupId: true,
            teacherId: true,
            group: { select: { facultyId: true, faculty: { select: { universityId: true } } } },
          },
        },
      },
    })
    if (!column) throw new AppException('NOT_FOUND', 'Колонка не найдена')
    const c = column.course
    this.assertManage(actor, {
      teacherId: c.teacherId,
      facultyId: c.group.facultyId,
      universityId: c.group.faculty.universityId,
    })
    return { id: column.id, course: { groupId: c.groupId } }
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

  private async record(
    actor: JwtPayload,
    action: string,
    entityId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.audit.record({ userId: actor.sub, action, entity: 'GradeColumn', entityId, ...ctx })
  }
}
