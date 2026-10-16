import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  ACTIVE_APPOINTMENT_STATUSES,
  APPOINTMENT_QUEUE_LIMIT,
  CLOSED_APPOINTMENT_STATUSES,
  type AppointmentListQueryInput,
  type ConfirmAppointmentInput,
  type CreateAppointmentInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { QueueService } from '../../common/queue/queue.service'
import { QUEUES, NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { NotificationMessageKey } from '@studenthub/shared-config'
import type { RequestContext } from '../auth/auth.service'
import { rethrowStaleStatus } from '../../common/prisma/stale-status'
import { localDateTimeLabel } from '../../common/time/local-label'

// Допустимые переходы записи в деканат. Завершённая и отменённая — конечные: раньше сотрудник
// подтверждал запись, которую студент уже отменил, а студент «отменял» отменённую.
const TRANSITIONS: Record<string, readonly string[]> = {
  REQUESTED: ['CONFIRMED', 'RESCHEDULED', 'CANCELLED'],
  CONFIRMED: ['RESCHEDULED', 'COMPLETED', 'CANCELLED'],
  RESCHEDULED: ['CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

function assertTransition(from: string, to: string): void {
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new AppException('CONFLICT', 'Запись уже в другом статусе')
  }
}

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(ACTIVE_APPOINTMENT_STATUSES)

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

const SELECT = {
  id: true,
  type: true,
  status: true,
  topic: true,
  requestedAt: true,
  scheduledAt: true,
  applicationId: true,
  staffNote: true,
  createdAt: true,
  facultyId: true,
  student: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.DeaneryAppointmentSelect

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async create(actor: JwtPayload, input: CreateAppointmentInput, ctx: RequestContext) {
    if (!STUDENT_ROLES.includes(actor.role)) {
      throw new AppException('FORBIDDEN', 'Записываются только студенты')
    }
    if (!actor.facultyId) throw new AppException('BAD_REQUEST', 'Факультет не назначен')
    const appointment = await this.prisma.deaneryAppointment.create({
      data: {
        studentId: actor.sub,
        facultyId: actor.facultyId,
        type: input.type,
        topic: input.topic,
        requestedAt: new Date(input.requestedAt),
        applicationId: input.applicationId,
      },
      select: SELECT,
    })
    await this.record(actor, 'appointment_created', appointment.id, ctx)
    return appointment
  }

  listMine(viewer: JwtPayload) {
    return this.prisma.deaneryAppointment.findMany({
      where: { studentId: viewer.sub },
      select: SELECT,
      orderBy: { requestedAt: 'desc' },
      take: 200,
    })
  }

  async cancelMine(actor: JwtPayload, id: string, ctx: RequestContext) {
    const appt = await this.prisma.deaneryAppointment.findUnique({
      where: { id },
      select: { id: true, studentId: true, status: true },
    })
    if (!appt) throw new AppException('NOT_FOUND', 'Запись не найдена')
    if (appt.studentId !== actor.sub) throw new AppException('FORBIDDEN', 'Не ваша запись')
    assertTransition(appt.status, 'CANCELLED')
    const updated = await this.prisma.deaneryAppointment
      .update({
        where: { id, status: appt.status },
        data: { status: 'CANCELLED' },
        select: SELECT,
      })
      .catch(rethrowStaleStatus)
    await this.record(actor, 'appointment_cancelled_by_student', id, ctx)
    return updated
  }

  /**
   * Очередь деканата. По умолчанию — только открытые записи: раньше выборка шла «по статусу»
   * строкой, где CANCELLED и COMPLETED алфавитно раньше REQUESTED, и накопленный архив
   * вытеснял из потолка новые записи. Дальше потолка — по `cursor`.
   */
  async listQueue(viewer: JwtPayload, query: AppointmentListQueryInput) {
    const statuses: readonly string[] | null = query.status
      ? [query.status]
      : query.view === 'all'
        ? null
        : query.view === 'closed'
          ? CLOSED_APPOINTMENT_STATUSES
          : ACTIVE_APPOINTMENT_STATUSES
    // Открытые разбирают по желаемому времени — ближайшие и просроченные сверху; архив и
    // общий список читают с конца — свежие сверху.
    const openOnly = statuses !== null && statuses.every((s) => ACTIVE_STATUSES.has(s))
    const dir = openOnly ? 'asc' : 'desc'
    const where: Prisma.DeaneryAppointmentWhereInput = {
      ...this.scopeWhere(viewer),
      ...(statuses ? { status: { in: [...statuses] } } : {}),
    }
    return this.prisma.deaneryAppointment.findMany({
      where,
      select: SELECT,
      orderBy: [{ requestedAt: dir }, { id: dir }],
      take: query.limit ?? APPOINTMENT_QUEUE_LIMIT,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
  }

  async confirm(
    actor: JwtPayload,
    id: string,
    input: ConfirmAppointmentInput,
    status: 'CONFIRMED' | 'RESCHEDULED',
    ctx: RequestContext,
  ) {
    const appt = await this.findManageable(actor, id)
    assertTransition(appt.status, status)
    const updated = await this.prisma.deaneryAppointment
      .update({
        where: { id, status: appt.status },
        data: {
          status,
          scheduledAt: new Date(input.scheduledAt),
          staffNote: input.staffNote,
          assignedToId: actor.sub,
        },
        select: SELECT,
      })
      .catch(rethrowStaleStatus)
    await this.record(actor, `appointment_${status.toLowerCase()}`, id, ctx)
    await this.notifyStudent(
      appt.studentId,
      status === 'CONFIRMED' ? 'appointments.confirmed.title' : 'appointments.rescheduled.title',
      localDateTimeLabel(new Date(input.scheduledAt), appt.timezone),
      id,
    )
    return updated
  }

  async setStatus(
    actor: JwtPayload,
    id: string,
    status: 'COMPLETED' | 'CANCELLED',
    ctx: RequestContext,
  ) {
    const appt = await this.findManageable(actor, id)
    assertTransition(appt.status, status)
    const updated = await this.prisma.deaneryAppointment
      .update({ where: { id, status: appt.status }, data: { status }, select: SELECT })
      .catch(rethrowStaleStatus)
    await this.record(actor, `appointment_${status.toLowerCase()}_by_staff`, id, ctx)
    await this.notifyStudent(
      appt.studentId,
      status === 'COMPLETED' ? 'appointments.completed.title' : 'appointments.cancelled.title',
      '',
      id,
    )
    return updated
  }

  // ── scope ─────────────────────────────────────────────────────────────────

  private scopeWhere(viewer: JwtPayload): Prisma.DeaneryAppointmentWhereInput {
    if (isPlatform(viewer.role)) return {}
    if (viewer.role === Role.DEAN) return { facultyId: viewer.facultyId ?? '__none__' }
    // Админ/модератор вуза — все факультеты своего вуза.
    return { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } }
  }

  private async findManageable(
    actor: JwtPayload,
    id: string,
  ): Promise<{ id: string; studentId: string; status: string; timezone: string | null }> {
    const row = await this.prisma.deaneryAppointment.findUnique({
      where: { id },
      select: {
        id: true,
        studentId: true,
        status: true,
        facultyId: true,
        faculty: { select: { universityId: true, university: { select: { timezone: true } } } },
      },
    })
    if (!row) throw new AppException('NOT_FOUND', 'Запись не найдена')
    const appt = {
      id: row.id,
      studentId: row.studentId,
      status: row.status,
      timezone: row.faculty.university.timezone,
    }
    if (isPlatform(actor.role)) return appt
    if (actor.role === Role.DEAN) {
      if (actor.facultyId === row.facultyId) return appt
      throw new AppException('WRONG_SCOPE', 'Другой факультет')
    }
    if (actor.role === Role.UNIVERSITY_ADMIN || actor.role === Role.UNIVERSITY_MODERATOR) {
      if (actor.universityId === row.faculty.universityId) return appt
      throw new AppException('WRONG_SCOPE', 'Другой университет')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  private async notifyStudent(
    userId: string,
    titleKey: NotificationMessageKey,
    // Тело — метка «2026-10-02 14:30» или пусто: дата и время, переводить нечего.
    body: string,
    id: string,
  ): Promise<void> {
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.APPOINTMENT_UPDATED,
      {
        recipientIds: [userId],
        type: 'SYSTEM',
        titleKey,
        body,
        data: { url: '/appointments', appointmentId: id },
        // Ключ словарной статьи, а не переведённый заголовок: тот менялся бы вместе с
        // языком получателя, и идемпотентность развалилась бы на ровном месте.
        // Время входит в ключ: второй перенос той же записи — новое уведомление, а не дубль.
        dedupeKey: `appointment-updated:${id}:${titleKey}:${body}`,
      },
      { jobId: `appointment-updated:${id}:${Date.now()}` },
    )
  }

  private async record(
    actor: JwtPayload,
    action: string,
    entityId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.audit.record({
      userId: actor.sub,
      action,
      entity: 'DeaneryAppointment',
      entityId,
      ...ctx,
    })
  }
}
