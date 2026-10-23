import type {
  ParameterObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface'
import type { ZodTypeAny } from 'zod'

// Zod (v3) → схема OpenAPI 3.0 для Swagger.
//
// Почему не zodToOpenAPI из nestjs-zod 4.3.1. Штатный конвертер устарел относительно схем
// проекта: `.pipe()` (разбор списков в query, очистка текста сообщений) он отдаёт пустым
// объектом, `.strict()` не отражает, `z.null()` в union теряет, а обязательность поля
// определяет по имени класса — поле под `z.preprocess` у него всегда «обязательное».
// Здесь те же правила, но с этими случаями. Переход на nestjs-zod 5 (zod v4, нативный
// JSON Schema) сделает модуль ненужным.
//
// Документируется ВХОД: то, что клиент присылает по проводу. Поэтому у `.transform()` и
// `z.preprocess` берётся внутренняя схема, у `.pipe()` — входная сторона, а `.default()`
// делает поле необязательным. Неизвестный или невыразимый в OpenAPI 3.0 тип не роняет
// генерацию: он описывается пустой схемой `{}` («любое значение»).

/** Внутреннее определение zod-узла: поля зависят от typeName, поэтому типизировано свободно. */
interface ZodDef {
  typeName?: string
  [key: string]: unknown
}

interface ZodCheck {
  kind: string
  value?: number
  inclusive?: boolean
  regex?: RegExp
  version?: string
}

const defOf = (schema: ZodTypeAny): ZodDef => schema._def as ZodDef
const typeOf = (schema: ZodTypeAny): string | undefined => defOf(schema).typeName

/** Обёртки, не меняющие форму значения: снимаем, чтобы добраться до сути. */
function unwrapTransparent(schema: ZodTypeAny): ZodTypeAny {
  let current = schema
  for (;;) {
    const def = defOf(current)
    switch (def.typeName) {
      case 'ZodEffects':
        current = def.schema as ZodTypeAny
        break
      case 'ZodPipeline':
        current = def.in as ZodTypeAny
        break
      case 'ZodBranded':
        current = def.type as ZodTypeAny
        break
      case 'ZodReadonly':
      case 'ZodCatch':
      case 'ZodOptional':
      case 'ZodDefault':
      case 'ZodNullable':
        current = def.innerType as ZodTypeAny
        break
      case 'ZodLazy':
        current = (def.getter as () => ZodTypeAny)()
        break
      default:
        return current
    }
  }
}

/**
 * Можно ли не присылать поле. Определяется по структуре схемы, а не прогоном
 * `safeParse(undefined)`: тот выполнял бы preprocess и refine-функции проекта на
 * значении, которого они не ждут.
 */
export function isZodOptional(schema: ZodTypeAny): boolean {
  const def = defOf(schema)
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodUndefined':
    case 'ZodVoid':
    case 'ZodAny':
    case 'ZodUnknown':
      return true
    case 'ZodEffects':
      return isZodOptional(def.schema as ZodTypeAny)
    case 'ZodPipeline':
      return isZodOptional(def.in as ZodTypeAny)
    case 'ZodBranded':
      return isZodOptional(def.type as ZodTypeAny)
    case 'ZodReadonly':
    case 'ZodNullable':
      return isZodOptional(def.innerType as ZodTypeAny)
    case 'ZodUnion':
      // `a.optional().or(b)` — вариант без значения делает необязательным всё поле.
      return (def.options as ZodTypeAny[]).some(isZodOptional)
    default:
      return false
  }
}

