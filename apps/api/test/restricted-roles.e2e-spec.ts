import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATH_METADATA } from '@nestjs/common/constants'
import { ModulesContainer, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import request from 'supertest'
import { RESTRICTED_ROLES, Role } from '@studenthub/shared-types'
import { AppModule } from '../src/app.module'
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator'
import { RESTRICTED_ALLOWED_KEY } from '../src/common/decorators/restricted-allowed.decorator'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'
import { throttlerStorageStub } from './throttler-storage.stub'

const PASSWORD = 'Passw0rd!'
const UNIVERSITY_ID = 'uni-restricted'
/** Фиктивный идентификатор для любого параметра пути: guard срабатывает раньше, чем его разбирают. */
const FAKE_ID = '00000000-0000-4000-8000-000000000000'
/** Текст отказа RestrictedRoleGuard — по нему отказ реестра отличается от отказа RolesGuard/ScopeGuard. */
const RESTRICTED_DENIAL = 'Операция недоступна этой роли'

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

interface OpenApiOperation {
  method: HttpMethod
  /** Путь из openapi.json без глобального префикса, параметры — `{name}`. */
  path: string
  operationId: string
  hasRequiredBody: boolean
}

interface RouteRegistryEntry {
  isPublic: boolean
  restrictedAllowed: readonly Role[]
}

/**
 * Запрет по умолчанию для охраны и библиотекаря (21.E1, docs/PROJECT.md §2) — сквозным
 * прогоном на настоящей БД, а не unit-тестом guard'а на моках.
 *
 * Ни один список маршрутов здесь не пишется руками:
 * - ВСЕ маршруты берутся из `apps/api/openapi.json` (тот самый контракт, который CI сверяет
 *   с кодом);
 * - что открыто ограниченной роли, и что публично, — из метаданных живых контроллеров
 *   (`@RestrictedAllowed` и `@Public`), по тому же `operationId`, которым Swagger называет
 *   обработчик (`<Controller>_<метод>`). Это ровно то, что читают JwtAuthGuard и
 *   RestrictedRoleGuard.
 *
 * Новый эндпоинт без `@RestrictedAllowed` автоматически попадает в перебор и обязан
 * отвечать охране и библиотекарю `403`; новый эндпоинт с пометкой — обязан не отказывать.
 *
 * Отказ проверяется по тексту RestrictedRoleGuard: `403` от RolesGuard или ScopeGuard
 * значил бы, что запрет держится на случайности (у маршрута оказался `@Roles`), а не на
 * реестре. Тело запроса — пустой объект: если бы валидация шла раньше guard'а, маршруты с
 * обязательным телом ответили бы `422`, а не `403`.
 */
describe('Ограниченные роли: запрет по умолчанию (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let passwords: PasswordService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>

  const operations = readOpenApiOperations()
  let registry: Map<string, RouteRegistryEntry>
  const tokens = new Map<Role, string>()

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorage)
      .useValue(throttlerStorageStub)
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.setGlobalPrefix('api/v1')
    await app.register(cookie)
    // Как в main.ts: без парсера multipart маршруты загрузки отвечали бы 500 на любой запрос,
    // и проверка «разрешённые не падают» мерила бы стенд, а не приложение.
    await app.register(multipart, { limits: { files: 10 } })
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    prisma = app.get(PrismaService)
    passwords = app.get(PasswordService)
    server = app.getHttpServer()
    registry = readRouteRegistry(app)

    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE refresh_tokens, users, universities RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: UNIVERSITY_ID, name: 'Вуз ограниченных ролей' } })
    for (const role of [...RESTRICTED_ROLES, Role.PLATFORM_ADMIN]) {
      await makeUser(role)
      tokens.set(role, await login(role))
    }
  })

  afterAll(async () => {
    await app.close()
  })

  function emailOf(role: Role): string {
    return `${role.toLowerCase()}@restricted.e2e`
  }

  async function makeUser(role: Role): Promise<void> {
    await prisma.user.create({
      data: {
        email: emailOf(role),
        passwordHash: await passwords.hash(PASSWORD),
        firstName: 'Имя',
        lastName: 'Фамилия',
        role,
        universityId: role === Role.PLATFORM_ADMIN ? null : UNIVERSITY_ID,
      },
    })
  }

  async function login(role: Role): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ identifier: emailOf(role), password: PASSWORD })
      .expect(201)
    return res.body.data.accessToken as string
  }

  /** Запрос по операции openapi.json: фиктивные параметры пути, пустое тело у изменяющих методов. */
  function call(op: OpenApiOperation, token: string) {
    const path = op.path.replace(/\{[^}]+\}/g, FAKE_ID)
    const req = request(server)[op.method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`)
    return op.method === 'get' || op.method === 'delete' ? req : req.send({})
  }

  function entryOf(op: OpenApiOperation): RouteRegistryEntry {
    const entry = registry.get(op.operationId)
    if (!entry) throw new Error(`Нет обработчика для ${op.operationId}`)
    return entry
  }

  const describeOp = (op: OpenApiOperation): string =>
    `${op.method.toUpperCase()} ${op.path} (${op.operationId})`

  it('каждая операция openapi.json сопоставлена с обработчиком приложения', () => {
    // Иначе перебор ниже молча пропустил бы маршрут: стухший openapi.json или своя
    // operationIdFactory в Swagger — повод чинить здесь, а не ослаблять проверку.
    expect(operations.length).toBeGreaterThan(100)
    const unmapped = operations.filter((op) => !registry.has(op.operationId)).map(describeOp)
    expect(unmapped).toEqual([])
  })

  it('контроль: без ограниченной роли пустое тело доходит до валидации (422)', async () => {
    // Показывает, что `{}` — действительно невалидное тело. Тогда `403` на том же маршруте у
    // охраны и библиотекаря ниже означает, что отказ реестра случился до валидации.
    const res = await request(server)
      .post('/api/v1/universities')
      .set('Authorization', `Bearer ${tokens.get(Role.PLATFORM_ADMIN)}`)
      .send({})
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  describe.each(RESTRICTED_ROLES.map((role) => [role]))('%s', (role) => {
    it('реестр открывает роли хотя бы свой аккаунт', () => {
      const me = operations.find((op) => op.operationId === 'UsersController_me')
      expect(me).toBeDefined()
      expect(entryOf(me!).restrictedAllowed).toContain(role)
    })

    it('все маршруты вне реестра роли отвечают 403 от RestrictedRoleGuard', async () => {
      const token = tokens.get(role)!
      const forbidden = operations.filter((op) => {
        const entry = entryOf(op)
        return !entry.isPublic && !entry.restrictedAllowed.includes(role)
      })
      // Запрет по умолчанию — большая часть API. Если вдруг закрытых маршрутов стало мало,
      // скорее сломалось чтение реестра, чем кто-то открыл роли пол-API.
      expect(forbidden.length).toBeGreaterThan(operations.length / 2)

      const leaks: string[] = []
      let withRequiredBody = 0
      for (const op of forbidden) {
        const res = await call(op, token)
        const denied =
          res.status === 403 &&
          res.body?.error?.code === 'FORBIDDEN' &&
          res.body?.error?.message === RESTRICTED_DENIAL
        if (!denied) {
          leaks.push(`${describeOp(op)} → ${res.status} ${res.body?.error?.code ?? ''}`)
        }
        if (op.hasRequiredBody) withRequiredBody += 1
      }
      expect(leaks).toEqual([])
      // Среди закрытых есть маршруты с обязательным телом — значит, перебор действительно
      // проверил порядок «guard раньше валидации».
      expect(withRequiredBody).toBeGreaterThan(0)
    }, 180_000)

    it('маршруты из реестра роли не отказывают ей по роли', async () => {
      const allowed = operations.filter((op) => {
        const entry = entryOf(op)
        return !entry.isPublic && entry.restrictedAllowed.includes(role)
      })
      expect(allowed.length).toBeGreaterThan(0)

      // Сначала безопасные чтения, изменяющие — после: выход из всех сессий или удаление
      // аккаунта с пустым телом не проходят валидацию, но порядок страхует и от этого.
      const ordered = [...allowed].sort(
        (a, b) => Number(a.method !== 'get') - Number(b.method !== 'get'),
      )
      const problems: string[] = []
      for (const op of ordered) {
        let res = await call(op, tokens.get(role)!)
        if (res.status === 401) {
          // Маршрут вроде logout-all мог отозвать сессию — перелогиниваемся и повторяем.
          tokens.set(role, await login(role))
          res = await call(op, tokens.get(role)!)
        }
        const deniedByRegistry =
          res.status === 403 && res.body?.error?.message === RESTRICTED_DENIAL
        if (deniedByRegistry || res.status === 401 || res.status >= 500) {
          problems.push(`${describeOp(op)} → ${res.status} ${res.body?.error?.code ?? ''}`)
        }
      }
      expect(problems).toEqual([])
    }, 120_000)
  })
})

/** Все операции из openapi.json — единственный источник списка маршрутов в этом тесте. */
function readOpenApiOperations(): OpenApiOperation[] {
  const doc = JSON.parse(readFileSync(join(__dirname, '..', 'openapi.json'), 'utf8')) as {
    paths: Record<
      string,
      Record<string, { operationId: string; requestBody?: { required?: boolean } }>
    >
  }
  const methods: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']
  const ops: OpenApiOperation[] = []
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of methods) {
      const op = item[method]
      if (!op) continue
      ops.push({
        method,
        path,
        operationId: op.operationId,
        hasRequiredBody: op.requestBody?.required === true,
      })
    }
  }
  return ops
}

/**
 * Реестр из кода: для каждого обработчика всех контроллеров приложения — `@Public` и
 * `@RestrictedAllowed`, прочитанные тем же `getAllAndOverride`, что и guard'ы.
 * Ключ — `operationId` по умолчанию у Swagger: `<ИмяКонтроллера>_<имяМетода>`.
 */
function readRouteRegistry(app: NestFastifyApplication): Map<string, RouteRegistryEntry> {
  const reflector = app.get(Reflector)
  const registry = new Map<string, RouteRegistryEntry>()
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null
      if (!controller) continue
      const proto = controller.prototype as Record<string, unknown>
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') continue
        const handler = proto[key]
        if (typeof handler !== 'function') continue
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue
        const targets = [handler, controller]
        registry.set(`${controller.name}_${key}`, {
          isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true,
          restrictedAllowed:
            reflector.getAllAndOverride<Role[] | undefined>(RESTRICTED_ALLOWED_KEY, targets) ?? [],
        })
      }
    }
  }
  return registry
}
