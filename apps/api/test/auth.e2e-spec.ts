import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'

const LOGIN = { email: 'admin@t.io', password: 'Admin1234!' }

function getCookie(res: request.Response, name: string): string | null {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  for (const c of raw ?? []) {
    if (c.startsWith(`${name}=`)) {
      return c.split(';')[0]
    }
  }
  return null
}

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let adminId: string
  let server: ReturnType<NestFastifyApplication['getHttpServer']>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Rate limit отключаем в e2e, иначе повторные логины упрутся в 5/15мин.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.setGlobalPrefix('api/v1')
    await app.register(cookie)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    prisma = app.get(PrismaService)
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE audit_logs, refresh_tokens, invites, files, groups, rooms, faculties, universities, users RESTART IDENTITY CASCADE',
    )
    // Scope-поля User теперь FK (Фаза 5): инвайт с universityId должен ссылаться на реальный вуз.
    await prisma.university.create({ data: { id: 'uni-e2e', name: 'E2E University' } })
    const passwordHash = await app.get(PasswordService).hash(LOGIN.password)
    const admin = await prisma.user.create({
      data: {
        email: LOGIN.email,
        passwordHash,
        firstName: 'Демо',
        lastName: 'Админ',
        role: 'PLATFORM_ADMIN',
      },
    })
    adminId = admin.id
  })

  describe('POST /auth/login', () => {
    it('неверный пароль → 401 UNAUTHORIZED', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: LOGIN.email, password: 'wrong' })
      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('верные данные → accessToken + cookies', async () => {
      const res = await request(server).post('/api/v1/auth/login').send(LOGIN)
      expect([200, 201]).toContain(res.status)
      expect(res.body.data.accessToken).toEqual(expect.any(String))
      expect(getCookie(res, 'sh_refresh')).toBeTruthy()
      expect(getCookie(res, 'sh_role')).toBeTruthy()
    })

    it('accessToken открывает GET /auth/me', async () => {
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const token = login.body.data.accessToken
      const me = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
      expect(me.status).toBe(200)
      expect(me.body.data.email).toBe(LOGIN.email)
      expect(me.body.data).not.toHaveProperty('passwordHash')
    })
  })

  describe('POST /auth/refresh — ротация и разрыв цепочки', () => {
    it('ротация выдаёт новый токен, повтор старого рвёт всю цепочку', async () => {
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const cookieA = getCookie(login, 'sh_refresh') as string

      const r1 = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookieA)
      expect([200, 201]).toContain(r1.status)
      const cookieB = getCookie(r1, 'sh_refresh') as string
      expect(cookieB).toBeTruthy()
      expect(cookieB).not.toEqual(cookieA)

      // Повтор старого (revoked) → 401 + инвалидация цепочки.
      const reuse = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookieA)
      expect(reuse.status).toBe(401)

      // Новый тоже мёртв после разрыва цепочки.
      const afterBreak = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookieB)
      expect(afterBreak.status).toBe(401)
    })
  })

  describe('POST /auth/register-by-invite', () => {
    async function makeInvite(token: string) {
      return prisma.invite.create({
        data: {
          token,
          role: 'UNIVERSITY_ADMIN',
          email: 'newadmin@t.io',
          universityId: 'uni-e2e',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 3_600_000),
          createdById: adminId,
        },
      })
    }

    it('успех: создаёт пользователя с ролью из инвайта + авто-вход', async () => {
      await makeInvite('e2e-ok')
      const res = await request(server).post('/api/v1/auth/register-by-invite').send({
        token: 'e2e-ok',
        firstName: 'Иван',
        lastName: 'Деканов',
        password: 'Passw0rd!',
      })
      expect([200, 201]).toContain(res.status)
      expect(res.body.data.accessToken).toEqual(expect.any(String))

      const user = await prisma.user.findUnique({ where: { email: 'newadmin@t.io' } })
      expect(user?.role).toBe('UNIVERSITY_ADMIN')
      expect(user?.universityId).toBe('uni-e2e')
    })

    it('повторное использование токена → 410 INVITE_USED', async () => {
      await makeInvite('e2e-once')
      const body = {
        token: 'e2e-once',
        firstName: 'A',
        lastName: 'B',
        password: 'Passw0rd!',
      }
      const first = await request(server).post('/api/v1/auth/register-by-invite').send(body)
      expect([200, 201]).toContain(first.status)

      const second = await request(server)
        .post('/api/v1/auth/register-by-invite')
        .send({ ...body, firstName: 'Дубль' })
      expect(second.status).toBe(410)
      expect(second.body.error.code).toBe('INVITE_USED')
    })
  })
})
