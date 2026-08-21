import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import * as QRCode from 'qrcode'
import { Role } from '@studenthub/shared-types'
import type {
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

// Ростер пары: потолок общий для студентов и их отметок (BACKEND_RULES §7.2).
const ROSTER_LIMIT = 500

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

// Время жизни QR-токена самоотметки: короткое, чтобы окно «переслать скрин» было мало.
const QR_TTL_MS = 90_000

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
  async roster(viewer: JwtPayload, query: AttendanceRosterQueryInput) {
    const pair = await this.resolvePair(query.pairId)
    this.assertManagePair(viewer, pair)
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
    this.assertManagePair(actor, pair)

    const groupStudents = await this.prisma.user.findMany({
      where: { groupId: pair.groupId, role: { in: ['STUDENT', 'STAROSTA'] } },
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

  /** Сводка посещаемости студента (свои данные). */
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
    }
    const [all, records] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({ where, select: { status: true }, take: 2000 }),
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
    for (const a of all) {
      if (a.status in counts) counts[a.status as keyof typeof counts] += 1
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
    this.assertManagePair(actor, pair)
    const exp = Date.now() + QR_TTL_MS
    const token = signToken<QrPayload>(
      { typ: QR_TYP, p: pair.id, d: query.date, exp },
      this.secret(),
    )
    const checkinUrl = `${this.webBase()}/checkin?t=${encodeURIComponent(token)}`
    const qr = await QRCode.toDataURL(checkinUrl, { margin: 1, width: 320 })
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

  private secret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true })
  }

  private verifyQrToken(token: string): QrPayload {
    const res = verifyToken<QrPayload>(token, this.secret(), Date.now())
    if (!res.ok) {
      if (res.reason === 'expired') {
        throw new AppException('BAD_REQUEST', 'QR-код истёк — попросите преподавателя обновить')
      }
      if (res.reason === 'invalid')
        throw new AppException('UNAUTHORIZED', 'Недействительный QR-код')
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

  // ── scope ─────────────────────────────────────────────────────────────────

  private assertManagePair(
    actor: JwtPayload,
    pair: { teacherId: string | null; facultyId: string; universityId: string },
  ): void {
    if (isPlatform(actor.role)) return
    if (actor.role === Role.TEACHER) {
      if (pair.teacherId === actor.sub) return
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

  private async resolvePair(pairId: string): Promise<{
    id: string
    groupId: string
    teacherId: string | null
    subject: string
    facultyId: string
    universityId: string
  }> {
    const pair = await this.prisma.pair.findUnique({
      where: { id: pairId },
      select: {
        id: true,
        groupId: true,
        teacherId: true,
        subject: true,
        group: { select: { facultyId: true, faculty: { select: { universityId: true } } } },
      },
    })
    if (!pair) throw new AppException('NOT_FOUND', 'Занятие не найдено')
    return {
      id: pair.id,
      groupId: pair.groupId,
      teacherId: pair.teacherId,
      subject: pair.subject,
      facultyId: pair.group.facultyId,
      universityId: pair.group.faculty.universityId,
    }
  }
}