function stringSchema(def: ZodDef): SchemaObject {
  const out: SchemaObject = { type: 'string' }
  for (const check of (def.checks as ZodCheck[] | undefined) ?? []) {
    switch (check.kind) {
      case 'min':
        out.minLength = check.value
        break
      case 'max':
        out.maxLength = check.value
        break
      case 'length':
        out.minLength = check.value
        out.maxLength = check.value
        break
      case 'email':
        out.format = 'email'
        break
      case 'url':
        out.format = 'uri'
        break
      case 'uuid':
        out.format = 'uuid'
        break
      case 'datetime':
        out.format = 'date-time'
        break
      case 'date':
        out.format = 'date'
        break
      case 'time':
        out.format = 'time'
        break
      case 'duration':
        out.format = 'duration'
        break
      case 'base64':
        out.format = 'byte'
        break
      case 'ip':
        if (check.version) out.format = check.version
        break
      case 'cuid':
      case 'cuid2':
      case 'ulid':
      case 'nanoid':
        out.format = check.kind
        break
      case 'regex':
        // OpenAPI 3.0 допускает один pattern; при нескольких regex остаётся первый.
        if (check.regex && out.pattern === undefined) out.pattern = check.regex.source
        break
    }
  }
  return out
}

function numberSchema(def: ZodDef): SchemaObject {
  const out: SchemaObject = { type: 'number' }
  for (const check of (def.checks as ZodCheck[] | undefined) ?? []) {
    switch (check.kind) {
      case 'int':
        out.type = 'integer'
        break
      case 'min':
        out.minimum = check.value
        if (check.inclusive === false) out.exclusiveMinimum = true
        break
      case 'max':
        out.maximum = check.value
        if (check.inclusive === false) out.exclusiveMaximum = true
        break
      case 'multipleOf':
        out.multipleOf = check.value
        break
    }
  }
  return out
}

function literalSchema(value: unknown): SchemaObject {
  if (value === null) return { nullable: true, enum: [null] }
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return { type, enum: [value] }
  }
  return {}
}

/** Значение `.default()` в документ — только сериализуемое в JSON. */
function jsonDefault(getDefault: () => unknown): { default?: unknown } {
  try {
    const value = getDefault()
    if (value === undefined || typeof value === 'function') return {}
    JSON.stringify(value)
    return { default: value }
  } catch {
    return {}
  }
}

function unionSchema(options: ZodTypeAny[], seen: Set<unknown>): SchemaObject {
  // null — это nullable; undefined — необязательность, она уже учтена в required родителя.
  const nullable = options.some((o) => typeOf(o) === 'ZodNull')
  const rest = options.filter((o) => {
    const t = typeOf(o)
    return t !== 'ZodNull' && t !== 'ZodUndefined'
  })

  // Набор литералов одного типа — это enum, а не перечень вариантов.
  const literals = rest.map((o) => (typeOf(o) === 'ZodLiteral' ? defOf(o).value : undefined))
  const literalType = typeof literals[0]
  if (
    rest.length > 0 &&
    literals.every((v) => v !== undefined && v !== null && typeof v === literalType) &&
    (literalType === 'string' || literalType === 'number')
  ) {
    return { type: literalType, enum: literals, ...(nullable ? { nullable: true } : {}) }
  }

  const schemas = rest.map((o) => convert(o, seen))
  // z.union принимает первый подошедший вариант — это anyOf, а не oneOf.
  const base: SchemaObject = schemas.length === 1 && schemas[0] ? schemas[0] : { anyOf: schemas }
  return nullable ? { ...base, nullable: true } : base
}

function objectSchema(def: ZodDef, seen: Set<unknown>): SchemaObject {
  const shape = (def.shape as () => Record<string, ZodTypeAny>)()
  const properties: Record<string, SchemaObject> = {}
  const required: string[] = []
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = convert(value, seen)
    if (!isZodOptional(value)) required.push(key)
  }
  const out: SchemaObject = { type: 'object', properties }
  if (required.length > 0) out.required = required

  const catchall = def.catchall as ZodTypeAny | undefined
  if (catchall && typeOf(catchall) !== 'ZodNever') {
    out.additionalProperties = convert(catchall, seen)
  } else if (def.unknownKeys === 'strict') {
    out.additionalProperties = false
  }
  return out
}

