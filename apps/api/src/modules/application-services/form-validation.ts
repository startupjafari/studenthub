import type { Prisma } from '@prisma/client'

// Проверка ответов анкеты услуги по самой анкете (D-F15). Клиент получает поля вместе с
// `validation` (catalog.service), но до этого сервер сверял только «обязательно» и вариант
// из списка: тип значения, правила поля и состав ключей не проверялись, и в заявку можно
// было положить что угодно, лишь бы в рамках тела запроса.
//
// Клиенты кодируют значения по-разному, и все варианты законны: веб шлёт число и дату
// строкой из <input>, Android — числом и «ГГГГ-ММ-ДД», iOS — всё строками (дату — ISO с
// временем). Поэтому тип проверяется по смыслу, а не по JSON-типу.

export interface FormFieldRule {
  code: string
  type: string
  required: boolean
  options: Prisma.JsonValue | null
  validation: Prisma.JsonValue | null
  labelRu: string
}

/**
 * Правила поля (`ServiceFormField.validation`). Схемой не закреплены — пишутся сидом или
 * шаблоном платформы, — поэтому читаем только известные ключи и только верного типа:
 * кривое правило не должно ни ронять подачу, ни отключать остальные проверки.
 *
 * - `minLength` / `maxLength` — длина строкового ответа;
 * - `min` / `max` — границы числа (NUMBER) или даты «ГГГГ-ММ-ДД» (DATE);
 * - `pattern` — регулярное выражение для строкового ответа.
 */
interface FieldValidation {
  minLength?: number
  maxLength?: number
  min?: number | string
  max?: number | string
  pattern?: string
}

// Длинное выражение из данных — повод не исполнять его вовсе (защита от катастрофического
// перебора на вводе студента).
const PATTERN_MAX_LENGTH = 200
const NUMBER_RE = /^-?\d+(?:[.,]\d+)?$/
const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:$|T)/

/** Ответы только на поля анкеты: ключи, которых в анкете нет, отбрасываются. */
export function pickFormFields(
  fields: Pick<FormFieldRule, 'code'>[],
  formData: Prisma.JsonValue | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const data = asRecord(formData)
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(data, f.code)) out[f.code] = data[f.code]
  }
  return out
}

/** Первая ошибка анкеты (текст для ответа API) или null, если ответы корректны. */
export function formDataError(
  fields: FormFieldRule[],
  formData: Prisma.JsonValue | Record<string, unknown> | null | undefined,
): string | null {
  const data = asRecord(formData)
  for (const f of fields) {
    const value = data[f.code]
    const empty =
      value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
    if (empty) {
      if (f.required) return `Заполните поле: ${f.labelRu}`
      continue
    }
    if (!valueMatchesType(f, value) || !valueMatchesRules(f, value)) {
      return `Недопустимое значение поля: ${f.labelRu}`
    }
    // Обязательный флажок (CHECKBOX — «согласен», «подтверждаю») засчитывается только
    // отмеченным: снятый флажок — не ответ. Вопрос «да/нет» (BOOLEAN) принимает оба.
    if (f.required && f.type === 'CHECKBOX' && value !== true && value !== 'true') {
      return `Заполните поле: ${f.labelRu}`
    }
  }
  return null
}

function valueMatchesType(field: FormFieldRule, value: unknown): boolean {
  switch (field.type) {
    case 'NUMBER':
      return toNumber(value) !== null
    case 'DATE':
      return toDate(value) !== null
    case 'BOOLEAN':
    case 'CHECKBOX':
      return typeof value === 'boolean' || value === 'true' || value === 'false'
    case 'SELECT':
    case 'RADIO': {
      if (!Array.isArray(field.options)) return true
      const allowed = (field.options as Array<{ value?: unknown } | null>).map((o) => o?.value)
      return allowed.includes(value)
    }
    default:
      // TEXT / TEXTAREA и незнакомые типы: строка (число в текстовом поле — тоже ответ).
      return typeof value === 'string' || typeof value === 'number'
  }
}

function valueMatchesRules(field: FormFieldRule, value: unknown): boolean {
  const rules = readRules(field.validation)
  if (!rules) return true
  if (typeof value === 'string') {
    const length = value.trim().length
    if (rules.minLength !== undefined && length < rules.minLength) return false
    if (rules.maxLength !== undefined && length > rules.maxLength) return false
    if (rules.pattern !== undefined && !testPattern(rules.pattern, value)) return false
  }
  if (field.type === 'NUMBER') {
    const n = toNumber(value)
    if (n !== null) {
      if (typeof rules.min === 'number' && n < rules.min) return false
      if (typeof rules.max === 'number' && n > rules.max) return false
    }
  }
  if (field.type === 'DATE') {
    const d = toDate(value)
    if (d !== null) {
      // Даты «ГГГГ-ММ-ДД» сравниваются как строки — порядок совпадает с календарным.
      if (typeof rules.min === 'string' && DATE_RE.test(rules.min) && d < rules.min.slice(0, 10))
        return false
      if (typeof rules.max === 'string' && DATE_RE.test(rules.max) && d > rules.max.slice(0, 10))
        return false
    }
  }
  return true
}

function readRules(raw: Prisma.JsonValue | null): FieldValidation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const int = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined
  const bound = (v: unknown) =>
    (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string' ? v : undefined
  return {
    minLength: int(r.minLength),
    maxLength: int(r.maxLength),
    min: bound(r.min),
    max: bound(r.max),
    pattern:
      typeof r.pattern === 'string' && r.pattern.length <= PATTERN_MAX_LENGTH
        ? r.pattern
        : undefined,
  }
}

function testPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(value)
  } catch {
    // Кривое выражение в данных — ошибка настройки, а не студента: правило пропускаем.
    return true
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && NUMBER_RE.test(value.trim())) {
    return Number(value.trim().replace(',', '.'))
  }
  return null
}

/** Дата ответа как «ГГГГ-ММ-ДД» или null. Время (iOS шлёт ISO целиком) отбрасывается. */
function toDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = DATE_RE.exec(value.trim())
  if (!match?.[1]) return null
  const day = match[1]
  const parsed = new Date(`${day}T00:00:00Z`)
  // 2026-02-31 Date «исправит» на 3 марта — такая дата недопустима.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null
}

function asRecord(
  formData: Prisma.JsonValue | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return formData && typeof formData === 'object' && !Array.isArray(formData)
    ? (formData as Record<string, unknown>)
    : {}
}
