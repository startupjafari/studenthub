import { Injectable } from '@nestjs/common'
import { DOCUMENT_TYPES, documentTypeDef } from '@studenthub/shared-config'
import type {
  CreateCustomDocumentTypeInput,
  UpdateDocumentTypeInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Переопределений типов не больше, чем типов в каталоге плюс собственные (BACKEND_RULES §7.2).
const DOCUMENT_TYPE_OVERRIDES_LIMIT = 200

// Набор полей по умолчанию для custom-типа, если вуз не указал свой.
const DEFAULT_CUSTOM_FIELDS = ['comment']

export interface EffectiveDocumentType {
  typeId: string
  category: string
  fields: string[]
  custom: boolean
  enabled: boolean
  retentionDays: number | null
  label: string | null // задан только у custom-типов (у статических берётся из i18n на фронте)
}

/**
 * Гибридный каталог типов документов (задача 15.20): статические 25 типов из shared-config
 * + правки/добавления вуза из таблицы document_types. Валидацию типов при создании документа
 * и запроса ведёт этот сервис (учитывает enabled и custom-типы). Управляет — только админ вуза.
 */
@Injectable()
export class DocumentTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertAdmin(actor: JwtPayload): string {
    if (!actor.universityId) {
      throw new AppException('FORBIDDEN', 'Нет привязки к университету')
    }
    return actor.universityId
  }

  /** Эффективный каталог типов для вуза: merge(static, overrides). */
  async effective(universityId: string | null): Promise<EffectiveDocumentType[]> {
    const overrides = universityId
      ? await this.prisma.documentType.findMany({
          where: { universityId },
          take: DOCUMENT_TYPE_OVERRIDES_LIMIT,
        })
      : []
    const byType = new Map(overrides.map((o) => [o.typeId, o]))

    const staticTypes: EffectiveDocumentType[] = DOCUMENT_TYPES.map((d) => {
      const o = byType.get(d.id)
      return {
        typeId: d.id,
        category: d.category,
        fields: d.fields,
        custom: false,
        enabled: o?.enabled ?? true,
        retentionDays: o?.retentionDays ?? null,
        label: null,
      }
    })

    const customTypes: EffectiveDocumentType[] = overrides
      .filter((o) => o.custom)
      .map((o) => ({
        typeId: o.typeId,
        category: o.category ?? 'PERSONAL',
        fields: o.fields.length > 0 ? o.fields : DEFAULT_CUSTOM_FIELDS,
        custom: true,
        enabled: o.enabled,
        retentionDays: o.retentionDays,
        label: o.label,
      }))

    return [...staticTypes, ...customTypes]
  }

  /** Тип пригоден для создания документа/запроса: существует в вузе и включён. Вернёт его категорию. */
  async resolveUsable(universityId: string | null, typeId: string): Promise<string> {
    const catalog = await this.effective(universityId)
    const def = catalog.find((t) => t.typeId === typeId)
    if (!def) throw new AppException('BAD_REQUEST', `Неизвестный тип документа: ${typeId}`)
    if (!def.enabled) throw new AppException('BAD_REQUEST', `Тип документа отключён: ${typeId}`)
    return def.category
  }

  /** Срок хранения (дни) для типа в вузе, если задан. */
  async retentionDays(universityId: string | null, typeId: string): Promise<number | null> {
    if (!universityId) return null
    const o = await this.prisma.documentType.findUnique({
      where: { universityId_typeId: { universityId, typeId } },
      select: { retentionDays: true },
    })
    return o?.retentionDays ?? null
  }

  // ── Админ вуза ────────────────────────────────────────────────────────────

  async list(actor: JwtPayload): Promise<EffectiveDocumentType[]> {
    return this.effective(this.assertAdmin(actor))
  }

  /** Правка статического типа: включить/выключить + срок хранения. */
  async updateType(
    actor: JwtPayload,
    typeId: string,
    input: UpdateDocumentTypeInput,
  ): Promise<EffectiveDocumentType[]> {
    const universityId = this.assertAdmin(actor)
    if (!documentTypeDef(typeId)) {
      // Не статический — возможно custom этого вуза; иначе ошибка.
      const existing = await this.prisma.documentType.findUnique({
        where: { universityId_typeId: { universityId, typeId } },
        select: { id: true },
      })
      if (!existing) throw new AppException('NOT_FOUND', 'Тип не найден')
    }
    await this.prisma.documentType.upsert({
      where: { universityId_typeId: { universityId, typeId } },
      create: {
        universityId,
        typeId,
        custom: false,
        enabled: input.enabled ?? true,
        retentionDays: input.retentionDays ?? null,
      },
      update: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
      },
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'DOCUMENT_TYPE_UPDATE',
      entity: 'DocumentType',
      entityId: typeId,
      metadata: { universityId, ...input },
    })
    return this.effective(universityId)
  }

  /** Добавить собственный тип вуза. */
  async addCustom(
    actor: JwtPayload,
    input: CreateCustomDocumentTypeInput,
  ): Promise<EffectiveDocumentType[]> {
    const universityId = this.assertAdmin(actor)
    if (documentTypeDef(input.code)) {
      throw new AppException('BAD_REQUEST', 'Код совпадает со стандартным типом')
    }
    const existing = await this.prisma.documentType.findUnique({
      where: { universityId_typeId: { universityId, typeId: input.code } },
      select: { id: true },
    })
    if (existing) throw new AppException('CONFLICT', 'Тип с таким кодом уже есть')
    await this.prisma.documentType.create({
      data: {
        universityId,
        typeId: input.code,
        custom: true,
        enabled: true,
        category: input.category,
        label: input.label,
        fields: input.fields ?? [],
        retentionDays: input.retentionDays ?? null,
      },
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'DOCUMENT_TYPE_CREATE',
      entity: 'DocumentType',
      entityId: input.code,
      metadata: { universityId, category: input.category, label: input.label },
    })
    return this.effective(universityId)
  }

  /** Удалить настройку типа: для custom — удаляет тип; для статического — сбрасывает к дефолту. */
  async remove(actor: JwtPayload, typeId: string): Promise<EffectiveDocumentType[]> {
    const universityId = this.assertAdmin(actor)
    await this.prisma.documentType.deleteMany({ where: { universityId, typeId } })
    await this.audit.record({
      userId: actor.sub,
      action: 'DOCUMENT_TYPE_DELETE',
      entity: 'DocumentType',
      entityId: typeId,
      metadata: { universityId },
    })
    return this.effective(universityId)
  }
}
