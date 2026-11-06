import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { documentTemplateVariable, type DocumentTemplateLocale } from '@studenthub/shared-config'
import type {
  CreateDocumentTemplateInput,
  DocumentTemplateCategory,
  DocumentTemplateDetail,
  DocumentTemplateListItem,
  DocumentTemplateListQueryInput,
  DocumentTemplateStatus,
  DocumentTemplateValidation,
  DocumentTemplateVersionDto,
  UpdateDocumentTemplateInput,
} from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { AuditService } from '../../common/audit/audit.service'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { FileService } from '../files/file.service'
import { detectAllowedFileType } from '../files/mime-detector'
import { UserService } from '../users/users.service'
import { UniversityService } from '../universities/universities.service'
import { DocxFileRejected, inspectDocxArchive } from './docx-archive'
import {
  TemplateNotRenderable,
  TemplateValueMissing,
  analyzeTemplate,
  demoTemplateValues,
  renderTemplate,
} from './docx-template-engine'
import { buildTemplateValues, missingVariables, withOptionalBlanks } from './template-values'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Шаблонами управляет админ вуза (§3.8 «Шаблоны»). */
const MANAGER_ROLES: readonly Role[] = [Role.UNIVERSITY_ADMIN]
/** Документ для студента формируют те, кто обрабатывает заявки (§2.2 «Заявки — обработка»). */
export const ISSUER_ROLES: readonly Role[] = [
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]
const STUDENT_ROLES: readonly Role[] = [Role.STUDENT, Role.STAROSTA]
const VERSIONS_IN_DETAIL = 50

const PERSON_SELECT = { select: { id: true, firstName: true, lastName: true } } as const

const TEMPLATE_SELECT = {
  id: true,
  universityId: true,
  title: true,
  category: true,
  description: true,
  locale: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  currentVersionId: true,
  publishedVersionId: true,
  createdBy: PERSON_SELECT,
  currentVersion: { select: { id: true, version: true, valid: true, variables: true } },
  publishedVersion: { select: { id: true, version: true } },
} satisfies Prisma.DocumentTemplateSelect

type TemplateRow = Prisma.DocumentTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>

const VERSION_SELECT = {
  id: true,
  version: true,
  fileName: true,
  size: true,
  checksum: true,
  createdAt: true,
  validation: true,
  createdBy: PERSON_SELECT,
} satisfies Prisma.DocumentTemplateVersionSelect

/** Файл для отдачи пользователю: сформированный DOCX или проверочный. */
export interface GeneratedDocx {
  buffer: Buffer
  filename: string
}

export interface RequestMeta {
  ip?: string
  userAgent?: string
}

function person(p: { id: string; firstName: string; lastName: string } | null) {
  return p ? { id: p.id, name: `${p.firstName} ${p.lastName}`.trim() } : null
}

function toListItem(t: TemplateRow): DocumentTemplateListItem {
  return {
    id: t.id,
    title: t.title,
    category: t.category as DocumentTemplateCategory,
    description: t.description,
    locale: t.locale as DocumentTemplateLocale,
    status: t.status as DocumentTemplateStatus,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    publishedAt: t.publishedAt?.toISOString() ?? null,
    author: person(t.createdBy),
    variableCount: t.currentVersion?.variables.length ?? 0,
    currentVersion: t.currentVersion
      ? {
          id: t.currentVersion.id,
          version: t.currentVersion.version,
          valid: t.currentVersion.valid,
        }
      : null,
    publishedVersion: t.publishedVersion,
    hasUnpublishedChanges:
      t.status === 'PUBLISHED' &&
      t.currentVersionId !== null &&
      t.currentVersionId !== t.publishedVersionId,
  }
}

function toVersionDto(
  v: Prisma.DocumentTemplateVersionGetPayload<{ select: typeof VERSION_SELECT }>,
): DocumentTemplateVersionDto {
  return {
    id: v.id,
    version: v.version,
    fileName: v.fileName,
    size: v.size,
    checksum: v.checksum,
    createdAt: v.createdAt.toISOString(),
    createdBy: person(v.createdBy),
    validation: v.validation as unknown as DocumentTemplateValidation,
  }
}

