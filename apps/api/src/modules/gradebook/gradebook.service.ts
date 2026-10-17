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

// Потолки на выборки (BACKEND_RULES §7.2). Журнал ограничен размерами группы и числом
// колонок по смыслу, но лимит обязан стоять в запросе, а не жить в предположении:
// «в группе же не больше тридцати» — это не гарантия, а надежда.
const GROUP_STUDENTS_LIMIT = 200
const COURSE_COLUMNS_LIMIT = 100
const GROUP_COURSES_LIMIT = 100
/** Матрица оценок дисциплины: студенты × колонки. */
const GRADES_MATRIX_LIMIT = GROUP_STUDENTS_LIMIT * COURSE_COLUMNS_LIMIT

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
        take: COURSE_COLUMNS_LIMIT,
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
        take: GROUP_STUDENTS_LIMIT,
      }),
      this.prisma.grade.findMany({
        where: { column: { courseId } },
        select: { columnId: true, studentId: true, score: true },
        take: GRADES_MATRIX_LIMIT,
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
    // Максимум ниже уже выставленной оценки сделал бы её «больше 100 %» — и итог студента,
    // и средний процент в аналитике декана уехали бы за сотню.
    if (input.maxScore != null) {
      const { _max } = await this.prisma.grade.aggregate({
        where: { columnId: id, score: { not: null } },
        _max: { score: true },
      })
      if (_max.score != null && _max.score > input.maxScore) {
        throw new AppException(
          'CONFLICT',
          `В колонке уже есть оценка ${_max.score} — максимум не может быть меньше`,
          [{ field: 'maxScore', message: `Не меньше ${_max.score}` }],
        )
      }
    }
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
    // Realtime: точечно тем, у кого есть оценка в колонке, — экран «Оценки» обновляется
    // вживую. И при публикации, и при снятии с публикации: снятая колонка иначе висела бы
    // у студента до перезагрузки. Payload минимальный (только columnId), без значений.
    const graded = await this.prisma.grade.findMany({
      where: { columnId: id },
      select: { studentId: true },
      take: GROUP_STUDENTS_LIMIT,
    })
    this.emitGradesChanged(
      id,
      graded.map((g) => g.studentId),
    )
    return column
  }

  async deleteColumn(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const column = await this.findManageableColumn(actor, id)
    // Опубликованные оценки студенты уже видели: колонку с ними сначала снимают с публикации,
    // а не стирают одним нажатием вместе с оценками.
    if (column.published) {
      const graded = await this.prisma.grade.count({
        where: { columnId: id, score: { not: null } },
      })
      if (graded > 0) {
        throw new AppException('CONFLICT', 'В опубликованной колонке есть оценки')
      }
    }
    await this.prisma.gradeColumn.delete({ where: { id } })
    await this.record(actor, 'grade_column_deleted', id, ctx)
  }

  /** Массовое сохранение оценок колонки (inline-редактирование). score=null очищает ячейку. */
  async saveGrades(actor: JwtPayload, input: SaveGradesInput, ctx: RequestContext) {
    const col = await this.findManageableColumn(actor, input.columnId)
    const groupStudents = await this.prisma.user.findMany({
      where: {
        groupId: col.course.groupId,
        role: { in: ['STUDENT', 'STAROSTA'] },
        deletedAt: null,
      },
      select: { id: true },
      take: GROUP_STUDENTS_LIMIT,
    })
    const allowed = new Set(groupStudents.map((s) => s.id))
    for (const e of input.entries) {
      if (!allowed.has(e.studentId))
        throw new AppException('WRONG_SCOPE', 'Студент не из этой группы')
    }
    // Схема держит только общий потолок 0..1000, а максимум у каждой колонки свой: лишний
    // ноль («150 из 10») сохранялся как есть. Отказ целиком, с адресом каждой ячейки — путь
    // как у ошибок схемы (`entries.<i>.score`), чтобы клиент подсветил их одинаково.
    const max = col.maxScore
    if (max != null) {
      const over = input.entries.flatMap((e, i) =>
        e.score !== null && e.score > max
          ? [{ field: `entries.${i}.score`, message: `Не больше ${max}` }]
          : [],
      )
      if (over.length > 0) {
        throw new AppException('VALIDATION_ERROR', `Балл больше максимума колонки (${max})`, over)
      }
    }
    // Пишем только то, что действительно меняется: ячейка, присланная с прежним значением,
    // не трогается вовсе. Прежние значения нужны и аудиту — по `{count}` правку
    // опубликованной оценки было не восстановить.
    const before = await this.prisma.grade.findMany({
      where: { columnId: input.columnId, studentId: { in: input.entries.map((e) => e.studentId) } },
      select: { studentId: true, score: true },
      take: input.entries.length,
    })
    const changes = diffGrades(before, input.entries)
    if (changes.length > 0) {
      await this.prisma.$transaction(
        changes.map((c) =>
          c.to === null
            ? this.prisma.grade.deleteMany({
                where: { columnId: input.columnId, studentId: c.studentId },
              })
            : this.prisma.grade.upsert({
                where: {
                  columnId_studentId: { columnId: input.columnId, studentId: c.studentId },
                },
                create: { columnId: input.columnId, studentId: c.studentId, score: c.to },
                update: { score: c.to },
              }),
        ),
      )
    }
    await this.audit.record({
      userId: actor.sub,
      action: 'grades_saved',
      entity: 'GradeColumn',
      entityId: input.columnId,
      metadata: { count: input.entries.length, published: col.published, changes },
      ...ctx,
    })
    // Правка уже опубликованной оценки — то же событие, что публикация: студент видит новое
    // значение без перезагрузки. Черновик студенту не виден — и сообщать не о чем.
    if (col.published) {
      this.emitGradesChanged(
        input.columnId,
        changes.map((c) => c.studentId),
      )
    }
    return this.prisma.grade.findMany({
      where: { columnId: input.columnId },
      select: { columnId: true, studentId: true, score: true },
      take: GROUP_STUDENTS_LIMIT,
    })
  }

  /**
   * Оценки студента по его дисциплинам (только опубликованные колонки). Задача 8.
   *
   * Дисциплины — текущей группы И те, где у студента есть опубликованная оценка: выборка
   * только по группе после перевода в другую группу прятала всю прошлую успеваемость.
   */
  async myGrades(viewer: JwtPayload) {
    if (!STUDENT_ROLES.includes(viewer.role)) {
      throw new AppException('FORBIDDEN', 'Только для студентов')
    }
    const courses = await this.prisma.course.findMany({
      take: GROUP_COURSES_LIMIT,
      where: {
        OR: [
          { groupId: viewer.groupId ?? '__none__' },
          {
            gradeColumns: {
              some: { published: true, grades: { some: { studentId: viewer.sub } } },
            },
          },
        ],
      },
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

  /**
   * Событие «опубликованные оценки изменились» адресатам колонки. Имя — прежнее
   * `grade.published`: клиенты по нему перечитывают «Оценки», а новое имя пришлось бы
   * сначала научить слушать все клиенты (веб, iOS, Android).
   */
  private emitGradesChanged(columnId: string, studentIds: string[]): void {
    for (const studentId of new Set(studentIds)) {
      this.realtime.emitEventToUser(studentId, REALTIME_EVENTS.gradePublished, columnId, {
        columnId,
      })
    }
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
        published: true,
        maxScore: true,
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
    return {
      id: column.id,
      published: column.published,
      maxScore: column.maxScore,
      course: { groupId: c.groupId },
    }
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

/** Изменение ячейки журнала для аудита: прежний и новый балл (null — ячейка пуста). */
export interface GradeChange {
  studentId: string
  from: number | null
  to: number | null
}

/**
 * Какие из присланных ячеек меняют сохранённое значение. Повтор студента в одном запросе —
 * последнее значение, как и при прежней записи по порядку.
 */
export function diffGrades(
  before: { studentId: string; score: number | null }[],
  entries: SaveGradesInput['entries'],
): GradeChange[] {
  const current = new Map(before.map((g) => [g.studentId, g.score]))
  const last = new Map(entries.map((e) => [e.studentId, e.score]))
  const changes: GradeChange[] = []
  for (const [studentId, to] of last) {
    const from = current.get(studentId) ?? null
    if (from !== to) changes.push({ studentId, from, to })
  }
  return changes
}
