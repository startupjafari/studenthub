import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  CourseListQueryInput,
  CourseSortValue,
  CreateCourseInput,
  CreateSubjectInput,
  CreateTermInput,
  SortOrderValue,
  SubjectListQueryInput,
  SubjectSortValue,
  TermListQueryInput,
  TermSortValue,
  UpdateCourseInput,
  UpdateSubjectInput,
  UpdateTermInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { isPlatformRole, resolveGroupScope } from '../../common/auth/group-scope'
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

/**
 * Порядок выборки по колонке таблицы. Общее для трёх списков модуля.
 *
 * Вторичный ключ обязателен везде: в Postgres сортировка нестабильна, и при равных
 * значениях постраничная навигация могла бы показать одну запись дважды, а другую
 * пропустить.
 */
function courseOrderBy(
  sort: CourseSortValue | undefined,
  order: SortOrderValue | undefined,
): Prisma.CourseOrderByWithRelationInput[] {
  // Последний ключ — id: у курсов одной дисциплины в разных семестрах совпадают и название,
  // и группа, и без него их взаимный порядок от запроса к запросу менялся (C-F25).
  return [...courseSortKeys(sort, order), { id: 'asc' }]
}

function courseSortKeys(
  sort: CourseSortValue | undefined,
  order: SortOrderValue | undefined,
): Prisma.CourseOrderByWithRelationInput[] {
  const dir = order ?? 'asc'
  const bySubject: Prisma.CourseOrderByWithRelationInput = { subject: { name: 'asc' } }
  switch (sort) {
    case 'subject':
      return [{ subject: { name: dir } }, { group: { name: 'asc' } }]
    case 'group':
      return [{ group: { name: dir } }, bySubject]
    case 'term':
      // Семестр необязателен — курсы без него уходят в конец при любом направлении.
      return [{ term: { startsOn: dir } }, bySubject]
    case 'teacher':
      return [{ teacher: { lastName: dir } }, bySubject]
    case 'credits':
      return [{ credits: { sort: dir, nulls: 'last' } }, bySubject]
    default:
      return [bySubject]
  }
}

function subjectOrderBy(
  sort: SubjectSortValue | undefined,
  order: SortOrderValue | undefined,
): Prisma.SubjectOrderByWithRelationInput[] {
  const dir = order ?? 'asc'
  if (sort === 'code') return [{ code: { sort: dir, nulls: 'last' } }, { name: 'asc' }]
  return [{ name: sort === 'name' ? dir : 'asc' }]
}

