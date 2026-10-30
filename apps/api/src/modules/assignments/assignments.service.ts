import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  AssignmentListQueryInput,
  ReviewQueueQueryInput,
  CreateAssignmentInput,
  GradeSubmissionInput,
  ReturnSubmissionInput,
  SaveSubmissionDraftInput,
  UpdateAssignmentInput,
} from '@studenthub/shared-schemas'
import type { NotificationMessageKey, NotificationParams } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { rethrowStaleStatus } from '../../common/prisma/stale-status'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { QueueService } from '../../common/queue/queue.service'
import { QUEUES, NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { signingWindow } from '../../common/minio/stable-sign'
import type { EnvVars } from '../../config/env.schema'
import type { RequestContext } from '../auth/auth.service'
import { FileService } from '../files/file.service'

// Потолок на список студентов группы при рассылке (BACKEND_RULES §7.2).
const GROUP_STUDENTS_LIMIT = 500

// Сколько файлов можно приложить к одной сдаче: отчёт, исходники архивом, пара сканов.
// Потолок нужен и сам по себе — presign выдаёт ссылки на запись, а платит за них хранилище.
export const SUBMISSION_FILES_LIMIT = 10

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

// Кто проверяет работы: тот же список ролей, что у `GET /assignments/:id/submissions` и
// оценки. Модератор платформы в него не входит, хотя `isPlatform` пропускает его в scope.
const REVIEWER_ROLES: Role[] = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER]

type AssignmentStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED'

/**
 * Переходы статуса задания (C-F20): из каких статусов можно прийти в целевой. Раньше
 * `publish`/`close` перезаписывали статус безусловно — черновик «закрывался», не побывав у
 * студентов, а повторная публикация заново ставила время публикации. Закрытое задание
 * можно открыть снова (закрыли по ошибке) — без повторной рассылки и с прежним временем
 * публикации.
 */
const STATUS_FROM: Record<'PUBLISHED' | 'CLOSED', readonly AssignmentStatus[]> = {
  PUBLISHED: ['DRAFT', 'CLOSED'],
  CLOSED: ['PUBLISHED'],
}

const STATUS_CONFLICT: Record<'PUBLISHED' | 'CLOSED', Partial<Record<AssignmentStatus, string>>> = {
  PUBLISHED: { PUBLISHED: 'Задание уже опубликовано' },
  CLOSED: {
    DRAFT: 'Черновик не публиковался — его можно удалить, а не закрыть',
    CLOSED: 'Задание уже закрыто',
  },
}

// Поля задания, правки которых пишутся в аудит значениями «было → стало» (C-F20):
// опубликованное задание правят, а студенты уже видели прежние срок и условия.
const AUDITED_FIELDS = [
  'title',
  'type',
  'submissionType',
  'maxScore',
  'maxAttempts',
  'allowLate',
  'dueAt',
] as const

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

// Файл сдачи наружу: ключ и бакет не отдаём — ссылку на байты выдаёт отдельный эндпоинт
// после проверки прав (преподаватель дисциплины или сам автор работы).
const SUBMISSION_FILE_SELECT = {
  id: true,
  name: true,
  mime: true,
  size: true,
  createdAt: true,
} satisfies Prisma.FileSelect

