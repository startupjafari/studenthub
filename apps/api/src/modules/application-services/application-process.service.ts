import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  canTransition,
  REALTIME_EVENTS,
  type ApplicationServiceStatus,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import { ExportRegistryService } from '../../common/export/export-registry.service'
import type { ExportContext, ExportLocale } from '../../common/export/export-branding.types'
import { UserService } from '../users/users.service'
import { renderQrPngDataUrl } from '../../common/qr/qr-raster'
import { renderStudyCertificatePdf } from './study-certificate-pdf'
import { STUDY_CERTIFICATE_LABELS } from './study-certificate-labels'
import { QueueService, QUEUES, NOTIFICATION_JOBS } from '../../common/queue'
import { RealtimeGateway } from '../../common/realtime'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { DocumentsService } from '../documents/documents.service'
import { ApplicationPolicy } from './application.policy'

// Обработка заявки сотрудником (§15–§17, §27): business-actions вместо generic PATCH /status.
// Каждое действие: canProcess + scope + проверка перехода (state-machine) + событие + уведомление.

/**
 * Тип выдаваемого документа для справки об обучении. Категория `ISSUED_BY_UNIVERSITY` —
 * обязательное условие `documents.issueToOwner` (выдать можно только то, что каталог вуза
 * относит к выданному университетом).
 */
const STUDY_CERTIFICATE_TYPE = 'STUDY_PLACE_REF'

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
  // Загруженный сотрудником файл готовой справки: документ по нему заводится здесь,
  // на имя студента (см. addResult).
  fileId?: string
  documentType?: string
  documentNumber?: string
  note?: string
}