/** Ошибки проверки — в details для клиента: код замечания и тег, без текста документа. */
function invalidTemplate(validation: DocumentTemplateValidation): AppException {
  return new AppException(
    'TEMPLATE_INVALID',
    'Шаблон не прошёл проверку — исправьте документ и загрузите его снова',
    validation.errors.slice(0, 20).map((e) => ({ field: e.tag ?? 'template', message: e.code })),
  )
}

const FILE_NAME_MAX = 200

function fileName(raw: string | undefined): string {
  // Браузеры на Windows присылают полный путь; берём только имя.
  const base = (raw ?? '').split(/[\\/]/).pop()?.trim() ?? ''
  if (base.length <= FILE_NAME_MAX) return base
  // Режем основу, а не хвост: иначе длинное имя теряло «.docx» и честный файл отклонялся.
  const ext = /\.[^.]{1,10}$/.exec(base)?.[0] ?? ''
  return base.slice(0, FILE_NAME_MAX - ext.length) + ext
}

/**
 * DOCX-шаблоны документов вуза (docs/PROJECT.md §3.8 «Шаблоны документов»).
 *
 * Изоляция вузов: вуз берётся только из токена, каждый шаблон сверяется с ним (`load`).
 * Данные студента и вуза запрашиваются у модулей-владельцев (UserService, UniversityService),
 * своих копий этих данных модуль не хранит.
 */
