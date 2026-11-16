import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import InspectModule from 'docxtemplater/js/inspect-module.js'
import {
  DOCUMENT_TEMPLATE_LIMITS,
  DOCUMENT_TEMPLATE_VARIABLES,
  documentTemplateVariable,
} from '@studenthub/shared-config'
import type { DocumentTemplateIssue, DocumentTemplateValidation } from '@studenthub/shared-schemas'

/**
 * Разбор и заполнение DOCX-шаблона через docxtemplater (docs/PROJECT.md §3.8 «Шаблоны»).
 *
 * Безопасность подстановки держится на собственном парсере тегов: тег — это ТОЛЬКО ключ
 * реестра (`student.fullName`), значение берётся из плоской Map, заранее собранной сервером.
 * Нет ни вычислителя выражений (angular-expressions и подобного), ни обхода объектов по
 * точкам — в шаблон физически не может попасть ничего, кроме того, что сервис положил в Map.
 * ORM-модели, служебные поля и секреты сюда не передаются вовсе.
 *
 * MVP — только простые поля. Циклы `{#…}`, условия `{^…}`, вставка XML `{@…}` и прочие
 * модули docxtemplater находит сам; такие теги проверка помечает как неподдерживаемые.
 *
 * Перед этим модулем файл уже прошёл `inspectDocxArchive`: архив цел, не бомба, без макросов.
 */

/** Тег, найденный в документе. */
interface FoundTag {
  value: string
  /** Модуль docxtemplater (loop, rawxml…); у простого поля его нет. */
  module?: string
  part: DocumentTemplateIssue['part']
}

/** docxtemplater при ошибках шаблона бросает объект с `properties`. */
interface TemplateErrorLike {
  properties?: {
    id?: string
    xtag?: string
    file?: string
    errors?: TemplateErrorLike[]
  }
}

/** Ошибки разбора, относящиеся к неподдерживаемым конструкциям, а не к скобкам. */
const UNSUPPORTED_ERROR = /loop|raw|module|section/i

const OPTIONS = {
  // Перенос строки в значении (адрес в две строки) — перенос строки в Word, а не пробел.
  linebreaks: true,
  paragraphLoop: true,
  // Сама библиотека по умолчанию печатает ошибки шаблона в console — нам это не нужно:
  // разбор ошибки и запись в лог (без содержимого документа) делает сервис.
  errorLogging: false,
  // Управляющие символы в данных профиля (вставка из другой программы) сломали бы XML
  // документа — Word отказался бы его открывать.
  stripInvalidXMLChars: true,
} as const

/** Значение для подстановки или отсутствие такового — решает политика пустых значений. */
export type TemplateValues = ReadonlyMap<string, string | null>

/** Внутренняя ошибка: шаблон с ошибками дошёл до генерации. Сервис превращает её в 422. */
export class TemplateNotRenderable extends Error {
  constructor(readonly validation: DocumentTemplateValidation) {
    super('Шаблон не прошёл проверку')
    this.name = 'TemplateNotRenderable'
  }
}

/** Пустое значение обязательного поля дошло до рендера — сервис обязан был отказать раньше. */
export class TemplateValueMissing extends Error {
  constructor(readonly key: string) {
    super(`Нет значения переменной ${key}`)
    this.name = 'TemplateValueMissing'
  }
}

function partOf(file: string | undefined): DocumentTemplateIssue['part'] {
  if (!file || file === 'word/document.xml') return 'body'
  if (/word\/header\d*\.xml$/.test(file)) return 'header'
  if (/word\/footer\d*\.xml$/.test(file)) return 'footer'
  return 'other'
}

/**
 * Парсер тега для docxtemplater. Ключ берётся как есть (с обрезкой пробелов: Word охотно
 * вставляет их у скобок), значение — из Map. Ничего не вычисляется.
 */
function registryParser(values: TemplateValues) {
  return (tag: string) => {
    const key = tag.trim()
    return {
      get: (): string | undefined => {
        const value = values.get(key)
        return value === null || value === undefined ? undefined : value
      },
    }
  }
}

function compile(buffer: Buffer, values: TemplateValues) {
  // Модуль экспортирован фабрикой; `new` над ней возвращает тот же объект, что и вызов,
  // а типы пакета описывают его классом.
  const inspect = new InspectModule()
  const zip = new PizZip(buffer, { checkCRC32: true })
  const doc = new Docxtemplater(zip, {
    ...OPTIONS,
    modules: [inspect],
    parser: registryParser(values),
    // Страховка: сервис проверяет пустые значения до рендера (политика §9), сюда пустое
    // значение дойти не должно. Если дошло — документ не формируется, а не печатается с
    // «undefined» или пустым местом.
    nullGetter: (part: { value?: string }) => {
      throw new TemplateValueMissing(String(part.value ?? '').trim())
    },
  })
  return { doc, inspect }
}

