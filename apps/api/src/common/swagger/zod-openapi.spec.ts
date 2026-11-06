import { z } from 'zod'

import { zodToOpenApi, zodToQueryParameters } from './zod-openapi'

describe('zodToOpenApi', () => {
  it('strict-объект: свойства, обязательные поля и запрет лишних ключей', () => {
    const schema = z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200),
        note: z.string().optional(),
        limit: z.coerce.number().int().positive().max(50).default(20),
      })
      .strict()

    expect(zodToOpenApi(schema)).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        note: { type: 'string' },
        limit: {
          type: 'integer',
          minimum: 0,
          exclusiveMinimum: true,
          maximum: 50,
          default: 20,
        },
      },
      required: ['id', 'title'],
      additionalProperties: false,
    })
  })

  it('refine/transform/preprocess описываются входной схемой', () => {
    const schema = z
      .object({
        a: z.string().transform((v) => v.length),
        b: z.preprocess((v) => v, z.boolean()).optional(),
      })
      .superRefine(() => undefined)

    const out = zodToOpenApi(schema)
    expect(out.properties).toEqual({ a: { type: 'string' }, b: { type: 'boolean' } })
    expect(out.required).toEqual(['a'])
  })

  it('pipe: вход — строка; ограничения выхода того же типа сохраняются', () => {
    const text = z
      .string()
      .transform((v) => v.trim())
      .pipe(z.string().min(1).max(4000))
    expect(zodToOpenApi(text)).toEqual({ type: 'string', minLength: 1, maxLength: 4000 })

    const list = z
      .string()
      .min(1)
      .transform((v) => v.split(','))
      .pipe(z.array(z.string()).max(20))
    expect(zodToOpenApi(list)).toEqual({ type: 'string', minLength: 1 })
  })

  it('union: null → nullable, литералы → enum, прочее → anyOf', () => {
    expect(zodToOpenApi(z.union([z.string().max(10), z.number(), z.null()]))).toEqual({
      anyOf: [{ type: 'string', maxLength: 10 }, { type: 'number' }],
      nullable: true,
    })
    expect(zodToOpenApi(z.union([z.literal('a'), z.literal('b')]))).toEqual({
      type: 'string',
      enum: ['a', 'b'],
    })
  })

  it('поле `x.optional().or(...)` необязательно', () => {
    const schema = z.object({
      website: z
        .string()
        .url()
        .optional()
        .or(z.literal('').transform(() => undefined)),
    })
    expect(zodToOpenApi(schema).required).toBeUndefined()
  })

  it('discriminatedUnion → oneOf с discriminator', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.number() }),
      z.object({ kind: z.literal('b') }),
    ])
    const out = zodToOpenApi(schema)
    expect(out.discriminator).toEqual({ propertyName: 'kind' })
    expect(out.oneOf).toHaveLength(2)
  })

  it('record, enum, nullable, массив с границами, literal(true)', () => {
    const schema = z.object({
      data: z.record(z.string(), z.union([z.string(), z.number()])),
      role: z.enum(['STUDENT', 'TEACHER']),
      deletedAt: z.string().datetime().nullable(),
      tags: z.array(z.string()).min(1).max(5),
      consent: z.literal(true),
    })
    expect(zodToOpenApi(schema).properties).toEqual({
      data: {
        type: 'object',
        additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
      role: { type: 'string', enum: ['STUDENT', 'TEACHER'] },
      deletedAt: { type: 'string', format: 'date-time', nullable: true },
      tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      consent: { type: 'boolean', enum: [true] },
    })
  })

  it('рекурсивная схема не зацикливается: повторный вход — «любое значение»', () => {
    interface Node {
      name: string
      children: Node[]
    }
    const node: z.ZodType<Node> = z.lazy(() =>
      z.object({ name: z.string(), children: z.array(node) }),
    )
    const out = zodToOpenApi(node)
    expect(out.properties?.children).toEqual({ type: 'array', items: {} })
  })

  it('невыразимый тип не роняет генерацию', () => {
    expect(zodToOpenApi(z.function())).toEqual({})
    expect(zodToOpenApi(z.unknown())).toEqual({})
  })
})

describe('zodToQueryParameters', () => {
  it('поле объекта → отдельный query-параметр', () => {
    const schema = z
      .object({
        q: z.string().min(2),
        limit: z.coerce.number().int().default(20),
      })
      .strict()
    expect(zodToQueryParameters(schema)).toEqual([
      { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 20 },
      },
    ])
  })

  it('корень под refine и union объектов: поля объединяются', () => {
    const refined = z.object({ from: z.string(), to: z.string().optional() }).refine(() => true)
    expect(zodToQueryParameters(refined).map((p) => [p.name, p.required])).toEqual([
      ['from', true],
      ['to', false],
    ])

    const union = z.union([
      z.object({ scope: z.literal('all'), page: z.coerce.number() }),
      z.object({ scope: z.literal('mine') }),
    ])
    expect(zodToQueryParameters(union).map((p) => [p.name, p.required])).toEqual([
      ['scope', true],
      ['page', false],
    ])
  })
})
