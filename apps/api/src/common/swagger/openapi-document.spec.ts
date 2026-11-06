import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

import { createOpenApiDocument } from './openapi-document'

class CreateThingDto extends createZodDto(
  z.object({ title: z.string().min(1), tags: z.array(z.string()).optional() }).strict(),
) {}

class ListThingsQueryDto extends createZodDto(
  z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().default(20) }),
) {}

@Controller('things')
class ThingsController {
  @Get()
  list(@Query() _query: ListThingsQueryDto) {
    return []
  }

  @Post()
  create(@Body() _dto: CreateThingDto) {
    return {}
  }
}

describe('createOpenApiDocument', () => {
  it('zod-DTO дают схему тела и query-параметры', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ThingsController] }).compile()
    const app = moduleRef.createNestApplication(new FastifyAdapter())
    try {
      const doc = createOpenApiDocument(app)

      expect(doc.components?.schemas?.CreateThingDto).toEqual({
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['title'],
        additionalProperties: false,
      })
      expect(doc.paths['/things']?.post?.requestBody).toEqual({
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateThingDto' } },
        },
      })
      expect(doc.paths['/things']?.get?.parameters).toEqual([
        { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', default: 20 },
        },
      ])
    } finally {
      await app.close()
    }
  })
})
