import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { canTransition, type ApplicationServiceStatus } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { QueueService, QUEUES, NOTIFICATION_JOBS } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { ApplicationPolicy } from './application.policy'

// Обработка заявки сотрудником (§15–§17, §27): business-actions вместо generic PATCH /status.
// Каждое действие: canProcess + scope + проверка перехода (state-machine) + событие + уведомление.

const PROC_SELECT = {
  id: true,
  number: true,
  status: true,
  deliveryType: true,
  studentId: true,
  facultyId: true,
  universityId: true,
  assignedToId: true,
  dueAt: true,
  service: { select: { nameRu: true } },
} satisfies Prisma.ApplicationSelect

interface AddResultInput {
  type: string
  documentId?: string
  documentNumber?: string
  note?: string
}

@Injectable()
export class ApplicationProcessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ApplicationPolicy,
    private readonly queue: QueueService,
  ) {}

  /** Взять в работу: SUBMITTED/RESUBMITTED → IN_REVIEW, назначить на себя. */
  async take(viewer: JwtPayload, id: string) {
    const app = await this.load(viewer, id)
    if (!['SUBMITTED', 'RESUBMITTED'].includes(app.status)) {
      throw new AppException('BAD_REQUEST', 'Заявку нельзя взять в работу из текущего статуса')
    }
    return this.transition(viewer, app, 'IN_REVIEW', {
      action: 'ASSIGNED',
      data: { assignedToId: viewer.sub, assignedAt: new Date(), startedAt: new Date() },
    })
  }

  /** Назначить ответственного (permission assign). Статус не меняется. */
  async assign(viewer: JwtPayload, id: string, userId: string) {
    this.policy.assert(viewer.role, 'assign')
    const app = await this.load(viewer, id)
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.application.update({
        where: { id: app.id },
        data: { assignedToId: userId, assignedAt: new Date() },
        select: PROC_SELECT,
      })
      await tx.applicationEvent.create({
        data: { applicationId: app.id, actorId: viewer.sub, action: 'ASSIGNED', comment: userId },
      })
      return u
    })
    return updated
  }

  /** Запросить исправление (уровень заявки): IN_REVIEW → NEEDS_CORRECTION. */
  async requestCorrection(viewer: JwtPayload, id: string, comment: string) {
    if (!comment) throw new AppException('BAD_REQUEST', 'Укажите, что нужно исправить')
    const app = await this.load(viewer, id)
    return this.transition(viewer, app, 'NEEDS_CORRECTION', {
      action: 'STATUS_CHANGED',
      comment,
      notify: {
        title: 'Требуется ваше действие',
        body: `Заявка ${app.number}: требуется исправление`,
      },
    })
  }

  /** Начать подготовку: IN_REVIEW → IN_PREPARATION. */
  async startPreparation(viewer: JwtPayload, id: string) {
    const app = await this.load(viewer, id)
    return this.transition(viewer, app, 'IN_PREPARATION', {
      action: 'STATUS_CHANGED',
      notify: { title: 'Заявка в подготовке', body: `Заявка ${app.number}: началась подготовка` },
    })
  }

  /** Отклонить заявку с обязательной причиной. */
  async reject(viewer: JwtPayload, id: string, reason: string) {
    if (!reason) throw new AppException('BAD_REQUEST', 'Укажите причину отказа')
    const app = await this.load(viewer, id)
    return this.transition(viewer, app, 'REJECTED', {
      action: 'REJECTED',
      comment: reason,
      data: { rejectionReason: reason },
      notify: { title: 'Заявка отклонена', body: `Заявка ${app.number} отклонена` },
    })
  }

  /** Добавить результат (на этапе подготовки). Статус не меняется — готовность отдельно (markReady). */
  async addResult(viewer: JwtPayload, id: string, dto: AddResultInput) {
    const app = await this.load(viewer, id)
    if (app.status !== 'IN_PREPARATION') {
      throw new AppException('BAD_REQUEST', 'Результат добавляется на этапе подготовки')
    }
    await this.prisma.$transaction([
      this.prisma.applicationResult.create({
        data: {
          applicationId: id,
          type: dto.type,
          documentId: dto.documentId,
          documentNumber: dto.documentNumber,
          note: dto.note,
          issuedById: viewer.sub,
        },
      }),
      this.prisma.applicationEvent.create({
        data: { applicationId: id, actorId: viewer.sub, action: 'RESULT_ADDED' },
      }),
    ])
    return { ok: true }
  }

  /** Пометить готовым: IN_PREPARATION → READY (электронно) или READY_FOR_PICKUP (бумажный/оба). */
  async markReady(
    viewer: JwtPayload,
    id: string,
    dto: { pickupLocation?: string; pickupInstructions?: string },
  ) {
    const app = await this.load(viewer, id)
    const paper = app.deliveryType === 'PAPER' || app.deliveryType === 'BOTH'
    const data: Prisma.ApplicationUpdateInput = { readyAt: new Date() }
    if (paper) {
      data.pickupLocation = dto.pickupLocation ?? null
      data.pickupInstructions = dto.pickupInstructions ?? null
      data.pickupCode = `SH-P-${randomUUID().slice(0, 8).toUpperCase()}`
    }
    return this.transition(viewer, app, paper ? 'READY_FOR_PICKUP' : 'READY', {
      action: 'READY',
      data,
      notify: {
        title: paper ? 'Документ готов к выдаче' : 'Документ готов',
        body: `Заявка ${app.number}: результат готов`,
      },
    })
  }

  /** Выдать оригинал: READY_FOR_PICKUP → ISSUED. */
  async issue(viewer: JwtPayload, id: string) {
    const app = await this.load(viewer, id)
    return this.transition(viewer, app, 'ISSUED', {
      action: 'ISSUED',
      data: { issuedAt: new Date(), issuedById: viewer.sub },
      notify: { title: 'Документ выдан', body: `Заявка ${app.number}: оригинал выдан` },
    })
  }

  /** Отметить электронный результат предоставленным: READY → DELIVERED. */
  async deliver(viewer: JwtPayload, id: string) {
    const app = await this.load(viewer, id)
    return this.transition(viewer, app, 'DELIVERED', {
      action: 'DELIVERED',
      notify: {
        title: 'Документ предоставлен',
        body: `Заявка ${app.number}: электронный документ готов`,
      },
    })
  }

  /** Счётчики очереди по scope роли (§16). */
  async queueStats(viewer: JwtPayload) {
    const base: Prisma.ApplicationWhereInput = {
      deletedAt: null,
      ...this.policy.scopeWhere(viewer),
    }
    const now = new Date()
    const [newCount, inWork, actionNeeded, ready, overdue] = await this.prisma.$transaction([
      this.prisma.application.count({
        where: { ...base, status: { in: ['SUBMITTED', 'RESUBMITTED'] } },
      }),
      this.prisma.application.count({
        where: { ...base, status: { in: ['IN_REVIEW', 'IN_PREPARATION'] } },
      }),
      this.prisma.application.count({ where: { ...base, status: 'NEEDS_CORRECTION' } }),
      this.prisma.application.count({
        where: { ...base, status: { in: ['READY', 'READY_FOR_PICKUP'] } },
      }),
      this.prisma.application.count({
        where: {
          ...base,
          dueAt: { lt: now },
          status: {
            in: ['SUBMITTED', 'RESUBMITTED', 'IN_REVIEW', 'IN_PREPARATION', 'NEEDS_CORRECTION'],
          },
        },
      }),
    ])
    return { new: newCount, inWork, actionNeeded, ready, overdue }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async load(viewer: JwtPayload, id: string) {
    const app = await this.prisma.application.findFirst({
      where: { id, deletedAt: null },
      select: PROC_SELECT,
    })
    if (!app) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    this.policy.assertCanProcess(viewer, app)
    return app
  }

  private async transition(
    viewer: JwtPayload,
    app: Prisma.ApplicationGetPayload<{ select: typeof PROC_SELECT }>,
    to: ApplicationServiceStatus,
    opts: {
      action: string
      comment?: string
      data?: Prisma.ApplicationUpdateInput
      notify?: { title: string; body: string }
    },
  ) {
    if (!canTransition(app.status as ApplicationServiceStatus, to)) {
      throw new AppException('BAD_REQUEST', 'Недопустимый переход')
    }
    const { updated, eventId } = await this.prisma.$transaction(async (tx) => {
      const u = await tx.application.update({
        where: { id: app.id },
        data: { status: to, ...opts.data },
        select: PROC_SELECT,
      })
      const event = await tx.applicationEvent.create({
        data: {
          applicationId: app.id,
          actorId: viewer.sub,
          action: opts.action,
          fromStatus: app.status,
          toStatus: to,
          comment: opts.comment,
        },
        select: { id: true },
      })
      return { updated: u, eventId: event.id }
    })
    if (opts.notify) {
      // dedupeKey по id события перехода, а НЕ по `${to}:${appId}`: цикл
      // IN_REVIEW→NEEDS_CORRECTION→…→NEEDS_CORRECTION даёт тот же статус повторно, и
      // ключ вида `${to}:${appId}` глушил бы второе уведомление (студент не узнал бы о
      // повторном отклонении). id события уникален на переход, но стабилен для ретраев job.
      await this.notify(
        app.studentId,
        opts.notify.title,
        opts.notify.body,
        app.id,
        `${to}:${eventId}`,
      )
    }
    return updated
  }

  private async notify(
    recipientId: string,
    title: string,
    body: string,
    appId: string,
    dedupeKey: string,
  ): Promise<void> {
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.APPLICATION_UPDATED,
      {
        recipientIds: [recipientId],
        type: 'APP_UPDATE',
        title,
        body,
        data: { url: `/applications/${appId}` },
        dedupeKey,
      },
      { jobId: dedupeKey },
    )
  }
}
