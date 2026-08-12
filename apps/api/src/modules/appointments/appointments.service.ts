import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  AppointmentListQueryInput,
  ConfirmAppointmentInput,
  CreateAppointmentInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { QueueService } from '../../common/queue/queue.service'
import { QUEUES, NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

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
    if (appt.status === 'COMPLETED') throw new AppException('CONFLICT', 'Приём уже завершён')
    const updated = await this.prisma.deaneryAppointment.update({
      where: { id },
      data: { status: 'CANCELLED' },
      select: SELECT,
    })
    await this.record(actor, 'appointment_cancelled_by_student', id, ctx)
    return updated
  }

  async listQueue(viewer: JwtPayload, query: AppointmentListQueryInput) {
    const where: Prisma.DeaneryAppointmentWhereInput = {
      ...this.scopeWhere(viewer),
      ...(query.status ? { status: query.status } : {}),
    }
    return this.prisma.deaneryAppointment.findMany({
      where,
      select: SELECT,
      orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
      take: 300,
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
    const updated = await this.prisma.deaneryAppointment.update({
      where: { id },
      data: {
        status,
        scheduledAt: new Date(input.scheduledAt),
        staffNote: input.staffNote,
        assignedToId: actor.sub,
      },
      select: SELECT,
    })
    await this.record(actor, `appointment_${status.toLowerCase()}`, id, ctx)
    await this.notifyStudent(
      appt.studentId,
      status === 'CONFIRMED' ? 'Запись в деканат подтверждена' : 'Запись в деканат перенесена',
      this.label(new Date(input.scheduledAt)),
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
    const updated = await this.prisma.deaneryAppointment.update({
      where: { id },
      data: { status },
      select: SELECT,
    })
    await this.record(actor, `appointment_${status.toLowerCase()}_by_staff`, id, ctx)
    await this.notifyStudent(
      appt.studentId,
      status === 'COMPLETED' ? 'Приём в деканате завершён' : 'Запись в деканат отменена',
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
  ): Promise<{ id: string; studentId: string }> {
    const appt = await this.prisma.deaneryAppointment.findUnique({
      where: { id },
      select: {
        id: true,
        studentId: true,
        facultyId: true,
        faculty: { select: { universityId: true } },
      },
    })
    if (!appt) throw new AppException('NOT_FOUND', 'Запись не найдена')
    if (isPlatform(actor.role)) return appt
    if (actor.role === Role.DEAN) {
      if (actor.facultyId === appt.facultyId) return appt
      throw new AppException('WRONG_SCOPE', 'Другой факультет')
    }
    if (actor.role === Role.UNIVERSITY_ADMIN || actor.role === Role.UNIVERSITY_MODERATOR) {
      if (actor.universityId === appt.faculty.universityId) return appt
      throw new AppException('WRONG_SCOPE', 'Другой университет')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  private label(date: Date): string {
    return date.toISOString().slice(0, 16).replace('T', ' ')
  }

  private async notifyStudent(
    userId: string,
    title: string,
    body: string,
    id: string,
  ): Promise<void> {
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.APPOINTMENT_UPDATED,
      {
        recipientIds: [userId],
        type: 'SYSTEM',
        title,
        body,
        data: { url: '/appointments', appointmentId: id },
        dedupeKey: `appointment-updated:${id}:${title}`,
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