const SUBMISSION_SELECT = {
  id: true,
  status: true,
  text: true,
  linkUrl: true,
  files: {
    select: SUBMISSION_FILE_SELECT,
    orderBy: { createdAt: 'asc' },
    take: SUBMISSION_FILES_LIMIT,
  },
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
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /**
   * Очередь проверки: сколько работ сдано и ждёт оценки, и по каким заданиям.
   *
   * Счётчик считается ЗДЕСЬ, потому что список заданий его не содержит: чтобы узнать
   * число сданных работ, клиенту пришлось бы запрашивать сабмиты каждого задания по
   * очереди. У декана такой показатель уже есть в аналитике факультета — это он же,
   * но в scope преподавателя.
   *
   * Scope тот же, что у списка заданий (`scopeWhere`), никаких отдельных правил:
   * преподаватель видит работы только по своим курсам.
   */
  async reviewQueue(viewer: JwtPayload, query: ReviewQueueQueryInput) {
    const where: Prisma.SubmissionWhereInput = {
      status: 'SUBMITTED',
      assignment: { is: this.scopeWhere(viewer) },
    }
    const [total, grouped] = await this.prisma.$transaction([
      this.prisma.submission.count({ where }),
      this.prisma.submission.groupBy({
        by: ['assignmentId'],
        where,
        // `_count: true` даёт число строк в группе одним полем; форма `{ _all: true }`
        // возвращает объект со всеми колонками и типизируется хуже, а нужна одна цифра.
        _count: true,
        orderBy: { _count: { assignmentId: 'desc' } },
        take: query.limit,
      }),
    ])
    if (grouped.length === 0) return { total, items: [] }

    // Названия отдельным запросом: groupBy не умеет тянуть поля связи, а без названия
    // строка панели («12 работ») не говорит, что именно проверять.
    const assignments = await this.prisma.assignment.findMany({
      where: { id: { in: grouped.map((g) => g.assignmentId) } },
      // Ровно столько, сколько групп вернул groupBy выше (он сам ограничен query.limit):
      // выборка и так конечна, но `findMany` без `take` запрещён (BACKEND_RULES §5.3/§18.8),
      // и явный потолок избавляет читающего от обратной трассировки до groupBy.
      take: grouped.length,
      select: {
        id: true,
        title: true,
        dueAt: true,
        course: { select: { subject: { select: { name: true } } } },
      },
    })
    const byId = new Map(assignments.map((a) => [a.id, a]))
    return {
      total,
      // Порядок сохраняем от groupBy (больше всего несделанного — сверху).
      items: grouped.flatMap((g) => {
        const a = byId.get(g.assignmentId)
        return a
          ? [
              {
                id: a.id,
                title: a.title,
                subject: a.course?.subject?.name ?? null,
                dueAt: a.dueAt,
                pending: g._count,
              },
            ]
          : []
      }),
    }
  }

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
        ...(query.dueFrom ? [{ dueAt: { gte: new Date(query.dueFrom) } }] : []),
        ...(query.dueTo ? [{ dueAt: { lt: new Date(query.dueTo) } }] : []),
      ],
    }
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const withMine = STUDENT_ROLES.includes(viewer.role)
    if (withMine && !query.sort) {
      return this.listByRelevance(viewer, where, page, limit)
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({
        where,
        select: withMine ? this.selectWithMine(viewer.sub) : ASSIGNMENT_SELECT,
        orderBy: assignmentOrderBy(query.sort, query.order),
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

  /**
   * Список студента «актуальные сверху» — порядок по умолчанию, когда `sort` не задан.
   *
   * Scope студента — задания группы за все семестры, и прежний порядок «срок по
   * возрастанию» без нижней границы ставил первыми задания первого курса: со второго
   * семестра первая сотня (и двадцатка «Сегодня») состояла из давно прошедших, а новые
   * отсекались — без всякого признака обрезки.
   *
   * Порядок из двух частей, страница режется поверх их склейки:
   *  1) открытые — опубликованные со сроком впереди или без срока, ближайший срок сверху;
   *  2) остальные — прошедшие и закрытые, от свежих к старым.
   * Prisma не умеет `ORDER BY CASE`, поэтому части читаются отдельно; вместе они делят
   * выборку без пересечений, и `total` равен тому же числу, что и без сортировки.
   */
  private async listByRelevance(
    viewer: JwtPayload,
    where: Prisma.AssignmentWhereInput,
    page: number,
    limit: number,
  ) {
    const now = new Date()
    const open: Prisma.AssignmentWhereInput = {
      AND: [where, { status: 'PUBLISHED' }, { OR: [{ dueAt: { gte: now } }, { dueAt: null }] }],
    }
    const rest: Prisma.AssignmentWhereInput = {
      AND: [where, { OR: [{ status: { not: 'PUBLISHED' } }, { dueAt: { lt: now } }] }],
    }
    const [openTotal, restTotal] = await this.prisma.$transaction([
      this.prisma.assignment.count({ where: open }),
      this.prisma.assignment.count({ where: rest }),
    ])
    const skip = (page - 1) * limit
    const openTake = Math.min(limit, Math.max(0, openTotal - skip))
    const restSkip = Math.max(0, skip - openTotal)
    const restTake = limit - openTake
    const select = this.selectWithMine(viewer.sub)
    const [openRows, restRows] = await Promise.all([
      openTake > 0
        ? this.prisma.assignment.findMany({
            where: open,
            select,
            orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
            skip,
            take: openTake,
          })
        : [],
      restTake > 0 && restSkip < restTotal
        ? this.prisma.assignment.findMany({
            where: rest,
            select,
            orderBy: [{ dueAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
            skip: restSkip,
            take: restTake,
          })
        : [],
    ])
    return new Paginated(
      [...openRows, ...restRows].map((r) => this.mapMine(r)),
      { total: openTotal + restTotal },
    )
  }

  async getById(viewer: JwtPayload, id: string) {
    const withMine = STUDENT_ROLES.includes(viewer.role)
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      select: withMine ? this.selectWithMine(viewer.sub) : ASSIGNMENT_SELECT,
    })
    if (!assignment) throw new AppException('NOT_FOUND', 'Задание не найдено')
    const mine = (assignment as Record<string, unknown>).submissions
    await this.assertRead(viewer, {
      ...assignment.course,
      // Отправленная работа по заданию прежней группы — тот же признак, что в `scopeWhere`.
      ownWork:
        Array.isArray(mine) && (mine as { status: string }[]).some((s) => s.status !== 'DRAFT'),
    })
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
    // Черновик — ещё не работа: студент его не отправлял, и проверяющему он не виден
    // (как неотправленные заявки, BACKEND_RULES §14.7).
    return this.prisma.submission.findMany({
      where: { assignmentId, status: { not: 'DRAFT' } },
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

  /**
   * Правка задания. Опубликованное и закрытое править можно (продлить срок, исправить
   * условие или максимум), кроме времени публикации: оно уже наступило, и его перенос
   * ничего не публикует. Изменения опубликованного пишутся в аудит значениями — студенты
   * видели прежние срок и условия, и спор «срок был другой» иначе нечем разрешить.
   */
  async update(actor: JwtPayload, id: string, input: UpdateAssignmentInput, ctx: RequestContext) {
    const current = await this.findManageable(actor, id)
    if (current.status !== 'DRAFT' && input.publishAt !== undefined) {
      throw new AppException(
        'CONFLICT',
        'Задание уже опубликовано — время публикации не меняется',
        [{ field: 'publishAt', message: 'Задание уже опубликовано' }],
      )
    }
    // Максимум ниже уже выставленного балла сделал бы старые оценки «больше 100 %».
    if (input.maxScore != null) {
      const { _max } = await this.prisma.submission.aggregate({
        where: { assignmentId: id, score: { not: null } },
        _max: { score: true },
      })
      if (_max.score != null && _max.score > input.maxScore) {
        throw new AppException(
          'CONFLICT',
          `Уже выставлен балл ${_max.score} — максимум не может быть меньше`,
          [{ field: 'maxScore', message: `Не меньше ${_max.score}` }],
        )
      }
    }
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
    await this.record(actor, 'assignment_updated', id, ctx, {
      status: current.status,
      changes: auditedChanges(current, assignment),
      descriptionChanged:
        input.description !== undefined && input.description !== current.description,
    })
    return assignment
  }

  async setStatus(
    actor: JwtPayload,
    id: string,
    status: 'PUBLISHED' | 'CLOSED',
    ctx: RequestContext,
  ) {
    const current = await this.findManageable(actor, id)
    // Колонка статуса — строка; значения держит сервис (ASSIGNMENT_STATUSES в схемах).
    const from = current.status as AssignmentStatus
    if (!STATUS_FROM[status].includes(from)) {
      throw new AppException(
        'CONFLICT',
        STATUS_CONFLICT[status][from] ?? 'Статус задания уже изменился',
      )
    }
    const firstPublish = status === 'PUBLISHED' && from === 'DRAFT'
    // Исходный статус — в условии записи: два одновременных «опубликовать» не пройдут оба
    // (вторая запись не найдёт черновика → CONFLICT), и рассылка уйдёт один раз.
    const assignment = await this.prisma.assignment
      .update({
        where: { id, status: from },
        data: { status, ...(firstPublish ? { publishAt: new Date() } : {}) },
        select: ASSIGNMENT_SELECT,
      })
      .catch(rethrowStaleStatus)
    const action =
      status === 'PUBLISHED' && !firstPublish
        ? 'assignment_reopened'
        : `assignment_${status.toLowerCase()}`
    await this.record(actor, action, id, ctx, { from })
    if (firstPublish) await this.notifyPublished(assignment)
    return assignment
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findManageable(actor, id)
    // Сдачи висят на задании каскадом: удаление стёрло бы работы группы вместе с баллами
    // и отзывами. Как у дисциплины, колонки журнала и экзамена — такое задание не удаляем,
    // его закрывают. Черновики студентов (ещё не отправленное) удалению не мешают.
    //
    // Проверка — в условии самого удаления, а не отдельным count перед ним: между ними
    // студент успел бы отправить работу, и она ушла бы вместе с заданием.
    const { count } = await this.prisma.assignment.deleteMany({
      where: { id, submissions: { none: { status: { not: 'DRAFT' } } } },
    })
    if (count === 0) {
      throw new AppException(
        'CONFLICT',
        'По заданию уже есть сданные работы — его можно закрыть, но не удалить',
      )
    }
    await this.record(actor, 'assignment_deleted', id, ctx)
  }

  // ── Submissions (студент) ─────────────────────────────────────────────────

  async saveDraft(actor: JwtPayload, assignmentId: string, input: SaveSubmissionDraftInput) {
    await this.assertStudentCanSubmit(actor, assignmentId)
    const key = { assignmentId_studentId: { assignmentId, studentId: actor.sub } }
    // Статус — в условии самой записи (C-F20): раньше проверка и upsert шли разными
    // запросами, и сохранение из второй вкладки переписывало текст уже отправленной работы.
    const { count } = await this.prisma.submission.updateMany({
      where: { assignmentId, studentId: actor.sub, status: { in: ['DRAFT', 'RETURNED'] } },
      data: { text: input.text, linkUrl: input.linkUrl },
    })
    if (count === 0) {
      // Строки нет — первое сохранение. Есть, но отправлена, — уникальный ключ не даст
      // создать вторую, и это тот же отказ «уже отправлена».
      await this.prisma.submission
        .create({
          data: {
            assignmentId,
            studentId: actor.sub,
            status: 'DRAFT',
            text: input.text ?? undefined,
            linkUrl: input.linkUrl ?? undefined,
          },
          select: { id: true },
        })
        .catch((e: unknown) => {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new AppException('CONFLICT', 'Работа уже отправлена')
          }
          throw e
        })
    }
    const submission = await this.prisma.submission.findUnique({
      where: key,
      select: SUBMISSION_SELECT,
    })
    if (!submission) throw new AppException('NOT_FOUND', 'Работа не найдена')
    return submission
  }

  async submit(actor: JwtPayload, assignmentId: string) {
    const assignment = await this.assertStudentCanSubmit(actor, assignmentId)
    const existing = await this.prisma.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: actor.sub } },
      select: {
        id: true,
        status: true,
        text: true,
        linkUrl: true,
        attemptNumber: true,
        _count: { select: { files: true } },
      },
    })
    if (!existing || (existing.status !== 'DRAFT' && existing.status !== 'RETURNED')) {
      throw new AppException('BAD_REQUEST', 'Нет черновика для отправки')
    }
    // Файлы — полноценная работа: задание с типом «Файл» сдаётся без текста и ссылки.
    if (!existing.text && !existing.linkUrl && existing._count.files === 0) {
      throw new AppException('VALIDATION_ERROR', 'Работа пустая')
    }
    // Просрочка без разрешения поздней сдачи. Возвращённую на доработку работу срок не
    // держит: преподаватель возвращает её обычно уже после дедлайна, и иначе исправить её
    // было бы невозможно.
    if (
      existing.status !== 'RETURNED' &&
      assignment.dueAt &&
      !assignment.allowLate &&
      new Date() > assignment.dueAt
    ) {
      throw new AppException('CONFLICT', 'Срок сдачи истёк')
    }
    const nextAttempt =
      existing.status === 'RETURNED' ? existing.attemptNumber + 1 : existing.attemptNumber
    // Исходный статус — в условии: двойное нажатие «Отправить» не увеличит попытку дважды.
    return this.prisma.submission
      .update({
        where: { id: existing.id, status: existing.status },
        data: { status: 'SUBMITTED', submittedAt: new Date(), attemptNumber: nextAttempt },
        select: SUBMISSION_SELECT,
      })
      .catch(rethrowStaleStatus)
  }

  // ── Файлы сдачи (студент) ─────────────────────────────────────────────────
  // Схема та же, что у материалов: до порога — буферная загрузка через API, больше —
  // presign → PUT в MinIO → confirm. Файл сразу привязывается к черновику сдачи, поэтому
  // «ничейных» загрузок не остаётся. Бакет applications — приватный, байты отдаются только
  // по подписанной ссылке после проверки прав (getSubmissionFileUrl).

  /** Буферная загрузка файла в черновик сдачи (до FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES). */
  async addSubmissionFile(
    actor: JwtPayload,
    assignmentId: string,
    upload: { buffer: Buffer; name?: string },
  ) {
    const submissionId = await this.draftForFiles(actor, assignmentId)
    const file = await this.files.upload({
      buffer: upload.buffer,
      bucket: this.submissionsBucket(),
      ownerId: actor.sub,
      name: upload.name,
      // Лабораторные с кодом и проекты сдают архивом — для сдач это обычный формат.
      allowArchives: true,
    })
    return this.attachFile(file.id, submissionId)
  }

  /** Прямая загрузка крупного файла, шаг 1: подписанная ссылка. Права — ДО выдачи ключа. */
  async presignSubmissionFile(actor: JwtPayload, assignmentId: string, mime: string) {
    await this.assertCanAttach(actor, assignmentId)
    return this.files.presignPut(this.submissionsBucket(), mime, actor.sub)
  }

  /** Шаг 3: подтверждение — тип и размер FileService определяет по самому объекту. */
  async confirmSubmissionFile(
    actor: JwtPayload,
    assignmentId: string,
    key: string,
    name: string | undefined,
  ) {
    const submissionId = await this.draftForFiles(actor, assignmentId)
    const file = await this.files.confirmDirectUpload({
      bucket: this.submissionsBucket(),
      key,
      ownerId: actor.sub,
      name,
      allowArchives: true,
    })
    return this.attachFile(file.id, submissionId)
  }

  /** Убрать файл из черновика (или из работы, возвращённой на доработку). */
  async removeSubmissionFile(actor: JwtPayload, assignmentId: string, fileId: string) {
    await this.assertStudentCanSubmit(actor, assignmentId)
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, submission: { is: { assignmentId, studentId: actor.sub } } },
      select: { id: true, submission: { select: { status: true } } },
    })
    if (!file) throw new AppException('NOT_FOUND', 'Файл не найден')
    if (file.submission?.status === 'SUBMITTED' || file.submission?.status === 'GRADED') {
      throw new AppException('CONFLICT', 'Работа уже отправлена')
    }
    await this.files.delete(file.id)
  }

  /**
   * Ссылка на файл сдачи: автору работы и тем, кто вправе проверять её (тот же круг, что у
   * списка сдач). Ссылка со схемой attachment и исходным именем — преподаватель сохраняет
   * работу как «Иванов_ЛР3.docx», а не под ключом хранилища.
   */
  async getSubmissionFileUrl(viewer: JwtPayload, submissionId: string, fileId: string) {
    const sub = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        studentId: true,
        status: true,
        assignment: { select: { course: { select: COURSE_MINI } } },
      },
    })
    if (!sub) throw new AppException('NOT_FOUND', 'Работа не найдена')
    if (STUDENT_ROLES.includes(viewer.role)) {
      // Чужую работу студенту не раскрываем даже фактом существования.
      if (sub.studentId !== viewer.sub) throw new AppException('NOT_FOUND', 'Работа не найдена')
    } else {
      if (!REVIEWER_ROLES.includes(viewer.role)) {
        throw new AppException('FORBIDDEN', 'Недостаточно прав')
      }
      await this.assertManage(viewer, sub.assignment.course)
      // Файлы неотправленного черновика — тот же черновик, что скрыт из списка сдач.
      if (sub.status === 'DRAFT') throw new AppException('NOT_FOUND', 'Работа не найдена')
    }
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, submissionId },
      select: { id: true },
    })
    if (!file) throw new AppException('NOT_FOUND', 'Файл не найден')
    const now = Date.now()
    const url = await this.files.getPresignedUrl(file.id, undefined, true)
    return { url, expiresAt: signingWindow(now).expiresAt.toISOString() }
  }

  // ── Submissions (преподаватель) ──────────────────────────────────────────

  /**
   * Оценка работы. Сданную — оценить, уже оценённую — переоценить (C-F20): ошибку в балле
   * раньше исправить было нельзя (CONFLICT), только просить студента пересдать. Переоценка
   * пишет в аудит прежний и новый балл и заново уведомляет студента.
   *
   * Запись условная: статус (и для переоценки — время прежней оценки) в `where`. Два
   * преподавателя, одновременно нажавшие «оценить» и «вернуть», раньше оба проходили
   * проверку, и итог решал последний; теперь второй получает CONFLICT и видит чужое решение.
   */
  async grade(
    actor: JwtPayload,
    submissionId: string,
    input: GradeSubmissionInput,
    ctx: RequestContext,
  ) {
    const sub = await this.findGradableSubmission(actor, submissionId)
    if (sub.status !== 'SUBMITTED' && sub.status !== 'GRADED') {
      throw new AppException('CONFLICT', 'Работа не на проверке')
    }
    const regrade = sub.status === 'GRADED'
    // Схема держит только общий потолок 0..1000; «150 из 100» — опечатка, а не оценка, и
    // уводит процент студента и аналитику декана за 100 %.
    const max = sub.assignment.maxScore
    if (max != null && input.score > max) {
      throw new AppException('VALIDATION_ERROR', `Балл больше максимального (${max})`, [
        { field: 'score', message: `Не больше ${max}` },
      ])
    }
    // Отзыв к оценке. Пустой — очищает поле: при первой оценке там мог остаться комментарий
    // «на доработку» к прошлой попытке, при переоценке его стёрли намеренно. Не передан
    // при переоценке — прежний отзыв остаётся (клиенты, правящие только балл).
    const feedback =
      regrade && input.feedback === undefined ? undefined : input.feedback?.trim() || null
    const gradedAt = new Date()
    const graded = await this.prisma.submission
      .update({
        where: {
          id: submissionId,
          status: sub.status,
          ...(regrade ? { gradedAt: sub.gradedAt } : {}),
        },
        data: {
          status: 'GRADED',
          score: input.score,
          feedback,
          gradedById: actor.sub,
          gradedAt,
        },
        select: SUBMISSION_SELECT,
      })
      .catch(rethrowStaleStatus)
    await this.record(
      actor,
      regrade ? 'submission_regraded' : 'submission_graded',
      submissionId,
      ctx,
      regrade
        ? { previousScore: sub.score, score: input.score, previousGradedById: sub.gradedById }
        : { score: input.score },
    )
    await this.notifyStudent(
      graded.student.id,
      NOTIFICATION_JOBS.ASSIGNMENT_GRADED,
      'assignments.graded.title',
      { subject: sub.assignment.course.subject.name, title: sub.assignment.title },
      { url: '/assignments', submissionId },
      // У переоценки свой ключ: прежний (на попытку) погасил бы повторное уведомление.
      regrade
        ? `submission-regraded:${submissionId}:${gradedAt.getTime()}`
        : `submission-graded:${submissionId}:${graded.attemptNumber}`,
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
    // Закрытое задание работ не принимает: возвращённую студент не смог бы ни поправить, ни
    // отправить снова. Сначала задание открывают заново, потом возвращают работу.
    if (sub.assignment.status !== 'PUBLISHED') {
      throw new AppException('CONFLICT', 'Задание закрыто — откройте его, чтобы вернуть работу')
    }
    const returned = await this.prisma.submission
      .update({
        where: { id: submissionId, status: 'SUBMITTED' },
        data: {
          status: 'RETURNED',
          feedback: input.feedback,
          gradedById: actor.sub,
          gradedAt: new Date(),
        },
        select: SUBMISSION_SELECT,
      })
      .catch(rethrowStaleStatus)
    await this.record(actor, 'submission_returned', submissionId, ctx)
    await this.notifyStudent(
      returned.student.id,
      NOTIFICATION_JOBS.ASSIGNMENT_GRADED,
      'assignments.returned.title',
      { subject: sub.assignment.course.subject.name, title: sub.assignment.title },
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
        // Задания текущей группы И те, по которым студент отправлял работу: после перевода в
        // другую группу выборка только по группе прятала прежние работы и оценки за них (как
        // в журнале оценок). Черновик в прежней группе — не работа, его не считаем.
        OR: [
          { course: { is: { groupId: viewer.groupId ?? '__none__' } } },
          { submissions: { some: { studentId: viewer.sub, status: { not: 'DRAFT' } } } },
        ],
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
    course: { groupId: string; teacherId: string | null; ownWork?: boolean },
  ): Promise<void> {
    if (isPlatform(viewer.role)) return
    if (STUDENT_ROLES.includes(viewer.role)) {
      if (viewer.groupId === course.groupId || course.ownWork) return
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
      select: {
        id: true,
        status: true,
        title: true,
        description: true,
        type: true,
        submissionType: true,
        maxScore: true,
        maxAttempts: true,
        allowLate: true,
        dueAt: true,
        course: { select: COURSE_MINI },
      },
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
        score: true,
        gradedAt: true,
        gradedById: true,
        assignment: {
          select: { title: true, status: true, maxScore: true, course: { select: COURSE_MINI } },
        },
      },
    })
    if (!sub) throw new AppException('NOT_FOUND', 'Работа не найдена')
    await this.assertManage(actor, sub.assignment.course)
    return sub
  }

  /**
   * Можно ли добавить файл в работу: задание открыто для сдачи, работа ещё не отправлена
   * (или возвращена на доработку) и потолок файлов не выбран. Отдаёт черновик, если он уже
   * есть. Только проверка — её же зовёт presign: ссылку на запись выдаём лишь тому, кто
   * вправе сдавать, а строку сдачи заводим уже на confirm.
   */
  private async assertCanAttach(
    actor: JwtPayload,
    assignmentId: string,
  ): Promise<{ id: string } | null> {
    await this.assertStudentCanSubmit(actor, assignmentId)
    const existing = await this.prisma.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: actor.sub } },
      select: { id: true, status: true, _count: { select: { files: true } } },
    })
    if (!existing) return null
    if (existing.status === 'SUBMITTED' || existing.status === 'GRADED') {
      throw new AppException('CONFLICT', 'Работа уже отправлена')
    }
    if (existing._count.files >= SUBMISSION_FILES_LIMIT) {
      throw new AppException(
        'CONFLICT',
        `К работе можно приложить не больше ${SUBMISSION_FILES_LIMIT} файлов`,
      )
    }
    return { id: existing.id }
  }

  /** Черновик для нового файла; нет — создаётся пустой. */
  private async draftForFiles(actor: JwtPayload, assignmentId: string): Promise<string> {
    const existing = await this.assertCanAttach(actor, assignmentId)
    if (existing) return existing.id
    // upsert, а не create: две параллельные загрузки первого файла не упрутся в уникальный ключ.
    const created = await this.prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId: actor.sub } },
      create: { assignmentId, studentId: actor.sub, status: 'DRAFT' },
      update: {},
      select: { id: true },
    })
    return created.id
  }

  private async attachFile(fileId: string, submissionId: string) {
    return this.prisma.file.update({
      where: { id: fileId },
      data: { submissionId },
      select: SUBMISSION_FILE_SELECT,
    })
  }

  private submissionsBucket(): string {
    return this.config.get('MINIO_BUCKET_APPLICATIONS', { infer: true })
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
        titleKey: 'assignments.published.title',
        bodyKey: 'assignments.course.body',
        params: { subject: a.course.subject.name, title: a.title },
        data: { url: '/assignments', assignmentId: a.id },
        dedupeKey: `assignment-published:${a.id}`,
      },
      { jobId: `assignment-published:${a.id}` },
    )
  }

  private async notifyStudent(
    userId: string,
    jobName: string,
    titleKey: NotificationMessageKey,
    params: NotificationParams,
    data: Record<string, unknown>,
    dedupeKey: string,
  ): Promise<void> {
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      jobName,
      {
        recipientIds: [userId],
        type: 'SYSTEM',
        titleKey,
        bodyKey: 'assignments.course.body',
        params,
        data,
        dedupeKey,
      },
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
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      userId: actor.sub,
      action,
      entity: 'Assignment',
      entityId,
      metadata,
      ...ctx,
    })
  }
}

