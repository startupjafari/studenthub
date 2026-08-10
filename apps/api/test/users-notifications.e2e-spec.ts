import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'

const PASSWORD = 'Passw0rd!'

function getCookie(res: request.Response, name: string): string | null {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  for (const c of raw ?? []) {
    if (c.startsWith(`${name}=`)) return c.split(';')[0]
  }
  return null
}

describe('Users & Notifications (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let passwords: PasswordService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.setGlobalPrefix('api/v1')
    await app.register(cookie)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    prisma = app.get(PrismaService)
    passwords = app.get(PasswordService)
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    ;(app.get(ThrottlerStorage) as unknown as { storage: Map<string, unknown> }).storage.clear()
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE notification_settings, notifications, audit_logs, refresh_tokens, invites, files, groups, rooms, faculties, universities, users RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: 'uni-e2e', name: 'E2E University' } })
  })

  async function makeStudent(email: string, extra: Record<string, unknown> = {}): Promise<string> {
    const passwordHash = await passwords.hash(PASSWORD)
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Имя',
        lastName: 'Фамилия',
        role: 'STUDENT',
        universityId: 'uni-e2e',
        ...extra,
      },
    })
    return u.id
  }

  async function login(email: string): Promise<{ token: string; refresh: string | null }> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201)
    return { token: res.body.data.accessToken as string, refresh: getCookie(res, 'sh_refresh') }
  }

  describe('Приватность профиля', () => {
    it('студент не видит email/phone другого студента и passwordHash', async () => {
      const viewerId = await makeStudent('viewer@e2e.io')
      const targetId = await makeStudent('target@e2e.io', {
        phone: '+70000000000',
        showEmail: false,
        showPhone: false,
      })
      void viewerId
      const { token } = await login('viewer@e2e.io')

      const res = await request(server)
        .get(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(res.body.data).not.toHaveProperty('passwordHash')
      expect(res.body.data.email).toBeNull()
      expect(res.body.data.phone ?? null).toBeNull()
    })

    it('GET /users/me не отдаёт passwordHash', async () => {
      await makeStudent('me@e2e.io')
      const { token } = await login('me@e2e.io')
      const res = await request(server)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      expect(res.body.data).not.toHaveProperty('passwordHash')
      expect(res.body.data.email).toBe('me@e2e.io')
    })
  })

  describe('Смена пароля разлогинивает все устройства', () => {
    it('после смены пароля старый refresh-cookie не работает', async () => {
      await makeStudent('rotate@e2e.io')
      const { token, refresh } = await login('rotate@e2e.io')
      expect(refresh).toBeTruthy()

      await request(server)
        .patch('/api/v1/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'NewPassw0rd!' })
        .expect(200)

      // Старая сессия (refresh) должна быть инвалидирована.
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', refresh as string)
        .expect(401)
    })
  })

  describe('Удаление аккаунта анонимизирует ПДн', () => {
    it('DELETE /users/me затирает email/phone и помечает deletedAt', async () => {
      const id = await makeStudent('bye@e2e.io', { phone: '+70000000001', bio: 'секрет' })
      const { token } = await login('bye@e2e.io')

      await request(server)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      const row = await prisma.user.findUnique({ where: { id } })
      expect(row?.deletedAt).toBeTruthy()
      expect(row?.email).toContain('deleted+')
      expect(row?.phone).toBeNull()
      expect(row?.bio).toBeNull()
    })
  })

  describe('Уведомления: список / счётчик / прочтение / настройки', () => {
    async function seedNotification(userId: string): Promise<string> {
      const n = await prisma.notification.create({
        data: { userId, type: 'SYSTEM', title: 'Заголовок', body: 'Текст' },
      })
      return n.id
    }

    it('list + unread-count + mark read', async () => {
      const id = await makeStudent('notif@e2e.io')
      const notifId = await seedNotification(id)
      const { token } = await login('notif@e2e.io')
      const auth = { Authorization: `Bearer ${token}` }

      const list = await request(server).get('/api/v1/notifications').set(auth).expect(200)
      expect(Array.isArray(list.body.data)).toBe(true)
      expect(list.body.data).toHaveLength(1)

      const before = await request(server)
        .get('/api/v1/notifications/unread-count')
        .set(auth)
        .expect(200)
      expect(before.body.data.count).toBe(1)

      await request(server).patch(`/api/v1/notifications/${notifId}/read`).set(auth).expect(200)

      const after = await request(server)
        .get('/api/v1/notifications/unread-count')
        .set(auth)
        .expect(200)
      expect(after.body.data.count).toBe(0)
    })

    it('чужое уведомление недоступно (mark read → 404)', async () => {
      const owner = await makeStudent('owner@e2e.io')
      await makeStudent('intruder@e2e.io')
      const notifId = await seedNotification(owner)
      const { token } = await login('intruder@e2e.io')

      await request(server)
        .patch(`/api/v1/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404)
    })

    it('settings: get создаёт дефолт, patch сохраняет', async () => {
      await makeStudent('settings@e2e.io')
      const { token } = await login('settings@e2e.io')
      const auth = { Authorization: `Bearer ${token}` }

      const def = await request(server).get('/api/v1/notifications/settings').set(auth).expect(200)
      expect(def.body.data.emailEnabled).toBe(true)

      const patched = await request(server)
        .patch('/api/v1/notifications/settings')
        .set(auth)
        .send({ emailEnabled: false })
        .expect(200)
      expect(patched.body.data.emailEnabled).toBe(false)
    })
  })
})
