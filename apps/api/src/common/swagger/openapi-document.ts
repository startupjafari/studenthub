import { dirname, join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'
import type { ZodDto } from 'nestjs-zod'

import { zodToOpenApi, zodToQueryParameters } from './zod-openapi'

// Документ OpenAPI для живого Swagger (main.ts, /api/docs) и для экспорта в openapi.json
// (scripts/export-openapi.mjs). Один код на оба места — документ обязан совпадать.
//
// Как zod-DTO попадают в Swagger. Свойств с @ApiProperty у них нет, и сам Swagger видит
// пустой класс. Поэтому подменяются два метода его внутренних сервисов:
//   - SchemaObjectFactory.exploreModelSchema — тело запроса (и любой `type: Dto` в
//     декораторах): схема компонента строится из zod-схемы DTO;
//   - ParametersMetadataMapper.transformModelToProperties — `@Query() q: Dto`: поля схемы
//     разворачиваются в отдельные query-параметры.
// Остальные классы идут по штатному пути Swagger.
//
// Почему не patchNestJsSwagger() из nestjs-zod 4.3.1. Он подменяет только первый метод
// (query-DTO не покрывает вовсе) и сам грузит SchemaObjectFactory по глубокому пути
// `@nestjs/swagger/dist/...`, который карта exports в @nestjs/swagger 11 запрещает —
// отсюда «патч ломается о swagger 11». Здесь внутренние модули грузятся по абсолютному
// пути от точки входа пакета (exports действует только на голые спецификаторы), а
// конвертер — свой, см. zod-openapi.ts.
//
// Внутренности Swagger не публичны и могут поменяться при обновлении: тогда патч падает
// с явной ошибкой на старте dev и в экспорте схемы, а не молча отдаёт пустые схемы.

interface SchemaObjectFactoryProto {
  exploreModelSchema(type: unknown, schemas: Record<string, unknown>, ...rest: unknown[]): string
  isLazyTypeFunc(type: unknown): boolean
}

interface ReflectedParam {
  in?: string
  name?: string
  type?: unknown
  [key: string]: unknown
}

interface ParametersMetadataMapperProto {
  transformModelToProperties(
    parameters: Record<string, ReflectedParam> | ReflectedParam[],
  ): unknown[]
}

const PATCHED = Symbol.for('studenthub.swagger.zod')

const isZodDto = (type: unknown): type is ZodDto =>
  typeof type === 'function' && (type as Partial<ZodDto>).isZodDto === true

function loadSwaggerInternal<T>(relativePath: string, exportName: string): T {
  const swaggerDist = dirname(require.resolve('@nestjs/swagger'))
  // Глубокий импорт закрыт картой exports пакета, поэтому путь абсолютный — тот же файл,
  // что Swagger подключает у себя относительным require, то есть тот же объект класса.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(join(swaggerDist, relativePath)) as Record<string, unknown>
  const cls = mod[exportName] as { prototype?: T } | undefined
  if (!cls?.prototype) {
    throw new Error(
      `@nestjs/swagger: не найден ${exportName} в ${relativePath} — патч zod-DTO устарел`,
    )
  }
  return cls.prototype
}

/** Учит Swagger строить схемы из createZodDto-классов. Повторный вызов ничего не делает. */
export function patchSwaggerForZodDto(): void {
  const factory = loadSwaggerInternal<SchemaObjectFactoryProto & { [PATCHED]?: true }>(
    join('services', 'schema-object-factory.js'),
    'SchemaObjectFactory',
  )
  const mapper = loadSwaggerInternal<ParametersMetadataMapperProto & { [PATCHED]?: true }>(
    join('services', 'parameters-metadata-mapper.js'),
    'ParametersMetadataMapper',
  )
  if (
    typeof factory.exploreModelSchema !== 'function' ||
    typeof factory.isLazyTypeFunc !== 'function' ||
    typeof mapper.transformModelToProperties !== 'function'
  ) {
    throw new Error('@nestjs/swagger: сменились внутренние методы — патч zod-DTO устарел')
  }

  if (!factory[PATCHED]) {
    const original = factory.exploreModelSchema
    factory.exploreModelSchema = function (this: SchemaObjectFactoryProto, type, schemas, ...rest) {
      const resolved = this.isLazyTypeFunc(type) ? (type as () => unknown)() : type
      if (!isZodDto(resolved)) return original.call(this, type, schemas, ...rest)
      schemas[resolved.name] = zodToOpenApi(resolved.schema)
      return resolved.name
    }
    factory[PATCHED] = true
  }

  if (!mapper[PATCHED]) {
    const original = mapper.transformModelToProperties
    mapper.transformModelToProperties = function (this: ParametersMetadataMapperProto, parameters) {
      // Безымянный @Query() с zod-DTO разворачиваем сами, остальное отдаём Swagger —
      // по одному, чтобы порядок параметров остался как в сигнатуре метода.
      return Object.values(parameters ?? {}).flatMap((p) =>
        p?.in === 'query' && !p.name && isZodDto(p.type)
          ? zodToQueryParameters(p.type.schema)
          : original.call(this, [p]),
      )
    }
    mapper[PATCHED] = true
  }
}

/** Документ OpenAPI приложения. Заголовки общие для /api/docs и openapi.json. */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  patchSwaggerForZodDto()
  const config = new DocumentBuilder()
    .setTitle('StudentHub API')
    .setDescription('Внутренний API образовательной платформы StudentHub')
    .setVersion('1.0')
    .addBearerAuth()
    .build()
  return SwaggerModule.createDocument(app, config)
}
