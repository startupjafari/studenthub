import {
  DOCUMENT_TEMPLATE_CODE_LABELS,
  documentTemplateVariable,
  type DocumentTemplateLocale,
  type DocumentTemplateVariableKey,
} from '@studenthub/shared-config'
import type { TemplateValues } from './docx-template-engine'

/**
 * Значения переменных из данных StudentHub (docs/PROJECT.md §3.8 «Шаблоны»).
 *
 * На вход — уже выбранные модулями-владельцами поля (UserService, UniversityService), на
 * выход — плоская Map «ключ реестра → строка». Целые ORM-строки в шаблонизатор не уходят:
 * Map строится явно по реестру, лишнему полю взяться неоткуда.
 *
 * Пустое значение — `null`, а не пустая строка: решение «формировать ли документ с
 * пустым местом» принимает `missingVariables`, а не случайность форматирования.
 */

/** Человек, о ком документ, или кто его формирует — поля из UserService. */
export interface TemplatePerson {
  lastName: string
  firstName: string
  middleName: string | null
  birthDate: Date | null
  studentCardNumber: string | null
  course: number | null
  specialty: string | null
  studyForm: string | null
  educationLevel: string | null
  fundingType: string | null
  enrollmentYear: number | null
  graduationYear: number | null
  position: string | null
  groupName: string | null
  facultyName: string | null
}

/** Реквизиты вуза — поля из UniversityService. */
export interface TemplateUniversity {
  name: string
  shortName: string | null
  city: string | null
  address: string | null
  contactPhone: string | null
  contactEmail: string | null
  website: string | null
  timezone: string
}

export interface TemplateSources {
  student: TemplatePerson
  university: TemplateUniversity
  issuer: Pick<TemplatePerson, 'lastName' | 'firstName' | 'middleName' | 'position'>
  locale: DocumentTemplateLocale
  now: Date
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function num(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value)
}

function fullName(p: Pick<TemplatePerson, 'lastName' | 'firstName' | 'middleName'>): string | null {
  // Отчество есть не у всех — склеиваем заполненное без двойных пробелов (как в справке B7).
  return text([p.lastName, p.firstName, p.middleName].map(text).filter(Boolean).join(' '))
}

/** Код (`FULL_TIME`) — в подпись на языке документа; готовое слово («Очная») — как есть. */
function codeLabel(value: string | null, locale: DocumentTemplateLocale): string | null {
  const raw = text(value)
  if (!raw) return null
  return DOCUMENT_TEMPLATE_CODE_LABELS[locale][raw] ?? raw
}

/** Дата `ДД.ММ.ГГГГ` в заданном поясе. */
function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/**
 * Значения всех переменных реестра. Тип `Record<ключ, …>` заставляет компилятор требовать
 * значение для каждого ключа: добавил переменную в реестр — обязан сказать, откуда она.
 */
export function buildTemplateValues(src: TemplateSources): TemplateValues {
  const { student, university, issuer, locale, now } = src
  const values: Record<DocumentTemplateVariableKey, string | null> = {
    'student.fullName': fullName(student),
    'student.lastName': text(student.lastName),
    'student.firstName': text(student.firstName),
    'student.middleName': text(student.middleName),
    // Дата рождения хранится датой без времени (полночь UTC) — форматируем в UTC, иначе
    // в поясе западнее Гринвича она сдвинулась бы на день назад.
    'student.birthDate': student.birthDate ? formatDate(student.birthDate, 'UTC') : null,
    'student.studentCardNumber': text(student.studentCardNumber),
    'student.group': text(student.groupName),
    'student.course': num(student.course),
    'student.faculty': text(student.facultyName),
    'student.specialty': text(student.specialty),
    'student.studyForm': codeLabel(student.studyForm, locale),
    'student.educationLevel': codeLabel(student.educationLevel, locale),
    'student.fundingType': codeLabel(student.fundingType, locale),
    'student.enrollmentYear': num(student.enrollmentYear),
    'student.graduationYear': num(student.graduationYear),
    'university.name': text(university.name),
    'university.shortName': text(university.shortName),
    'university.city': text(university.city),
    'university.address': text(university.address),
    'university.phone': text(university.contactPhone),
    'university.email': text(university.contactEmail),
    'university.website': text(university.website),
    // Дата документа — по месту учёбы, а не по поясу сервера.
    'document.date': formatDate(now, university.timezone),
    'document.year': formatDate(now, university.timezone).slice(-4),
    'issuer.fullName': fullName(issuer),
    'issuer.position': text(issuer.position),
  }
  return new Map(Object.entries(values))
}

/**
 * Переменные шаблона, для которых нет значения. Политика по умолчанию (§9 ТЗ): документ
 * с пустым местом не формируется. Исключение — поля, законно бывающие пустыми (`optional`
 * в реестре): у них пустота подставляется пустой строкой.
 */
export function missingVariables(used: readonly string[], values: TemplateValues): string[] {
  return used.filter((key) => {
    if (documentTemplateVariable(key)?.optional) return false
    const value = values.get(key)
    return value === null || value === undefined || value === ''
  })
}

/** Значения, готовые к рендеру: пустые необязательные — пустая строка. */
export function withOptionalBlanks(
  used: readonly string[],
  values: TemplateValues,
): TemplateValues {
  const out = new Map(values)
  for (const key of used) {
    if (documentTemplateVariable(key)?.optional && !out.get(key)) out.set(key, '')
  }
  return out
}