/** Все теги документа по частям, включая вложенные в циклы. */
function collectTags(inspect: InspectModule): FoundTag[] {
  const found: FoundTag[] = []
  const walk = (parts: unknown[], file: string) => {
    for (const raw of parts) {
      const tag = raw as { value?: unknown; module?: string; raw?: string; subparsed?: unknown[] }
      if (typeof tag.value !== 'string') continue
      found.push({
        value: tag.module ? (tag.raw ?? tag.value) : tag.value,
        module: tag.module,
        part: partOf(file),
      })
      if (Array.isArray(tag.subparsed)) walk(tag.subparsed, file)
    }
  }
  for (const file of Object.keys(inspect.fullInspected)) {
    walk(inspect.getStructuredTags(file), file)
  }
  return found
}

function syntaxIssues(error: unknown): DocumentTemplateIssue[] | null {
  const props = (error as TemplateErrorLike | null)?.properties
  if (!props) return null
  const list = props.errors?.length ? props.errors : [error as TemplateErrorLike]
  return list.map((e) => {
    const p = e.properties ?? {}
    return {
      code: UNSUPPORTED_ERROR.test(p.id ?? '') ? 'UNSUPPORTED_TAG' : 'SYNTAX',
      tag: p.xtag?.slice(0, 120),
      part: partOf(p.file),
    }
  })
}

/**
 * Ошибки без повторов и не больше MAX_REPORTED_ISSUES; про остальные — одна строка с их
 * числом. Отчёт хранится в версии и отдаётся с карточкой шаблона, его размер ограничен.
 */
function report(issues: DocumentTemplateIssue[]): DocumentTemplateIssue[] {
  const unique = dedupe(issues)
  const limit = DOCUMENT_TEMPLATE_LIMITS.MAX_REPORTED_ISSUES
  if (unique.length <= limit) return unique
  return [...unique.slice(0, limit), { code: 'MORE_ISSUES', tag: String(unique.length - limit) }]
}

function dedupe(issues: DocumentTemplateIssue[]): DocumentTemplateIssue[] {
  const seen = new Set<string>()
  return issues.filter((i) => {
    const key = `${i.code}|${i.tag ?? ''}|${i.part ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Проверка шаблона: какие переменные найдены, какие неизвестны, где нарушен синтаксис.
 * Не бросает на ошибках шаблона — их показывают сотруднику. Бросает только то, что не
 * относится к шаблону (повреждённый zip уже отсеян `inspectDocxArchive`).
 */
export function analyzeTemplate(buffer: Buffer): DocumentTemplateValidation {
  let tags: FoundTag[]
  try {
    tags = collectTags(compile(buffer, new Map()).inspect)
  } catch (error) {
    const issues = syntaxIssues(error)
    if (!issues) throw error
    return { valid: false, variables: [], errors: report(issues), warnings: [] }
  }

  const errors: DocumentTemplateIssue[] = []
  const warnings: DocumentTemplateIssue[] = []
  const variables: string[] = []
  for (const tag of tags) {
    const key = tag.value.trim()
    if (tag.module) {
      errors.push({ code: 'UNSUPPORTED_TAG', tag: key.slice(0, 120), part: tag.part })
    } else if (!documentTemplateVariable(key)) {
      errors.push({ code: 'UNKNOWN_VARIABLE', tag: key.slice(0, 120), part: tag.part })
    } else if (!variables.includes(key)) {
      variables.push(key)
    }
  }
  if (tags.length > DOCUMENT_TEMPLATE_LIMITS.MAX_TAGS) errors.push({ code: 'TOO_MANY_TAGS' })
  if (tags.length === 0) warnings.push({ code: 'NO_VARIABLES' })

  for (const key of variables) {
    if (documentTemplateVariable(key)?.optional)
      warnings.push({ code: 'OPTIONAL_VARIABLE', tag: key })
  }
  if (variables.some((key) => documentTemplateVariable(key)?.personal)) {
    warnings.push({ code: 'PERSONAL_DATA' })
  }

  const reported = report(errors)
  return { valid: reported.length === 0, variables, errors: reported, warnings }
}

/**
 * Заполняет шаблон. Оформление документа не трогается: docxtemplater меняет только текст
 * тегов, стили, таблицы, колонтитулы и картинки остаются как в исходнике.
 *
 * Шаблон проверяется заново прямо здесь, хотя версия уже хранит результат проверки: рендер
 * не должен доверять флагу в базе, если в нём ошибка, — неизвестный тег не получит значения.
 */
export function renderTemplate(buffer: Buffer, values: TemplateValues): Buffer {
  const { doc, inspect } = compile(buffer, values)
  const tags = collectTags(inspect)
  const bad = tags.some((t) => t.module || !documentTemplateVariable(t.value.trim()))
  if (bad || tags.length > DOCUMENT_TEMPLATE_LIMITS.MAX_TAGS) {
    throw new TemplateNotRenderable(analyzeTemplate(buffer))
  }
  doc.render({})
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

/** Значения-примеры реестра — для проверочного документа. Реальных данных в них нет. */
export function demoTemplateValues(): TemplateValues {
  return new Map(DOCUMENT_TEMPLATE_VARIABLES.map((v) => [v.key, v.example]))
}
