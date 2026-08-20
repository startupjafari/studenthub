import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { CreateMaterialInput, MaterialListQueryInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { FileService } from '../files/file.service'
import type { EnvVars } from '../../config/env.schema'

const MATERIAL_SELECT = {
  id: true,
  groupId: true,
  subject: true,
  title: true,
  description: true,
  url: true,
  createdAt: true,
  teacher: { select: { id: true, firstName: true, lastName: true } },
  media: { select: { id: true, mime: true, size: true, createdAt: true } },
} satisfies Prisma.MaterialSelect

type MaterialRow = Prisma.MaterialGetPayload<{ select: typeof MATERIAL_SELECT }>

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async create(
    actor: JwtPayload,
    input: CreateMaterialInput,
    ctx: RequestContext,
  ): Promise<MaterialRow> {
    await this.assertGroupManage(actor, input.groupId)
    const material = await this.prisma.material.create({
      data: {
        teacherId: actor.sub,
        groupId: input.groupId,
        title: input.title,
        description: input.description,
        subject: input.subject,
        url: input.url,
      },
      select: MATERIAL_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'material_created',
      entity: 'Material',
      entityId: material.id,
      metadata: { groupId: input.groupId },
      ...ctx,
    })
    return material
  }

  /** Список материалов, видимых смотрящему: студент/староста — своя группа, персонал — по scope. */
  async list(viewer: JwtPayload, query: MaterialListQueryInput): Promise<MaterialRow[]> {
    // scope и ?groupId= — через AND: клиентский groupId обязан СУЖАТЬ scope, а не
    // перезаписывать его (spread по общему ключу groupId открыл бы студенту метаданные
    // материалов любой чужой группы). См. §14.
    const where: Prisma.MaterialWhereInput = {
      AND: [this.scopeWhere(viewer), ...(query.groupId ? [{ groupId: query.groupId }] : [])],
    }
    return this.prisma.material.findMany({
      where,
      select: MATERIAL_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }

  /** Прикрепить файл к материалу (автор или админ). Файл → приватный бакет materials. */
  /**
   * Прямая загрузка крупного файла материала (лекция, презентация — лимит категории 25 МБ,
   * порог буферной загрузки 10 МБ). Шаг 1: подписанная ссылка.
   */
  async presignFile(actor: JwtPayload, id: string, mime: string) {
    // Права на материал проверяем ДО выдачи ключа: подписанная ссылка — это уже доступ на запись.
    await this.findManageable(actor, id)
    const bucket = this.config.get('MINIO_BUCKET_MATERIALS', { infer: true })
    return this.files.presignPut(bucket, mime, actor.sub)
  }

  /** Шаг 3: подтверждение — тип и размер определяет FileService по самому объекту. */
  async confirmFile(
    actor: JwtPayload,
    id: string,
    key: string,
    name: string | undefined,
    ctx: RequestContext,
  ) {
    const material = await this.findManageable(actor, id)
    const bucket = this.config.get('MINIO_BUCKET_MATERIALS', { infer: true })
    const file = await this.files.confirmDirectUpload({
      bucket,
      key,
      ownerId: actor.sub,
      materialId: material.id,
      name,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'material_file_added',
      entity: 'Material',
      entityId: id,
      metadata: { fileId: file.id, direct: true },
      ...ctx,
    })
    return { id: file.id, mime: file.mime, size: file.size, createdAt: file.createdAt }
  }

  async addFile(actor: JwtPayload, id: string, buffer: Buffer, ctx: RequestContext) {
    const material = await this.findManageable(actor, id)
    const bucket = this.config.get('MINIO_BUCKET_MATERIALS', { infer: true })
    const file = await this.files.upload({
      buffer,
      bucket,
      ownerId: actor.sub,
      materialId: material.id,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'material_file_added',
      entity: 'Material',
      entityId: id,
      metadata: { fileId: file.id },
      ...ctx,
    })
    return { id: file.id, mime: file.mime, size: file.size, createdAt: file.createdAt }
  }

  async getFileUrl(viewer: JwtPayload, id: string, fileId: string): Promise<{ url: string }> {
    const material = await this.prisma.material.findUnique({
      where: { id },
      select: MATERIAL_SELECT,
    })
    if (!material) throw new AppException('NOT_FOUND', 'Материал не найден')
    await this.assertRead(viewer, material.groupId)
    const file = await this.files.findOrThrow(fileId)
    if (file.materialId !== id) throw new AppException('NOT_FOUND', 'Файл не найден')
    const url = await this.files.getPresignedUrl(fileId)
    return { url }
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findManageable(actor, id)
    // Файлы (File.materialId → SetNull) осиротеют и будут удалены cron cleanOrphanFiles.
    await this.prisma.material.delete({ where: { id } })
    await this.audit.record({
      userId: actor.sub,
      action: 'material_deleted',
      entity: 'Material',
      entityId: id,
      ...ctx,
    })
  }

  // ── scope ────────────────────────────────────────────────────────────────

  private scopeWhere(viewer: JwtPayload): Prisma.MaterialWhereInput {
    if (isPlatform(viewer.role)) return {}
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      return { groupId: viewer.groupId ?? '__none__' }
    }
    if (viewer.role === Role.DEAN) {
      return { group: { is: { facultyId: viewer.facultyId ?? '__none__' } } }
    }
    // TEACHER / UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR — материалы групп своего вуза.
    return {
      group: { is: { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } } },
    }
  }

  private async assertRead(viewer: JwtPayload, groupId: string): Promise<void> {
    if (isPlatform(viewer.role)) return
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      if (viewer.groupId === groupId) return
      throw new AppException('WRONG_SCOPE', 'Материал другой группы')
    }
    const group = await this.resolveGroup(groupId)
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === group.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Материал другого факультета')
    }
    if (viewer.universityId === group.universityId) return
    throw new AppException('WRONG_SCOPE', 'Материал другого университета')
  }

  private async assertGroupManage(actor: JwtPayload, groupId: string): Promise<void> {
    if (isPlatform(actor.role)) return
    const group = await this.resolveGroup(groupId)
    if (actor.role === Role.DEAN) {
      if (actor.facultyId !== group.facultyId)
        throw new AppException('WRONG_SCOPE', 'Чужой факультет')
      return
    }
    // TEACHER / UNIVERSITY_ADMIN — своя вуз-группа.
    if (group.universityId !== actor.universityId)
      throw new AppException('WRONG_SCOPE', 'Группа другого университета')
  }

  private async findManageable(
    actor: JwtPayload,
    id: string,
  ): Promise<{ id: string; groupId: string }> {
    const material = await this.prisma.material.findUnique({
      where: { id },
      select: { id: true, teacherId: true, groupId: true },
    })
    if (!material) throw new AppException('NOT_FOUND', 'Материал не найден')
    if (material.teacherId === actor.sub || isPlatform(actor.role)) return material
    // Не автор — только админ/декан своего scope.
    await this.assertGroupManage(actor, material.groupId).catch(() => {
      throw new AppException('FORBIDDEN', 'Нет прав на материал')
    })
    if (actor.role === Role.TEACHER)
      throw new AppException('FORBIDDEN', 'Можно управлять только своими материалами')
    return material
  }

  private async resolveGroup(
    groupId: string,
  ): Promise<{ facultyId: string; universityId: string }> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { facultyId: true, faculty: { select: { universityId: true } } },
    })
    if (!group) throw new AppException('NOT_FOUND', 'Группа не найдена')
    return { facultyId: group.facultyId, universityId: group.faculty.universityId }
  }
}
