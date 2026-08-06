// Справочник модуля «Документы» (Ф15, задача 15.4): категории, типы, статусы и то,
// какие поля показывать в мастере для каждого типа. Единый источник для API и форм.
// На MVP — статический справочник; управление типами из БД добавит задача 15.20.

export const DOCUMENT_CATEGORIES = [
  'PERSONAL',
  'ACADEMIC',
  'CERTIFICATE',
  'ISSUED_BY_UNIVERSITY',
] as const
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]

// Полный набор статусов документа (ТЗ §6). REJECTED/NEEDS_REPLACEMENT требуют причину.
export const DOCUMENT_STATUSES = [
  'DRAFT',
  'UPLOADED',
  'IN_REVIEW',
  'VERIFIED',
  'ACCEPTED',
  'REJECTED',
  'NEEDS_REPLACEMENT',
  'EXPIRING',
  'EXPIRED',
  'ARCHIVED',
] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

// Кому можно выдать доступ к документу (ТЗ §9).
export const DOCUMENT_GRANTEE_TYPES = ['UNIVERSITY', 'DEPARTMENT', 'USER'] as const
export type DocumentGranteeType = (typeof DOCUMENT_GRANTEE_TYPES)[number]

// Поля мастера (шаг 3). title обязателен всегда; остальные — по типу документа.
export const DOCUMENT_FIELDS = ['number', 'issuedAt', 'expiresAt', 'issuedBy', 'comment'] as const
export type DocumentField = (typeof DOCUMENT_FIELDS)[number]

export interface DocumentTypeDef {
  id: string
  category: DocumentCategory
  fields: DocumentField[]
}

// Часто используемые наборы полей.
const ID_FIELDS: DocumentField[] = ['number', 'issuedAt', 'expiresAt', 'issuedBy', 'comment']
const CERT_FIELDS: DocumentField[] = ['number', 'issuedAt', 'issuedBy', 'comment']
const EXPIRING_FIELDS: DocumentField[] = ['issuedAt', 'expiresAt', 'issuedBy', 'comment']
const SIMPLE_FIELDS: DocumentField[] = ['comment']

// Полный каталог типов (ТЗ §4). id — стабильный ключ (в БД Document.type / RequestItem.docType).
export const DOCUMENT_TYPES = [
  // Личные
  { id: 'ID_CARD', category: 'PERSONAL', fields: ID_FIELDS },
  { id: 'PASSPORT', category: 'PERSONAL', fields: ID_FIELDS },
  { id: 'BIRTH_CERTIFICATE', category: 'PERSONAL', fields: CERT_FIELDS },
  { id: 'PHOTO_3X4', category: 'PERSONAL', fields: SIMPLE_FIELDS },
  { id: 'NAME_CHANGE', category: 'PERSONAL', fields: CERT_FIELDS },
  { id: 'LEGAL_GUARDIAN', category: 'PERSONAL', fields: CERT_FIELDS },
  // Учебные
  { id: 'SCHOOL_CERTIFICATE', category: 'ACADEMIC', fields: CERT_FIELDS },
  { id: 'DIPLOMA', category: 'ACADEMIC', fields: CERT_FIELDS },
  { id: 'DIPLOMA_SUPPLEMENT', category: 'ACADEMIC', fields: CERT_FIELDS },
  { id: 'TRANSCRIPT', category: 'ACADEMIC', fields: CERT_FIELDS },
  { id: 'CERTIFICATES', category: 'ACADEMIC', fields: CERT_FIELDS },
  { id: 'ACADEMIC_REFERENCE', category: 'ACADEMIC', fields: EXPIRING_FIELDS },
  { id: 'TRANSFER_DOCS', category: 'ACADEMIC', fields: CERT_FIELDS },
  // Справки
  { id: 'MEDICAL', category: 'CERTIFICATE', fields: EXPIRING_FIELDS },
  { id: 'STUDY_PLACE', category: 'CERTIFICATE', fields: EXPIRING_FIELDS },
  { id: 'DORMITORY_DOCS', category: 'CERTIFICATE', fields: CERT_FIELDS },
  { id: 'MILITARY_DOCS', category: 'CERTIFICATE', fields: CERT_FIELDS },
  { id: 'SOCIAL_REFERENCE', category: 'CERTIFICATE', fields: EXPIRING_FIELDS },
  { id: 'BENEFITS_DOCS', category: 'CERTIFICATE', fields: EXPIRING_FIELDS },
  // Выданные университетом
  { id: 'STUDY_CONTRACT', category: 'ISSUED_BY_UNIVERSITY', fields: CERT_FIELDS },
  { id: 'ENROLLMENT_ORDER', category: 'ISSUED_BY_UNIVERSITY', fields: CERT_FIELDS },
  { id: 'STUDENT_ID', category: 'ISSUED_BY_UNIVERSITY', fields: ID_FIELDS },
  { id: 'CAMPUS_PASS', category: 'ISSUED_BY_UNIVERSITY', fields: EXPIRING_FIELDS },
  { id: 'STUDY_PLACE_REF', category: 'ISSUED_BY_UNIVERSITY', fields: EXPIRING_FIELDS },
  { id: 'TRANSCRIPT_ISSUED', category: 'ISSUED_BY_UNIVERSITY', fields: CERT_FIELDS },
] as const satisfies readonly DocumentTypeDef[]

// Идентификаторы типов — литеральный кортеж для z.enum в shared-schemas.
export const DOCUMENT_TYPE_IDS = [
  'ID_CARD',
  'PASSPORT',
  'BIRTH_CERTIFICATE',
  'PHOTO_3X4',
  'NAME_CHANGE',
  'LEGAL_GUARDIAN',
  'SCHOOL_CERTIFICATE',
  'DIPLOMA',
  'DIPLOMA_SUPPLEMENT',
  'TRANSCRIPT',
  'CERTIFICATES',
  'ACADEMIC_REFERENCE',
  'TRANSFER_DOCS',
  'MEDICAL',
  'STUDY_PLACE',
  'DORMITORY_DOCS',
  'MILITARY_DOCS',
  'SOCIAL_REFERENCE',
  'BENEFITS_DOCS',
  'STUDY_CONTRACT',
  'ENROLLMENT_ORDER',
  'STUDENT_ID',
  'CAMPUS_PASS',
  'STUDY_PLACE_REF',
  'TRANSCRIPT_ISSUED',
] as const
export type DocumentTypeId = (typeof DOCUMENT_TYPE_IDS)[number]

// Быстрый доступ к определению типа по id.
export function documentTypeDef(id: string): DocumentTypeDef | undefined {
  return DOCUMENT_TYPES.find((t) => t.id === id)
}