function termOrderBy(
  sort: TermSortValue | undefined,
  order: SortOrderValue | undefined,
): Prisma.TermOrderByWithRelationInput[] {
  const dir = order ?? 'asc'
  const byStart: Prisma.TermOrderByWithRelationInput = { startsOn: 'desc' }
  switch (sort) {
    case 'name':
      return [{ name: dir }, byStart]
    case 'startsOn':
      return [{ startsOn: dir }]
    case 'endsOn':
      return [{ endsOn: dir }, byStart]
    case 'isActive':
      return [{ isActive: dir }, byStart]
    default:
      return [byStart]
  }
}

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Subjects ───────────────────────────────────────────────────────────────

  async listSubjects(viewer: JwtPayload, query: SubjectListQueryInput) {
    const universityId = this.readUniversityScope(viewer, query.universityId)
    const where: Prisma.SubjectWhereInput = {
      universityId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.subject.findMany({
        where,
        select: SUBJECT_SELECT,
        orderBy: subjectOrderBy(query.sort, query.order),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.subject.count({ where }),
    ])
    return new Paginated(rows, { total })
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
    // CONFLICT — только нарушение внешнего ключа (Course.subject = Restrict). Раньше в него
    // превращалась любая ошибка БД, и сбой соединения выглядел как «используется в курсах».
    await this.prisma.subject.delete({ where: { id } }).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new AppException('CONFLICT', 'Дисциплина используется в курсах')
      }
      throw e
    })
    await this.record(actor, 'subject_deleted', 'Subject', id, ctx)
  }

  // ── Terms ─────────────────────────────────────────────────────────────────

  async listTerms(viewer: JwtPayload, query: TermListQueryInput) {
    const universityId = this.readUniversityScope(viewer, query.universityId)
    const where: Prisma.TermWhereInput = { universityId }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.term.findMany({
        where,
        select: TERM_SELECT,
        orderBy: termOrderBy(query.sort, query.order),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.term.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  /**
   * Активный семестр в вузе один (C-F05): учебный план считает «изучается» по
   * `term.isActive`, и два активных семестра делали текущими дисциплины обоих.
   * Включение флага снимает его с остальных семестров вуза в той же транзакции.
   */
  async createTerm(actor: JwtPayload, input: CreateTermInput, ctx: RequestContext) {
    this.assertUniversityManage(actor, input.universityId)
    const isActive = input.isActive ?? false
    const term = await this.prisma
      .$transaction(async (tx) => {
        if (isActive) await this.deactivateOtherTerms(tx, input.universityId)
        return tx.term.create({
          data: {
            universityId: input.universityId,
            name: input.name,
            number: input.number,
            startsOn: new Date(input.startsOn),
            endsOn: new Date(input.endsOn),
            isActive,
          },
          select: TERM_SELECT,
        })
      })
      .catch(this.handleUnique('Семестр с таким названием уже существует'))
    await this.record(actor, 'term_created', 'Term', term.id, ctx)
    return term
  }

  async updateTerm(actor: JwtPayload, id: string, input: UpdateTermInput, ctx: RequestContext) {
    const existing = await this.prisma.term.findUnique({
      where: { id },
      select: { id: true, universityId: true, startsOn: true, endsOn: true },
    })
    if (!existing) throw new AppException('NOT_FOUND', 'Семестр не найден')
    this.assertUniversityManage(actor, existing.universityId)
    // Схема сверяет даты, только когда пришли обе; правка одной даты сверяется с
    // сохранённой второй — иначе семестр мог кончиться раньше, чем начался (C-F05).
    const startsOn = input.startsOn ? new Date(input.startsOn) : existing.startsOn
    const endsOn = input.endsOn ? new Date(input.endsOn) : existing.endsOn
    if (endsOn < startsOn) {
      throw new AppException('VALIDATION_ERROR', 'Семестр не может закончиться раньше начала', [
        { field: input.endsOn ? 'endsOn' : 'startsOn', message: 'Конец раньше начала' },
      ])
    }
    const term = await this.prisma
      .$transaction(async (tx) => {
        if (input.isActive === true) await this.deactivateOtherTerms(tx, existing.universityId, id)
        return tx.term.update({
          where: { id },
          data: {
            name: input.name,
            number: input.number,
            startsOn: input.startsOn ? startsOn : undefined,
            endsOn: input.endsOn ? endsOn : undefined,
            isActive: input.isActive,
          },
          select: TERM_SELECT,
        })
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
    // Course.term_id → SetNull: удаление семестра не удаляет курсы, а делает их курсами
    // «без семестра». Если у группы такая дисциплина без семестра уже есть, получился бы
    // дубль (C-F04) — такой семестр не удаляем, пока дисциплины не разведут.
    const clash = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM "courses" a
      JOIN "courses" b ON b.subject_id = a.subject_id AND b.group_id = a.group_id
      WHERE a.term_id = ${id} AND b.term_id IS NULL
      LIMIT 1`
    if (clash.length > 0) {
      throw new AppException(
        'CONFLICT',
        'После удаления семестра у группы окажутся две одинаковые дисциплины без семестра',
      )
    }
    await this.prisma.term
      .delete({ where: { id } })
      .catch(this.handleUnique('У группы уже есть такая дисциплина без семестра'))
    await this.record(actor, 'term_deleted', 'Term', id, ctx)
  }

  /** Снять «активный» с остальных семестров вуза; лок — чтобы две активации не прошли обе. */
  private async deactivateOtherTerms(
    tx: Prisma.TransactionClient,
    universityId: string,
    exceptId?: string,
  ): Promise<void> {
    await advisoryXactLock(tx, `term-active:${universityId}`)
    await tx.term.updateMany({
      where: { universityId, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { isActive: false },
    })
  }

  // ── Courses ──────────────────────────────────────────────────────────────

  async listCourses(viewer: JwtPayload, query: CourseListQueryInput) {
    // Фильтры сужают scope, а не подменяют его: раньше spread `groupId` из запроса затирал
    // `groupId` студента, и `?groupId=` отдавал дисциплины чужой группы (BACKEND_RULES §6).
    const where: Prisma.CourseWhereInput = {
      AND: [
        this.courseScopeWhere(viewer),
        {
          ...(query.groupId ? { groupId: query.groupId } : {}),
          ...(query.termId ? { termId: query.termId } : {}),
          ...(query.mine
            ? { teacherId: viewer.sub }
            : query.teacherId
              ? { teacherId: query.teacherId }
              : {}),
        },
      ],
    }
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        select: COURSE_SELECT,
        orderBy: courseOrderBy(query.sort, query.order),
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
    const course = await this.prisma
      .$transaction(async (tx) => {
        if (!input.termId) await this.assertNoTermlessTwin(tx, input.subjectId, input.groupId)
        return tx.course.create({
          data: {
            subjectId: input.subjectId,
            groupId: input.groupId,
            teacherId: input.teacherId,
            termId: input.termId,
            credits: input.credits,
          },
          select: COURSE_SELECT,
        })
      })
      .catch(this.handleUnique('Такая дисциплина уже назначена группе в этом семестре'))
    await this.record(actor, 'course_created', 'Course', course.id, ctx)
    return course
  }

  async updateCourse(actor: JwtPayload, id: string, input: UpdateCourseInput, ctx: RequestContext) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      select: { id: true, groupId: true, subjectId: true, termId: true },
    })
    if (!course) throw new AppException('NOT_FOUND', 'Дисциплина не найдена')
    const group = await this.assertGroupManage(actor, course.groupId)
    if (input.termId) await this.assertTermSameUniversity(input.termId, group.universityId)
    if (input.teacherId) await this.assertTeacherSameUniversity(input.teacherId, group.universityId)
    // Снять семестр — значит стать дисциплиной «без семестра», а такая у группы одна.
    const becomesTermless = input.termId === null && course.termId !== null
    const updated = await this.prisma
      .$transaction(async (tx) => {
        if (becomesTermless) {
          await this.assertNoTermlessTwin(tx, course.subjectId, course.groupId, id)
        }
        return tx.course.update({
          where: { id },
          data: { teacherId: input.teacherId, termId: input.termId, credits: input.credits },
          select: COURSE_SELECT,
        })
      })
      // Перенос в семестр, где группе эта дисциплина уже назначена, — тот же уникальный
      // ключ, что и при создании; раньше он уходил наружу ошибкой 500.
      .catch(this.handleUnique('Такая дисциплина уже назначена группе в этом семестре'))
    await this.record(actor, 'course_updated', 'Course', id, ctx)
    return updated
  }

  /**
   * Дисциплина без семестра — одна на (предмет, группа) (C-F04).
   *
   * Уникальный индекс `[subjectId, groupId, termId]` её не держит: в Postgres NULL-ы
   * различны, и двойной клик «Создать» с вариантом «без семестра» (он в модалке по
   * умолчанию) давал студенту две одинаковые карточки, а задания и журнал расползались
   * по ним. Пока частичного уникального индекса нет, правило держит код: проверка и
   * запись — в одной транзакции под advisory-локом пары (предмет, группа), так что
   * параллельный запрос ждёт и видит уже созданную дисциплину.
   */
  private async assertNoTermlessTwin(
    tx: Prisma.TransactionClient,
    subjectId: string,
    groupId: string,
    exceptId?: string,
  ): Promise<void> {
    await advisoryXactLock(tx, `course-termless:${subjectId}:${groupId}`)
    const twin = await tx.course.findFirst({
      where: {
        subjectId,
        groupId,
        termId: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    })
    if (twin) {
      throw new AppException('CONFLICT', 'Такая дисциплина уже назначена группе без семестра')
    }
  }

  /**
   * Удаление дисциплины — только без академических записей.
   *
   * Задания, колонки журнала и экзамены висят на дисциплине каскадом: удаление стёрло бы
   * оценки, сданные работы и результаты экзаменов без следа. Такую дисциплину не удаляем.
   *
   * Подсчёт и удаление — одна транзакция под блокировкой строки курса (FOR UPDATE).
   * Вставка задания, колонки журнала или экзамена проверяет внешний ключ и берёт на строку
   * курса FOR KEY SHARE, несовместимую с FOR UPDATE: заведённое параллельно либо попадает
   * в подсчёт, либо ждёт удаления и падает на внешнем ключе — каскадом не исчезает.
   */
  async deleteCourse(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const course = await this.prisma.course.findUnique({
      where: { id },
      select: { id: true, groupId: true },
    })
    if (!course) throw new AppException('NOT_FOUND', 'Дисциплина не найдена')
    await this.assertGroupManage(actor, course.groupId)
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "courses" WHERE id = ${id} FOR UPDATE`
      if (locked.length === 0) throw new AppException('NOT_FOUND', 'Дисциплина не найдена')
      if ((await this.academicRecordCount(tx, id)) > 0) {
        throw new AppException(
          'CONFLICT',
          'У дисциплины есть оценки, сданные работы или результаты экзаменов',
        )
      }
      await tx.course.delete({ where: { id } })
    })
    await this.record(actor, 'course_deleted', 'Course', id, ctx)
  }

  /**
   * Сколько записей дисциплины пропало бы при удалении каскадом.
   *
   * Результат экзамена — запись и без балла: зачёт («сдал» / «не сдал»), неявка и
   * недопуск ставятся статусом и флагом `admitted`, балл у них пустой. Раньше считались
   * только строки с баллом, и курс с заполненной ведомостью зачёта удалялся вместе с ней.
   * Пустой не считается лишь строка «назначен, допущен, без балла» — её ещё никто
   * не заполнял. Оценка журнала без балла — не запись: `null` в ней означает «снята».
   */
  private async academicRecordCount(
    tx: Prisma.TransactionClient,
    courseId: string,
  ): Promise<number> {
    const grades = await tx.grade.count({ where: { column: { courseId }, score: { not: null } } })
    const submissions = await tx.submission.count({
      where: { assignment: { courseId }, status: { not: 'DRAFT' } },
    })
    const results = await tx.examResult.count({
      where: {
        exam: { courseId },
        OR: [{ status: { not: 'SCHEDULED' } }, { score: { not: null } }, { admitted: false }],
      },
    })
    return grades + submissions + results
  }

  // ── scope helpers ─────────────────────────────────────────────────────────

  private readUniversityScope(viewer: JwtPayload, requested?: string): string {
    if (isPlatformRole(viewer.role)) return requested ?? viewer.universityId ?? '__none__'
    return viewer.universityId ?? '__none__'
  }

  private assertUniversityManage(actor: JwtPayload, universityId: string): void {
    if (isPlatformRole(actor.role)) return
    if (actor.role === Role.UNIVERSITY_ADMIN && actor.universityId === universityId) return
    throw new AppException('WRONG_SCOPE', 'Другой университет')
  }

  private courseScopeWhere(viewer: JwtPayload): Prisma.CourseWhereInput {
    if (isPlatformRole(viewer.role)) return {}
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
    if (isPlatformRole(viewer.role)) return
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      if (viewer.groupId === groupId) return
      throw new AppException('WRONG_SCOPE', 'Дисциплина другой группы')
    }
    const group = await resolveGroupScope(this.prisma, groupId)
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
    const group = await resolveGroupScope(this.prisma, groupId)
    if (isPlatformRole(actor.role)) return group
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
    // Вести дисциплину может только действующий преподаватель или декан: раньше сюда
    // проходил кто угодно из вуза, включая удалённых, заблокированных и студентов.
    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId, deletedAt: null, isBlocked: false },
      select: { universityId: true, role: true },
    })
    if (!teacher) throw new AppException('NOT_FOUND', 'Преподаватель не найден')
    if (teacher.universityId !== universityId)
      throw new AppException('WRONG_SCOPE', 'Преподаватель другого университета')
    if (teacher.role !== Role.TEACHER && teacher.role !== Role.DEAN) {
      throw new AppException('BAD_REQUEST', 'Назначить можно только преподавателя или декана')
    }
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
