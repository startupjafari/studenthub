import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  MATERIAL_LIST_LIMIT,
  type CreateMaterialInput,
  type MaterialListQueryInput,
  type MaterialSubjectsQueryInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { isPlatformRole, resolveGroupScope } from '../../common/auth/group-scope'
import type { RequestContext } from '../auth/auth.service'
import { FileService } from '../files/file.service'
import { MediaService } from '../media/media.service'
import { MEDIA_FILE_SELECT, MEDIA_PREVIEW_SELECT, type MediaInfo } from '../media/media.types'
import { signingWindow } from '../../common/minio/stable-sign'
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
  // Размеры и LQIP — превью фото и видео в карточке материала до запроса ссылки.
  media: {
    select: {
      id: true,
      // Исходное имя файла — без него в окне материала был виден только MIME-тип.
      name: true,
      mime: true,
      size: true,
      createdAt: true,
      width: true,
      height: true,
      ...MEDIA_PREVIEW_SELECT,
    },
  },
} satisfies Prisma.MaterialSelect

type MaterialRow = Prisma.MaterialGetPayload<{ select: typeof MATERIAL_SELECT }>

// Потолок счётчиков по дисциплинам: у группы их десятки, у вуза — сотни.
const MATERIAL_SUBJECTS_LIMIT = 500

/**
 * Группы, где преподаватель ведёт занятия: дисциплина группы или пара действующего
 * расписания — то же основание, что у выкладки материалов и у составов групп (groups).
 */
