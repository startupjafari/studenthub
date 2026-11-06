import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { UpdateUniversityPageInput } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { buildPublicObjectUrl } from '../../common/minio/public-url'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import type { RequestContext } from '../auth/auth.service'
import { FileService } from '../files/file.service'
import { CareerAccessService, isUniversityPageEditor } from '../career/career-access.service'

/** Витрина вуза: реквизиты (их правит платформа) и поля страницы (их правит админ вуза). */
const UNIVERSITY_PAGE_SELECT = {
  id: true,
  name: true,
  shortName: true,
  country: true,
  city: true,
  logoUrl: true,
  coverUrl: true,
  description: true,
  website: true,
  foundedYear: true,
  contactEmail: true,
  contactPhone: true,
  address: true,
  telegram: true,
  instagram: true,
  linkedin: true,
  createdAt: true,
} satisfies Prisma.UniversitySelect

export type UniversityImageKind = 'logo' | 'cover'

/** Поле картинки — явными ветками, а не вычисляемым ключом: так Prisma знает тип. */
function imageData(kind: UniversityImageKind, url: string | null): Prisma.UniversityUpdateInput {
  return kind === 'logo' ? { logoUrl: url } : { coverUrl: url }
}

/**
 * Страница университета в стиле профиля: витрина вуза для своих, платформы и компаний с
 * действующим допуском. Поля страницы, логотип и обложку правит только админ своего вуза
 * (вуз — из токена); публикуют от имени вуза админ и модератор (контент — в модулях постов,
 * опросов и контента профиля).
 *
 * Картинки — raw-объекты публичного бакета profile-covers, как у обложки профиля и страницы
 * компании: без записи File, удаляются точечно по ключу, ссылку строит сервер.
 */
@Injectable()
export class UniversityPageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CareerAccessService,
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /**
   * Страница вуза глазами смотрящего. Чужим — `NOT_FOUND`, как несуществующему: перебор id
   * ничего не подтверждает. `canPublish` — смотрящий публикует от имени вуза (админ или
   * модератор), `canEdit` — правит саму страницу (админ).
   */
  async page(viewer: JwtPayload, universityId: string) {
    await this.access.assertCanViewUniversityPage(viewer, universityId)
    const university = await this.prisma.university.findUnique({
      where: { id: universityId },
      select: UNIVERSITY_PAGE_SELECT,
    })
    if (!university) throw new AppException('NOT_FOUND', 'Университет не найден')
    return {
      ...university,
      canPublish: isUniversityPageEditor(viewer, universityId),
      canEdit: this.isAdminOf(viewer, universityId),
    }
  }

  async update(viewer: JwtPayload, input: UpdateUniversityPageInput, ctx: RequestContext) {
    const universityId = this.ownUniversity(viewer)
    await this.prisma.university.update({ where: { id: universityId }, data: input })
    await this.record(viewer, universityId, 'university_page_updated', ctx)
    return this.page(viewer, universityId)
  }

  /** Новая картинка: сначала загрузка (тип и размер проверяет FileService), потом замена. */
  async setImage(
    viewer: JwtPayload,
    kind: UniversityImageKind,
    buffer: Buffer,
    ctx: RequestContext,
  ): Promise<{ url: string }> {
    const universityId = this.ownUniversity(viewer)
    const prev = await this.currentImage(universityId, kind)
    const key = await this.files.putAuxImage(this.bucket, buffer)
    const url = buildPublicObjectUrl(this.config, this.bucket, key)
    await this.prisma.university.update({
      where: { id: universityId },
      data: imageData(kind, url),
    })
    await this.removeOwnObject(prev)
    await this.record(viewer, universityId, `university_${kind}_updated`, ctx)
    return { url }
  }

  async removeImage(viewer: JwtPayload, kind: UniversityImageKind, ctx: RequestContext) {
    const universityId = this.ownUniversity(viewer)
    const prev = await this.currentImage(universityId, kind)
    await this.prisma.university.update({
      where: { id: universityId },
      data: imageData(kind, null),
    })
    await this.removeOwnObject(prev)
    await this.record(viewer, universityId, `university_${kind}_removed`, ctx)
  }

  private isAdminOf(viewer: JwtPayload, universityId: string): boolean {
    return viewer.role === Role.UNIVERSITY_ADMIN && viewer.universityId === universityId
  }

  /** Страницу правит админ своего вуза — вуз из токена, не из запроса. */
  private ownUniversity(viewer: JwtPayload): string {
    if (!viewer.universityId || !this.isAdminOf(viewer, viewer.universityId)) {
      throw new AppException('FORBIDDEN', 'Страницу университета меняет админ вуза')
    }
    return viewer.universityId
  }

  private async currentImage(
    universityId: string,
    kind: UniversityImageKind,
  ): Promise<string | null> {
    const row = await this.prisma.university.findUnique({
      where: { id: universityId },
      select: { logoUrl: true, coverUrl: true },
    })
    return (kind === 'logo' ? row?.logoUrl : row?.coverUrl) ?? null
  }

  /** Прежний объект — только если он в нашем бакете (ссылку строил сервер). */
  private async removeOwnObject(url: string | null): Promise<void> {
    const prefix = buildPublicObjectUrl(this.config, this.bucket, '')
    if (!url?.startsWith(prefix)) return
    const key = url.slice(prefix.length).split('?')[0]
    // Сбой удаления FileService глотает сам: новая картинка уже сохранена.
    if (key) await this.files.removeRawObject(this.bucket, key)
  }

  private async record(
    viewer: JwtPayload,
    universityId: string,
    action: string,
    ctx: RequestContext,
  ) {
    await this.audit.record({
      userId: viewer.sub,
      action,
      entity: 'University',
      entityId: universityId,
      ...ctx,
    })
  }

  private get bucket(): string {
    return this.config.get('MINIO_BUCKET_PROFILE_COVERS', { infer: true })
  }
}
