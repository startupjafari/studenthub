import type { z } from 'zod'
import type {
  ServiceFormFieldInputSchema,
  ServiceRequirementInputSchema,
  UpsertApplicationServiceSchema,
} from '@studenthub/shared-schemas'
import type { ManagedServiceDetail } from '../../../entities/application-service'

// Значения формы — вход схемы (до default/refine), как их держит React Hook Form.
export type ServiceFormValues = z.input<typeof UpsertApplicationServiceSchema>
export type RequirementFormValues = z.input<typeof ServiceRequirementInputSchema>
export type FormFieldFormValues = z.input<typeof ServiceFormFieldInputSchema>

export const LANGS = ['Ru', 'Kk', 'En'] as const
export type Lang = (typeof LANGS)[number]

// Код строки требования/поля — служебный ключ синхронизации (по нему сервер узнаёт строку
// при сохранении). Админу его видеть незачем, поэтому новые строки получают его сами.
export function newItemCode(prefix: 'doc' | 'field'): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function emptyRequirement(): RequirementFormValues {
  return {
    code: newItemCode('doc'),
    documentType: null,
    titleRu: '',
    titleKk: '',
    titleEn: '',
    description: null,
    required: true,
    allowStorage: true,
    allowUpload: true,
    maxFiles: 1,
  }
}

export function emptyFormField(): FormFieldFormValues {
  return {
    code: newItemCode('field'),
    type: 'TEXT',
    labelRu: '',
    labelKk: '',
    labelEn: '',
    placeholderRu: null,
    placeholderKk: null,
    placeholderEn: null,
    required: false,
    options: null,
  }
}

export function emptyService(categoryId = ''): ServiceFormValues {
  return {
    categoryId,
    code: '',
    nameRu: '',
    nameKk: '',
    nameEn: '',
    descriptionRu: null,
    descriptionKk: null,
    descriptionEn: null,
    instructionsRu: null,
    instructionsKk: null,
    instructionsEn: null,
    slaHours: 24,
    deliveryModes: ['ELECTRONIC'],
    requiresPickup: false,
    facultyScoped: true,
    active: true,
    sortOrder: 0,
    requirements: [],
    formFields: [],
  }
}

export function toFormValues(detail: ManagedServiceDetail): ServiceFormValues {
  return {
    categoryId: detail.categoryId,
    code: detail.code,
    nameRu: detail.nameRu,
    nameKk: detail.nameKk,
    nameEn: detail.nameEn,
    descriptionRu: detail.descriptionRu,
    descriptionKk: detail.descriptionKk,
    descriptionEn: detail.descriptionEn,
    instructionsRu: detail.instructionsRu,
    instructionsKk: detail.instructionsKk,
    instructionsEn: detail.instructionsEn,
    slaHours: detail.slaHours,
    deliveryModes: detail.deliveryModes,
    requiresPickup: detail.requiresPickup,
    facultyScoped: detail.facultyScoped,
    active: detail.active,
    sortOrder: detail.sortOrder,
    requirements: detail.requirements,
    formFields: detail.formFields.map((f) => ({
      ...f,
      // У старых вариантов перевода могло не быть — подставляем значение, чтобы форма прошла.
      options:
        f.options?.map((o) => ({
          value: o.value,
          labelRu: o.labelRu ?? o.value,
          labelKk: o.labelKk ?? o.value,
          labelEn: o.labelEn ?? o.value,
        })) ?? null,
    })),
  }
}

/**
 * На каких языках в форме есть ошибки. Поля разных языков показываются по одному языку за
 * раз, и без такой подсказки ошибка в скрытом казахском поле выглядела бы как «кнопка
 * сохранения не работает».
 */
export function langsWithErrors(errors: unknown): Set<Lang> {
  const found = new Set<Lang>()
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'ref') continue
      for (const lang of LANGS) if (key.endsWith(lang)) found.add(lang)
      walk(value)
    }
  }
  walk(errors)
  return found
}
