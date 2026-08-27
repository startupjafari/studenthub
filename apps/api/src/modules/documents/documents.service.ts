import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import type {
  CreateDocumentInput,
  DocumentListQueryInput,
  DocumentSortValue,
  SortOrderValue,
  GrantDocumentAccessInput,
  ReorderDocumentFilesInput,
  UpdateDocumentInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { FileService } from '../files/file.service'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { AuditService } from '../../common/audit/audit.service'
import { DocumentTypesService } from './document-types.service'

// Документы принимаем только как PDF/JPG/PNG (ТЗ §5, шаг 2).
// Потолки на выборки (BACKEND_RULES §7.2). Страниц у документа не больше, чем разрешает
// схема reorder (30), грантов на документ — единицы; лимит фиксируем в запросе.
const DOCUMENT_FILES_LIMIT = 30
const DOCUMENT_ACCESS_LIMIT = 200

const DOCUMENT_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png'])
// Порог «скоро истекает» — 30 дней.
const EXPIRING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const DOCUMENT_SELECT = {
  id: true,
  category: true,
  type: true,
  title: true,
  numberLast4: true,
  issuedBy: true,
  issuedAt: true,
  expiresAt: true,
  comment: true,
  status: true,
  rejectionReason: true,
  issuedByUniversity: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  files: { select: { id: true, mime: true, size: true, order: true }, orderBy: { order: 'asc' } },
  _count: { select: { access: true } },
} satisfies Prisma.DocumentSelect

type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>

/**
 * Порядок выборки документов по колонке таблицы.
 *
 * Даты и срок действия бывают пустыми: `nulls: 'last'` держит такие строки в конце
 * при любом направлении — иначе при сортировке по возрастанию сверху оказывалась бы
 * пачка документов без даты, а не самые ранние.
 */
function documentOrderBy(
  sort: DocumentSortValue | undefined,
  order: SortOrderValue | undefined,
): Prisma.DocumentOrderByWithRelationInput {
  const dir = order ?? 'asc'
  switch (sort) {
    case 'title':
      return { title: dir }
    case 'category':
      return { category: dir }
    case 'status':
      return { status: dir }
    case 'issuedAt':
      return { issuedAt: { sort: dir, nulls: 'last' } }
    case 'expiresAt':
      return { expiresAt: { sort: dir, nulls: 'last' } }
    case 'access':
      return { access: { _count: dir } }
    case 'createdAt':
      return { createdAt: dir }
    default:
      // Порядок по умолчанию — свежие сверху, как было до появления сортировки по колонкам.
      return { createdAt: 'desc' }
  }
}

export interface DocumentFileDto {
  id: string
  mime: string
  size: number
  order: number | null
}
export interface DocumentDto {
  id: string
  category: string
  type: string
  title: string
  numberMasked: string | null
  issuedBy: string | null
  issuedAt: Date | null
  expiresAt: Date | null
  comment: string | null
  status: string
  rejectionReason: string | null
  issuedByUniversity: boolean
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  files: DocumentFileDto[]
  fileCount: number
  accessCount: number
}

/**
 * Модуль «Документы» (Ф15, задачи 15.5–15.6): личное защищённое хранилище.
 * Полный номер (Document.number) НАРУЖУ НЕ отдаётся — только маска ******4821 из numberLast4.
 * Файлы — в приватном бакете documents; отдача только presigned по проверке владения/доступа.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly queue: QueueService,
    private readonly types: DocumentTypesService,
    private readonly audit: AuditService,
  ) {}

  private get bucket(): string {
    return this.config.get('MINIO_BUCKET_DOCUMENTS', { infer: true })
  }

  /** Presigned-URL к уже проверенному по scope файлу (используется сервисом запросов). */
  presign(fileId: string): Promise<string> {
    return this.files.getPresignedUrl(fileId)
  }

  private mask(last4: string | null): string | null {
    return last4 ? `******${last4}` : null
  }

  private last4(value?: string | null): string | null {
    const n = (value ?? '').replace(/\s+/g, '')
    return n ? n.slice(-4) : null
  }

  // Проверка типа с учётом правок вуза (15.20): тип должен существовать, быть включён,
  // и его категория — совпадать с заявленной. Делегирует эффективному каталогу.
  private async assertType(actor: JwtPayload, category: string, type: string): Promise<void> {
    const resolved = await this.types.resolveUsable(actor.universityId ?? null, type)
    if (resolved !== category) {
      throw new AppException('BAD_REQUEST', 'Неизвестный тип документа для этой категории')
    }
  }

  private async logEvent(
    actorId: string,
    documentId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.documentEvent.create({
      data: {
        actorId,
        documentId,
        action,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    })
  }

  private async findOwnedOrThrow(actor: JwtPayload, id: string): Promise<{ id: string }> {
    const doc = await this.prisma.document.findFirst({
      where: { id, ownerId: actor.sub, deletedAt: null },
      select: { id: true },
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')
    return doc
  }

  private toDto(row: DocumentRow): DocumentDto {
    const { numberLast4, files, _count, ...rest } = row
    return {
      ...rest,
      numberMasked: this.mask(numberLast4),
      files: files.map((f) => ({ id: f.id, mime: f.mime, size: f.size, order: f.order })),
      fileCount: files.length,
      accessCount: _count.access,
    }
  }

  private async getOwnedDto(actor: JwtPayload, id: string): Promise<DocumentDto> {
    const doc = await this.prisma.document.findFirst({
      where: { id, ownerId: actor.sub, deletedAt: null },
      select: DOCUMENT_SELECT,
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')
    return this.toDto(doc)
  }

  // ── Файлы ─────────────────────────────────────────────────────────────────────

  /** Загрузка одного файла документа (буферно) в приватный бакет. Только PDF/JPG/PNG. */
  async uploadFile(
    actor: JwtPayload,
    buffer: Buffer,
  ): Promise<{ id: string; mime: string; size: number }> {
    const file = await this.files.upload({ buffer, bucket: this.bucket, ownerId: actor.sub })
    if (!DOCUMENT_MIME.has(file.mime)) {
      await this.files.delete(file.id, actor.sub)
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Поддерживаются только PDF, JPG и PNG')
    }
    return { id: file.id, mime: file.mime, size: file.size }
  }

  /**
   * Прямая загрузка файла документа (скан крупнее порога буферной загрузки — типичный
   * случай: диплом в 300 dpi). Шаг 1: подписанная ссылка.
   */
  async presignFile(
    actor: JwtPayload,
    mime: string,
  ): Promise<{ key: string; url: string; expiresAt: string }> {
    if (!DOCUMENT_MIME.has(mime)) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Поддерживаются только PDF, JPG и PNG')
    }
    return this.files.presignPut(this.bucket, mime, actor.sub)
  }

  /**
   * Шаг 3: подтверждение. Реальный тип определяет FileService по содержимому объекта —
   * заявленный на шаге 1 MIME здесь не участвует, иначе PDF-«обёртка» пропустила бы что угодно.
   */
  async confirmFile(
    actor: JwtPayload,
    key: string,
    name?: string,
  ): Promise<{ id: string; mime: string; size: number }> {
    const file = await this.files.confirmDirectUpload({
      bucket: this.bucket,
      key,
      ownerId: actor.sub,
      allowedMimes: DOCUMENT_MIME,
      name,
    })
    return { id: file.id, mime: file.mime, size: file.size }
  }

  /** Прикрепить уже загруженные файлы к документу (страницы/стороны), сохраняя порядок. */
  async attachFiles(
    actor: JwtPayload,
    id: string,
    input: ReorderDocumentFilesInput,
  ): Promise<DocumentDto> {
    await this.findOwnedOrThrow(actor, id)
    const files = await this.prisma.file.findMany({
      where: {
        id: { in: input.fileIds },
        ownerId: actor.sub,
        bucket: this.bucket,
        documentId: null,
      },
      select: { id: true },
      take: DOCUMENT_FILES_LIMIT,
    })
    if (files.length !== input.fileIds.length) {
      throw new AppException('BAD_REQUEST', 'Некоторые файлы недоступны для прикрепления')
    }
    const existing = await this.prisma.file.count({ where: { documentId: id } })
    await this.prisma.$transaction(
      input.fileIds.map((fileId, i) =>
        this.prisma.file.update({
          where: { id: fileId },
          data: { documentId: id, order: existing + i },
        }),
      ),
    )
    // Черновик без файлов → «Загружен».
    await this.prisma.document.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'UPLOADED' },
    })
    await this.logEvent(actor.sub, id, existing === 0 ? 'UPLOAD' : 'REPLACE', {
      added: input.fileIds.length,
    })
    return this.getOwnedDto(actor, id)
  }

  /** Изменить порядок страниц документа. */
  async reorderFiles(
    actor: JwtPayload,
    id: string,
    input: ReorderDocumentFilesInput,
  ): Promise<DocumentDto> {
    await this.findOwnedOrThrow(actor, id)
    const files = await this.prisma.file.findMany({
      where: { documentId: id },
      select: { id: true },
      take: DOCUMENT_FILES_LIMIT,
    })
    const ids = new Set(files.map((f) => f.id))
    if (input.fileIds.length !== files.length || !input.fileIds.every((x) => ids.has(x))) {
      throw new AppException('BAD_REQUEST', 'Список файлов не соответствует документу')
    }
    await this.prisma.$transaction(
      input.fileIds.map((fileId, i) =>
        this.prisma.file.update({ where: { id: fileId }, data: { order: i } }),
      ),
    )
    await this.logEvent(actor.sub, id, 'EDIT', { reordered: true })
    return this.getOwnedDto(actor, id)
  }

  /** Presigned-URL к файлу документа (открыть/скачать). Владелец или активный грант доступа. */
  async getFileUrl(
    actor: JwtPayload,
    id: string,
    fileId: string,
    asAttachment = false,
  ): Promise<string> {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, ownerId: true, universityId: true },
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')
    const isOwner = doc.ownerId === actor.sub
    if (!isOwner && !(await this.hasActiveGrant(actor, doc))) {
      throw new AppException('NOT_FOUND', 'Документ не найден')
    }
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, documentId: id },
      select: { id: true },
    })
    if (!file) throw new AppException('NOT_FOUND', 'Файл не найден')
    await this.logEvent(actor.sub, id, isOwner ? 'DOWNLOAD' : 'VIEW', { fileId })
    return this.files.getPresignedUrl(fileId, undefined, asAttachment)
  }

  // Есть ли у смотрящего активный (не отозван, не истёк) грант на документ:
  // персональный (USER), на его факультет/подразделение (DEPARTMENT) или на весь его вуз (UNIVERSITY).
  private async hasActiveGrant(
    actor: JwtPayload,
    doc: { id: string; universityId: string | null },
  ): Promise<boolean> {
    const now = new Date()
    const granteeOr: { granteeType: string; granteeId?: string | null }[] = [
      { granteeType: 'USER', granteeId: actor.sub },
    ]
    if (actor.facultyId) granteeOr.push({ granteeType: 'DEPARTMENT', granteeId: actor.facultyId })
    if (actor.universityId && doc.universityId === actor.universityId) {
      granteeOr.push({ granteeType: 'UNIVERSITY' })
    }
    const grant = await this.prisma.documentAccess.findFirst({
      where: {
        documentId: doc.id,
        revokedAt: null,
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        OR: granteeOr,
      },
      select: { id: true },
    })
    return grant !== null
  }

  // ── Управление доступом (ТЗ §9) ────────────────────────────────────────────────

  async grantAccess(actor: JwtPayload, id: string, input: GrantDocumentAccessInput) {
    await this.findOwnedOrThrow(actor, id)
    if (input.granteeType !== 'UNIVERSITY' && !input.granteeId) {
      throw new AppException('BAD_REQUEST', 'Не указан получатель доступа')
    }
    await this.prisma.documentAccess.create({
      data: {
        documentId: id,
        granteeType: input.granteeType,
        granteeId: input.granteeType === 'UNIVERSITY' ? null : (input.granteeId ?? null),
        reason: input.reason,
        grantedById: actor.sub,
        expiresAt: input.expiresAt ?? null,
      },
    })
    await this.logEvent(actor.sub, id, 'GRANT', { granteeType: input.granteeType })
    return this.listAccess(actor, id)
  }

  async listAccess(actor: JwtPayload, id: string) {
    await this.findOwnedOrThrow(actor, id)
    const rows = await this.prisma.documentAccess.findMany({
      where: { documentId: id },
      orderBy: { grantedAt: 'desc' },
      take: DOCUMENT_ACCESS_LIMIT,
    })
    const now = Date.now()
    return rows.map((r) => ({
      id: r.id,
      granteeType: r.granteeType,
      granteeId: r.granteeId,
      reason: r.reason,
      grantedAt: r.grantedAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      active: !r.revokedAt && (!r.expiresAt || r.expiresAt.getTime() > now),
    }))
  }

  async revokeAccess(actor: JwtPayload, id: string, accessId: string) {
    await this.findOwnedOrThrow(actor, id)
    const access = await this.prisma.documentAccess.findFirst({
      where: { id: accessId, documentId: id },
      select: { id: true, revokedAt: true },
    })
    if (!access) throw new AppException('NOT_FOUND', 'Доступ не найден')
    if (!access.revokedAt) {
      await this.prisma.documentAccess.update({
        where: { id: accessId },
        data: { revokedAt: new Date() },
      })
      await this.logEvent(actor.sub, id, 'REVOKE')
    }
    return this.listAccess(actor, id)
  }

  // ── Документы ───────────────────────────────────────────────────────────────

  async create(actor: JwtPayload, input: CreateDocumentInput): Promise<DocumentDto> {
    await this.assertType(actor, input.category, input.type)
    const doc = await this.prisma.document.create({
      data: {
        ownerId: actor.sub,
        universityId: actor.universityId ?? null,
        category: input.category,
        type: input.type,
        title: input.title,
        number: input.number || null,
        numberLast4: this.last4(input.number),
        issuedBy: input.issuedBy || null,
        issuedAt: input.issuedAt ?? null,
        expiresAt: input.expiresAt ?? null,
        comment: input.comment || null,
        status: input.status === 'DRAFT' ? 'DRAFT' : 'UPLOADED',
      },
      select: { id: true },
    })
    await this.logEvent(actor.sub, doc.id, 'UPLOAD', { created: true })
    return this.getOwnedDto(actor, doc.id)
  }

  /**
   * Выдать документ его будущему владельцу: вуз изготовил справку и кладёт её в кабинет
   * СТУДЕНТА, а не автора. Единственный путь, создающий Document с чужим `ownerId`, поэтому
   * публичного эндпоинта у него нет — вызывают только домены, которые сами проверили право
   * выдачи (заявки-услуги, §17). Иначе выданная справка оседала бы в личных документах
   * сотрудника, а студент не находил бы её у себя.
   */
  async issueToOwner(
    actor: JwtPayload,
    input: {
      ownerId: string
      universityId: string | null
      type: string
      title: string
      number?: string
      fileId: string
    },
  ): Promise<{ id: string }> {
    // Категорию не принимаем снаружи, а выводим из типа: выдать можно только то, что
    // каталог вуза относит к «Выданным университетом».
    const category = await this.types.resolveUsable(input.universityId, input.type)
    if (category !== 'ISSUED_BY_UNIVERSITY') {
      throw new AppException(
        'BAD_REQUEST',
        'Результат выдаётся типом из раздела «Выданные университетом»',
      )
    }
    // Файл обязан принадлежать выдающему и ещё не быть привязан к документу — те же
    // условия, что у attachFiles: иначе чужой файл переехал бы в чужой документ.
    const file = await this.prisma.file.findFirst({
      where: { id: input.fileId, ownerId: actor.sub, bucket: this.bucket, documentId: null },
      select: { id: true },
    })
    if (!file) {
      throw new AppException('BAD_REQUEST', 'Файл недоступен для прикрепления')
    }
    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          ownerId: input.ownerId,
          universityId: input.universityId,
          category,
          type: input.type,
          title: input.title,
          number: input.number || null,
          numberLast4: this.last4(input.number),
          issuedAt: new Date(),
          issuedByUniversity: true,
          status: 'UPLOADED',
        },
        select: { id: true },
      })
      await tx.file.update({ where: { id: file.id }, data: { documentId: created.id, order: 0 } })
      return created
    })
    // Актор события — выдавший сотрудник: в истории документа видно, кто его завёл.
    await this.logEvent(actor.sub, doc.id, 'UPLOAD', { issuedTo: input.ownerId })
    return doc
  }

  async update(actor: JwtPayload, id: string, input: UpdateDocumentInput): Promise<DocumentDto> {
    await this.findOwnedOrThrow(actor, id)
    const data: Prisma.DocumentUpdateInput = {}
    if (input.title !== undefined) data.title = input.title
    if (input.number !== undefined) {
      data.number = input.number || null
      data.numberLast4 = this.last4(input.number)
    }
    if (input.issuedBy !== undefined) data.issuedBy = input.issuedBy || null
    if (input.issuedAt !== undefined) data.issuedAt = input.issuedAt
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt
    if (input.comment !== undefined) data.comment = input.comment || null
    await this.prisma.document.update({ where: { id }, data })
    await this.logEvent(actor.sub, id, 'EDIT')
    return this.getOwnedDto(actor, id)
  }

  async list(actor: JwtPayload, query: DocumentListQueryInput): Promise<DocumentDto[]> {
    const where: Prisma.DocumentWhereInput = {
      ownerId: actor.sub,
      deletedAt: null,
      ...(query.view === 'archived' ? { NOT: { archivedAt: null } } : { archivedAt: null }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { issuedBy: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      // Пресеты раздела. `shared` — документы, к которым выдан хотя бы один доступ;
      // `issued` — выданные вузом. Раньше это отбиралось на клиенте уже после выборки.
      ...(query.preset === 'shared' ? { access: { some: {} } } : {}),
      ...(query.preset === 'issued' ? { issuedByUniversity: true } : {}),
    }
    const orderBy = documentOrderBy(query.sort, query.order)
    const rows = await this.prisma.document.findMany({
      where,
      select: DOCUMENT_SELECT,
      orderBy,
      take: 200,
    })
    return rows.map((r) => this.toDto(r))
  }

  getById(actor: JwtPayload, id: string): Promise<DocumentDto> {
    return this.getOwnedDto(actor, id)
  }

  async setArchived(actor: JwtPayload, id: string, archived: boolean): Promise<DocumentDto> {
    await this.findOwnedOrThrow(actor, id)
    await this.prisma.document.update({
      where: { id },
      data: {
        archivedAt: archived ? new Date() : null,
        status: archived ? 'ARCHIVED' : 'UPLOADED',
      },
    })
    await this.logEvent(actor.sub, id, 'ARCHIVE', { archived })
    return this.getOwnedDto(actor, id)
  }

  async remove(actor: JwtPayload, id: string): Promise<void> {
    await this.findOwnedOrThrow(actor, id)
    await this.prisma.document.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.logEvent(actor.sub, id, 'DELETE')
  }

  /** История действий по документу (ТЗ §10). */
  async listEvents(actor: JwtPayload, id: string) {
    await this.findOwnedOrThrow(actor, id)
    return this.prisma.documentEvent.findMany({
      where: { documentId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }

  /** Счётчики для экрана «Обзор» (ТЗ §3). */
  async overview(actor: JwtPayload): Promise<{
    total: number
    toUpload: number
    inReview: number
    expiringSoon: number
    needsReplacement: number
  }> {
    const base: Prisma.DocumentWhereInput = {
      ownerId: actor.sub,
      deletedAt: null,
      archivedAt: null,
    }
    const now = new Date()
    const soon = new Date(now.getTime() + EXPIRING_WINDOW_MS)
    const [total, toUpload, inReview, expiringSoon, needsReplacement] =
      await this.prisma.$transaction([
        this.prisma.document.count({ where: base }),
        this.prisma.document.count({ where: { ...base, status: 'DRAFT' } }),
        this.prisma.document.count({ where: { ...base, status: 'IN_REVIEW' } }),
        this.prisma.document.count({
          where: {
            ...base,
            OR: [{ status: 'EXPIRING' }, { expiresAt: { gte: now, lte: soon } }],
          },
        }),
        this.prisma.document.count({
          where: { ...base, status: { in: ['NEEDS_REPLACEMENT', 'REJECTED'] } },
        }),
      ])
    return { total, toUpload, inReview, expiringSoon, needsReplacement }
  }

  // ── Спец-режим платформенного админа (задача 15.21) ─────────────────────────

  /**
   * Метаданные любого документа для платформенного админа (без полного номера — только маска).
   * Обращение фиксируется: журнал документа (VIEW, platformMode) + аудит.
   */
  async platformGet(actor: JwtPayload, id: string): Promise<DocumentDto> {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: DOCUMENT_SELECT,
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')
    await this.logEvent(actor.sub, id, 'VIEW', { platformMode: true, meta: true })
    await this.audit.record({
      userId: actor.sub,
      action: 'DOCUMENT_PLATFORM_VIEW',
      entity: 'Document',
      entityId: id,
    })
    return this.toDto(doc)
  }

  /**
   * Presigned-URL к файлу чужого документа в спец-режиме — ТОЛЬКО с причиной.
   * Пишет причину в журнал документа и аудит (никакого «тихого» доступа).
   */
  async platformFileUrl(
    actor: JwtPayload,
    id: string,
    fileId: string,
    reason: string,
  ): Promise<string> {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, documentId: id },
      select: { id: true },
    })
    if (!file) throw new AppException('NOT_FOUND', 'Файл не найден')
    await this.logEvent(actor.sub, id, 'VIEW', { platformMode: true, fileId, reason })
    await this.audit.record({
      userId: actor.sub,
      action: 'DOCUMENT_PLATFORM_DOWNLOAD',
      entity: 'Document',
      entityId: id,
      metadata: { fileId, reason },
    })
    return this.files.getPresignedUrl(fileId)
  }

  // ── Крон истечения (задача 15.19) ───────────────────────────────────────────

  /**
   * Двигает документы по сроку `expiresAt`: просроченные → EXPIRED, ближайшие 30 дней → EXPIRING;
   * затем архивирует EXPIRED, пережившие срок хранения типа (retentionDays, 15.20).
   * Каждому владельцу — уведомление (BullMQ, SYSTEM, идемпотентно) и событие в журнал.
   * Вызывается из CleanupService по расписанию. Возвращает {expired, expiring, archived}.
   */
  async sweepExpiry(): Promise<{ expired: number; expiring: number; archived: number }> {
    const now = new Date()
    const soon = new Date(now.getTime() + EXPIRING_WINDOW_MS)
    const expired = await this.sweepStage(
      {
        deletedAt: null,
        archivedAt: null,
        expiresAt: { lt: now },
        status: { notIn: ['DRAFT', 'ARCHIVED', 'EXPIRED'] },
      },
      'EXPIRED',
      NOTIFICATION_JOBS.DOCUMENT_EXPIRING,
      'doc-expired',
      'Срок документа истёк',
    )
    const expiring = await this.sweepStage(
      {
        deletedAt: null,
        archivedAt: null,
        expiresAt: { gte: now, lte: soon },
        status: { notIn: ['DRAFT', 'ARCHIVED', 'EXPIRED', 'EXPIRING'] },
      },
      'EXPIRING',
      NOTIFICATION_JOBS.DOCUMENT_EXPIRING,
      'doc-expiring',
      'Документ скоро истекает',
    )
    const archived = await this.sweepRetention(now)
    if (expired + expiring + archived > 0) {
      this.logger.log(`sweepExpiry: EXPIRED ${expired}, EXPIRING ${expiring}, ARCHIVED ${archived}`)
    }
    return { expired, expiring, archived }
  }

  // Архивирование по сроку хранения (15.20): EXPIRED-документ, у которого прошло
  // `expiresAt + retentionDays` (retention типа вуза), уводим в архив (одна пачка за прогон).
  private async sweepRetention(now: Date): Promise<number> {
    const candidates = await this.prisma.document.findMany({
      where: { deletedAt: null, archivedAt: null, status: 'EXPIRED', expiresAt: { not: null } },
      select: { id: true, ownerId: true, universityId: true, type: true, expiresAt: true },
      take: 500,
    })
    let archived = 0
    for (const doc of candidates) {
      const days = await this.types.retentionDays(doc.universityId, doc.type)
      if (days === null || !doc.expiresAt) continue
      const deadline = doc.expiresAt.getTime() + days * 24 * 60 * 60 * 1000
      if (now.getTime() <= deadline) continue
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { status: 'ARCHIVED', archivedAt: now },
      })
      await this.logEvent(doc.ownerId, doc.id, 'ARCHIVE', { retention: days })
      archived += 1
    }
    return archived
  }

  private async sweepStage(
    where: Prisma.DocumentWhereInput,
    nextStatus: string,
    jobName: string,
    dedupePrefix: string,
    title: string,
  ): Promise<number> {
    let total = 0
    for (;;) {
      const batch = await this.prisma.document.findMany({
        where,
        select: { id: true, ownerId: true, title: true },
        take: 500,
      })
      if (batch.length === 0) break
      await this.prisma.document.updateMany({
        where: { id: { in: batch.map((b) => b.id) } },
        data: { status: nextStatus },
      })
      for (const doc of batch) {
        await this.logEvent(doc.ownerId, doc.id, nextStatus === 'EXPIRED' ? 'EXPIRE' : 'EXPIRING')
        await this.queue.enqueue(
          QUEUES.NOTIFICATIONS,
          jobName,
          {
            recipientIds: [doc.ownerId],
            type: 'SYSTEM',
            title,
            body: `«${doc.title}»`,
            data: { documentId: doc.id, url: '/documents' },
            dedupeKey: `${dedupePrefix}:${doc.id}`,
          },
          { jobId: `${dedupePrefix}:${doc.id}` },
        )
      }
      total += batch.length
      if (batch.length < 500) break
    }
    return total
  }
}
