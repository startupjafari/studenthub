import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { BookSlotInput, CreateSlotInput } from '@studenthub/shared-schemas'
import type { NotificationMessageKey } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import type { ConsultationMineQueryInput } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { QueueService } from '../../common/queue/queue.service'
import { QUEUES, NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { localDateTimeLabel } from '../../common/time/local-label'

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
      select: {
        id: true,
        teacherId: true,
        studentId: true,
        startsAt: true,
        teacher: { select: { university: { select: { timezone: true } } } },
      },
    })
    if (!slot) throw new AppException('NOT_FOUND', 'Слот не найден')
    if (slot.teacherId !== actor.sub) throw new AppException('FORBIDDEN', 'Не ваш слот')
    if (slot.studentId) {
      await this.notify(
        slot.studentId,
        NOTIFICATION_JOBS.CONSULTATION_CANCELLED,
        'consultations.cancelled.title',
        localDateTimeLabel(slot.startsAt, slot.teacher.university?.timezone),
        '/consultations',
        `consultation-cancelled:${id}`,
      )
    }
    await this.prisma.consultationSlot.delete({ where: { id } })
    await this.record(actor, 'consultation_slot_deleted', id, ctx)
  }

  /**
   * Мои консультации: преподаватель — свои слоты; студент — свои записи.
   *
   * Страница и сортировка считаются ЗДЕСЬ, а не в браузере: клиент получает одну
   * страницу, и сортировка на ней переставляла бы только её — верхние строки списка
   * при этом оставались бы прежними. Поле сортировки приходит enum'ом, в `orderBy`
   * произвольное имя не попадает.
   */
  async listMine(viewer: JwtPayload, query: ConsultationMineQueryInput) {
    const base: Prisma.ConsultationSlotWhereInput = STUDENT_ROLES.includes(viewer.role)
      ? { studentId: viewer.sub, status: 'BOOKED' }
      : { teacherId: viewer.sub }
    // `from` сужает выборку, а не подменяет её: дашборду нужны ближайшие слоты,
    // разделу «Консультации» — все.
    const where: Prisma.ConsultationSlotWhereInput = query.from
      ? { AND: [base, { startsAt: { gte: new Date(query.from) } }] }
      : base
    const [items, total] = await this.prisma.$transaction([
      this.prisma.consultationSlot.findMany({
        where,
        select: SLOT_SELECT,
        orderBy: slotOrderBy(query.sort, query.order),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.consultationSlot.count({ where }),
    ])
    return { items, total }
  }

  /** Преподаватели с открытыми слотами (для выбора студентом) — в пределах вуза. */
  async listTeachers(viewer: JwtPayload) {
    const now = new Date()
    const slots = await this.prisma.consultationSlot.findMany({
      where: {
        status: 'OPEN',
        startsAt: { gte: now },
        // Удалённый или заблокированный преподаватель консультаций не ведёт.
        teacher: {
          is: {
            universityId: viewer.universityId ?? '__none__',
            deletedAt: null,
            isBlocked: false,
          },
        },
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
        teacher: {
          select: {
            universityId: true,
            deletedAt: true,
            isBlocked: true,
            university: { select: { timezone: true } },
          },
        },
      },
    })
    if (!slot || slot.teacher.deletedAt || slot.teacher.isBlocked) {
      throw new AppException('NOT_FOUND', 'Слот не найден')
    }
    if (slot.teacher.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Преподаватель другого университета')
    }
    if (slot.status !== 'OPEN') throw new AppException('CONFLICT', 'Слот занят')
    if (slot.startsAt < new Date()) throw new AppException('CONFLICT', 'Время уже прошло')

    // Условная запись: из двух одновременных записей на слот проходит одна. Проверка статуса
    // выше её не заменяет — между чтением и записью слот успевал занять другой, и второй
    // студент перезаписывал первого, а тот получал 200 и считал, что записан.
    const claimed = await this.prisma.consultationSlot.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'BOOKED', studentId: actor.sub, topic: input.topic },
    })
    if (claimed.count === 0) throw new AppException('CONFLICT', 'Слот занят')
    const booked = await this.prisma.consultationSlot.findUniqueOrThrow({
      where: { id },
      select: SLOT_SELECT,
    })
    await this.record(actor, 'consultation_booked', id, ctx)
    await this.notify(
      slot.teacherId,
      NOTIFICATION_JOBS.CONSULTATION_BOOKED,
      'consultations.booked.title',
      localDateTimeLabel(slot.startsAt, slot.teacher.university?.timezone),
      '/teacher/consultations',
      // На один слот записываются не однажды (запись → отмена → новая запись): ключ без
      // момента записи гасил повторное уведомление как дубль.
      `consultation-booked:${id}:${actor.sub}:${Date.now()}`,
    )
    return booked
  }

  async cancel(actor: JwtPayload, id: string, ctx: RequestContext) {
    const slot = await this.prisma.consultationSlot.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        startsAt: true,
        teacherId: true,
        studentId: true,
        teacher: { select: { university: { select: { timezone: true } } } },
      },
    })
    if (!slot) throw new AppException('NOT_FOUND', 'Слот не найден')

    if (slot.studentId === actor.sub) {
      // Студент отменяет свою запись → слот снова открыт. Только из BOOKED: слот, отменённый
      // преподавателем, хранит studentId, и без условия «отмена» студентом его воскрешала.
      const released = await this.prisma.consultationSlot.updateMany({
        where: { id, studentId: actor.sub, status: 'BOOKED' },
        data: { status: 'OPEN', studentId: null, topic: null },
      })
      if (released.count === 0) throw new AppException('CONFLICT', 'Запись уже не действует')
      const updated = await this.prisma.consultationSlot.findUniqueOrThrow({
        where: { id },
        select: SLOT_SELECT,
      })
      await this.record(actor, 'consultation_cancelled_by_student', id, ctx)
      await this.notify(
        slot.teacherId,
        NOTIFICATION_JOBS.CONSULTATION_CANCELLED,
        'consultations.bookingCancelled.title',
        localDateTimeLabel(slot.startsAt, slot.teacher.university?.timezone),
        '/teacher/consultations',
        `consultation-cancelled:${id}:${actor.sub}:${Date.now()}`,
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
          'consultations.cancelled.title',
          localDateTimeLabel(slot.startsAt, slot.teacher.university?.timezone),
          '/consultations',
          `consultation-cancelled:${id}:teacher`,
        )
      }
      return updated
    }
    throw new AppException('FORBIDDEN', 'Нет прав на слот')
  }

  // ── helpers ──────────────────────────────────────────────────────────────

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
    titleKey: NotificationMessageKey,
    // Тело — метка слота «2026-10-02 14:30»: дата и время, а не фраза. Словарной статьи
    // ей не нужно, переводить в ней нечего.
    body: string,
    url: string,
    dedupeKey: string,
  ): Promise<void> {
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      jobName,
      { recipientIds: [userId], type: 'SYSTEM', titleKey, body, data: { url }, dedupeKey },
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

/**
 * Порядок строк таблицы. Сортировка по студенту — по фамилии и имени: у слота есть
 * только связь, а сортировать по `studentId` значило бы упорядочить по случайному uuid.
 * Свободные слоты (связи нет вовсе) Prisma сама уводит в конец.
 *
 * Вторым ключом всегда идёт `startsAt`: без него строки с одинаковым статусом
 * возвращались бы в непредсказуемом порядке, и страницы могли бы перемешиваться.
 */
export function slotOrderBy(
  sort: ConsultationMineQueryInput['sort'],
  order: ConsultationMineQueryInput['order'],
): Prisma.ConsultationSlotOrderByWithRelationInput[] {
  if (sort === 'status') return [{ status: order }, { startsAt: 'asc' }]
  if (sort === 'student') {
    return [
      { student: { lastName: order } },
      { student: { firstName: order } },
      { startsAt: 'asc' },
    ]
  }
  return [{ startsAt: order }]
}