/**
 * Изменённые поля задания значениями «было → стало» для аудита правки. Описание сюда не
 * входит (до 20 000 символов) — о нём в аудите только факт правки.
 */
function auditedChanges(
  before: Record<(typeof AUDITED_FIELDS)[number], unknown>,
  after: Record<(typeof AUDITED_FIELDS)[number], unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of AUDITED_FIELDS) {
    const from =
      before[field] instanceof Date ? (before[field] as Date).toISOString() : before[field]
    const to = after[field] instanceof Date ? (after[field] as Date).toISOString() : after[field]
    if (from !== to) changes[field] = { from: from ?? null, to: to ?? null }
  }
  return changes
}

/**
 * Порядок списка заданий.
 *
 * Без явной сортировки — прежний порядок «ближайший срок сверху» для преподавателя при
 * первом открытии. Студент без `sort` сюда не попадает: у него «актуальные сверху»
 * (`listByRelevance`).
 *
 * Вторым ключом всегда `createdAt`: заданий с одинаковым сроком или статусом много,
 * и без него СУБД вправе вернуть их в любом порядке — строки перемешивались бы между
 * страницами. Предмет и группа — поля связи, сортировать по `courseId` (uuid) значило
 * бы упорядочить по случайному значению.
 */
export function assignmentOrderBy(
  sort: AssignmentListQueryInput['sort'],
  order: AssignmentListQueryInput['order'],
): Prisma.AssignmentOrderByWithRelationInput[] {
  const dir = order ?? 'asc'
  if (sort === 'title') return [{ title: dir }, { createdAt: 'desc' }]
  if (sort === 'status') return [{ status: dir }, { createdAt: 'desc' }]
  if (sort === 'dueAt') return [{ dueAt: dir }, { createdAt: 'desc' }]
  if (sort === 'subject') return [{ course: { subject: { name: dir } } }, { createdAt: 'desc' }]
  if (sort === 'group') return [{ course: { group: { name: dir } } }, { createdAt: 'desc' }]
  return [{ dueAt: 'asc' }, { createdAt: 'desc' }]
}