@Injectable()
export class DocumentTemplatesService {
  private readonly logger = new Logger(DocumentTemplatesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly users: UserService,
    private readonly universities: UniversityService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  private get bucket(): string {
    return this.config.get('MINIO_BUCKET_DOCUMENTS', { infer: true })
  }

  private get maxBytes(): number {
    return this.config.get('DOCUMENT_TEMPLATE_MAX_BYTES', { infer: true })
  }

  private isManager(viewer: JwtPayload): boolean {
    return MANAGER_ROLES.includes(viewer.role)
  }

  /**
   * Шаблон в scope пользователя. Чужой вуз — `WRONG_SCOPE` (§4.4). Тем, кто формирует
   * документы, но не управляет шаблонами (модератор вуза, декан), видны только
   * опубликованные: черновик для них — `NOT_FOUND`.
   */
  private async load(viewer: JwtPayload, id: string): Promise<TemplateRow> {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id },
      select: TEMPLATE_SELECT,
    })
    if (!template) throw new AppException('NOT_FOUND', 'Шаблон не найден')
    if (!viewer.universityId || template.universityId !== viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Шаблон другого университета')
    }
    if (!this.isManager(viewer) && template.status !== 'PUBLISHED') {
      throw new AppException('NOT_FOUND', 'Шаблон не найден')
    }
    return template
  }

  private async loadEditable(viewer: JwtPayload, id: string): Promise<TemplateRow> {
    const template = await this.load(viewer, id)
    if (template.status === 'ARCHIVED') {
      throw new AppException('CONFLICT', 'Шаблон в архиве — его нельзя изменить')
    }
    return template
  }

  private requireUniversity(viewer: JwtPayload): string {
    if (!viewer.universityId) throw new AppException('FORBIDDEN', 'Нет университета в профиле')
    return viewer.universityId
  }

  async list(
    viewer: JwtPayload,
    query: DocumentTemplateListQueryInput,
  ): Promise<Paginated<DocumentTemplateListItem>> {
    const universityId = this.requireUniversity(viewer)
    const where: Prisma.DocumentTemplateWhereInput = {
      universityId,
      ...(this.isManager(viewer)
        ? query.status
          ? { status: query.status }
          : {}
        : { status: 'PUBLISHED' }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.documentTemplate.findMany({
        where,
        select: TEMPLATE_SELECT,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.documentTemplate.count({ where }),
    ])
    return new Paginated(rows.map(toListItem), { total })
  }

  async get(viewer: JwtPayload, id: string): Promise<DocumentTemplateDetail> {
    const template = await this.load(viewer, id)
    // Историю версий и счётчик выдач видит только тот, кто управляет шаблоном.
    if (!this.isManager(viewer))
      return { ...toListItem(template), versions: [], generationCount: 0 }
    const [versions, generationCount] = await this.prisma.$transaction([
      this.prisma.documentTemplateVersion.findMany({
        where: { templateId: id },
        select: VERSION_SELECT,
        orderBy: { version: 'desc' },
        take: VERSIONS_IN_DETAIL,
      }),
      this.prisma.documentTemplateGeneration.count({ where: { templateId: id } }),
    ])
    return { ...toListItem(template), versions: versions.map(toVersionDto), generationCount }
  }

  async create(
    viewer: JwtPayload,
    input: CreateDocumentTemplateInput,
    meta: RequestMeta = {},
  ): Promise<DocumentTemplateDetail> {
    const universityId = this.requireUniversity(viewer)
    const created = await this.prisma.documentTemplate.create({
      data: {
        universityId,
        title: input.title,
        category: input.category,
        description: input.description || null,
        locale: input.locale,
        createdById: viewer.sub,
      },
      select: { id: true },
    })
    await this.record(viewer, 'document_template_created', created.id, {}, meta)
    return this.get(viewer, created.id)
  }

  async update(
    viewer: JwtPayload,
    id: string,
    input: UpdateDocumentTemplateInput,
    meta: RequestMeta = {},
  ): Promise<DocumentTemplateDetail> {
    await this.loadEditable(viewer, id)
    await this.prisma.documentTemplate.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
      },
    })
    await this.record(viewer, 'document_template_updated', id, { fields: Object.keys(input) }, meta)
    return this.get(viewer, id)
  }

  /**
   * Новая версия файла. Порядок проверок — от дешёвой к дорогой и от «файл вообще не тот»
   * к «шаблон с замечаниями»:
   *   1. размер и расширение;
   *   2. тип по содержимому (не .doc, не .docm, не произвольный zip);
   *   3. архив и структура OOXML (zip-бомба, макросы, ActiveX, внешние шаблоны) — отказ;
   *   4. переменные и синтаксис — версия СОХРАНЯЕТСЯ с отчётом: сотрудник видит, что
   *      исправить, а опубликовать такую версию нельзя.
   * Прежние версии не трогаются: опубликованная остаётся опубликованной до новой публикации.
   */
  async uploadVersion(
    viewer: JwtPayload,
    id: string,
    upload: { buffer: Buffer; filename?: string },
    meta: RequestMeta = {},
  ): Promise<DocumentTemplateDetail> {
    await this.loadEditable(viewer, id)
    const { buffer } = upload
    const name = fileName(upload.filename)

    if (buffer.length > this.maxBytes) {
      throw new AppException('FILE_TOO_LARGE', `Файл больше ${this.maxBytes} байт`)
    }
    if (!/\.docx$/i.test(name)) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Нужен документ Word в формате .docx')
    }
    const detected = await detectAllowedFileType(buffer)
    if (detected?.mime !== DOCX_MIME) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Нужен документ Word в формате .docx')
    }

    let validation: DocumentTemplateValidation
    try {
      inspectDocxArchive(buffer)
      validation = analyzeTemplate(buffer)
    } catch (error) {
      if (error instanceof DocxFileRejected) {
        // Причина — в лог (без содержимого документа), клиенту — только код.
        this.logger.warn(
          { templateId: id, userId: viewer.sub, problem: error.problem, reason: error.reason },
          'DOCX-шаблон отклонён',
        )
        throw new AppException('TEMPLATE_FILE_INVALID', 'Файл не подходит для шаблона', [
          { field: 'file', message: error.problem },
        ])
      }
      // Архив прошёл проверку, а шаблонизатор его не открыл: для пользователя это тот же
      // «повреждённый файл», подробности — в лог.
      this.logger.warn({ err: error, templateId: id }, 'DOCX-шаблон не разобран')
      throw new AppException('TEMPLATE_FILE_INVALID', 'Файл не подходит для шаблона', [
        { field: 'file', message: 'CORRUPTED' },
      ])
    }

    const checksum = createHash('sha256').update(buffer).digest('hex')
    const file = await this.files.upload({
      buffer,
      bucket: this.bucket,
      ownerId: viewer.sub,
      expectedCategory: 'DOCUMENT',
      name,
    })
    let version: number
    try {
      version = await this.prisma.$transaction(async (tx) => {
        const last = await tx.documentTemplateVersion.findFirst({
          where: { templateId: id },
          orderBy: { version: 'desc' },
          select: { version: true },
        })
        const created = await tx.documentTemplateVersion.create({
          data: {
            templateId: id,
            version: (last?.version ?? 0) + 1,
            fileId: file.id,
            fileName: name,
            size: buffer.length,
            checksum,
            variables: validation.variables,
            validation: validation as unknown as Prisma.InputJsonValue,
            valid: validation.valid,
            createdById: viewer.sub,
          },
          select: { id: true, version: true },
        })
        await tx.documentTemplate.update({
          where: { id },
          data: { currentVersionId: created.id },
        })
        return created.version
      })
    } catch (error) {
      // Без версии файл никому не принадлежит — убираем сразу, не дожидаясь ночной чистки.
      await this.files.delete(file.id).catch((err: unknown) => {
        this.logger.warn({ err, fileId: file.id }, 'Не удалось удалить файл несохранённой версии')
      })
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Файл шаблона уже загружается — повторите попытку')
      }
      throw error
    }
    await this.record(
      viewer,
      'document_template_version_uploaded',
      id,
      { version, valid: validation.valid, checksum },
      meta,
    )
    return this.get(viewer, id)
  }

  /** Публикация рабочей версии. Только после успешной технической проверки (§6 ТЗ). */
  async publish(
    viewer: JwtPayload,
    id: string,
    meta: RequestMeta = {},
  ): Promise<DocumentTemplateDetail> {
    const template = await this.loadEditable(viewer, id)
    const current = template.currentVersion
    if (!current) {
      throw new AppException('TEMPLATE_INVALID', 'Сначала загрузите файл шаблона', [
        { field: 'file', message: 'NO_FILE' },
      ])
    }
    if (!current.valid) {
      const version = await this.prisma.documentTemplateVersion.findUniqueOrThrow({
        where: { id: current.id },
        select: { validation: true },
      })
      throw invalidTemplate(version.validation as unknown as DocumentTemplateValidation)
    }
    // Условное обновление: рабочую версию могли заменить между чтением и публикацией —
    // тогда опубликовалась бы не та, что проверили.
    const { count } = await this.prisma.documentTemplate.updateMany({
      where: { id, currentVersionId: current.id, status: { not: 'ARCHIVED' } },
      data: {
        status: 'PUBLISHED',
        publishedVersionId: current.id,
        publishedAt: new Date(),
        publishedById: viewer.sub,
      },
    })
    if (count === 0) {
      throw new AppException(
        'CONFLICT',
        'Файл шаблона только что изменился — проверьте и повторите',
      )
    }
    await this.record(
      viewer,
      'document_template_published',
      id,
      { versionId: current.id, version: current.version },
      meta,
    )
    return this.get(viewer, id)
  }

  async unpublish(
    viewer: JwtPayload,
    id: string,
    meta: RequestMeta = {},
  ): Promise<DocumentTemplateDetail> {
    const template = await this.loadEditable(viewer, id)
    if (template.status === 'PUBLISHED') {
      await this.prisma.documentTemplate.update({
        where: { id },
        data: { status: 'DRAFT', publishedVersionId: null, publishedAt: null, publishedById: null },
      })
      await this.record(viewer, 'document_template_unpublished', id, {}, meta)
    }
    return this.get(viewer, id)
  }

  /**
   * Удаление с учётом ссылок. По шаблону уже выдавали документы — его версии нужны как
   * доказательство того, что было выдано, поэтому шаблон уходит в архив (генерация и правка
   * закрыты, история и файлы остаются). Не выдавали — удаляется целиком вместе с файлами.
   */
  async remove(
    viewer: JwtPayload,
    id: string,
    meta: RequestMeta = {},
  ): Promise<{ archived: boolean }> {
    await this.load(viewer, id)
    const used = await this.prisma.documentTemplateGeneration.count({ where: { templateId: id } })
    if (used > 0) {
      await this.archive(viewer, id, used, meta)
      return { archived: true }
    }
    const versions = await this.prisma.documentTemplateVersion.findMany({
      where: { templateId: id },
      select: { fileId: true },
      take: 1000,
    })
    try {
      await this.prisma.documentTemplate.delete({ where: { id } })
    } catch (error) {
      // Документ успели сформировать между подсчётом и удалением — внешний ключ журнала
      // выдач (Restrict) удаление не пустил. Архивируем, как если бы увидели его сразу.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        await this.archive(viewer, id, 1, meta)
        return { archived: true }
      }
      throw error
    }
    for (const { fileId } of versions) {
      await this.files.delete(fileId).catch((err: unknown) => {
        // Запись версии уже удалена, файл стал «ничьим» — его подберёт cleanDetachedFiles.
        this.logger.warn({ err, fileId }, 'Не удалось удалить файл версии шаблона')
      })
    }
    await this.record(viewer, 'document_template_deleted', id, { versions: versions.length }, meta)
    return { archived: false }
  }

  private async archive(viewer: JwtPayload, id: string, generations: number, meta: RequestMeta) {
    await this.prisma.documentTemplate.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
        publishedVersionId: null,
        publishedAt: null,
        publishedById: null,
      },
    })
    await this.record(viewer, 'document_template_archived', id, { generations }, meta)
  }

  /** Ссылка на исходный DOCX версии (presigned, 15 минут). */
  async sourceUrl(
    viewer: JwtPayload,
    id: string,
    versionId: string,
  ): Promise<{ url: string; fileName: string | null }> {
    await this.load(viewer, id)
    const version = await this.prisma.documentTemplateVersion.findFirst({
      where: { id: versionId, templateId: id },
      select: { fileId: true, fileName: true },
    })
    if (!version) throw new AppException('NOT_FOUND', 'Версия шаблона не найдена')
    return {
      url: await this.files.getPresignedUrl(version.fileId, undefined, true),
      fileName: version.fileName,
    }
  }

  /**
   * Проверочный документ на демонстрационных данных (§5 ТЗ «Проверить на примере»).
   * Без версии — по рабочей. Реальных людей в данных нет, поэтому журнал выдач не пишется;
   * в аудит — да: кто и какую версию проверял.
   */
  async testGenerate(
    viewer: JwtPayload,
    id: string,
    versionId: string | undefined,
    meta: RequestMeta = {},
  ): Promise<GeneratedDocx> {
    const template = await this.load(viewer, id)
    const targetId = versionId ?? template.currentVersionId
    if (!targetId) {
      throw new AppException('TEMPLATE_INVALID', 'Сначала загрузите файл шаблона', [
        { field: 'file', message: 'NO_FILE' },
      ])
    }
    const version = await this.loadVersion(id, targetId)
    const buffer = await this.render(id, version, demoTemplateValues())
    await this.record(
      viewer,
      'document_template_test_generated',
      id,
      { versionId: version.id, version: version.version },
      meta,
    )
    return { buffer, filename: `${template.title} (пример).docx` }
  }

  /**
   * Документ для студента по опубликованной версии.
   *
   *   · шаблон — своего вуза и опубликован;
   *   · студент — своего вуза, у декана — своего факультета (иначе `WRONG_SCOPE`);
   *   · данные — из профиля на сервере, от клиента приходит только id студента;
   *   · пустое обязательное поле — отказ `TEMPLATE_DATA_MISSING` со списком полей,
   *     а не документ с пустым местом.
   *
   * В журнал выдач и в аудит пишутся только идентификаторы — ни ФИО, ни иных данных.
   */
  async generateForStudent(
    viewer: JwtPayload,
    id: string,
    studentId: string,
    meta: RequestMeta = {},
  ): Promise<GeneratedDocx> {
    const template = await this.load(viewer, id)
    if (template.status !== 'PUBLISHED' || !template.publishedVersionId) {
      throw new AppException('BAD_REQUEST', 'Шаблон не опубликован')
    }
    const student = await this.users.documentTemplatePerson(studentId)
    if (!student || !STUDENT_ROLES.includes(student.role)) {
      throw new AppException('NOT_FOUND', 'Студент не найден')
    }
    const foreign =
      student.universityId !== template.universityId ||
      (viewer.role === Role.DEAN && (!viewer.facultyId || student.facultyId !== viewer.facultyId))
    if (foreign) throw new AppException('WRONG_SCOPE', 'Студент не из вашей области')

    const [issuer, university, version] = await Promise.all([
      this.users.documentTemplatePerson(viewer.sub),
      this.universities.documentRequisites(template.universityId),
      this.loadVersion(id, template.publishedVersionId),
    ])
    if (!issuer || !university) throw new AppException('NOT_FOUND', 'Данные вуза не найдены')

    const values = buildTemplateValues({
      student,
      university,
      issuer,
      locale: template.locale as DocumentTemplateLocale,
      now: new Date(),
    })
    const missing = missingVariables(version.variables, values)
    if (missing.length > 0) throw this.dataMissing(missing)

    const buffer = await this.render(id, version, withOptionalBlanks(version.variables, values))
    const generation = await this.prisma.documentTemplateGeneration.create({
      data: {
        templateId: id,
        versionId: version.id,
        universityId: template.universityId,
        studentId,
        actorId: viewer.sub,
      },
      select: { id: true },
    })
    await this.record(
      viewer,
      'document_template_generated',
      id,
      { versionId: version.id, studentId, generationId: generation.id },
      meta,
    )
    return { buffer, filename: `${template.title}.docx` }
  }

  private async loadVersion(templateId: string, versionId: string) {
    const version = await this.prisma.documentTemplateVersion.findFirst({
      where: { id: versionId, templateId },
      select: {
        id: true,
        version: true,
        valid: true,
        variables: true,
        validation: true,
        file: { select: { bucket: true, key: true } },
      },
    })
    if (!version) throw new AppException('NOT_FOUND', 'Версия шаблона не найдена')
    if (!version.valid) {
      throw invalidTemplate(version.validation as unknown as DocumentTemplateValidation)
    }
    return version
  }

  private async render(
    templateId: string,
    version: { id: string; file: { bucket: string; key: string } },
    values: ReadonlyMap<string, string | null>,
  ): Promise<Buffer> {
    const source = await this.files.getObjectBuffer(version.file.bucket, version.file.key)
    try {
      return renderTemplate(source, values)
    } catch (error) {
      if (error instanceof TemplateNotRenderable) throw invalidTemplate(error.validation)
      if (error instanceof TemplateValueMissing) throw this.dataMissing([error.key])
      // Содержимого документа и значений в логе нет — только идентификаторы.
      this.logger.error({ err: error, templateId, versionId: version.id }, 'Сбой генерации DOCX')
      throw new AppException('INTERNAL_ERROR', 'Не удалось сформировать документ')
    }
  }

  private dataMissing(keys: string[]): AppException {
    return new AppException(
      'TEMPLATE_DATA_MISSING',
      'Не удалось сформировать документ: в профиле не заполнены нужные поля',
      keys.map((key) => ({
        field: key,
        message: documentTemplateVariable(key) ? `Не заполнено поле ${key}` : key,
      })),
    )
  }

  private async record(
    viewer: JwtPayload,
    action: string,
    templateId: string,
    metadata: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<void> {
    await this.audit.record({
      userId: viewer.sub,
      action,
      entity: 'DocumentTemplate',
      entityId: templateId,
      metadata: { universityId: viewer.universityId, ...metadata },
      ...meta,
    })
    this.logger.log({ action, templateId, userId: viewer.sub }, 'Шаблон документа')
  }
}