function convert(schema: ZodTypeAny, seen: Set<unknown>): SchemaObject {
  const def = defOf(schema)
  const out = convertNode(def, seen)
  if (schema.description && out.description === undefined) {
    return { ...out, description: schema.description }
  }
  return out
}

function convertNode(def: ZodDef, seen: Set<unknown>): SchemaObject {
  switch (def.typeName) {
    case 'ZodString':
      return stringSchema(def)
    case 'ZodNumber':
      return numberSchema(def)
    case 'ZodBigInt':
      return { type: 'integer', format: 'int64' }
    case 'ZodBoolean':
      return { type: 'boolean' }
    case 'ZodDate':
      return { type: 'string', format: 'date-time' }
    case 'ZodLiteral':
      return literalSchema(def.value)
    case 'ZodEnum':
      return { type: 'string', enum: [...(def.values as string[])] }
    case 'ZodNativeEnum': {
      const raw = def.values as Record<string, string | number>
      // У числового TS-enum есть обратные ключи (0 → 'A'); их в перечень не берём.
      const values = Object.entries(raw)
        .filter(([key]) => typeof raw[raw[key] as string] !== 'number')
        .map(([, value]) => value)
      const allNumbers = values.every((v) => typeof v === 'number')
      return { type: allNumbers ? 'number' : 'string', enum: values }
    }
    case 'ZodNull':
      return { nullable: true, enum: [null] }

    case 'ZodArray': {
      const out: SchemaObject = { type: 'array', items: convert(def.type as ZodTypeAny, seen) }
      const exact = def.exactLength as { value: number } | null
      const min = def.minLength as { value: number } | null
      const max = def.maxLength as { value: number } | null
      if (exact) {
        out.minItems = exact.value
        out.maxItems = exact.value
      }
      if (min) out.minItems = min.value
      if (max) out.maxItems = max.value
      return out
    }
    case 'ZodSet': {
      const out: SchemaObject = {
        type: 'array',
        uniqueItems: true,
        items: convert(def.valueType as ZodTypeAny, seen),
      }
      const min = def.minSize as { value: number } | null
      const max = def.maxSize as { value: number } | null
      if (min) out.minItems = min.value
      if (max) out.maxItems = max.value
      return out
    }
    case 'ZodTuple': {
      // prefixItems появился только в OpenAPI 3.1; в 3.0 — «любой из элементов» и длина.
      const items = (def.items as ZodTypeAny[]).map((item) => convert(item, seen))
      const out: SchemaObject = {
        type: 'array',
        items: items.length === 1 && items[0] ? items[0] : { anyOf: items },
      }
      if (!def.rest) {
        out.minItems = items.length
        out.maxItems = items.length
      }
      return out
    }
    case 'ZodObject':
      return objectSchema(def, seen)
    case 'ZodRecord':
    case 'ZodMap':
      return { type: 'object', additionalProperties: convert(def.valueType as ZodTypeAny, seen) }

    case 'ZodUnion':
      return unionSchema(def.options as ZodTypeAny[], seen)
    case 'ZodDiscriminatedUnion': {
      const options = [...(def.options as ZodTypeAny[])]
      return {
        oneOf: options.map((o) => convert(o, seen)),
        discriminator: { propertyName: def.discriminator as string },
      }
    }
    case 'ZodIntersection':
      return {
        allOf: [convert(def.left as ZodTypeAny, seen), convert(def.right as ZodTypeAny, seen)],
      }

    case 'ZodOptional':
      // Необязательность выражается в required родителя, сама схема значения та же.
      return convert(def.innerType as ZodTypeAny, seen)
    case 'ZodNullable':
      return { ...convert(def.innerType as ZodTypeAny, seen), nullable: true }
    case 'ZodDefault':
      return {
        ...convert(def.innerType as ZodTypeAny, seen),
        ...jsonDefault(def.defaultValue as () => unknown),
      }
    case 'ZodCatch':
    case 'ZodReadonly':
    case 'ZodPromise':
      return convert((def.innerType ?? def.type) as ZodTypeAny, seen)
    case 'ZodBranded':
      return convert(def.type as ZodTypeAny, seen)
    case 'ZodEffects':
      // refine / superRefine / transform / preprocess: по проводу приходит то, что ждёт
      // внутренняя схема. Для preprocess это приближение — до него значение произвольно.
      return convert(def.schema as ZodTypeAny, seen)
    case 'ZodPipeline': {
      // a.transform(...).pipe(b): клиент присылает a. Если обе стороны одного типа
      // (строка → очищенная строка), ограничения выходной стороны тоже верны для входа.
      const input = convert(def.in as ZodTypeAny, seen)
      const output = convert(def.out as ZodTypeAny, seen)
      return input.type !== undefined && input.type === output.type
        ? { ...input, ...output }
        : input
    }
    case 'ZodLazy': {
      // Рекурсивная схема инлайном не разворачивается: на повторном входе — «любое
      // значение». Ссылки $ref на компоненты для вложенных zod-узлов не заводим.
      const getter = def.getter as () => ZodTypeAny
      if (seen.has(getter)) return {}
      const next = new Set(seen)
      next.add(getter)
      return convert(getter(), next)
    }
    default:
      // ZodAny, ZodUnknown, ZodUndefined, ZodVoid, ZodNever, ZodFunction, ZodSymbol, ZodNaN
      // и всё, что появится позже: в OpenAPI 3.0 не выражается — «любое значение».
      return {}
  }
}

