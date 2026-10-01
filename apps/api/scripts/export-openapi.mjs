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
// ОГРАНИЧЕНИЕ. Схемы ответов в документ почти не попадают: patchNestJsSwagger() выключен
// в main.ts (TODO Ф1 — несовместимость nestjs-zod 4.3.1 и @nestjs/swagger 11), и zod-DTO до
// Swagger не доходят. Числа на момент написания: 387 путей, 481 операция, тело запроса
// описано у 176, схема ответа — у одной. То есть сравнение контракта видит исчезнувшие и
// переименованные эндпоинты, смену методов, параметров и тел запросов, но не форму ответа.
// Когда TODO закроют, документ станет полным сам, без правок этого скрипта.
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NestFactory } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

import { AppModule } from '../dist/app.module.js'

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json')

// Адаптер тот же, что в main.ts: без него Nest ищет @nestjs/platform-express, которого в
// проекте нет. Сервер при этом не поднимается — listen() не вызывается.
const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
  preview: true,
  logger: false,
})

// Те же заголовки, что у живого Swagger в main.ts: документ должен быть один и тот же.
const config = new DocumentBuilder()
  .setTitle('StudentHub API')
  .setDescription('Внутренний API образовательной платформы StudentHub')
  .setVersion('1.0')
  .addBearerAuth()
  .build()

const document = SwaggerModule.createDocument(app, config)

writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
await app.close()

const paths = Object.keys(document.paths ?? {}).length
console.log(`Схема записана: ${out} (путей: ${paths})`)
