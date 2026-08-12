import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { BookSlotInput, CreateSlotInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { QueueService } from '../../common/queue/queue.service'
import { QUEUES, NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]
const TEACHER_ROLES: Role[] = [Role.TEACHER, Role.DEAN]

const SLOT_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  location: true,
  isOnline: true,
  status: true,
  topic: true,
  createdAt: true,
  teacher: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  student: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ConsultationSlotSelect

@Injectable()
export class ConsultationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async createSlot(actor: JwtPayload, input: CreateSlotInput, ctx: RequestContext) {
    if (!TEACHER_ROLES.includes(actor.role)) {
      throw new AppException('FORBIDDEN', 'Слоты создаёт преподаватель')
    }
    const slot = await this.prisma.consultationSlot.create({
      data: {
        teacherId: actor.sub,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        location: input.location,
        isOnline: input.isOnline ?? false,
      },
      select: SLOT_SELECT,
    })
    await this.record(actor, 'consultation_slot_created', slot.id, ctx)
    return slot
  }

  async deleteSlot(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const slot = await this.prisma.consultationSlot.findUnique({
      where: { id },
      select: { id: true, teacherId: true, studentId: true, startsAt: true },
    })
    if (!slot) throw new AppException('NOT_FOUND', 'Слот не найден')
    if (slot.teacherId !== actor.sub) throw new AppException('FORBIDDEN', 'Не ваш слот')
    if (slot.studentId) {
      await this.notify(
        slot.studentId,
        NOTIFICATION_JOBS.CONSULTATION_CANCELLED,
        'Консультация отменена',
        this.slotLabel(slot.startsAt),
        '/consultations',
        `consultation-cancelled:${id}`,
      )
    }
    await this.prisma.consultationSlot.delete({ where: { id } })
    await this.record(actor, 'consultation_slot_deleted', id, ctx)
  }

  /** Мои консультации: преподаватель — свои слоты; студент — свои записи. */
  listMine(viewer: JwtPayload) {
    const where: Prisma.ConsultationSlotWhereInput = STUDENT_ROLES.includes(viewer.role)
      ? { studentId: viewer.sub, status: 'BOOKED' }
      : { teacherId: viewer.sub }
    return this.prisma.consultationSlot.findMany({
      where,
      select: SLOT_SELECT,
      orderBy: { startsAt: 'asc' },
      take: 200,
    })
  }

  /** Преподаватели с открытыми слотами (для выбора студентом) — в пределах вуза. */
  async listTeachers(viewer: JwtPayload) {
    const now = new Date()
    const slots = await this.prisma.consultationSlot.findMany({
      where: {
        status: 'OPEN',
        startsAt: { gte: now },
        teacher: { is: { universityId: viewer.universityId ?? '__none__' } },
      },
      select: {
        teacher: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
      take: 5000,
    })
    const byTeacher = new Map<
      string,
      {
        id: string
        firstName: string
        lastName: string
        avatarUrl: string | null
        openCount: number
      }
    >()
    for (const s of slots) {
      const t = s.teacher
      const cur = byTeacher.get(t.id) ?? { ...t, openCount: 0 }
      cur.openCount += 1
      byTeacher.set(t.id, cur)
    }
    return [...byTeacher.values()]
      .map((t) => ({
        teacherId: t.id,
        firstName: t.firstName,
        lastName: t.lastName,
        avatarUrl: t.avatarUrl,
        openSlots: t.openCount,
      }))
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
  }

  /** Открытые слоты преподавателя (+ мои записи к нему) — для записи студентом. */
  async listTeacherSlots(viewer: JwtPayload, teacherId: string) {
    await this.assertSameUniversity(teacherId, viewer.universityId)
    const now = new Date()
    return this.prisma.consultationSlot.findMany({
      where: {
        teacherId,
        startsAt: { gte: now },
        OR: [{ status: 'OPEN' }, { studentId: viewer.sub }],
      },
      select: SLOT_SELECT,
      orderBy: { startsAt: 'asc' },
      take: 200,
    })
  }

  async book(actor: JwtPayload, id: string, input: BookSlotInput, ctx: RequestContext) {
    if (!STUDENT_ROLES.includes(actor.role)) {
      throw new AppException('FORBIDDEN', 'Записываются только студенты')
    }
    const slot = await this.prisma.consultationSlot.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        startsAt: true,
        teacherId: true,
        teacher: { select: { universityId: true } },
      },
    })
    if (!slot) throw new AppException('NOT_FOUND', 'Слот не найден')
    if (slot.teacher.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Преподаватель другого университета')
    }
    if (slot.status !== 'OPEN') throw new AppException('CONFLICT', 'Слот занят')
    if (slot.startsAt < new Date()) throw new AppException('CONFLICT', 'Время уже прошло')

    const booked = await this.prisma.consultationSlot.update({
      where: { id },
      data: { status: 'BOOKED', studentId: actor.sub, topic: input.topic },
      select: SLOT_SELECT,
    })
    await this.record(actor, 'consultation_booked', id, ctx)
    await this.notify(
      slot.teacherId,
      NOTIFICATION_JOBS.CONSULTATION_BOOKED,
      'Новая запись на консультацию',
      this.slotLabel(slot.startsAt),
      '/teacher/consultations',
      `consultation-booked:${id}`,
    )
    return booked
  }

  async cancel(actor: JwtPayload, id: string, ctx: RequestContext) {
    const slot = await this.prisma.consultationSlot.findUnique({
      where: { id },
      select: { id: true, status: true, startsAt: true, teacherId: true, studentId: true },
    })
    if (!slot) throw new AppException('NOT_FOUND', 'Слот не найден')

    if (slot.studentId === actor.sub) {
      // Студент отменяет свою запись → слот снова открыт.
      const updated = await this.prisma.consultationSlot.update({
        where: { id },
        data: { status: 'OPEN', studentId: null, topic: null },
        select: SLOT_SELECT,
      })
      await this.record(actor, 'consultation_cancelled_by_student', id, ctx)
      await this.notify(
        slot.teacherId,
        NOTIFICATION_JOBS.CONSULTATION_CANCELLED,
        'Запись на консультацию отменена',
        this.slotLabel(slot.startsAt),
        '/teacher/consultations',
        `consultation-cancelled:${id}:${actor.sub}`,
      )
      return updated
    }
    if (slot.teacherId === actor.sub) {
      const updated = await this.prisma.consultationSlot.update({
        where: { id },
        data: { status: 'CANCELLED' },
        select: SLOT_SELECT,
      })
      await this.record(actor, 'consultation_cancelled_by_teacher', id, ctx)
      if (slot.studentId) {
        await this.notify(
          slot.studentId,
          NOTIFICATION_JOBS.CONSULTATION_CANCELLED,
          'Консультация отменена',
          this.slotLabel(slot.startsAt),
          '/consultations',
          `consultation-cancelled:${id}:teacher`,
        )
      }
      return updated
    }
    throw new AppException('FORBIDDEN', 'Нет прав на слот')
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private slotLabel(date: Date): string {
    return date.toISOString().slice(0, 16).replace('T', ' ')
  }

  private async assertSameUniversity(
    teacherId: string,
    universityId: string | null,
  ): Promise<void> {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { universityId: true },
    })
    if (!teacher || teacher.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Преподаватель другого университета')
    }
  }

  private async notify(
    userId: string,
    jobName: string,
    title: string,
    body: string,
    url: string,
    dedupeKey: string,
  ): Promise<void> {
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      jobName,
      { recipientIds: [userId], type: 'SYSTEM', title, body, data: { url }, dedupeKey },
      { jobId: dedupeKey },
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
      entity: 'ConsultationSlot',
      entityId,
      ...ctx,
    })
  }
}
