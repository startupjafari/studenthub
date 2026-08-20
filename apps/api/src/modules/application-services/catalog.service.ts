import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Каталог услуг: категории + услуги, видимые зрителю (глобальные шаблоны + услуги его вуза).
// Локализованные поля отдаются как есть (nameRu/Kk/En) — фронт выбирает по локали.

// Каталог услуг — справочник вуза (BACKEND_RULES §7.2: потолок обязателен и здесь).
const CATEGORIES_LIMIT = 100

const SERVICE_CARD_SELECT = {
  id: true,
  categoryId: true,
  code: true,
  nameRu: true,
  nameKk: true,
  nameEn: true,
  descriptionRu: true,
  descriptionKk: true,
  descriptionEn: true,
  slaHours: true,
  deliveryModes: true,
  requiresPickup: true,
  processingMode: true,
} satisfies Prisma.ApplicationServiceSelect

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // Услуга видна, если это глобальный шаблон (universityId=null) или услуга вуза зрителя.
  private visibilityWhere(viewer: JwtPayload): Prisma.ApplicationServiceWhereInput {
    const OR: Prisma.ApplicationServiceWhereInput[] = [{ universityId: null }]
    if (viewer.universityId) OR.push({ universityId: viewer.universityId })
    return { active: true, OR }
  }

  /** Категории (активные) с вложенными видимыми услугами — для экрана выбора услуги. */
  async listCategories(viewer: JwtPayload) {
    const categories = await this.prisma.applicationCategory.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      take: CATEGORIES_LIMIT,
      select: {
        id: true,
        code: true,
        nameRu: true,
        nameKk: true,
        nameEn: true,
        description: true,
        icon: true,
        services: {
          where: this.visibilityWhere(viewer),
          orderBy: { sortOrder: 'asc' },
          select: SERVICE_CARD_SELECT,
        },
      },
    })
    // Пустые категории (без доступных услуг) не показываем.
    return categories.filter((c) => c.services.length > 0)
  }

  /** Детали услуги: описание, требования-документы (чек-лист) и поля формы. */
  async getService(id: string, viewer: JwtPayload) {
    const service = await this.prisma.applicationService.findFirst({
      where: { id, ...this.visibilityWhere(viewer) },
      select: {
        ...SERVICE_CARD_SELECT,
        instructionsRu: true,
        instructionsKk: true,
        instructionsEn: true,
        requirements: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            code: true,
            documentType: true,
            titleRu: true,
            titleKk: true,
            titleEn: true,
            description: true,
            required: true,
            allowStorage: true,
            allowUpload: true,
            maxFiles: true,
          },
        },
        formFields: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            code: true,
            type: true,
            labelRu: true,
            labelKk: true,
            labelEn: true,
            placeholderRu: true,
            placeholderKk: true,
            placeholderEn: true,
            required: true,
            options: true,
            validation: true,
          },
        },
      },
    })
    if (!service) {
      throw new AppException('NOT_FOUND', 'Услуга не найдена')
    }
    return service
  }
}
