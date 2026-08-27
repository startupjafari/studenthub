import { Injectable } from '@nestjs/common'
import {
  canTransition,
  REALTIME_EVENTS,
  type ApplicationServiceStatus,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { QueueService, QUEUES, NOTIFICATION_JOBS } from '../../common/queue'
import { RealtimeGateway } from '../../common/realtime'
import { FileService } from '../files/file.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { ApplicationPolicy } from './application.policy'

// Документы заявки (§3/§4): студент прикладывает документ из личного хранилища к требованию услуги;
// сотрудник проверяет (принять / запросить замену конкретного документа). Файлы не дублируем —
// это Document из домена «Документы», presigned через FileService.
const EDITABLE = ['DRAFT', 'NEEDS_CORRECTION']

@Injectable()
export class ApplicationDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ApplicationPolicy,
    private readonly files: FileService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Приложить документ из хранилища к требованию (или заменить существующий — та же строка). */
  async attach(viewer: JwtPayload, appId: string, requirementId: string, documentId: string) {
    const app = await this.loadOwnedEditable(viewer, appId)
    const req = await this.prisma.serviceRequirement.findFirst({
      where: { id: requirementId, serviceId: app.serviceId, active: true },
      select: { id: true, titleRu: true },
    })
    if (!req) {
      throw new AppException('NOT_FOUND', 'Требование не найдено для этой услуги')
    }
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: viewer.sub, deletedAt: null },
      select: { id: true, title: true },
    })
    if (!doc) {
      throw new AppException('NOT_FOUND', 'Документ не найден в вашем хранилище')
    }
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.applicationDocument.upsert({
        where: { applicationId_requirementId: { applicationId: appId, requirementId } },
        update: {
          documentId: doc.id,
          source: 'STORAGE',
          status: 'PENDING',
          reviewComment: null,
          reviewedAt: null,
          reviewedById: null,
          snapshotTitle: doc.title,
          submittedAt: new Date(),
        },
        create: {
          applicationId: appId,
          requirementId,
          documentId: doc.id,
          source: 'STORAGE',
          status: 'PENDING',
          snapshotTitle: doc.title,
        },
        select: { id: true, requirementId: true, status: true, snapshotTitle: true },
      })
      await tx.applicationEvent.create({
        data: {
          applicationId: appId,
          actorId: viewer.sub,
          action: 'DOCUMENT_ADDED',
          comment: req.titleRu,
        },
      })
      return saved
    })
  }

  /** Убрать приложенный документ (только владелец, черновик/исправление). */
  async remove(viewer: JwtPayload, appId: string, requirementId: string): Promise<null> {
    await this.loadOwnedEditable(viewer, appId)
    await this.prisma.applicationDocument.deleteMany({
      where: { applicationId: appId, requirementId },
    })
    return null
  }

  /** Проверка документа сотрудником: принять или запросить замену (→ заявка в NEEDS_CORRECTION). */
  async review(
    viewer: JwtPayload,
    appId: string,
    docId: string,
    action: 'accept' | 'request-replacement',
    comment?: string,
  ): Promise<null> {
    const app = await this.loadForProcess(viewer, appId)
    if (app.status === 'DRAFT') {
      throw new AppException('BAD_REQUEST', 'Заявка ещё не отправлена')
    }
    const ad = await this.prisma.applicationDocument.findFirst({
      where: { id: docId, applicationId: appId },
      select: { id: true, requirement: { select: { titleRu: true } } },
    })
    if (!ad) {
      throw new AppException('NOT_FOUND', 'Документ заявки не найден')
    }
    if (action === 'accept') {
      await this.prisma.$transaction([
        this.prisma.applicationDocument.update({
          where: { id: docId },
          data: {
            status: 'ACCEPTED',
            reviewComment: null,
            reviewedAt: new Date(),
            reviewedById: viewer.sub,
          },
        }),
        this.prisma.applicationEvent.create({
          data: {
            applicationId: appId,
            actorId: viewer.sub,
            action: 'DOCUMENT_ACCEPTED',
            comment: ad.requirement.titleRu,
          },
        }),
      ])
      return null
    }
    if (!comment) {
      throw new AppException('BAD_REQUEST', 'Укажите причину замены документа')
    }
    // Запрос замены двигает заявку в NEEDS_CORRECTION — переход обязан пройти через SSOT
    // (canTransition), иначе из IN_PREPARATION/READY/READY_FOR_PICKUP заявку откатывало бы
    // в исправление в обход графа и портило SLA. NEEDS_CORRECTION допустим только из IN_REVIEW.
    if (!canTransition(app.status as ApplicationServiceStatus, 'NEEDS_CORRECTION')) {
      throw new AppException('BAD_REQUEST', 'Недопустимый переход')
    }
    const { eventId } = await this.prisma.$transaction(async (tx) => {
      await tx.applicationDocument.update({
        where: { id: docId },
        data: {
          status: 'REPLACEMENT_REQUIRED',
          reviewComment: comment,
          reviewedAt: new Date(),
          reviewedById: viewer.sub,
        },
      })
      await tx.application.update({
        where: { id: appId },
        data: { status: 'NEEDS_CORRECTION' },
      })
      const event = await tx.applicationEvent.create({
        data: {
          applicationId: appId,
          actorId: viewer.sub,
          action: 'DOCUMENT_REJECTED',
          fromStatus: app.status,
          toStatus: 'NEEDS_CORRECTION',
          comment,
        },
        select: { id: true },
      })
      return { eventId: event.id }
    })
    // Уведомляем студента: без этого запрос замены документа «молчал» и заявка тихо
    // застревала в NEEDS_CORRECTION (студент не знал, что нужно действовать). Тот же job
    // уведомления, что и у переходов заявки; dedupeKey по id события — уникален на переход.
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.APPLICATION_UPDATED,
      {
        recipientIds: [app.studentId],
        type: 'APP_UPDATE',
        title: 'Требуется замена документа',
        body: comment,
        data: { url: `/applications/${appId}` },
        dedupeKey: `NEEDS_CORRECTION:${eventId}`,
      },
      { jobId: `NEEDS_CORRECTION:${eventId}` },
    )
    // Realtime: окно заявки у студента обновляется вживую (перевод в NEEDS_CORRECTION).
    this.realtime.emitEventToUser(app.studentId, REALTIME_EVENTS.applicationStatusChanged, appId, {
      status: 'NEEDS_CORRECTION',
    })
    return null
  }

  /** Presigned-ссылка на файл документа заявки: владелец или обработчик (§26, scope перед выдачей). */
  async presignedUrl(viewer: JwtPayload, appId: string, docId: string): Promise<{ url: string }> {
    const scope = await this.prisma.application.findFirst({
      where: { id: appId, deletedAt: null },
      select: { studentId: true, facultyId: true, universityId: true },
    })
    if (!scope) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    if (scope.studentId !== viewer.sub && !this.policy.canProcess(viewer, scope)) {
      throw new AppException('FORBIDDEN', 'Нет доступа к документу заявки')
    }
    const ad = await this.prisma.applicationDocument.findFirst({
      where: { id: docId, applicationId: appId },
      select: { documentId: true },
    })
    if (!ad?.documentId) {
      throw new AppException('NOT_FOUND', 'Документ не приложен')
    }
    const file = await this.prisma.file.findFirst({
      where: { documentId: ad.documentId },
      orderBy: { order: 'asc' },
      select: { id: true },
    })
    if (!file) {
      throw new AppException('NOT_FOUND', 'Файл документа не найден')
    }
    return { url: await this.files.getPresignedUrl(file.id) }
  }

  /**
   * Presigned-ссылка на файл документа-результата. Гейт тот же, что у входящих документов
   * заявки: владелец или обработчик. Владение самим Document здесь не проверяется — документ
   * выдан студенту, а сотруднику доступ к нему даёт scope заявки.
   */
  async resultUrl(
    viewer: JwtPayload,
    appId: string,
    resultId: string,
    download = false,
  ): Promise<{ url: string }> {
    const scope = await this.prisma.application.findFirst({
      where: { id: appId, deletedAt: null },
      select: { studentId: true, facultyId: true, universityId: true },
    })
    if (!scope) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    if (scope.studentId !== viewer.sub && !this.policy.canProcess(viewer, scope)) {
      throw new AppException('FORBIDDEN', 'Нет доступа к результату заявки')
    }
    const result = await this.prisma.applicationResult.findFirst({
      where: { id: resultId, applicationId: appId },
      select: { documentId: true },
    })
    if (!result?.documentId) {
      throw new AppException('NOT_FOUND', 'К результату не приложен документ')
    }
    const file = await this.prisma.file.findFirst({
      where: { documentId: result.documentId },
      orderBy: { order: 'asc' },
      select: { id: true },
    })
    if (!file) {
      throw new AppException('NOT_FOUND', 'Файл документа не найден')
    }
    return { url: await this.files.getPresignedUrl(file.id, undefined, download) }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async loadOwnedEditable(viewer: JwtPayload, appId: string) {
    const app = await this.prisma.application.findFirst({
      where: { id: appId, deletedAt: null },
      select: { id: true, studentId: true, status: true, serviceId: true },
    })
    if (!app) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    if (app.studentId !== viewer.sub) {
      throw new AppException('WRONG_SCOPE', 'Это не ваша заявка')
    }
    if (!EDITABLE.includes(app.status)) {
      throw new AppException('BAD_REQUEST', 'Документы можно менять только до/во время исправления')
    }
    return app
  }

  private async loadForProcess(viewer: JwtPayload, appId: string) {
    const app = await this.prisma.application.findFirst({
      where: { id: appId, deletedAt: null },
      select: { studentId: true, facultyId: true, universityId: true, status: true },
    })
    if (!app) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    this.policy.assertCanProcess(viewer, app)
    return app
  }
}
