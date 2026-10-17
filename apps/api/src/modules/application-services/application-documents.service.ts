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
import { rethrowStaleStatus } from '../../common/prisma/stale-status'

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
      select: { id: true, title: true, status: true, issuedByUniversity: true },
    })
    if (!doc) {
      throw new AppException('NOT_FOUND', 'Документ не найден в вашем хранилище')
    }
    // Отозванная вузом справка (revokeStudyCertificate) в кабинете остаётся, но как
    // подтверждение уже ничего не значит — прикладывать её к новой заявке нельзя.
    if (doc.issuedByUniversity && doc.status === 'REJECTED') {
      throw new AppException('BAD_REQUEST', 'Документ отозван университетом')
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
    const app = await this.loadOwnedEditable(viewer, appId)
    if (app.status !== 'NEEDS_CORRECTION') {
      await this.prisma.applicationDocument.deleteMany({
        where: { applicationId: appId, requirementId },
      })
      return null
    }
    // В исправлении принятый документ сотрудник уже проверил: убрать его — значит тихо
    // поменять одобренный комплект. Менять можно возвращённое на замену и ещё не проверенное
    // (заменить принятый можно повторным прикладыванием — он снова уйдёт на проверку).
    // Полноту комплекта отдельно проверяет resubmit.
    const attached = await this.prisma.applicationDocument.findFirst({
      where: { applicationId: appId, requirementId },
      select: { status: true },
    })
    if (attached?.status === 'ACCEPTED') {
      throw new AppException('BAD_REQUEST', 'Принятый документ нельзя убрать из заявки')
    }
    // Условие на статус и в самом удалении: документ могли принять между проверкой и записью.
    await this.prisma.applicationDocument.deleteMany({
      where: { applicationId: appId, requirementId, status: { not: 'ACCEPTED' } },
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
      // Статус заявки — в условии записи, как у прочих переходов: параллельные «начать
      // подготовку», отказ или отзыв студентом иначе затирались бы откатом в NEEDS_CORRECTION.
      await tx.application
        .update({
          where: { id: appId, status: app.status },
          data: { status: 'NEEDS_CORRECTION' },
        })
        .catch(rethrowStaleStatus)
      await tx.applicationDocument.update({
        where: { id: docId },
        data: {
          status: 'REPLACEMENT_REQUIRED',
          reviewComment: comment,
          reviewedAt: new Date(),
          reviewedById: viewer.sub,
        },
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
        titleKey: 'applications.replacement.title',
        // Тело — комментарий сотрудника: пользовательский ввод, переводить нечем.
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

  /**
   * Presigned-ссылка на страницу документа заявки: владелец или обработчик (§26, scope перед
   * выдачей). `fileId` — конкретная страница из `documents[].files` карточки заявки; без него —
   * первая (так работали клиенты до списка страниц). Страница обязана принадлежать именно
   * приложенному документу: чужой fileId по этой ссылке не открывается.
   *
   * Просмотр сотрудником пишется в журнал документа (DocumentEvent VIEW, `viaApplication`):
   * студент видит, кто открывал его паспорт, как и для запросов документов и грантов.
   */
  async presignedUrl(
    viewer: JwtPayload,
    appId: string,
    docId: string,
    fileId?: string,
  ): Promise<{ url: string }> {
    // Документы чужого черновика сотруднику не открываются — заявку ему ещё не подавали.
    const scope = await this.prisma.application.findFirst({
      where: { id: appId, deletedAt: null, AND: [this.policy.submittedOnlyWhere(viewer)] },
      select: { studentId: true, facultyId: true, universityId: true },
    })
    if (!scope) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    const isOwner = scope.studentId === viewer.sub
    if (!isOwner && !this.policy.canProcess(viewer, scope)) {
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
      where: fileId ? { id: fileId, documentId: ad.documentId } : { documentId: ad.documentId },
      orderBy: { order: 'asc' },
      select: { id: true },
    })
    if (!file) {
      throw new AppException('NOT_FOUND', 'Файл документа не найден')
    }
    // Журнал — до выдачи ссылки: без записи ссылки нет. Собственный просмотр владельца сюда
    // не пишем — журнал отвечает на вопрос «кто ещё открывал мой документ».
    if (!isOwner) {
      await this.prisma.documentEvent.create({
        data: {
          actorId: viewer.sub,
          documentId: ad.documentId,
          action: 'VIEW',
          metadata: { fileId: file.id, viaApplication: appId, applicationDocumentId: docId },
        },
      })
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
    // Файл — только документа самого студента заявки: результат, записанный до проверки
    // владельца в addResult, мог ссылаться на чужой документ.
    const file = await this.prisma.file.findFirst({
      where: {
        documentId: result.documentId,
        document: { is: { ownerId: scope.studentId, deletedAt: null } },
      },
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