/** Полная схема значения (тело запроса, ответ). */
export function zodToOpenApi(schema: ZodTypeAny): SchemaObject {
  return convert(schema, new Set())
}

/**
 * Поля объекта верхнего уровня для разворота в query-параметры. Корень может быть
 * обёрнут в refine/transform, а может быть union объектов: тогда параметр — объединение
 * полей вариантов, обязательный только если обязателен во всех.
 */
function topLevelFields(
  schema: ZodTypeAny,
): { key: string; schema: ZodTypeAny; required: boolean }[] {
  const root = unwrapTransparent(schema)
  const def = defOf(root)
  if (def.typeName === 'ZodObject') {
    return Object.entries((def.shape as () => Record<string, ZodTypeAny>)()).map(
      ([key, value]) => ({ key, schema: value, required: !isZodOptional(value) }),
    )
  }
  const parts =
    def.typeName === 'ZodUnion' || def.typeName === 'ZodDiscriminatedUnion'
      ? [...(def.options as ZodTypeAny[])]
      : def.typeName === 'ZodIntersection'
        ? [def.left as ZodTypeAny, def.right as ZodTypeAny]
        : []
  if (parts.length === 0) return []

  const isIntersection = def.typeName === 'ZodIntersection'
  const variants = parts.map(topLevelFields)
  const merged = new Map<string, { key: string; schema: ZodTypeAny; required: boolean }>()
  for (const fields of variants) {
    for (const field of fields) {
      const existing = merged.get(field.key)
      if (!existing) {
        const inAll = variants.every((v) => v.some((f) => f.key === field.key && f.required))
        merged.set(field.key, {
          ...field,
          required: isIntersection ? field.required : inAll,
        })
      } else if (isIntersection && field.required) {
        existing.required = true
      }
    }
  }
  return [...merged.values()]
}

/** Query-DTO → список параметров `in: query`, по одному на поле схемы. */
export function zodToQueryParameters(schema: ZodTypeAny): ParameterObject[] {
  return topLevelFields(schema).map(({ key, schema: field, required }) => {
    const { description, ...fieldSchema } = zodToOpenApi(field)
    const param: ParameterObject = { name: key, in: 'query', required, schema: fieldSchema }
    if (description) param.description = description
    return param
  })
}