function taughtBy(teacherId: string): Prisma.GroupWhereInput[] {
  return [
    { courses: { some: { teacherId } } },
    { pairs: { some: { teacherId, schedule: { is: { isActive: true } } } } },
  ]
}

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly media: MediaService,
  ) {}

  async create(
    actor: JwtPayload,
    input: CreateMaterialInput,
    ctx: RequestContext,
  ): Promise<MaterialRow> {
    await this.assertGroupManage(actor, input.groupId)
    if (actor.role === Role.TEACHER) await this.assertTeachesGroup(actor.sub, input.groupId)
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

  /**
   * Список материалов, видимых смотрящему: студент/староста — своя группа, персонал — по scope.
   * Свежие сверху, страница — до `MATERIAL_LIST_LIMIT`, дальше — по `cursor`. Фильтры `mine`
   * и `subject` сужают выборку на сервере: без них преподаватель получал общий поток вуза,
   * а страница дисциплины искала свои материалы в последних 200 материалах группы.
   */
  async list(viewer: JwtPayload, query: MaterialListQueryInput): Promise<MaterialRow[]> {
    return this.prisma.material.findMany({
      where: this.listWhere(viewer, query),
      select: MATERIAL_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? MATERIAL_LIST_LIMIT,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
  }

  /** Сколько материалов у каждой дисциплины — по всей выборке scope, а не по странице списка. */
  async subjects(
    viewer: JwtPayload,
    query: MaterialSubjectsQueryInput,
  ): Promise<{ subject: string | null; count: number }[]> {
    const rows = await this.prisma.material.groupBy({
      by: ['subject'],
      where: this.listWhere(viewer, query),
      _count: { _all: true },
      orderBy: { subject: 'asc' },
      take: MATERIAL_SUBJECTS_LIMIT,
    })
    return rows.map((r) => ({ subject: r.subject, count: r._count._all }))
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
    return {
      id: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
      createdAt: file.createdAt,
    }
  }

  async addFile(
    actor: JwtPayload,
    id: string,
    buffer: Buffer,
    name: string | undefined,
    ctx: RequestContext,
  ) {
    const material = await this.findManageable(actor, id)
    const bucket = this.config.get('MINIO_BUCKET_MATERIALS', { infer: true })
    const file = await this.files.upload({
      buffer,
      bucket,
      ownerId: actor.sub,
      materialId: material.id,
      name,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'material_file_added',
      entity: 'Material',
      entityId: id,
      metadata: { fileId: file.id },
      ...ctx,
    })
    return {
      id: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
      createdAt: file.createdAt,
    }
  }

  /** Ссылка на файл материала и, для фото и видео, описание вариантов — по scope группы. */
  async getFileUrl(
    viewer: JwtPayload,
    id: string,
    fileId: string,
  ): Promise<MediaInfo & { url: string; expiresAt: string }> {
    const material = await this.prisma.material.findUnique({
      where: { id },
      select: MATERIAL_SELECT,
    })
    if (!material) throw new AppException('NOT_FOUND', 'Материал не найден')
    await this.assertRead(viewer, material.groupId, material.teacher?.id ?? null)
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, materialId: id },
      select: MEDIA_FILE_SELECT,
    })
    if (!file) throw new AppException('NOT_FOUND', 'Файл не найден')
    const now = Date.now()
    const [url, media] = await Promise.all([
      this.files.getPresignedUrl(fileId),
      this.media.describeOne(file, now),
    ])
    return { ...media, url, expiresAt: signingWindow(now).expiresAt.toISOString() }
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findManageable(actor, id)
    // Файлы (File.materialId → SetNull) отвяжутся: строки снимет cron cleanDetachedFiles,
    // объекты — следом cleanOrphanFiles.
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

  private listWhere(
    viewer: JwtPayload,
    query: MaterialListQueryInput | MaterialSubjectsQueryInput,
  ): Prisma.MaterialWhereInput {
    // scope и фильтры — через AND: клиентский groupId обязан СУЖАТЬ scope, а не
    // перезаписывать его (spread по общему ключу groupId открыл бы студенту метаданные
    // материалов любой чужой группы). См. §14.
    const subject = 'subject' in query ? query.subject : undefined
    return {
      AND: [
        this.scopeWhere(viewer),
        ...(query.groupId ? [{ groupId: query.groupId }] : []),
        ...(query.mine ? [{ teacherId: viewer.sub }] : []),
        ...(subject ? [{ subject }] : []),
      ],
    }
  }

  private scopeWhere(viewer: JwtPayload): Prisma.MaterialWhereInput {
    if (isPlatformRole(viewer.role)) return {}
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      return { groupId: viewer.groupId ?? '__none__' }
    }
    if (viewer.role === Role.DEAN) {
      return { group: { is: { facultyId: viewer.facultyId ?? '__none__' } } }
    }
    // Преподаватель — свои материалы и материалы групп, где ведёт занятия (§2.2 «✅ свои»,
    // §5.5 бакет materials — участникам группы и автору). Раньше — все группы вуза.
    if (viewer.role === Role.TEACHER) {
      return {
        OR: [
          { teacherId: viewer.sub },
          {
            group: {
              is: {
                faculty: { is: { universityId: viewer.universityId ?? '__none__' } },
                OR: taughtBy(viewer.sub),
              },
            },
          },
        ],
      }
    }
    // UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR — материалы групп своего вуза.
    return {
      group: { is: { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } } },
    }
  }

  private async assertRead(
    viewer: JwtPayload,
    groupId: string,
    authorId: string | null,
  ): Promise<void> {
    if (isPlatformRole(viewer.role)) return
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      if (viewer.groupId === groupId) return
      throw new AppException('WRONG_SCOPE', 'Материал другой группы')
    }
    // Преподаватель — автор или ведёт занятия в группе (как `scopeWhere`): подписанная
    // ссылка на файл — это уже доступ к содержимому.
    if (viewer.role === Role.TEACHER) {
      if (authorId === viewer.sub) return
      const taught = await this.prisma.group.findFirst({
        where: {
          id: groupId,
          faculty: { is: { universityId: viewer.universityId ?? '__none__' } },
          OR: taughtBy(viewer.sub),
        },
        select: { id: true },
      })
      if (taught) return
      throw new AppException('WRONG_SCOPE', 'Вы не ведёте занятий в этой группе')
    }
    const group = await resolveGroupScope(this.prisma, groupId)
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === group.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Материал другого факультета')
    }
    if (viewer.universityId === group.universityId) return
    throw new AppException('WRONG_SCOPE', 'Материал другого университета')
  }

  private async assertGroupManage(actor: JwtPayload, groupId: string): Promise<void> {
    if (isPlatformRole(actor.role)) return
    const group = await resolveGroupScope(this.prisma, groupId)
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
    if (material.teacherId === actor.sub || isPlatformRole(actor.role)) return material
    // Не автор — только админ/декан своего scope.
    await this.assertGroupManage(actor, material.groupId).catch(() => {
      throw new AppException('FORBIDDEN', 'Нет прав на материал')
    })
    if (actor.role === Role.TEACHER)
      throw new AppException('FORBIDDEN', 'Можно управлять только своими материалами')
    return material
  }

  /**
   * Преподаватель выкладывает материалы только группам, где ведёт занятия (C-F27): раньше
   * материал уходил любой группе вуза, хотя ставить себе пары он может лишь там, где ведёт
   * дисциплину. Основание — дисциплина группы или пара действующего расписания: пара даёт
   * ему ростер и посещаемость группы, и материалы своим студентам — то же право.
   */
  private async assertTeachesGroup(teacherId: string, groupId: string): Promise<void> {
    const course = await this.prisma.course.findFirst({
      where: { teacherId, groupId },
      select: { id: true },
    })
    if (course) return
    const pair = await this.prisma.pair.findFirst({
      where: { teacherId, groupId, schedule: { is: { isActive: true } } },
      select: { id: true },
    })
    if (pair) return
    throw new AppException('WRONG_SCOPE', 'Вы не ведёте занятий в этой группе')
  }
}
