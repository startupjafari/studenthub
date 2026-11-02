import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { buildPublicObjectUrl } from '../../common/minio/public-url'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import type { RequestContext } from '../auth/auth.service'
import { FileService } from '../files/file.service'
import { CareerAccessService, isCompanyMember } from './career-access.service'

/**
 * Витрина компании: то, что видит студент на её странице. Без платформенного статуса,
 * причины блокировки и состава сотрудников — это служебное, оно в карточке `GET me`.
 */
export const COMPANY_PAGE_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  website: true,
  city: true,
  logoUrl: true,
  coverUrl: true,
  industry: true,
  size: true,
  foundedYear: true,
  contactEmail: true,
  contactPhone: true,
  address: true,
  telegram: true,
  instagram: true,
  linkedin: true,
  createdAt: true,
} satisfies Prisma.CompanySelect

/** Какую картинку компании меняем: логотип (аватар страницы) или обложку. */
export type CompanyImageKind = 'logo' | 'cover'

/** Поле картинки — явными ветками, а не вычисляемым ключом: так Prisma знает тип. */
function imageData(kind: CompanyImageKind, url: string | null): Prisma.CompanyUpdateInput {
  return kind === 'logo' ? { logoUrl: url } : { coverUrl: url }
}

/**
 * Страница компании (профиль в стиле профиля пользователя): чтение по id для вузов с
 * допуском и картинки — логотип и обложка.
 *
 * Картинки — raw-объектами в публичном бакете profile-covers, как обложка профиля
 * пользователя (UserService.setCover): без записи File, удаляются точечно по ключу. Ссылка
 * строится сервером — свободной строки (`logoUrl` в теле правки) больше нет, иначе студент
 * грузил бы картинку с чужого сервера.
 */
@Injectable()
export class CompanyPageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CareerAccessService,
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /**
   * Страница компании глазами смотрящего: сотрудник, платформа или вуз с действующим
   * допуском. Остальным — `NOT_FOUND`, как несуществующей: перебор id ничего не подтверждает.
   * `isMember` — смотрящий её сотрудник (веб показывает кнопки создания контента).
   */
  async page(viewer: JwtPayload, companyId: string) {
    await this.access.assertCanViewCompany(viewer, companyId)
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: COMPANY_PAGE_SELECT,
    })
    if (!company) throw new AppException('NOT_FOUND', 'Компания не найдена')
    return { ...company, isMember: isCompanyMember(viewer, companyId) }
  }

  /** Новая картинка: сначала загрузка (тип и размер проверяет FileService), потом замена. */
  async setImage(
    viewer: JwtPayload,
    kind: CompanyImageKind,
    buffer: Buffer,
    ctx: RequestContext,
  ): Promise<{ url: string }> {
    const companyId = await this.ownedCompany(viewer)
    const prev = await this.currentImage(companyId, kind)
    const key = await this.files.putAuxImage(this.bucket, buffer)
    const url = buildPublicObjectUrl(this.config, this.bucket, key)
    await this.prisma.company.update({ where: { id: companyId }, data: imageData(kind, url) })
    await this.removeOwnObject(prev)
    await this.record(viewer, companyId, `company_${kind}_updated`, ctx)
    return { url }
  }

  async removeImage(viewer: JwtPayload, kind: CompanyImageKind, ctx: RequestContext) {
    const companyId = await this.ownedCompany(viewer)
    const prev = await this.currentImage(companyId, kind)
    await this.prisma.company.update({ where: { id: companyId }, data: imageData(kind, null) })
    await this.removeOwnObject(prev)
    await this.record(viewer, companyId, `company_${kind}_removed`, ctx)
  }

  private async currentImage(companyId: string, kind: CompanyImageKind): Promise<string | null> {
    const row = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { logoUrl: true, coverUrl: true },
    })
    return (kind === 'logo' ? row?.logoUrl : row?.coverUrl) ?? null
  }

  /** Картинки компании меняет только владелец — как и остальной профиль (assertOwner). */
  private async ownedCompany(viewer: JwtPayload): Promise<string> {
    const companyId = this.access.requireCompany(viewer)
    const member = await this.prisma.companyMember.findUnique({
      where: { userId: viewer.sub },
      select: { companyId: true, role: true },
    })
    if (!member || member.companyId !== companyId || member.role !== 'OWNER') {
      throw new AppException('FORBIDDEN', 'Действие доступно владельцу компании')
    }
    return companyId
  }

  /**
   * Прежний объект — только если он наш: у компаний, заведённых до этой правки, в logoUrl
   * может лежать любая строка, и удалять по ней объект из бакета нельзя.
   */
  private async removeOwnObject(url: string | null): Promise<void> {
    const prefix = buildPublicObjectUrl(this.config, this.bucket, '')
    if (!url?.startsWith(prefix)) return
    const key = url.slice(prefix.length).split('?')[0]
    // Сбой удаления FileService глотает сам: новая картинка уже сохранена, сирота в бакете
    // хуже не делает.
    if (key) await this.files.removeRawObject(this.bucket, key)
  }

  private async record(viewer: JwtPayload, companyId: string, action: string, ctx: RequestContext) {
    await this.audit.record({
      userId: viewer.sub,
      action,
      entity: 'Company',
      entityId: companyId,
      ...ctx,
    })
  }

  private get bucket(): string {
    return this.config.get('MINIO_BUCKET_PROFILE_COVERS', { infer: true })
  }
}
