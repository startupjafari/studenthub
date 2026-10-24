import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { renderQrDataUrl } from '../../common/qr/qr-image'
import { Role } from '@studenthub/shared-types'
import type {
  AttendanceMarkedQueryInput,
  AttendanceRosterQueryInput,
  AttendanceSummaryQueryInput,
  MarkAttendanceInput,
  QrCheckInInput,
  QrTokenQueryInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { signToken, verifyToken, type SignedPayload } from '../../common/crypto/signed-token'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import type { RequestContext } from '../auth/auth.service'
import { localDateTimeLabel } from '../../common/time/local-label'

// Ростер пары: потолок общий для студентов и их отметок (BACKEND_RULES §7.2).
const ROSTER_LIMIT = 500

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

// Время жизни QR-токена самоотметки: короткое, чтобы окно «переслать скрин» было мало.
const QR_TTL_MS = 90_000

// Окно QR-самоотметки вокруг занятия: выдать код и отметиться можно с получаса до начала
// пары (студенты рассаживаются) до четверти часа после конца (опоздавший досканирует).
// Широкое намеренно: время пары в системе бывает неточным, а отказ на живом занятии
// хуже, чем отметка за несколько минут до звонка.
export const QR_OPEN_BEFORE_MIN = 30
export const QR_CLOSE_AFTER_MIN = 15
// Запас для самоотметки сверх окна: код, выданный в последнюю минуту окна, живёт ещё QR_TTL_MS.
const CHECKIN_GRACE_MIN = Math.ceil(QR_TTL_MS / 60_000)

// Дискриминатор назначения токена: тот же секрет подписывает разные токены (student-id и др.),
// поэтому проверяем typ, чтобы чужой валидно-подписанный токен не попал в чужой обработчик.
const QR_TYP = 'att-checkin'

interface QrPayload extends SignedPayload {
  typ: typeof QR_TYP
  p: string // pairId
  d: string // YYYY-MM-DD
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /** Ростер занятия (пара+дата): студенты группы + их текущие отметки (для преподавателя). */
  /**
   * Какие из перечисленных пар уже отмечены на дату.
   *
   * Один запрос вместо ростера по каждой паре: дашборду нужен не состав отметок, а
   * один факт — заполнен журнал или нет. Пара считается отмеченной, если по ней есть
   * хотя бы одна запись: журнал сохраняется целиком, частичных отметок не бывает.
   *
   * Scope держит `resolvePair`-проверка на записи: здесь читаются только те пары,
   * которые клиент уже получил из своего расписания, а чужой pairId не даст ничего
   * сверх факта «отметок нет» — состава журнала в ответе нет вовсе.
   */
  async marked(query: AttendanceMarkedQueryInput): Promise<{ marked: string[] }> {
    const rows = await this.prisma.attendance.findMany({
      where: { pairId: { in: query.pairIds }, date: new Date(query.date) },
      select: { pairId: true },
      distinct: ['pairId'],
      take: query.pairIds.length,
    })
    return { marked: rows.map((r) => r.pairId) }
  }

  async roster(viewer: JwtPayload, query: AttendanceRosterQueryInput) {
    const pair = await this.resolvePair(query.pairId)
    await this.assertManagePair(viewer, pair, query.date)
    const [students, marks] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: {
          groupId: pair.groupId,
          role: { in: ['STUDENT', 'STAROSTA'] },
          deletedAt: null,
          isBlocked: false,
        },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: ROSTER_LIMIT,
      }),
      this.prisma.attendance.findMany({
        where: { pairId: query.pairId, date: new Date(query.date) },
        select: { studentId: true, status: true, note: true },
        // Отметок не больше, чем студентов в ростере выше.
        take: ROSTER_LIMIT,
      }),
    ])
    const byStudent = new Map(marks.map((m) => [m.studentId, m]))
    return {
      pairId: query.pairId,
      date: query.date,
      subject: pair.subject,
      students: students.map((s) => ({
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        avatarUrl: s.avatarUrl,
        status: byStudent.get(s.id)?.status ?? null,
        note: byStudent.get(s.id)?.note ?? null,
      })),
    }
  }

  /** Массовая простановка отметок занятия (преподаватель). */
  async mark(actor: JwtPayload, input: MarkAttendanceInput, ctx: RequestContext) {
    const pair = await this.resolvePair(input.pairId)
    await this.assertManagePair(actor, pair, input.date)
    await this.assertHeldOn(pair, input.date)
    // Будущее занятие ещё не прошло: «присутствовал» или «отсутствовал» на нём — опечатка в
    // дате. Заранее можно только уважительную причину (справка, командировка).
    if (input.date > localDateTimeLabel(new Date(), pair.timezone).slice(0, 10)) {
      const early = input.entries.findIndex((e) => e.status !== 'EXCUSED')
      if (early !== -1) {
        throw new AppException('VALIDATION_ERROR', 'Занятие ещё не прошло', [
          { field: `entries.${early}.status`, message: 'Заранее — только уважительная причина' },
        ])
      }
    }

    const groupStudents = await this.prisma.user.findMany({
      where: { groupId: pair.groupId, role: { in: ['STUDENT', 'STAROSTA'] }, deletedAt: null },
      select: { id: true },
      take: 500,
    })
    const allowed = new Set(groupStudents.map((s) => s.id))
    for (const e of input.entries) {
      if (!allowed.has(e.studentId)) {
        throw new AppException('WRONG_SCOPE', 'Студент не из этой группы')
      }
    }

    const date = new Date(input.date)
    await this.prisma.$transaction(
      input.entries.map((e) =>
        this.prisma.attendance.upsert({
          where: {
            pairId_date_studentId: { pairId: input.pairId, date, studentId: e.studentId },
          },
          create: {
            pairId: input.pairId,
            studentId: e.studentId,
            date,
            status: e.status,
            note: e.note ?? undefined,
            markedById: actor.sub,
          },
          // note не передан (undefined) — не трогаем; передан null — очищаем; строка — ставим.
          update: {
            status: e.status,
            note: e.note === undefined ? undefined : e.note,
            markedById: actor.sub,
          },
        }),
      ),
    )
    await this.audit.record({
      userId: actor.sub,
      action: 'attendance_marked',
      entity: 'Attendance',
      entityId: input.pairId,
      metadata: { date: input.date, count: input.entries.length },
      ...ctx,
    })
    return this.roster(actor, { pairId: input.pairId, date: input.date })
  }

  /**
   * Сводка посещаемости студента (свои данные).
   *
   * Счётчики считает БД (`GROUP BY status`), а не выборка: прежние 2000 строк без порядка
   * к третьему-четвёртому курсу покрывали произвольную часть истории, и процент «плыл».
   * `subject` сужает сводку до дисциплины — страница курса раньше считала её в браузере
   * по последним 100 отметкам за все предметы, то есть за пару недель, а не за семестр.
   */
  async studentSummary(viewer: JwtPayload, query: AttendanceSummaryQueryInput) {
    if (!STUDENT_ROLES.includes(viewer.role)) {
      throw new AppException('FORBIDDEN', 'Только для студентов')
    }
    const where: Prisma.AttendanceWhereInput = {
      studentId: viewer.sub,
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.subject ? { pair: { is: { subject: query.subject } } } : {}),
    }
    // Promise.all, а не $transaction: groupBy в пакетной транзакции Prisma не типизирует.
    const [byStatus, records] = await Promise.all([
      // Строк в ответе не больше, чем статусов: потолок `take` здесь не нужен.
      this.prisma.attendance.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.attendance.findMany({
        where,
        select: {
          id: true,
          date: true,
          status: true,
          note: true,
          pair: { select: { subject: true, startTime: true } },
        },
        orderBy: { date: 'desc' },
        take: 100,
      }),
    ])
    const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 }
    for (const g of byStatus) {
      if (g.status in counts) counts[g.status as keyof typeof counts] += g._count._all
    }
    const total = counts.PRESENT + counts.LATE + counts.ABSENT + counts.EXCUSED
    // «Посещаемость» = доля не-пропусков (присутствовал/опоздал/уважительная).
    const rate = total === 0 ? 0 : Math.round(((total - counts.ABSENT) / total) * 100)
    return {
      total,
      present: counts.PRESENT,
      late: counts.LATE,
      absent: counts.ABSENT,
      excused: counts.EXCUSED,
      rate,
      records,
    }
  }

  /** Преподаватель: сгенерировать QR занятия (подписанный короткоживущий токен + картинка). */
  async createQrToken(actor: JwtPayload, query: QrTokenQueryInput) {
    const pair = await this.resolvePair(query.pairId)
    await this.assertManagePair(actor, pair, query.date)
    // QR — только на идущее сегодня занятие: код на завтрашнюю дату давал отметиться заранее.
    const time = await this.assertHeldOn(pair, query.date)
    this.assertQrWindow(pair, query.date, time, 0)
    const exp = Date.now() + QR_TTL_MS
    const token = signToken<QrPayload>(
      { typ: QR_TYP, p: pair.id, d: query.date, exp },
      this.secret(),
    )
    const checkinUrl = `${this.webBase()}/checkin?t=${encodeURIComponent(token)}`
    const qr = renderQrDataUrl(checkinUrl, { margin: 1, width: 320 })
    return {
      token,
      qr,
      checkinUrl,
      subject: pair.subject,
      date: query.date,
      expiresAt: new Date(exp).toISOString(),
      ttlSeconds: QR_TTL_MS / 1000,
    }
  }

  /** Студент: самоотметка по QR-токену. Идемпотентно — если отметка уже есть, не перетираем. */
  async checkIn(student: JwtPayload, input: QrCheckInInput, ctx: RequestContext) {
    if (!STUDENT_ROLES.includes(student.role)) {
      throw new AppException('FORBIDDEN', 'Самоотметка доступна только студентам')
    }
    const payload = this.verifyQrToken(input.token)
    const pair = await this.resolvePair(payload.p)
    const me = await this.prisma.user.findUnique({
      where: { id: student.sub },
      select: { groupId: true },
    })
    if (!me || me.groupId !== pair.groupId) {
      throw new AppException('WRONG_SCOPE', 'Вы не в группе этого занятия')
    }
    // Повторная проверка на скане: за время жизни кода занятие могли отменить, а код,
    // выданный до появления этих проверок, — получить на любую дату.
    const time = await this.assertHeldOn(pair, payload.d)
    this.assertQrWindow(pair, payload.d, time, CHECKIN_GRACE_MIN)
    const date = new Date(payload.d)
    const existing = await this.prisma.attendance.findUnique({
      where: { pairId_date_studentId: { pairId: pair.id, date, studentId: student.sub } },
      select: { status: true },
    })
    if (existing) {
      return { status: existing.status, subject: pair.subject, date: payload.d, already: true }
    }
    try {
      await this.prisma.attendance.create({
        data: {
          pairId: pair.id,
          studentId: student.sub,
          date,
          status: 'PRESENT',
          markedById: null,
        },
      })
    } catch (e) {
      // Гонка двух одновременных самоотметок: уникальный индекс уже заполнен — считаем идемпотентно.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const row = await this.prisma.attendance.findUnique({
          where: { pairId_date_studentId: { pairId: pair.id, date, studentId: student.sub } },
          select: { status: true },
        })
        return {
          status: row?.status ?? 'PRESENT',
          subject: pair.subject,
          date: payload.d,
          already: true,
        }
      }
      throw e
    }
    await this.audit.record({
      userId: student.sub,
      action: 'attendance_self_checkin',
      entity: 'Attendance',
      entityId: pair.id,
      metadata: { date: payload.d, via: 'qr' },
      ...ctx,
    })
    return { status: 'PRESENT', subject: pair.subject, date: payload.d, already: false }
  }

  // ── QR token (stateless, HMAC) ──────────────────────────────────────────────

  /**
   * Ключ подписи QR-токенов посещаемости.
   *
   * Выводится из JWT_ACCESS_SECRET, но НЕ равен ему: одним и тем же ключом подписывать
   * сессии и одноразовые QR-ссылки — значит связать две несвязанные системы. Ротация
   * доступа сломала бы развешанные QR, а утечка ключа одной подсистемы сразу отдавала бы
   * вторую. Разделение доменов делает sha256 с меткой назначения — отдельной переменной
   * окружения при этом не появляется, деплой менять не нужно.
   *
   * Смена ключа обесценивает уже выданные QR: они живут минутами (токен пары), так что
   * на практике это незаметно.
   */
  private secret(): string {
    this.qrSecret ??= createHash('sha256')
      .update(`${this.config.get('JWT_ACCESS_SECRET', { infer: true })}:attendance-qr:v1`)
      .digest('hex')
    return this.qrSecret
  }

  /** Кэш выведенного ключа: sha256 дешёвый, но считать его на каждый скан незачем. */
  private qrSecret: string | null = null

  private verifyQrToken(token: string): QrPayload {
    const res = verifyToken<QrPayload>(token, this.secret(), Date.now())
    if (!res.ok) {
      if (res.reason === 'expired') {
        throw new AppException('BAD_REQUEST', 'QR-код истёк — попросите преподавателя обновить')
      }
      // Не UNAUTHORIZED: 401 — про сессию, и клиент читал его как «Неверный email или пароль».
      if (res.reason === 'invalid') throw new AppException('BAD_REQUEST', 'Недействительный QR-код')
      throw new AppException('BAD_REQUEST', 'Некорректный QR-код')
    }
    // Токен другого назначения (напр. студенческий билет), но с той же подписью — не наш.
    if (res.payload.typ !== QR_TYP || typeof res.payload.p !== 'string') {
      throw new AppException('BAD_REQUEST', 'Некорректный QR-код')
    }
    return res.payload
  }

  // Базовый адрес веб-клиента для ссылки в QR (первый origin из CORS_ORIGIN).
  private webBase(): string {
    return this.config.get('CORS_ORIGIN', { infer: true }).split(',')[0]?.trim() ?? ''
  }

  // ── занятие в дату ────────────────────────────────────────────────────────

  /**
   * Проводится ли занятие в дату `date` (YYYY-MM-DD): версия расписания действует, день
   * недели — день пары, занятие не отменено. Возвращает фактическое время пары в эту дату
   * (для переноса MOVED — новое). Раньше отметку принимали на любую дату: на воскресенье,
   * на отменённую пару и на пару неактивной версии.
   *
   * Чётность недели сервер не сверяет: формула недели у клиентов расходится с ISO 8601 и
   * ждёт решения продукта, а ложный отказ в отметке живого занятия хуже пропущенной ошибки.
   */
  private async assertHeldOn(
    pair: ResolvedPair,
    date: string,
  ): Promise<{ start: string; end: string }> {
    if (!pair.scheduleActive) {
      throw new AppException('CONFLICT', 'Версия расписания с этой парой не действует')
    }
    if (isoDayOfWeek(date) !== pair.dayOfWeek) {
      throw new AppException('VALIDATION_ERROR', 'В этот день пары нет', [
        { field: 'date', message: 'День недели не совпадает с днём пары' },
      ])
    }
    const changes = await this.prisma.scheduleChange.findMany({
      where: { pairId: pair.id, date: new Date(date), type: { in: ['CANCELLED', 'MOVED'] } },
      select: { type: true, newStartTime: true, newEndTime: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    if (changes.some((c) => c.type === 'CANCELLED')) {
      throw new AppException('CONFLICT', 'Занятие в эту дату отменено')
    }
    const moved = changes.find((c) => c.type === 'MOVED')
    return {
      start: moved?.newStartTime ?? pair.startTime,
      end: moved?.newEndTime ?? pair.endTime,
    }
  }

  /**
   * QR живёт только вокруг занятия: сегодня по часам вуза и с QR_OPEN_BEFORE_MIN до начала
   * до QR_CLOSE_AFTER_MIN (+ `graceMin`) после конца.
   */
  private assertQrWindow(
    pair: ResolvedPair,
    date: string,
    time: { start: string; end: string },
    graceMin: number,
  ): void {
    const [today, now] = localDateTimeLabel(new Date(), pair.timezone).split(' ') as [
      string,
      string,
    ]
    const minutes = toMinutes(now)
    const opens = toMinutes(time.start) - QR_OPEN_BEFORE_MIN
    const closes = toMinutes(time.end) + QR_CLOSE_AFTER_MIN + graceMin
    if (date !== today || minutes < opens || minutes > closes) {
      throw new AppException(
        'CONFLICT',
        `QR-отметка открыта с ${QR_OPEN_BEFORE_MIN} мин до начала до ${QR_CLOSE_AFTER_MIN} мин после конца занятия`,
      )
    }
  }

  // ── scope ─────────────────────────────────────────────────────────────────

  /**
   * Право вести журнал занятия (пара + дата). Преподаватель — только своё занятие, причём
   * «своё» решается на дату: при замене (C-F12) его ведёт заменяющий, а основной на эту дату
   * журнал не трогает — он отсутствует, отмечал бы занятие, которого не проводил.
   */
  private async assertManagePair(
    actor: JwtPayload,
    pair: ResolvedPair,
    date: string,
  ): Promise<void> {
    if (isPlatform(actor.role)) return
    if (actor.role === Role.TEACHER) {
      const teacherId = (await this.substituteOn(pair.id, date)) ?? pair.teacherId
      if (teacherId === actor.sub) return
      throw new AppException('FORBIDDEN', 'Можно отмечать только свои занятия')
    }
    if (actor.role === Role.DEAN) {
      if (actor.facultyId === pair.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Другой факультет')
    }
    if (actor.role === Role.UNIVERSITY_ADMIN) {
      if (actor.universityId === pair.universityId) return
      throw new AppException('WRONG_SCOPE', 'Другой университет')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  /**
   * Заменяющий преподаватель занятия на дату или null, если замены нет (или аккаунт
   * заменяющего удалён — тогда занятие снова за основным). Решает последняя замена:
   * ошибочную деканат исправляет новой, отдельного редактирования замен нет.
   */
  private async substituteOn(pairId: string, date: string): Promise<string | null> {
    const substitution = await this.prisma.scheduleChange.findFirst({
      where: { pairId, date: new Date(date), type: 'SUBSTITUTED' },
      select: { newTeacherId: true },
      orderBy: { createdAt: 'desc' },
    })
    return substitution?.newTeacherId ?? null
  }

  private async resolvePair(pairId: string): Promise<ResolvedPair> {
    const pair = await this.prisma.pair.findUnique({
      where: { id: pairId },
      select: {
        id: true,
        groupId: true,
        teacherId: true,
        subject: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        schedule: { select: { isActive: true } },
        group: {
          select: {
            facultyId: true,
            faculty: {
              select: { universityId: true, university: { select: { timezone: true } } },
            },
          },
        },
      },
    })
    if (!pair) throw new AppException('NOT_FOUND', 'Занятие не найдено')
    return {
      id: pair.id,
      groupId: pair.groupId,
      teacherId: pair.teacherId,
      subject: pair.subject,
      dayOfWeek: pair.dayOfWeek,
      startTime: pair.startTime,
      endTime: pair.endTime,
      scheduleActive: pair.schedule.isActive,
      facultyId: pair.group.facultyId,
      universityId: pair.group.faculty.universityId,
      timezone: pair.group.faculty.university.timezone,
    }
  }
}

/** Пара с тем, что нужно для scope и проверки «занятие в дату». */
interface ResolvedPair {
  id: string
  groupId: string
  teacherId: string | null
  subject: string
  /** ISO: 1 — понедельник … 7 — воскресенье. */
  dayOfWeek: number
  startTime: string
  endTime: string
  scheduleActive: boolean
  facultyId: string
  universityId: string
  timezone: string | null
}

/** День недели календарной даты YYYY-MM-DD по ISO (1 — понедельник). Пояс не нужен: дата уже местная. */
export function isoDayOfWeek(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

/** "HH:mm" → минуты от полуночи. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return h * 60 + m
}
