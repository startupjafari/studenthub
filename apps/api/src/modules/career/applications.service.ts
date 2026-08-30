import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  canTransitionApplication,
  type ApplicationListQueryInput,
  type CareerApplicationStatus,
  type ChangeApplicationStatusInput,
  type CreateApplicationInput,
} from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { Paginated } from '../../common/http/paginated'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CareerAccessService } from './career-access.service'

/** Что видит студент в списке своих откликов. */
const STUDENT_SELECT = {
  id: true,
  status: true,
  coverLetter: true,
  createdAt: true,
  updatedAt: true,
  vacancy: {
    select: {
      id: true,
      title: true,
      employmentType: true,
      workFormat: true,
      city: true,
      company: { select: { id: true, name: true, logoUrl: true } },
    },
  },
} satisfies Prisma.CareerApplicationSelect

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly access: CareerAccessService,
  ) {}

  // ── Студент ────────────────────────────────────────────────────────────────

  /**
   * Отклик на вакансию.
   *
   * Вакансия должна быть видима именно этому студенту — та же проверка, что в витрине:
   * опубликована и одобрена его вузом. Иначе отклик стал бы обходом модерации: угадал id —
   * откликнулся на то, что вуз не пропустил.
   */
  async apply(viewer: JwtPayload, input: CreateApplicationInput, ctx: RequestContext) {
    const universityId = viewer.universityId
    if (!universityId) {
      throw new AppException('WRONG_SCOPE', 'Нет доступа к этой области данных')
    }

    const vacancy = await this.prisma.vacancy.findFirst({
      where: {
        id: input.vacancyId,
        deletedAt: null,
        status: 'PUBLISHED',
        reviews: { some: { universityId, status: 'APPROVED' } },
      },
      select: { id: true, companyId: true, deadline: true },
    })
    if (!vacancy) throw new AppException('NOT_FOUND', 'Вакансия не найдена')
    if (vacancy.deadline && vacancy.deadline.getTime() < Date.now()) {
      throw new AppException('BAD_REQUEST', 'Срок приёма откликов истёк')
    }

    const existing = await this.prisma.careerApplication.findUnique({
      where: { vacancyId_studentId: { vacancyId: vacancy.id, studentId: viewer.sub } },
      select: { id: true },
    })
    if (existing) throw new AppException('CONFLICT', 'Вы уже откликались на эту вакансию')

    const application = await this.prisma.$transaction(async (tx) => {
      const created = await tx.careerApplication.create({
        data: {
          vacancyId: vacancy.id,
          studentId: viewer.sub,
          companyId: vacancy.companyId,
          universityId,
          coverLetter: input.coverLetter,
          status: 'SUBMITTED',
        },
        select: { id: true },
      })
      await tx.careerApplicationEvent.create({
        data: { applicationId: created.id, toStatus: 'SUBMITTED', actorId: viewer.sub },
      })
      return created
    })

    await this.audit.record({
      userId: viewer.sub,
      action: 'career_application_created',
      entity: 'CareerApplication',
      entityId: application.id,
      ...ctx,
    })
    return application
  }

  async listMine(viewer: JwtPayload, query: ApplicationListQueryInput) {
    const where: Prisma.CareerApplicationWhereInput = {
      studentId: viewer.sub,
      ...(query.status ? { status: query.status } : {}),
    }
    const [items, total] = await Promise.all([
      this.prisma.careerApplication.findMany({
        where,
        select: STUDENT_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.careerApplication.count({ where }),
    ])
    return new Paginated(items, { total })
  }

  /** Отзыв отклика — единственный переход, доступный студенту. */
  async withdraw(viewer: JwtPayload, id: string, ctx: RequestContext) {
    const application = await this.prisma.careerApplication.findFirst({
      where: { id, studentId: viewer.sub },
      select: { id: true, status: true },
    })
    if (!application) throw new AppException('NOT_FOUND', 'Отклик не найден')

    const from = application.status as CareerApplicationStatus
    if (!canTransitionApplication(from, 'WITHDRAWN')) {
      throw new AppException('CONFLICT', 'Отклик уже завершён')
    }
    await this.transition(application.id, from, 'WITHDRAWN', viewer.sub)

    await this.audit.record({
      userId: viewer.sub,
      action: 'career_application_withdrawn',
      entity: 'CareerApplication',
      entityId: id,
      ...ctx,
    })
  }

  /** История отклика — доступна и студенту-автору, и компании-владельцу вакансии. */
  async history(viewer: JwtPayload, id: string) {
    const application = await this.prisma.careerApplication.findUnique({
      where: { id },
      select: { id: true, studentId: true, companyId: true },
    })
    if (!application) throw new AppException('NOT_FOUND', 'Отклик не найден')

    const isOwner = application.studentId === viewer.sub
    const isCompany = viewer.companyId != null && viewer.companyId === application.companyId
    if (!isOwner && !isCompany) {
      throw new AppException('FORBIDDEN', 'Нет доступа к этому отклику')
    }

    return this.prisma.careerApplicationEvent.findMany({
      where: { applicationId: id },
      select: { id: true, fromStatus: true, toStatus: true, comment: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
  }

  // ── Компания ───────────────────────────────────────────────────────────────

  /**
   * Воронка кандидатов компании.
   *
   * Обратите внимание на universityId в выборке: он зафиксирован на момент отклика.
   * Если вуз отозвал допуск, компания перестаёт видеть новых студентов, но уже поданные
   * отклики остаются — иначе диалог обрывался бы на середине, а человек не понимал, куда
   * делась его заявка.
   */
  async pipeline(viewer: JwtPayload, query: ApplicationListQueryInput) {
    const companyId = this.access.requireCompany(viewer)
    const where: Prisma.CareerApplicationWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.vacancyId ? { vacancyId: query.vacancyId } : {}),
    }

    const [items, total] = await Promise.all([
      this.prisma.careerApplication.findMany({
        where,
        select: {
          id: true,
          status: true,
          coverLetter: true,
          createdAt: true,
          updatedAt: true,
          vacancy: { select: { id: true, title: true } },
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatarThumbUrl: true,
              headline: true,
              specialty: true,
              course: true,
              skills: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.careerApplication.count({ where }),
    ])
    return new Paginated(items, { total })
  }

  /** Перевод отклика по воронке компанией. */
  async changeStatus(
    viewer: JwtPayload,
    id: string,
    input: ChangeApplicationStatusInput,
    ctx: RequestContext,
  ) {
    const companyId = this.access.requireCompany(viewer)
    const application = await this.prisma.careerApplication.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, studentId: true, vacancyId: true },
    })
    if (!application) throw new AppException('NOT_FOUND', 'Отклик не найден')

    const from = application.status as CareerApplicationStatus
    if (!canTransitionApplication(from, input.status)) {
      throw new AppException('CONFLICT', `Переход ${from} → ${input.status} недопустим`)
    }

    await this.transition(application.id, from, input.status, viewer.sub, input.comment)

    // Студент должен узнать о движении по своей заявке — молчание здесь и есть главная
    // претензия к job-бордам.
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.APPLICATION_UPDATED,
      { userId: application.studentId, applicationId: application.id, status: input.status },
      { jobId: `career-app:${application.id}:${input.status}` },
    )

    await this.audit.record({
      userId: viewer.sub,
      action: `career_application_${input.status.toLowerCase()}`,
      entity: 'CareerApplication',
      entityId: id,
      ...ctx,
    })
  }

  // ── Служебное ──────────────────────────────────────────────────────────────

  /** Смена статуса и запись в историю — всегда вместе, одной транзакцией. */
  private transition(
    applicationId: string,
    from: CareerApplicationStatus,
    to: CareerApplicationStatus,
    actorId: string,
    comment?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.careerApplication.update({ where: { id: applicationId }, data: { status: to } })
      await tx.careerApplicationEvent.create({
        data: { applicationId, fromStatus: from, toStatus: to, comment, actorId },
      })
    })
  }
}
