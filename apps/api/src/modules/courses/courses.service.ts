import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  CreateCourseInput,
  CreateSubjectInput,
  CreateTermInput,
  CourseListQueryInput,
  SubjectListQueryInput,
  TermListQueryInput,
  UpdateCourseInput,
  UpdateSubjectInput,
  UpdateTermInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

const SUBJECT_SELECT = {
  id: true,
  universityId: true,
  name: true,
  code: true,
  createdAt: true,
} satisfies Prisma.SubjectSelect

const TERM_SELECT = {
  id: true,
  universityId: true,
  name: true,
  number: true,
  startsOn: true,
  endsOn: true,
  isActive: true,
} satisfies Prisma.TermSelect

const COURSE_SELECT = {
  id: true,
  credits: true,
  createdAt: true,
  subject: { select: { id: true, name: true, code: true } },
  group: { select: { id: true, name: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  term: { select: { id: true, name: true, number: true, isActive: true } },
} satisfies Prisma.CourseSelect

type CourseRow = Prisma.CourseGetPayload<{ select: typeof COURSE_SELECT }>

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Subjects ───────────────────────────────────────────────────────────────

  listSubjects(viewer: JwtPayload, query: SubjectListQueryInput) {
    const universityId = this.readUniversityScope(viewer, query.universityId)
    return this.prisma.subject.findMany({
      where: {
        universityId,
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      select: SUBJECT_SELECT,
      orderBy: { name: 'asc' },
      take: 500,
    })
  }

  async createSubject(actor: JwtPayload, input: CreateSubjectInput, ctx: RequestContext) {
    this.assertUniversityManage(actor, input.universityId)
    const subject = await this.prisma.subject
      .create({
        data: { universityId: input.universityId, name: input.name, code: input.code },
        select: SUBJECT_SELECT,
      })
      .catch(this.handleUnique('Дисциплина с таким названием уже существует'))
    await this.record(actor, 'subject_created', 'Subject', subject.id, ctx)
    return subject
  }

  async updateSubject(
    actor: JwtPayload,
    id: string,
    input: UpdateSubjectInput,
    ctx: RequestContext,
  ) {
    const existing = await this.prisma.subject.findUnique({
      where: { id },
      select: { id: true, universityId: true },
    })
    if (!existing) throw new AppException('NOT_FOUND', 'Дисциплина не найдена')
    this.assertUniversityManage(actor, existing.universityId)
    const subject = await this.prisma.subject
      .update({
        where: { id },
        data: { name: input.name, code: input.code },
        select: SUBJECT_SELECT,
      })
      .catch(this.handleUnique('Дисциплина с таким названием уже существует'))
    await this.record(actor, 'subject_updated', 'Subject', id, ctx)
    return subject
  }

  async deleteSubject(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.subject.findUnique({
      where: { id },
      select: { id: true, universityId: true },
    })
    if (!existing) throw new AppException('NOT_FOUND', 'Дисциплина не найдена')
    this.assertUniversityManage(actor, existing.universityId)
    await this.prisma.subject.delete({ where: { id } }).catch(() => {
      throw new AppException('CONFLICT', 'Дисциплина используется в курсах')
    })
    await this.record(actor, 'subject_deleted', 'Subject', id, ctx)
  }

  // ── Terms ─────────────────────────────────────────────────────────────────

  listTerms(viewer: JwtPayload, query: TermListQueryInput) {
    const universityId = this.readUniversityScope(viewer, query.universityId)
    return this.prisma.term.findMany({
      where: { universityId },
      select: TERM_SELECT,
      orderBy: [{ startsOn: 'desc' }],
      take: 200,
    })
  }

  async createTerm(actor: JwtPayload, input: CreateTermInput, ctx: RequestContext) {
    this.assertUniversityManage(actor, input.universityId)
    const term = await this.prisma.term
      .create({
        data: {
          universityId: input.universityId,
          name: input.name,
          number: input.number,
          startsOn: new Date(input.startsOn),
          endsOn: new Date(input.endsOn),
          isActive: input.isActive ?? false,
        },
        select: TERM_SELECT,
      })
      .catch(this.handleUnique('Семестр с таким названием уже существует'))
    await this.record(actor, 'term_created', 'Term', term.id, ctx)
    return term
  }

  async updateTerm(actor: JwtPayload, id: string, input: UpdateTermInput, ctx: RequestContext) {
    const existing = await this.prisma.term.findUnique({
      where: { id },
      select: { id: true, universityId: true },
    })
    if (!existing) throw new AppException('NOT_FOUND', 'Семестр не найден')
    this.assertUniversityManage(actor, existing.universityId)
    const term = await this.prisma.term
      .update({
        where: { id },
        data: {
          name: input.name,
          number: input.number,
          startsOn: input.startsOn ? new Date(input.startsOn) : undefined,
          endsOn: input.endsOn ? new Date(input.endsOn) : undefined,
          isActive: input.isActive,
        },
        select: TERM_SELECT,
      })
      .catch(this.handleUnique('Семестр с таким названием уже существует'))
    await this.record(actor, 'term_updated', 'Term', id, ctx)
    return term
  }

  async deleteTerm(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.term.findUnique({
      where: { id },
      select: { id: true, universityId: true },
    })
    if (!existing) throw new AppException('NOT_FOUND', 'Семестр не найден')
    this.assertUniversityManage(actor, existing.universityId)
    // Course.term_id → SetNull: удаление семестра не удаляет курсы.
    await this.prisma.term.delete({ where: { id } })
    await this.record(actor, 'term_deleted', 'Term', id, ctx)
  }

  // ── Courses ──────────────────────────────────────────────────────────────

  async listCourses(viewer: JwtPayload, query: CourseListQueryInput) {
    const where: Prisma.CourseWhereInput = {
      ...this.courseScopeWhere(viewer),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.mine
        ? { teacherId: viewer.sub }
        : query.teacherId
          ? { teacherId: query.teacherId }
          : {}),
    }
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        select: COURSE_SELECT,
        orderBy: [{ subject: { name: 'asc' } }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.course.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  async getCourse(viewer: JwtPayload, id: string): Promise<CourseRow> {
    const course = await this.prisma.course.findUnique({
      where: { id },
      select: { ...COURSE_SELECT, groupId: true },
    })
    if (!course) throw new AppException('NOT_FOUND', 'Дисциплина не найдена')
    await this.assertReadGroup(viewer, course.groupId)
    const { groupId: _groupId, ...rest } = course
    return rest
  }

  async createCourse(actor: JwtPayload, input: CreateCourseInput, ctx: RequestContext) {
    const group = await this.assertGroupManage(actor, input.groupId)
    await this.assertSubjectSameUniversity(input.subjectId, group.universityId)
    if (input.termId) await this.assertTermSameUniversity(input.termId, group.universityId)
    if (input.teacherId) await this.assertTeacherSameUniversity(input.teacherId, group.universityId)
    const course = await this.prisma.course
      .create({
        data: {
          subjectId: input.subjectId,
          groupId: input.groupId,
          teacherId: input.teacherId,
          termId: input.termId,
          credits: input.credits,
        },
        select: COURSE_SELECT,
      })
      .catch(this.handleUnique('Такая дисциплина уже назначена группе в этом семестре'))
    await this.record(actor, 'course_created', 'Course', course.id, ctx)
    return course
  }

  async updateCourse(actor: JwtPayload, id: string, input: UpdateCourseInput, ctx: RequestContext) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      select: { id: true, groupId: true },
    })
    if (!course) throw new AppException('NOT_FOUND', 'Дисциплина не найдена')
    const group = await this.assertGroupManage(actor, course.groupId)
    if (input.termId) await this.assertTermSameUniversity(input.termId, group.universityId)
    if (input.teacherId) await this.assertTeacherSameUniversity(input.teacherId, group.universityId)
    const updated = await this.prisma.course.update({
      where: { id },
      data: { teacherId: input.teacherId, termId: input.termId, credits: input.credits },
      select: COURSE_SELECT,
    })
    await this.record(actor, 'course_updated', 'Course', id, ctx)
    return updated
  }

  async deleteCourse(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const course = await this.prisma.course.findUnique({
      where: { id },
      select: { id: true, groupId: true },
    })
    if (!course) throw new AppException('NOT_FOUND', 'Дисциплина не найдена')
    await this.assertGroupManage(actor, course.groupId)
    await this.prisma.course.delete({ where: { id } })
    await this.record(actor, 'course_deleted', 'Course', id, ctx)
  }

  // ── scope helpers ─────────────────────────────────────────────────────────

  private readUniversityScope(viewer: JwtPayload, requested?: string): string {
    if (isPlatform(viewer.role)) return requested ?? viewer.universityId ?? '__none__'
    return viewer.universityId ?? '__none__'
  }

  private assertUniversityManage(actor: JwtPayload, universityId: string): void {
    if (isPlatform(actor.role)) return
    if (actor.role === Role.UNIVERSITY_ADMIN && actor.universityId === universityId) return
    throw new AppException('WRONG_SCOPE', 'Другой университет')
  }

  private courseScopeWhere(viewer: JwtPayload): Prisma.CourseWhereInput {
    if (isPlatform(viewer.role)) return {}
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      return { groupId: viewer.groupId ?? '__none__' }
    }
    if (viewer.role === Role.DEAN) {
      return { group: { is: { facultyId: viewer.facultyId ?? '__none__' } } }
    }
    // TEACHER / UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR — курсы групп своего вуза.
    return {
      group: { is: { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } } },
    }
  }

  private async assertReadGroup(viewer: JwtPayload, groupId: string): Promise<void> {
    if (isPlatform(viewer.role)) return
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      if (viewer.groupId === groupId) return
      throw new AppException('WRONG_SCOPE', 'Дисциплина другой группы')
    }
    const group = await this.resolveGroup(groupId)
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === group.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Дисциплина другого факультета')
    }
    if (viewer.universityId === group.universityId) return
    throw new AppException('WRONG_SCOPE', 'Дисциплина другого университета')
  }

  private async assertGroupManage(
    actor: JwtPayload,
    groupId: string,
  ): Promise<{ facultyId: string; universityId: string }> {
    const group = await this.resolveGroup(groupId)
    if (isPlatform(actor.role)) return group
    if (actor.role === Role.DEAN) {
      if (actor.facultyId !== group.facultyId)
        throw new AppException('WRONG_SCOPE', 'Чужой факультет')
      return group
    }
    if (actor.role === Role.UNIVERSITY_ADMIN) {
      if (actor.universityId !== group.universityId)
        throw new AppException('WRONG_SCOPE', 'Группа другого университета')
      return group
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  private async assertSubjectSameUniversity(
    subjectId: string,
    universityId: string,
  ): Promise<void> {
    const subject = await this.prisma.subject.findUnique({
      where: { id: subjectId },
      select: { universityId: true },
    })
    if (!subject) throw new AppException('NOT_FOUND', 'Дисциплина-справочник не найдена')
    if (subject.universityId !== universityId)
      throw new AppException('WRONG_SCOPE', 'Дисциплина другого университета')
  }

  private async assertTermSameUniversity(termId: string, universityId: string): Promise<void> {
    const term = await this.prisma.term.findUnique({
      where: { id: termId },
      select: { universityId: true },
    })
    if (!term) throw new AppException('NOT_FOUND', 'Семестр не найден')
    if (term.universityId !== universityId)
      throw new AppException('WRONG_SCOPE', 'Семестр другого университета')
  }

  private async assertTeacherSameUniversity(
    teacherId: string,
    universityId: string,
  ): Promise<void> {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { universityId: true, role: true },
    })
    if (!teacher) throw new AppException('NOT_FOUND', 'Преподаватель не найден')
    if (teacher.universityId !== universityId)
      throw new AppException('WRONG_SCOPE', 'Преподаватель другого университета')
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

  private handleUnique(message: string) {
    return (e: unknown): never => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppException('CONFLICT', message)
      }
      throw e
    }
  }

  private async record(
    actor: JwtPayload,
    action: string,
    entity: string,
    entityId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.audit.record({ userId: actor.sub, action, entity, entityId, ...ctx })
  }
}