@Injectable()
export class ApplicationProcessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ApplicationPolicy,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeGateway,
    private readonly documents: DocumentsService,
    private readonly users: UserService,
    private readonly branding: ExportBrandingService,
    private readonly exports: ExportRegistryService,
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
    // Файл готовой справки превращаем в документ студента ДО транзакции результата:
    // выдача трогает хранилище файлов, и держать на этом открытую транзакцию нельзя.
    let documentId = dto.documentId ?? null
    if (dto.fileId && dto.documentType) {
      const issued = await this.documents.issueToOwner(viewer, {
        ownerId: app.studentId,
        universityId: app.universityId,
        type: dto.documentType,
        // Название услуги — заголовок выданного документа: студент ищет его именно так.
        title: app.service.nameRu,
        number: dto.documentNumber,
        fileId: dto.fileId,
      })
      documentId = issued.id
    }
    await this.recordResult(viewer, id, {
      type: dto.type,
      documentId,
      documentNumber: dto.documentNumber,
      note: dto.note,
    })
    return { ok: true }
  }

  /**
   * Сформировать справку об обучении и выдать её студенту (этап B7).
   *
   * Заменяет загрузку готового файла сотрудником: данные у платформы уже есть, а документ,
   * который она выпустила сама, можно проверить — у него есть запись в журнале выгрузок и
   * код в бланке.
   *
   * Порядок важен: сначала запись в журнале, потом рендер. Код проверки печатается ВНУТРИ
   * документа, а после подписи документ неизменяем — дорисовать его потом будет нельзя.
   */
  async issueStudyCertificate(viewer: JwtPayload, id: string, locale: ExportLocale) {
    const app = await this.load(viewer, id)
    if (app.status !== 'IN_PREPARATION') {
      throw new AppException('BAD_REQUEST', 'Справка формируется на этапе подготовки')
    }
    const subject = await this.users.academicSubject(app.studentId)
    if (!subject) {
      throw new AppException('NOT_FOUND', 'Данные студента не найдены')
    }

    const context: ExportContext = {
      kind: 'certificate',
      actor: { id: viewer.sub, fullName: await this.users.fullName(viewer.sub) },
      locale,
      // Таймзона вуза студента: дата выдачи справки — это дата по месту учёбы.
      timezone: subject.timezone,
      generatedAt: new Date(),
      params: { applicationId: app.id, number: app.number },
    }

    // Официальный документ без записи в журнале непроверяем, поэтому здесь — в отличие от
    // рабочих выгрузок — сбой журнала отменяет выдачу (см. ExportRegistryService.register).
    const record = await this.exports.register({
      context,
      format: 'pdf',
      // Реквизиты для страницы проверки: с ними сверяют бумагу, которую держат в руках.
      // Снимком на момент выдачи — смена фамилии не должна задним числом «испортить»
      // уже выданную справку.
      document: {
        subjectName: subject.fullName,
        documentNumber: app.number ?? undefined,
        issuerName: subject.universityName,
      },
    })
    if (!record) {
      throw new AppException(
        'INTERNAL_ERROR',
        'Не удалось зарегистрировать документ — справка не выдана',
      )
    }

    const withCode: ExportContext = { ...context, shortId: record.shortId }
    const verifyUrl = `${this.branding.publicUrl}/verify/${record.shortId}`
    const buffer = await renderStudyCertificatePdf({
      number: app.number ?? record.shortId,
      verificationCode: record.shortId,
      verificationUrl: verifyUrl,
      verificationQr: await renderQrPngDataUrl(verifyUrl, { width: 256 }),
      subject,
      issuedAt: this.branding.dateTime(withCode),
      labels: STUDY_CERTIFICATE_LABELS[locale],
      branding: await this.branding.pdfBranding(withCode),
    })

    // Файл заводится на сотрудника (того требует issueToOwner), а документ — на студента.
    const file = await this.documents.uploadFile(viewer, buffer)
    const issued = await this.documents.issueToOwner(viewer, {
      ownerId: app.studentId,
      universityId: app.universityId,
      type: STUDY_CERTIFICATE_TYPE,
      title: app.service.nameRu,
      number: app.number ?? undefined,
      fileId: file.id,
    })
    await this.recordResult(viewer, id, {
      type: 'DOCUMENT',
      documentId: issued.id,
      documentNumber: app.number ?? undefined,
    })
    return { documentId: issued.id, verificationCode: record.shortId }
  }

  /**
   * Отозвать выданную справку: документ на руках перестаёт быть подтверждённым, страница
   * проверки показывает «отозван» вместо зелёной отметки.
   *
   * Право то же, что на обработку заявки (`ApplicationPolicy`): отзывает тот, кто выдавал,
   * — декан факультета или администрация вуза. Отдельной роли «отзывающего» не заводим,
   * пока вуз не потребует иного.
   *
   * Сам файл не трогаем: он уже у студента на руках и в его кабинете, а изъять бумагу
   * нельзя. Отзыв — это статус в журнале, и проверка по коду показывает именно его.
   */
  async revokeStudyCertificate(viewer: JwtPayload, id: string, reason?: string) {
    const app = await this.load(viewer, id)
    if (!app.number) {
      throw new AppException('BAD_REQUEST', 'У заявки нет номера — отзывать нечего')
    }
    const revoked = await this.exports.revokeByDocumentNumber(app.number)
    if (revoked === 0) {
      throw new AppException('NOT_FOUND', 'Действующей справки по этой заявке нет')
    }
    await this.prisma.applicationEvent.create({
      data: {
        applicationId: id,
        actorId: viewer.sub,
        action: 'RESULT_REVOKED',
        comment: reason ?? null,
      },
    })
    return { revoked }
  }

  /** Запись результата заявки и события — общая для загруженного файла и выданной справки. */
  private async recordResult(
    viewer: JwtPayload,
    applicationId: string,
    result: { type: string; documentId: string | null; documentNumber?: string; note?: string },
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.applicationResult.create({
        data: {
          applicationId,
          type: result.type,
          documentId: result.documentId,
          documentNumber: result.documentNumber,
          note: result.note,
          issuedById: viewer.sub,
        },
      }),
      this.prisma.applicationEvent.create({
        data: { applicationId, actorId: viewer.sub, action: 'RESULT_ADDED' },
      }),
    ])
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
    // Realtime: точечно уведомляем владельца заявки об изменении статуса — окно заявки
    // обновляется вживую (без опроса). Payload минимальный (только статус), без PII.
    this.realtime.emitEventToUser(app.studentId, REALTIME_EVENTS.applicationStatusChanged, app.id, {
      status: to,
    })
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
