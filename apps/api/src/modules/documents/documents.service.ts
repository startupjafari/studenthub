import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import type {
  CreateDocumentInput,
  CursorPaginationInput,
  DocumentListQueryInput,
  DocumentSortValue,
  SortOrderValue,
  GrantDocumentAccessInput,
  ReorderDocumentFilesInput,
  UpdateDocumentInput,
} from '@studenthub/shared-schemas'
import type { NotificationMessageKey } from '@studenthub/shared-config'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { FileService } from '../files/file.service'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { AuditService } from '../../common/audit/audit.service'
import { Paginated } from '../../common/http/paginated'
import { DocumentTypesService, type RetentionRule } from './document-types.service'

// Документы принимаем только как PDF/JPG/PNG (ТЗ §5, шаг 2).
// Потолки на выборки (BACKEND_RULES §7.2). Страниц у документа не больше, чем разрешает
// схема reorder (30), грантов на документ — единицы; лимит фиксируем в запросе.
const DOCUMENT_FILES_LIMIT = 30
const DOCUMENT_ACCESS_LIMIT = 200
// Деканов одного факультета — единицы; потолок на адресатов уведомления о гранте.
const GRANT_RECIPIENTS_LIMIT = 50
// Кто открывает документ по гранту «Университет»: администрация вуза, не все его люди.
const UNIVERSITY_GRANT_ROLES: ReadonlySet<Role> = new Set([
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
])

const DOCUMENT_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png'])
// Порог «скоро истекает» — 30 дней.
const EXPIRING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
// Статусы, которые выводятся из срока действия: при возврате из архива их пересчитываем.
const EXPIRY_STATUSES: ReadonlySet<string> = new Set(['UPLOADED', 'EXPIRING', 'EXPIRED'])
// Размер пачки ночного крона (правила сроков хранения, документы к архиву).
const SWEEP_BATCH = 500

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
 * Меняет ли правка содержимое документа — то, что выдаёт вуз и что он проверял (D-F22, D-F30):
 * название, номер, кем выдан и даты. Пустая строка и `null` — одно и то же «не указано».
 */
function changedContent(
  input: UpdateDocumentInput,
  doc: {
    title: string
    number: string | null
    issuedBy: string | null
    issuedAt: Date | null
    expiresAt: Date | null
  },
): boolean {
  const time = (d: Date | null | undefined) => d?.getTime() ?? null
  return (
    (input.title !== undefined && input.title !== doc.title) ||
    (input.number !== undefined && (input.number || null) !== doc.number) ||
    (input.issuedBy !== undefined && (input.issuedBy || null) !== doc.issuedBy) ||
    (input.issuedAt !== undefined && time(input.issuedAt) !== time(doc.issuedAt)) ||
    (input.expiresAt !== undefined && time(input.expiresAt) !== time(doc.expiresAt))
  )
}

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
// Документ, открытый смотрящему по гранту (раздел «Открытые мне»). Только метаданные
// с маской номера: комментарий владельца и причина отклонения сюда не попадают.
export interface SharedDocumentDto {
  accessId: string
  granteeType: string
  reason: string
  grantedAt: Date
  expiresAt: Date | null
  owner: { id: string; name: string }
  document: {
    id: string
    category: string
    type: string
    title: string
    numberMasked: string | null
    issuedBy: string | null
    issuedAt: Date | null
    expiresAt: Date | null
    status: string
    files: DocumentFileDto[]
    fileCount: number
  }
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

