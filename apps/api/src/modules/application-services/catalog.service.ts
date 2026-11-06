import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { visibleServicesWhere } from './service-visibility'

// Каталог услуг: категории + услуги, видимые зрителю (глобальные шаблоны + услуги его вуза;
// шаблон, который вуз настроил под себя, заменяется его копией).
// Локализованные поля отдаются как есть (nameRu/Kk/En) — фронт выбирает по локали.

// Каталог услуг — справочник вуза (BACKEND_RULES §7.2: потолок обязателен и здесь).
const CATEGORIES_LIMIT = 100
// Услуг в одной категории у вуза — десятки; потолок вложенной выборки с запасом.
const SERVICES_PER_CATEGORY_LIMIT = 200
// Требований и полей анкеты у услуги — единицы (редактор принимает до 30 и 40).
const SERVICE_ITEMS_LIMIT = 100

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

  /** Категории (активные) с вложенными видимыми услугами — для экрана выбора услуги. */
  async listCategories(viewer: JwtPayload) {
    // Глобальный шаблон видно, пока вуз зрителя не завёл свою копию (service-visibility.ts).
    const visible = await visibleServicesWhere(this.prisma, viewer.universityId)
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
          where: visible,
          orderBy: { sortOrder: 'asc' },
          take: SERVICES_PER_CATEGORY_LIMIT,
          select: SERVICE_CARD_SELECT,
        },
      },
    })
    // Пустые категории (без доступных услуг) не показываем.
    return categories.filter((c) => c.services.length > 0)
  }

  /** Детали услуги: описание, требования-документы (чек-лист) и поля формы. */
  async getService(id: string, viewer: JwtPayload) {
    const visible = await visibleServicesWhere(this.prisma, viewer.universityId)
    const service = await this.prisma.applicationService.findFirst({
      where: { AND: [{ id }, visible] },
      select: {
        ...SERVICE_CARD_SELECT,
        instructionsRu: true,
        instructionsKk: true,
        instructionsEn: true,
        requirements: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          take: SERVICE_ITEMS_LIMIT,
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
          take: SERVICE_ITEMS_LIMIT,
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
