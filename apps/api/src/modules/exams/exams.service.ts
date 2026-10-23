import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role, type ErrorDetail } from '@studenthub/shared-types'
import type { NotificationMessageKey } from '@studenthub/shared-config'
import {
  EXAM_LIST_LIMIT,
  type CreateExamInput,
  type ExamListQueryInput,
  type SetExamResultsInput,
  type UpdateExamInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { QueueService } from '../../common/queue/queue.service'
import { QUEUES, NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import { localDateTimeLabel } from '../../common/time/local-label'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

// Потолки на выборки (BACKEND_RULES §7.2): ведомость ограничена размером группы.
const GROUP_STUDENTS_LIMIT = 200

// Длительности у экзамена нет — `date` это начало. Экзамены, чьи начала ближе часа, заведомо
// идут одновременно: короче часа экзамен не бывает. Шире окно не берём — без длительности
// это уже догадка, и отказ в законном расписании хуже пропущенного пересечения.
export const EXAM_CONFLICT_WINDOW_MS = 60 * 60_000
// Кандидатов на пересечение в окне — единицы; потолок обязателен в запросе (§7.2).
const CONFLICT_CANDIDATES_LIMIT = 50

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

/**
 * Слияние двух сторон от `now`, каждая отсортирована от ближайшего к `now`: берёт `limit`
 * ближайших в обе стороны и возвращает их по возрастанию даты.
 */
function nearestToNow<T extends { date: Date }>(
  upcoming: T[],
  past: T[],
  now: Date,
  limit: number,
): T[] {
  let u = 0
  let p = 0
  while (u + p < limit && (u < upcoming.length || p < past.length)) {
    const next = upcoming[u]
    const prev = past[p]
    const nextGap = next ? next.date.getTime() - now.getTime() : Infinity
    const prevGap = prev ? now.getTime() - prev.date.getTime() : Infinity
    if (nextGap <= prevGap) u++
    else p++
  }
  return [...past.slice(0, p).reverse(), ...upcoming.slice(0, u)]
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
    private readonly queue: QueueService,
  ) {}

  /**
   * Экзамены по scope. В выдачу попадают `EXAM_LIST_LIMIT` экзаменов, БЛИЖАЙШИХ к текущему
   * моменту (предстоящие и недавно прошедшие), порядок ответа — по возрастанию даты.
   * Раньше брались первые по дате: у декана и админа, где за год набираются сотни экзаменов,
   * в ответ попадали самые старые, а текущая сессия не попадала вовсе.
   */
  async list(viewer: JwtPayload, query: ExamListQueryInput) {
    // AND, не spread: ?groupId= обязан СУЖАТЬ scope (у студента scope keys на groupId —
    // spread дал бы чтение экзаменов чужой группы). См. §14.
    const filters: Prisma.ExamWhereInput[] = [
      this.scopeWhere(viewer),
      ...(query.groupId ? [{ groupId: query.groupId }] : []),
      ...(query.courseId ? [{ courseId: query.courseId }] : []),
      ...(query.mine ? [{ OR: [{ examinerId: viewer.sub }, { createdById: viewer.sub }] }] : []),
      ...(query.from ? [{ date: { gte: new Date(query.from) } }] : []),
      ...(query.to ? [{ date: { lt: new Date(query.to) } }] : []),
    ]
    const withMine = STUDENT_ROLES.includes(viewer.role)
    const select = withMine ? this.selectWithMine(viewer.sub) : EXAM_SELECT
    const now = new Date()
    // Две стороны от «сейчас», каждая — от ближайшего. Ближайшие N экзаменов всегда лежат
    // среди первых N каждой стороны, поэтому слияние ниже точное.
    const [upcoming, past] = await Promise.all([
      this.prisma.exam.findMany({
        where: { AND: [...filters, { date: { gte: now } }] },
        select,
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        take: EXAM_LIST_LIMIT,
      }),
      this.prisma.exam.findMany({
        where: { AND: [...filters, { date: { lt: now } }] },
        select,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: EXAM_LIST_LIMIT,
      }),
    ])
    return nearestToNow(upcoming, past, now, EXAM_LIST_LIMIT).map((r) => this.mapMine(r))
  }

  async getById(viewer: JwtPayload, id: string) {
    const withMine = STUDENT_ROLES.includes(viewer.role)
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      select: withMine ? this.selectWithMine(viewer.sub) : EXAM_SELECT,
    })
    if (!exam) throw new AppException('NOT_FOUND', 'Экзамен не найден')
    const mine = (exam as Record<string, unknown>).results
    await this.assertRead(viewer, {
      groupId: exam.groupId,
      teacherId: exam.course.teacherId,
      examinerId: exam.examiner?.id ?? null,
      // Свой результат по экзамену прежней группы — тот же признак, что в `scopeWhere`.
      ownResult: Array.isArray(mine) && mine.length > 0,
    })
    return this.mapMine(exam)
  }

  /** Ведомость экзамена: студенты группы + их результаты (декан/экзаменатор). */
  async results(viewer: JwtPayload, examId: string) {
    const exam = await this.findManageable(viewer, examId, { examiner: true })
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
        take: GROUP_STUDENTS_LIMIT,
      }),
      this.prisma.examResult.findMany({
        where: { examId },
        select: RESULT_SELECT,
        take: GROUP_STUDENTS_LIMIT,
      }),
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
    const date = new Date(input.date)
    const examinerId = input.examinerId ?? course.teacherId
    await this.assertNoConflict({
      groupId: course.groupId,
      date,
      roomId: input.roomId ?? null,
      examinerId,
    })
    const exam = await this.prisma.exam.create({
      data: {
        courseId: input.courseId,
        groupId: course.groupId,
        createdById: actor.sub,
        examinerId,
        roomId: input.roomId,
        date,
        format: input.format,
        maxScore: input.maxScore,
        note: input.note,
      },
      select: EXAM_SELECT,
    })
    await this.record(actor, 'exam_created', exam.id, ctx)
    await this.notifyGroupIfUpcoming(
      exam,
      NOTIFICATION_JOBS.EXAM_SCHEDULED,
      'exams.scheduled.title',
      `exam-scheduled:${exam.id}`,
    )
    return exam
  }

  async update(actor: JwtPayload, id: string, input: UpdateExamInput, ctx: RequestContext) {
    const exam = await this.findManageable(actor, id)
    // Максимум ниже уже выставленного балла сделал бы старые результаты «больше 100 %».
    if (input.maxScore != null) {
      const { _max } = await this.prisma.examResult.aggregate({
        where: { examId: id, score: { not: null } },
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
    if (input.examinerId || input.roomId) {
      const universityId = await this.universityOfGroup(exam.groupId)
      if (input.examinerId) await this.assertSameUniversity(input.examinerId, universityId)
      // Как и при создании: аудитория чужого вуза в экзамен не ставится.
      if (input.roomId) await this.assertRoomUniversity(input.roomId, universityId)
    }
    // Итоговые время, аудитория и экзаменатор: `undefined` — поле не меняется, `null` — снято.
    const next = {
      date: input.date ? new Date(input.date) : exam.date,
      roomId: input.roomId === undefined ? exam.roomId : input.roomId,
      examinerId: input.examinerId === undefined ? exam.examinerId : input.examinerId,
    }
    const moved = next.date.getTime() !== exam.date.getTime()
    const roomChanged = next.roomId !== exam.roomId
    // Пересечения проверяем, только если меняется то, от чего они зависят: правка заметки
    // не должна упираться в конфликт, заведённый до появления проверки.
    if (moved || roomChanged || next.examinerId !== exam.examinerId) {
      await this.assertNoConflict({ id, groupId: exam.groupId, ...next })
    }
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
    // Студенту важны время и место; смена экзаменатора или заметки — не повод для уведомления.
    if (moved || roomChanged) {
      await this.notifyGroupIfUpcoming(
        updated,
        NOTIFICATION_JOBS.EXAM_UPDATED,
        'exams.updated.title',
        // Время и аудитория — в ключе: второй перенос того же экзамена — новое уведомление.
        `exam-updated:${id}:${next.date.toISOString()}:${next.roomId ?? '-'}`,
      )
    }
    return updated
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findManageable(actor, id)
    // Экзамен с выставленными результатами не удаляем: каскад стёр бы ведомость.
    const scored = await this.prisma.examResult.count({
      where: { examId: id, OR: [{ score: { not: null } }, { status: { not: 'SCHEDULED' } }] },
    })
    if (scored > 0) {
      throw new AppException('CONFLICT', 'По экзамену уже есть результаты')
    }
    await this.prisma.exam.delete({ where: { id } })
    await this.record(actor, 'exam_deleted', id, ctx)
  }

  async setResults(actor: JwtPayload, input: SetExamResultsInput, ctx: RequestContext) {
    const exam = await this.findManageable(actor, input.examId, { examiner: true })
    const groupStudents = await this.prisma.user.findMany({
      where: { groupId: exam.groupId, role: { in: ['STUDENT', 'STAROSTA'] }, deletedAt: null },
      select: { id: true },
      take: GROUP_STUDENTS_LIMIT,
    })
    const allowed = new Set(groupStudents.map((s) => s.id))
    for (const e of input.entries) {
      if (!allowed.has(e.studentId))
        throw new AppException('WRONG_SCOPE', 'Студент не из этой группы')
    }
    assertResultsConsistent(input.entries, exam.maxScore)
    const before = await this.prisma.examResult.findMany({
      where: { examId: input.examId, studentId: { in: input.entries.map((e) => e.studentId) } },
      select: { studentId: true, admitted: true, status: true, score: true, attempt: true },
      take: input.entries.length,
    })
    const plan = planExamResults(before, input.entries)
    if (plan.writes.length > 0) {
      await this.prisma.$transaction(
        plan.writes.map((w) =>
          this.prisma.examResult.upsert({
            where: { examId_studentId: { examId: input.examId, studentId: w.studentId } },
            create: { examId: input.examId, ...w, note: w.note ?? null },
            update: {
              admitted: w.admitted,
              status: w.status,
              score: w.score,
              note: w.note,
              attempt: w.attempt,
            },
          }),
        ),
      )
    }
    // Прежние значения — в аудит: строка ведомости одна на студента, и исправление (или
    // результат пересдачи) иначе не оставляло следа, кроме `{count}`.
    await this.audit.record({
      userId: actor.sub,
      action: 'exam_results_set',
      entity: 'Exam',
      entityId: input.examId,
      metadata: { count: input.entries.length, changes: plan.changes },
      ...ctx,
    })
    // Студенту сообщаем об итоге: статус или балл стал другим и это уже не «запланирован».
    const informed = plan.changes
      .filter(
        (c) =>
          c.to.status !== 'SCHEDULED' &&
          (c.from?.status !== c.to.status || c.from?.score !== c.to.score),
      )
      .map((c) => c.studentId)
    if (informed.length > 0) {
      await this.notifyStudents(
        { id: exam.id, groupId: exam.groupId, date: exam.date, subject: exam.subject },
        NOTIFICATION_JOBS.EXAM_RESULT,
        'exams.result.title',
        'SYSTEM',
        // Адресаты — те, чья строка изменилась: ключ на сохранение, а не на экзамен.
        `exam-result:${exam.id}:${Date.now()}`,
        informed,
      )
    }
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
    if (STUDENT_ROLES.includes(viewer.role)) {
      // Экзамены текущей группы И те, где у студента есть результат: после перевода в другую
      // группу выборка только по группе прятала всю прежнюю сессию (как в журнале оценок).
      return {
        OR: [
          { groupId: viewer.groupId ?? '__none__' },
          { results: { some: { studentId: viewer.sub } } },
        ],
      }
    }
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
    exam: {
      groupId: string
      teacherId: string | null
      examinerId: string | null
      ownResult?: boolean
    },
  ): Promise<void> {
    if (isPlatform(viewer.role)) return
    if (STUDENT_ROLES.includes(viewer.role)) {
      if (viewer.groupId === exam.groupId || exam.ownResult) return
      throw new AppException('WRONG_SCOPE', 'Экзамен другой группы')
    }
    // Преподаватель — то же условие, что в `scopeWhere`: своя дисциплина или он экзаменатор.
    // Раньше по прямой ссылке открывался любой экзамен вуза, хотя в списке их не было.
    if (viewer.role === Role.TEACHER) {
      if (exam.teacherId === viewer.sub || exam.examinerId === viewer.sub) return
      throw new AppException('FORBIDDEN', 'Не ваш экзамен')
    }
    const meta = await this.resolveGroup(exam.groupId)
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

  /**
   * Экзамен, которым актор вправе управлять. `examiner: true` — для ведомости: её ведёт
   * назначенный экзаменатор, даже если дисциплину читает другой преподаватель (приглашённый
   * председатель комиссии, замена заболевшего). Править и удалять сам экзамен экзаменатор не
   * может — это остаётся за ведущим дисциплину и деканатом.
   */
  private async findManageable(
    actor: JwtPayload,
    id: string,
    opts: { examiner?: boolean } = {},
  ): Promise<ManageableExam> {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      select: {
        id: true,
        groupId: true,
        date: true,
        roomId: true,
        maxScore: true,
        examinerId: true,
        course: {
          select: {
            teacherId: true,
            subject: { select: { name: true } },
            group: { select: { facultyId: true, faculty: { select: { universityId: true } } } },
          },
        },
      },
    })
    if (!exam) throw new AppException('NOT_FOUND', 'Экзамен не найден')
    const found: ManageableExam = {
      id: exam.id,
      groupId: exam.groupId,
      date: exam.date,
      roomId: exam.roomId,
      examinerId: exam.examinerId,
      maxScore: exam.maxScore ?? null,
      subject: exam.course.subject.name,
    }
    if (opts.examiner && actor.role === Role.TEACHER && exam.examinerId === actor.sub) {
      return found
    }
    this.assertManageCourse(actor, {
      teacherId: exam.course.teacherId,
      facultyId: exam.course.group.facultyId,
      universityId: exam.course.group.faculty.universityId,
    })
    return found
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
    // Экзаменатор — действующий преподаватель или декан своего вуза.
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isBlocked: false },
      select: { universityId: true, role: true },
    })
    if (!user || user.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Экзаменатор другого университета')
    }
    if (user.role !== Role.TEACHER && user.role !== Role.DEAN) {
      throw new AppException('BAD_REQUEST', 'Экзаменатором может быть преподаватель или декан')
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

  /**
   * Нет ли у группы, аудитории или экзаменатора другого экзамена в это же время.
   * Одновременный экзамен в той же аудитории — совместная сдача потока (экзамен заводится на
   * группу, поток — это несколько экзаменов с одним временем и местом), её не запрещаем.
   */
  private async assertNoConflict(slot: ExamSlot): Promise<void> {
    const or: Prisma.ExamWhereInput[] = [{ groupId: slot.groupId }]
    if (slot.roomId) or.push({ roomId: slot.roomId })
    if (slot.examinerId) or.push({ examinerId: slot.examinerId })
    const near = await this.prisma.exam.findMany({
      where: {
        ...(slot.id ? { id: { not: slot.id } } : {}),
        date: {
          gt: new Date(slot.date.getTime() - EXAM_CONFLICT_WINDOW_MS),
          lt: new Date(slot.date.getTime() + EXAM_CONFLICT_WINDOW_MS),
        },
        OR: or,
      },
      select: { id: true, date: true, groupId: true, roomId: true, examinerId: true },
      take: CONFLICT_CANDIDATES_LIMIT,
    })
    const details = examConflicts(slot, near)
    if (details.length > 0) {
      throw new AppException('CONFLICT', 'В это время уже идёт другой экзамен', details)
    }
  }

  /** Назначение и перенос — всей группе и только для предстоящего экзамена. */
  private async notifyGroupIfUpcoming(
    exam: { id: string; groupId: string; date: Date; course: { subject: { name: string } } },
    jobName: string,
    titleKey: NotificationMessageKey,
    dedupeKey: string,
  ): Promise<void> {
    // Задним числом заведённый экзамен (перенос архива) — не новость для студента.
    if (!(exam.date instanceof Date) || exam.date.getTime() <= Date.now()) return
    await this.notifyStudents(
      { id: exam.id, groupId: exam.groupId, date: exam.date, subject: exam.course.subject.name },
      jobName,
      titleKey,
      'SCHEDULE_CHANGE',
      dedupeKey,
    )
  }

  /**
   * Уведомление студентам об экзамене через очередь `notifications`: о назначении, переносе
   * и результате студент раньше узнавал, только открыв «Экзамены». Адресаты — вся группа
   * или перечисленные студенты; текст — дисциплина и время экзамена по часам вуза.
   */
  private async notifyStudents(
    exam: { id: string; groupId: string; date: Date; subject: string },
    jobName: string,
    titleKey: NotificationMessageKey,
    type: 'SCHEDULE_CHANGE' | 'SYSTEM',
    dedupeKey: string,
    studentIds?: string[],
  ): Promise<void> {
    const [group, students] = await Promise.all([
      this.prisma.group.findUnique({
        where: { id: exam.groupId },
        select: { faculty: { select: { university: { select: { timezone: true } } } } },
      }),
      studentIds
        ? Promise.resolve(studentIds.map((id) => ({ id })))
        : this.prisma.user.findMany({
            where: {
              groupId: exam.groupId,
              role: { in: ['STUDENT', 'STAROSTA'] },
              deletedAt: null,
              isBlocked: false,
            },
            select: { id: true },
            take: GROUP_STUDENTS_LIMIT,
          }),
    ])
    if (students.length === 0) return
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      jobName,
      {
        recipientIds: students.map((s) => s.id),
        type,
        titleKey,
        bodyKey: 'exams.course.body',
        params: {
          subject: exam.subject,
          date: localDateTimeLabel(exam.date, group?.faculty.university.timezone),
        },
        data: { url: '/exams', examId: exam.id },
        dedupeKey,
      },
      { jobId: dedupeKey },
    )
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

/** Экзамен, которым актор вправе управлять, — с тем, что нужно для проверок и уведомлений. */
interface ManageableExam {
  id: string
  groupId: string
  date: Date
  roomId: string | null
  examinerId: string | null
  maxScore: number | null
  subject: string
}

/** Время и место экзамена для проверки пересечений. `id` — свой экзамен при правке. */
export interface ExamSlot {
  id?: string
  groupId: string
  date: Date
  roomId: string | null
  examinerId: string | null
}

/**
 * Какие пересечения запрещены. Кандидаты уже отобраны по окну времени, здесь — правила:
 * группа не сдаёт два экзамена разом; аудитория занята, если другой экзамен в ней начинается
 * в другое время (в то же — совместная сдача потока); экзаменатор не может принимать в двух
 * местах сразу, кроме той же совместной сдачи.
 */
export function examConflicts(
  slot: ExamSlot,
  others: { date: Date; groupId: string; roomId: string | null; examinerId: string | null }[],
): ErrorDetail[] {
  const found = new Map<string, string>()
  for (const o of others) {
    const sameTime = o.date.getTime() === slot.date.getTime()
    const jointSitting = sameTime && o.roomId === slot.roomId
    if (o.groupId === slot.groupId) {
      found.set('date', 'У группы в это время другой экзамен')
    }
    if (slot.roomId && o.roomId === slot.roomId && !sameTime) {
      found.set('roomId', 'Аудитория занята другим экзаменом')
    }
    if (slot.examinerId && o.examinerId === slot.examinerId && !jointSitting) {
      found.set('examinerId', 'Экзаменатор в это время принимает другой экзамен')
    }
  }
  return [...found].map(([field, message]) => ({ field, message }))
}

/** Строка ведомости к записи. `note: undefined` — заметку не трогать. */
interface ResultWrite {
  studentId: string
  admitted: boolean
  status: SetExamResultsInput['entries'][number]['status']
  score: number | null
  note: string | null | undefined
  attempt: number
}

/** Строка ведомости в аудите: допуск, статус, балл, попытка. */
interface ResultSnapshot {
  admitted: boolean
  status: string
  score: number | null
  attempt: number
}

/**
 * Что записать в ведомость и что изменилось.
 *
 * Пишутся новые строки и изменённые: строка, присланная без изменений, не трогается.
 * Попытка: строка со статусом «Пересдача» (RETAKE), получившая итог (сдал / не сдал /
 * неявка), — это результат следующей попытки, `attempt + 1`. Раньше результат пересдачи
 * молча затирал первую попытку, а `attempt` навсегда оставался 1. Прежнее значение строки
 * при этом уходит в аудит (`changes[].from`); отдельной строки на попытку без миграции нет.
 */
export function planExamResults(
  before: (ResultSnapshot & { studentId: string })[],
  entries: SetExamResultsInput['entries'],
): {
  writes: ResultWrite[]
  changes: { studentId: string; from: ResultSnapshot | null; to: ResultSnapshot }[]
} {
  const prevByStudent = new Map(before.map((r) => [r.studentId, r]))
  const writes: ResultWrite[] = []
  const changes: { studentId: string; from: ResultSnapshot | null; to: ResultSnapshot }[] = []
  for (const e of entries) {
    const prev = prevByStudent.get(e.studentId)
    const score = e.score ?? null
    const retakeDone = prev?.status === 'RETAKE' && FINAL_AFTER_RETAKE.has(e.status)
    const attempt = prev ? prev.attempt + (retakeDone ? 1 : 0) : 1
    const to: ResultSnapshot = { admitted: e.admitted, status: e.status, score, attempt }
    const from: ResultSnapshot | null = prev
      ? { admitted: prev.admitted, status: prev.status, score: prev.score, attempt: prev.attempt }
      : null
    const changed =
      !from ||
      from.admitted !== to.admitted ||
      from.status !== to.status ||
      from.score !== to.score ||
      from.attempt !== to.attempt
    // Заметка в сравнение не входит, но пишется всегда, когда пришла: правка одной заметки
    // не повод уведомлять студента, а потерять её нельзя. Не пришла — не трогаем.
    if (changed || e.note !== undefined) {
      writes.push({
        studentId: e.studentId,
        admitted: e.admitted,
        status: e.status,
        score,
        note: e.note,
        attempt,
      })
    }
    if (changed) changes.push({ studentId: e.studentId, from, to })
  }
  return { writes, changes }
}

// Итоги, которые закрывают пересдачу и начинают следующую попытку.
const FINAL_AFTER_RETAKE: ReadonlySet<string> = new Set(['PASSED', 'FAILED', 'ABSENT'])

/**
 * Ведомость не должна противоречить сама себе. Схема держит только общий потолок 0..1000,
 * поэтому «150 из 100» сохранялось как есть, а недопущенный студент мог получить «сдал».
 * Отказ целиком, с адресом каждой строки — путь как у ошибок схемы (`entries.<i>.<поле>`),
 * чтобы клиент подсветил их одинаково.
 */
export function assertResultsConsistent(
  entries: SetExamResultsInput['entries'],
  maxScore: number | null,
): void {
  const details = entries.flatMap((e, i) => [
    ...(maxScore != null && e.score != null && e.score > maxScore
      ? [{ field: `entries.${i}.score`, message: `Не больше ${maxScore}` }]
      : []),
    ...(!e.admitted && (e.status === 'PASSED' || e.status === 'FAILED')
      ? [{ field: `entries.${i}.status`, message: 'Студент не допущен к экзамену' }]
      : []),
  ])
  if (details.length > 0) {
    throw new AppException('VALIDATION_ERROR', 'Ведомость заполнена с ошибками', details)
  }
}