  private async findOwnedOrThrow(
    actor: JwtPayload,
    id: string,
  ): Promise<{ id: string; issuedByUniversity: boolean }> {
    const doc = await this.prisma.document.findFirst({
      where: { id, ownerId: actor.sub, deletedAt: null },
      select: { id: true, issuedByUniversity: true },
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')
    return doc
  }

  /**
   * Подтверждение вуза (VERIFIED, D-F30) относится к проверенному содержимому: правка данных
   * или страниц владельцем возвращает документ в «Загружен».
   */
  private async dropVerification(id: string): Promise<void> {
    await this.prisma.document.updateMany({
      where: { id, status: 'VERIFIED' },
      data: { status: 'UPLOADED' },
    })
  }

  /**
   * Содержимое выданного вузом документа владельцу не правится (D-F22): справка уходит в
   * заявки и запросы как выданная университетом, и дописанная страница или исправленный
   * номер выдавались бы за подлинник. Владельцу остаются архив, удаление и личная заметка.
   */
  private assertContentEditable(doc: { issuedByUniversity: boolean }): void {
    if (doc.issuedByUniversity) {
      throw new AppException('FORBIDDEN', 'Документ выдан университетом — его данные не меняются')
    }
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
    this.assertContentEditable(await this.findOwnedOrThrow(actor, id))
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
    // Черновик без файлов → «Загружен»; подтверждённый вузом с новыми страницами — уже не
    // тот, что проверяли (D-F30).
    await this.prisma.document.updateMany({
      where: { id, status: { in: ['DRAFT', 'VERIFIED'] } },
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
    this.assertContentEditable(await this.findOwnedOrThrow(actor, id))
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
    await this.dropVerification(id)
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
    const grant = isOwner ? null : await this.activeGrant(actor, doc)
    if (!isOwner && !grant) {
      throw new AppException('NOT_FOUND', 'Документ не найден')
    }
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, documentId: id },
      select: { id: true },
    })
    if (!file) throw new AppException('NOT_FOUND', 'Файл не найден')
    // По какому гранту открыт чужой документ — видно в журнале документов вуза.
    await this.logEvent(
      actor.sub,
      id,
      isOwner ? 'DOWNLOAD' : 'VIEW',
      grant ? { fileId, accessId: grant.id, granteeType: grant.granteeType } : { fileId },
    )
    return this.files.getPresignedUrl(fileId, undefined, asAttachment)
  }

  // Под какие гранты попадает смотрящий: персональный (USER), на его факультет (DEPARTMENT)
  // и на весь его вуз (UNIVERSITY). `university` — условие гранта «Университет» или null,
  // если он смотрящему не положен.
  // «Мой факультет (деканат)» и «Университет» — доступ администрации, а не всем людям
  // факультета или вуза: раньше по такому гранту скан паспорта открывал и однокурсник.
  private granteeOr(
    actor: JwtPayload,
    university: Prisma.DocumentAccessWhereInput | null,
  ): Prisma.DocumentAccessWhereInput[] {
    const or: Prisma.DocumentAccessWhereInput[] = [{ granteeType: 'USER', granteeId: actor.sub }]
    if (actor.facultyId && actor.role === Role.DEAN) {
      or.push({ granteeType: 'DEPARTMENT', granteeId: actor.facultyId })
    }
    if (university && actor.universityId && UNIVERSITY_GRANT_ROLES.has(actor.role)) {
      or.push(university)
    }
    return or
  }

  // Активный (не отозван, не истёк) грант смотрящего на документ или null.
  private async activeGrant(
    actor: JwtPayload,
    doc: { id: string; universityId: string | null },
  ): Promise<{ id: string; granteeType: string } | null> {
    const now = new Date()
    const sameUniversity = !!actor.universityId && doc.universityId === actor.universityId
    const grant = await this.prisma.documentAccess.findFirst({
      where: {
        documentId: doc.id,
        revokedAt: null,
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        OR: this.granteeOr(actor, sameUniversity ? { granteeType: 'UNIVERSITY' } : null),
      },
      select: { id: true, granteeType: true },
    })
    return grant
  }

  /**
   * Документы, открытые мне (D-F10): активные гранты на меня, на мой факультет (декану) и
   * на мой вуз (администрации). Без этого списка грант не доходил до получателя: открыть
   * файл можно только по id документа, а его знал один владелец. Только метаданные с маской
   * номера и список страниц — сами файлы открываются через `GET :id/files/:fileId/url`
   * с той же проверкой гранта и записью VIEW в журнал документа.
   */
  async listSharedWithMe(
    actor: JwtPayload,
    query: CursorPaginationInput,
  ): Promise<Paginated<SharedDocumentDto>> {
    const now = new Date()
    const rows = await this.prisma.documentAccess.findMany({
      where: {
        revokedAt: null,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          {
            OR: this.granteeOr(actor, {
              granteeType: 'UNIVERSITY',
              document: { universityId: actor.universityId ?? '__none__' },
            }),
          },
        ],
        // Свои документы здесь не нужны — они в «Моих документах».
        document: { deletedAt: null, ownerId: { not: actor.sub } },
      },
      orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        granteeType: true,
        reason: true,
        grantedAt: true,
        expiresAt: true,
        document: {
          select: {
            id: true,
            category: true,
            type: true,
            title: true,
            numberLast4: true,
            issuedBy: true,
            issuedAt: true,
            expiresAt: true,
            status: true,
            files: {
              select: { id: true, mime: true, size: true, order: true },
              orderBy: { order: 'asc' },
              take: DOCUMENT_FILES_LIMIT,
            },
            owner: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    })
    const hasNext = rows.length > query.limit
    const page = hasNext ? rows.slice(0, query.limit) : rows
    return new Paginated(
      page.map((r) => {
        const { numberLast4, files, owner, ...doc } = r.document
        return {
          accessId: r.id,
          granteeType: r.granteeType,
          reason: r.reason,
          grantedAt: r.grantedAt,
          expiresAt: r.expiresAt,
          owner: { id: owner.id, name: `${owner.lastName} ${owner.firstName}`.trim() },
          document: {
            ...doc,
            numberMasked: this.mask(numberLast4),
            files,
            fileCount: files.length,
          },
        }
      }),
      { cursor: hasNext ? page[page.length - 1]?.id : undefined, hasNext },
    )
  }

  // ── Управление доступом (ТЗ §9) ────────────────────────────────────────────────

  async grantAccess(actor: JwtPayload, id: string, input: GrantDocumentAccessInput) {
    await this.findOwnedOrThrow(actor, id)
    if (input.granteeType !== 'UNIVERSITY' && !input.granteeId) {
      throw new AppException('BAD_REQUEST', 'Не указан получатель доступа')
    }
    const access = await this.prisma.documentAccess.create({
      data: {
        documentId: id,
        granteeType: input.granteeType,
        granteeId: input.granteeType === 'UNIVERSITY' ? null : (input.granteeId ?? null),
        reason: input.reason,
        grantedById: actor.sub,
        expiresAt: input.expiresAt ?? null,
      },
      select: { id: true },
    })
    await this.logEvent(actor.sub, id, 'GRANT', { granteeType: input.granteeType })
    await this.notifyGrantee(actor, id, access.id, input)
    return this.listAccess(actor, id)
  }

  /**
   * Уведомить получателя гранта (D-F10): человека (USER) или деканов факультета (DEPARTMENT).
   * Адресаты — только в вузе владельца: грант выписывается на любой id, и без сужения он
   * становился бы рассылкой по чужим людям. Грант «Университет» не рассылается — он на всю
   * администрацию вуза и виден ей в разделе «Открытые мне».
   */
  private async notifyGrantee(
    actor: JwtPayload,
    documentId: string,
    accessId: string,
    input: GrantDocumentAccessInput,
  ): Promise<void> {
    if (input.granteeType === 'UNIVERSITY' || !input.granteeId || !actor.universityId) return
    const recipients = await this.prisma.user.findMany({
      where: {
        universityId: actor.universityId,
        deletedAt: null,
        isBlocked: false,
        NOT: { id: actor.sub },
        ...(input.granteeType === 'USER'
          ? { id: input.granteeId }
          : { role: Role.DEAN, facultyId: input.granteeId }),
      },
      select: { id: true },
      take: GRANT_RECIPIENTS_LIMIT,
    })
    if (recipients.length === 0) return
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { title: true, owner: { select: { firstName: true, lastName: true } } },
    })
    if (!doc) return
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.DOCUMENT_SHARED,
      {
        recipientIds: recipients.map((r) => r.id),
        type: 'SYSTEM',
        titleKey: 'documents.shared.title',
        bodyKey: 'documents.shared.body',
        params: {
          name: `${doc.owner.firstName} ${doc.owner.lastName}`.trim(),
          title: doc.title,
        },
        data: { documentId, accessId, url: '/documents?section=shared' },
        dedupeKey: `doc-shared:${accessId}`,
      },
      { jobId: `doc-shared:${accessId}` },
    )
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
      select: { id: true, revokedAt: true, granteeType: true },
    })
    if (!access) throw new AppException('NOT_FOUND', 'Доступ не найден')
    if (!access.revokedAt) {
      await this.prisma.documentAccess.update({
        where: { id: accessId },
        data: { revokedAt: new Date() },
      })
      await this.logEvent(actor.sub, id, 'REVOKE', { granteeType: access.granteeType })
    }
    return this.listAccess(actor, id)
  }

  // ── Документы ───────────────────────────────────────────────────────────────

  async create(actor: JwtPayload, input: CreateDocumentInput): Promise<DocumentDto> {
    // «Выданные университетом» кладёт в кабинет только вуз (issueToOwner): собственный
    // документ этой категории стоял бы в каталоге рядом с настоящими справками (D-F22).
    if (input.category === 'ISSUED_BY_UNIVERSITY') {
      throw new AppException('FORBIDDEN', 'Документы этой категории выдаёт университет')
    }
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
  /**
   * Принадлежит ли документ человеку (живой, не удалённый). Для других доменов, которые
   * ссылаются на документ по id из запроса: без этой проверки id чужого документа
   * превращался в доступ к его файлу (результат заявки, §3.2).
   */
  async isOwnedBy(documentId: string, ownerId: string): Promise<boolean> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId, deletedAt: null },
      select: { id: true },
    })
    return doc !== null
  }

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
    const doc = await this.prisma.document.findFirst({
      where: { id, ownerId: actor.sub, deletedAt: null },
      select: {
        id: true,
        issuedByUniversity: true,
        title: true,
        number: true,
        issuedBy: true,
        issuedAt: true,
        expiresAt: true,
      },
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')
    // Изменилось ли содержимое, а не просто пришло ли поле: веб присылает форму целиком, и
    // правка одной заметки не должна ни упираться в запрет, ни снимать подтверждение вуза.
    const contentChanged = changedContent(input, doc)
    // У выданного вузом документа владелец меняет только свою заметку (comment) — она
    // никому, кроме него, не показывается.
    if (contentChanged) this.assertContentEditable(doc)
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
    if (contentChanged) await this.dropVerification(id)
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

  /**
   * Архив и возврат из него. Прежний статус запоминается в событии ARCHIVE и при возврате
   * восстанавливается (D-F22): раньше разархивация всегда ставила UPLOADED, и отозванная
   * вузом справка (REJECTED) или просроченный документ возвращались «действующими».
   * Повторный архив и возврат неархивного — без изменений: иначе запомнился бы ARCHIVED.
   */
  async setArchived(actor: JwtPayload, id: string, archived: boolean): Promise<DocumentDto> {
    const doc = await this.prisma.document.findFirst({
      where: { id, ownerId: actor.sub, deletedAt: null },
      select: { id: true, status: true, archivedAt: true, expiresAt: true },
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')
    if (archived === (doc.archivedAt !== null)) return this.getOwnedDto(actor, id)

    if (archived) {
      const { count } = await this.prisma.document.updateMany({
        where: { id, archivedAt: null },
        data: { archivedAt: new Date(), status: 'ARCHIVED' },
      })
      if (count > 0) {
        await this.logEvent(actor.sub, id, 'ARCHIVE', { archived, previousStatus: doc.status })
      }
    } else {
      const status = await this.restoredStatus(doc)
      const { count } = await this.prisma.document.updateMany({
        where: { id, archivedAt: { not: null } },
        data: { archivedAt: null, status },
      })
      if (count > 0) await this.logEvent(actor.sub, id, 'ARCHIVE', { archived, status })
    }
    return this.getOwnedDto(actor, id)
  }

  /**
   * Статус документа после возврата из архива: прежний из последнего события архивации.
   * Статусы срока (UPLOADED/EXPIRING/EXPIRED) пересчитываются по `expiresAt` — за время в
   * архиве срок мог пройти или владелец его продлил. Если прежний неизвестен (архив до
   * этого правила, архивация кроном по сроку хранения) — тоже по сроку.
   */
  private async restoredStatus(doc: { id: string; expiresAt: Date | null }): Promise<string> {
    const event = await this.prisma.documentEvent.findFirst({
      where: { documentId: doc.id, action: 'ARCHIVE' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    })
    const meta = (event?.metadata ?? null) as { previousStatus?: unknown } | null
    const previous = typeof meta?.previousStatus === 'string' ? meta.previousStatus : null
    if (previous && !EXPIRY_STATUSES.has(previous) && previous !== 'ARCHIVED') return previous
    const now = Date.now()
    const expires = doc.expiresAt?.getTime()
    if (expires !== undefined && expires < now) return 'EXPIRED'
    if (expires !== undefined && expires <= now + EXPIRING_WINDOW_MS) return 'EXPIRING'
    return 'UPLOADED'
  }

  /**
   * Удаление — мягкое, но окончательное для всех (D-F21): владелец, получатели грантов,
   * сотрудник по заявке или запросу и админ платформы документ больше не открывают (везде
   * условие `deletedAt: null`). Сканы снимает ночная уборка cleanDetachedFiles через
   * 30 дней — запас на спор и ошибку; восстановления удалённого документа нет.
   */
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
   * Обращение фиксируется: журнал документа (VIEW, platformMode) + аудит, с причиной (D-F24).
   * `reason` не передаёт только прежний GET без тела — он оставлен для совместимости.
   */
  async platformGet(actor: JwtPayload, id: string, reason?: string): Promise<DocumentDto> {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: DOCUMENT_SELECT,
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')
    await this.logEvent(actor.sub, id, 'VIEW', {
      platformMode: true,
      meta: true,
      ...(reason ? { reason } : {}),
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'DOCUMENT_PLATFORM_VIEW',
      entity: 'Document',
      entityId: id,
      ...(reason ? { metadata: { reason } } : {}),
    })
    return this.toDto(doc)
  }

  /**
   * Presigned-URL к файлам чужого документа в спец-режиме — ТОЛЬКО с причиной.
   * Пишет причину в журнал документа и аудит (никакого «тихого» доступа).
   *
   * Файлы берутся пачкой и дают РОВНО ОДНУ запись на обращение: карточка показывает превью
   * всех сканов сразу, и выдача по файлу за запрос размазывала одно обращение админа на N
   * строк журнала — читать такой аудит невозможно. Состав пачки не теряется: он уходит
   * в metadata.fileIds.
   */
  async platformFileUrls(
    actor: JwtPayload,
    id: string,
    fileIds: string[],
    reason: string,
  ): Promise<Record<string, string>> {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    })
    if (!doc) throw new AppException('NOT_FOUND', 'Документ не найден')

    // Дубли в запросе не должны множить выдачи presigned-ссылок.
    const requested = [...new Set(fileIds)]
    const files = await this.prisma.file.findMany({
      where: { id: { in: requested }, documentId: id },
      select: { id: true },
      take: requested.length,
    })
    // Хотя бы один чужой/несуществующий файл — отказ целиком: частичный ответ скрыл бы
    // от админа, что он смотрит не тот документ.
    if (files.length !== requested.length) throw new AppException('NOT_FOUND', 'Файл не найден')

    await this.logEvent(actor.sub, id, 'VIEW', { platformMode: true, fileIds: requested, reason })
    await this.audit.record({
      userId: actor.sub,
      action: 'DOCUMENT_PLATFORM_DOWNLOAD',
      entity: 'Document',
      entityId: id,
      metadata: { fileIds: requested, reason },
    })

    const urls = await Promise.all(
      requested.map(async (fileId) => [fileId, await this.files.getPresignedUrl(fileId)] as const),
    )
    return Object.fromEntries(urls)
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
      'documents.expired.title',
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
      'documents.expiring.title',
    )
    const archived = await this.sweepRetention(now)
    if (expired + expiring + archived > 0) {
      this.logger.log(`sweepExpiry: EXPIRED ${expired}, EXPIRING ${expiring}, ARCHIVED ${archived}`)
    }
    return { expired, expiring, archived }
  }

  // Архивирование по сроку хранения (15.20): EXPIRED-документ, у которого прошло
  // `expiresAt + retentionDays` (retention типа вуза), уводим в архив.
  // Идём от правил (вуз + тип с заданным сроком), а не от документов: раньше брались первые
  // 500 EXPIRED подряд без условия на срок, документы без срока хранения навсегда занимали
  // эту пачку, и до подходящих архивация не доходила ни в одном вузе (D-F08).
  private async sweepRetention(now: Date): Promise<number> {
    let archived = 0
    let afterId: string | null = null
    for (;;) {
      const rules = await this.types.retentionRules(afterId, SWEEP_BATCH)
      for (const rule of rules) archived += await this.archiveByRule(rule, now)
      const last = rules.at(-1)
      if (!last || rules.length < SWEEP_BATCH) break
      afterId = last.id
    }
    return archived
  }

  // Архивирует все документы одного правила пачками до исчерпания. Курсор по id гарантирует
  // продвижение, даже если часть пачки не обновилась (владелец продлил или удалил документ).
  private async archiveByRule(rule: RetentionRule, now: Date): Promise<number> {
    const where: Prisma.DocumentWhereInput = {
      universityId: rule.universityId,
      type: rule.typeId,
      status: 'EXPIRED',
      deletedAt: null,
      archivedAt: null,
      expiresAt: { lt: new Date(now.getTime() - rule.retentionDays * DAY_MS) },
    }
    let archived = 0
    let afterId: string | null = null
    for (;;) {
      const batch: { id: string }[] = await this.prisma.document.findMany({
        where: { ...where, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: 'asc' },
        select: { id: true },
        take: SWEEP_BATCH,
      })
      if (batch.length === 0) break
      // Условие отбора повторяем в UPDATE: между выборкой и записью документ могли изменить.
      const done = await this.prisma.document.updateManyAndReturn({
        where: { ...where, id: { in: batch.map((d) => d.id) } },
        data: { status: 'ARCHIVED', archivedAt: now },
        select: { id: true, ownerId: true },
      })
      if (done.length > 0) {
        await this.prisma.documentEvent.createMany({
          data: done.map((d) => ({
            actorId: d.ownerId,
            documentId: d.id,
            action: 'ARCHIVE',
            metadata: { retention: rule.retentionDays, previousStatus: 'EXPIRED' },
          })),
        })
      }
      archived += done.length
      const last = batch.at(-1)
      if (!last || batch.length < SWEEP_BATCH) break
      afterId = last.id
    }
    return archived
  }

  private async sweepStage(
    where: Prisma.DocumentWhereInput,
    nextStatus: string,
    jobName: string,
    dedupePrefix: string,
    titleKey: NotificationMessageKey,
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
            titleKey,
            bodyKey: 'documents.named.body',
            params: { title: doc.title },
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
