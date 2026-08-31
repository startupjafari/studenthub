import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import request from 'supertest'
import { authenticator } from 'otplib'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'

// identifier — новое поле логина (email ИЛИ username); email оставляем для создания юзера в сидах.
const LOGIN = { email: 'admin@t.io', identifier: 'admin@t.io', password: 'Admin1234!' }

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
    // Сброс счётчиков rate-limit между тестами: overrideGuard(ThrottlerGuard) не отключает
    // подсчёт по IP, а 2FA-сценарии делают несколько логинов — иначе упираемся в 5/15мин.
    ;(app.get(ThrottlerStorage) as unknown as { storage: Map<string, unknown> }).storage.clear()
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
        .send({ identifier: LOGIN.email, password: 'wrong' })
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

  describe('POST /auth/refresh — ротация, окно грации и разрыв цепочки', () => {
    // Окно грации в тестах — 300 мс (test/setup-env.cjs), поэтому обе ветки проверяются
    // в одном прогоне без долгих пауз.
    const GRACE_MS = 300

    it('ротация выдаёт новый токен', async () => {
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const cookieA = getCookie(login, 'sh_refresh') as string

      const r1 = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookieA)
      expect([200, 201]).toContain(r1.status)
      const cookieB = getCookie(r1, 'sh_refresh') as string
      expect(cookieB).toBeTruthy()
      expect(cookieB).not.toEqual(cookieA)
    })

    it('повтор сразу после ротации не рвёт сессию — ответ мог не доехать до клиента', async () => {
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const cookieA = getCookie(login, 'sh_refresh') as string
      const r1 = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookieA)
      const cookieB = getCookie(r1, 'sh_refresh') as string

      // Клиент не получил ответ (оборвалась навигация) и повторяет обмен старым токеном.
      const retry = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookieA)
      expect([200, 201]).toContain(retry.status)
      const cookieC = getCookie(retry, 'sh_refresh') as string
      expect(cookieC).toBeTruthy()
      expect(cookieC).not.toEqual(cookieB)

      // Живым остаётся ровно последний выданный токен: цепочка цела, но инвариант сохранён.
      const withLatest = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookieC)
      expect([200, 201]).toContain(withLatest.status)
    })

    it('повтор после окна грации рвёт всю цепочку', async () => {
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const cookieA = getCookie(login, 'sh_refresh') as string
      const r1 = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookieA)
      const cookieB = getCookie(r1, 'sh_refresh') as string

      await new Promise((resolve) => setTimeout(resolve, GRACE_MS + 200))

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
        username: 'ivandekanov',
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
        username: 'user_once',
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

  describe('2FA (TOTP)', () => {
    // Включает 2FA админу через реальные эндпоинты; возвращает secret + backup-коды.
    async function enable2fa(): Promise<{ secret: string; backupCodes: string[] }> {
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const token = login.body.data.accessToken as string
      const setup = await request(server)
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${token}`)
      const secret = setup.body.data.secret as string
      // QR отдаётся как SVG (common/qr/qr-image.ts) — фирменный рендер со скруглениями и логотипом.
      expect(setup.body.data.qr).toContain('data:image/svg+xml;base64,')
      const enable = await request(server)
        .post('/api/v1/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: authenticator.generate(secret) })
      expect([200, 201]).toContain(enable.status)
      const backupCodes = enable.body.data.backupCodes as string[]
      expect(backupCodes).toHaveLength(10)
      return { secret, backupCodes }
    }

    it('при включённой 2FA login отдаёт challenge без токенов/кук', async () => {
      await enable2fa()
      const res = await request(server).post('/api/v1/auth/login').send(LOGIN)
      expect([200, 201]).toContain(res.status)
      expect(res.body.data.twoFactorRequired).toBe(true)
      expect(res.body.data.challengeToken).toEqual(expect.any(String))
      expect(res.body.data.accessToken).toBeUndefined()
      expect(getCookie(res, 'sh_refresh')).toBeNull()
    })

    it('login/2fa с верным TOTP → accessToken + cookies', async () => {
      const { secret } = await enable2fa()
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const challengeToken = login.body.data.challengeToken as string
      const res = await request(server)
        .post('/api/v1/auth/login/2fa')
        .send({ challengeToken, code: authenticator.generate(secret) })
      expect([200, 201]).toContain(res.status)
      expect(res.body.data.accessToken).toEqual(expect.any(String))
      expect(getCookie(res, 'sh_refresh')).toBeTruthy()
      expect(getCookie(res, 'sh_role')).toBeTruthy()
    })

    it('login/2fa с неверным кодом → 401 INVALID_2FA_CODE', async () => {
      await enable2fa()
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const challengeToken = login.body.data.challengeToken as string
      const res = await request(server)
        .post('/api/v1/auth/login/2fa')
        .send({ challengeToken, code: '000000' })
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_2FA_CODE')
    })

    it('login/2fa по backup-коду → успех, повтор того же кода → отказ', async () => {
      const { backupCodes } = await enable2fa()
      const code = backupCodes[0]

      const login1 = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const ok = await request(server)
        .post('/api/v1/auth/login/2fa')
        .send({ challengeToken: login1.body.data.challengeToken, code })
      expect([200, 201]).toContain(ok.status)
      expect(ok.body.data.accessToken).toEqual(expect.any(String))

      // Тот же backup-код одноразовый — второй раз не проходит.
      const login2 = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const reuse = await request(server)
        .post('/api/v1/auth/login/2fa')
        .send({ challengeToken: login2.body.data.challengeToken, code })
      expect(reuse.status).toBe(401)
    })

    it('disable отключает 2FA → login снова отдаёт токены напрямую', async () => {
      const { secret } = await enable2fa()
      // Войти (через 2FA), получить access-токен.
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const verified = await request(server)
        .post('/api/v1/auth/login/2fa')
        .send({
          challengeToken: login.body.data.challengeToken,
          code: authenticator.generate(secret),
        })
      const token = verified.body.data.accessToken as string

      const disable = await request(server)
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: authenticator.generate(secret) })
      expect([200, 201]).toContain(disable.status)

      const res = await request(server).post('/api/v1/auth/login').send(LOGIN)
      expect(res.body.data.accessToken).toEqual(expect.any(String))
      expect(res.body.data.twoFactorRequired).toBeUndefined()
    })

    it('challenge-токен нельзя использовать как access-токен (GET /auth/me)', async () => {
      await enable2fa()
      const login = await request(server).post('/api/v1/auth/login').send(LOGIN)
      const challengeToken = login.body.data.challengeToken as string
      const me = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${challengeToken}`)
      expect(me.status).toBe(401)
    })
  })
})
