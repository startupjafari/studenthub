// Экспорт OpenAPI-схемы в apps/api/openapi.json.
//
// Зачем файл в репозитории. Контракт api руками читают два приложения — web и mini-app, и
// до сих пор «эндпоинт переименовали» обнаруживалось у них в рантайме. Схема, лежащая в
// git, даёт точку сравнения: прогон сверяет её с текущим кодом и показывает в PR, что
// именно в контракте поменялось (см. job «Контракт API» в ci.yml).
//
// Почему .mjs поверх dist, а не TypeScript. В apps/api нет ни ts-node, ни tsx — скрипты
// здесь обычные .mjs (как prisma/seed.mjs), и заводить ради одного скрипта ещё один
// рантайм незачем. Запускать после `pnpm --filter api build`.
//
// preview: true — Nest строит граф модулей, но не создаёт провайдеров и не выполняет
// onModuleInit. Без этого скрипт полез бы в базу: PrismaService подключается именно там.
// Swagger читает метаданные контроллеров, и провайдеры ему не нужны.
//
// Схемы тел запросов и query-параметров берутся из zod-DTO (createZodDto): документ строит
// createOpenApiDocument() — тот же код, что у живого Swagger в main.ts, с патчем Swagger
// под zod (common/swagger/openapi-document.ts). Схемы ОТВЕТОВ по-прежнему почти пусты:
// response-DTO в проекте нет, и сравнение контракта форму ответа не видит.
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NestFactory } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'

import { AppModule } from '../dist/app.module.js'
import { createOpenApiDocument } from '../dist/common/swagger/openapi-document.js'

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json')

// Адаптер тот же, что в main.ts: без него Nest ищет @nestjs/platform-express, которого в
// проекте нет. Сервер при этом не поднимается — listen() не вызывается.
const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
  preview: true,
  logger: false,
})

const document = createOpenApiDocument(app)

writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
await app.close()

const paths = Object.keys(document.paths ?? {}).length
console.log(`Схема записана: ${out} (путей: ${paths})`)
