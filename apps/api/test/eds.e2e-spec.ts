import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import request from 'supertest'
import { authenticator } from 'otplib'
import { Role } from '@studenthub/shared-types'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'
import { QueueService } from '../src/common/queue/queue.service'
import { EdsVerifier, type VerifiedEdsSigner } from '../src/common/eds/eds-verifier'
import { AppException } from '../src/common/exceptions/app.exception'
import { throttlerStorageStub } from './throttler-storage.stub'

// Вход по ЭЦП сквозным прогоном (docs/PROJECT.md §8.3 «Вход по ЭЦП»). NCANode в e2e нет:
// EdsVerifier подменён фейком, а «подпись» — это base64 от { iin, nonce, cn }. Фейк, как и
// настоящий верификатор, принимает подпись только над выданными байтами nonce — иначе
// одноразовость challenge проверялась бы вхолостую. Флаг и секрет ИИН — test/setup-env.cjs.

const PASSWORD = 'Passw0rd!'
const UNIVERSITY_ID = 'uni-eds'
const DEAN_IIN = '850315400123'
const STRANGER_IIN = '770101300999'

interface FakeSignature {
  iin: string
  nonce: string
  cn: string
}

class FakeEdsVerifier extends EdsVerifier {
  async verifyAuthSignature(cmsBase64: string, data: Buffer): Promise<VerifiedEdsSigner> {
    let signed: FakeSignature
    try {
      signed = JSON.parse(Buffer.from(cmsBase64, 'base64').toString('utf8')) as FakeSignature
    } catch {
      throw new AppException('EDS_SIGNATURE_INVALID', 'Подпись повреждена')
    }
    if (!Buffer.from(signed.nonce, 'base64').equals(data)) {
      throw new AppException('EDS_SIGNATURE_INVALID', 'Подписаны не те данные')
    }
    return {
      iin: signed.iin,
      orgBin: null,
      subjectCn: signed.cn,
      certSerial: `serial-${signed.iin.slice(-4)}`,
      certIssuer: 'ҰЛТТЫҚ КУӘЛАНДЫРУШЫ ОРТАЛЫҚ (RSA)',
      certNotBefore: new Date(Date.now() - 24 * 60 * 60 * 1000),
      certNotAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }
  }
}

/** «Подписать» nonce ключом с этим ИИН — то, что в браузере делает NCALayer. */
function sign(nonce: string, iin: string, cn = 'ДЕКАНОВА АЙГУЛЬ'): string {
  return Buffer.from(JSON.stringify({ iin, nonce, cn } satisfies FakeSignature)).toString('base64')
}

function getCookie(res: request.Response, name: string): string | null {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  for (const c of raw ?? []) {
    if (c.startsWith(`${name}=`)) return c.split(';')[0] ?? null
  }
  return null
}

describe('Вход по ЭЦП (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>
  let passwordHash: string
  const emails: Array<{ name: string; payload: Record<string, unknown> }> = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorage)
      .useValue(throttlerStorageStub)
      .overrideProvider(EdsVerifier)
      .useValue(new FakeEdsVerifier())
      // Письма — в массив: прогон не ставит задачи в общий dev-Redis, где их подобрал бы
      // чужой воркер.
      .overrideProvider(QueueService)
      .useValue({
        enqueue: async (_queue: string, name: string, payload: Record<string, unknown>) => {
          emails.push({ name, payload })
          return true
        },
        counts: async () => [],
        lastFailedReason: async () => null,
      })
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.setGlobalPrefix('api/v1')
    await app.register(cookie)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    prisma = app.get(PrismaService)
    server = app.getHttpServer()
    passwordHash = await app.get(PasswordService).hash(PASSWORD)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    emails.length = 0
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE audit_logs, refresh_tokens, user_eds_credentials, users, universities RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: UNIVERSITY_ID, name: 'Вуз ЭЦП' } })
  })

  async function makeUser(role: Role, email: string, lastName: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Айгуль',
        lastName,
        role,
        universityId: UNIVERSITY_ID,
      },
      select: { id: true },
    })
    return user.id
  }

  async function passwordLogin(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(201)
    return res.body.data.accessToken as string
  }

  /** Включить 2FA через API; токен остаётся рабочим (форс 2FA в e2e выключен). */
  async function enableTwoFactor(token: string): Promise<string[]> {
    const setup = await request(server)
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
    const enable = await request(server)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: authenticator.generate(setup.body.data.secret as string) })
      .expect(201)
    return enable.body.data.backupCodes as string[]
  }

  /** Декан с 2FA: токен и резервные коды (TOTP-код второй раз не принимается — берём их). */
  async function deanWithTwoFactor(): Promise<{ id: string; token: string; codes: string[] }> {
    const id = await makeUser(Role.DEAN, 'dean@eds.e2e', 'Деканова')
    const token = await passwordLogin('dean@eds.e2e')
    const codes = await enableTwoFactor(token)
    return { id, token, codes }
  }

  async function link(token: string, iin: string, code: string, cn?: string) {
    const challenge = await request(server)
      .post('/api/v1/auth/eds/link/challenge')
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
    const { challengeId, nonce } = challenge.body.data as { challengeId: string; nonce: string }
    return request(server)
      .post('/api/v1/auth/eds/link')
      .set('Authorization', `Bearer ${token}`)
      .send({ challengeId, cms: sign(nonce, iin, cn), code })
  }

  async function loginChallenge(): Promise<{ challengeId: string; nonce: string }> {
    const res = await request(server).post('/api/v1/auth/eds/challenge').expect(201)
    return res.body.data as { challengeId: string; nonce: string }
  }

  it('GET /auth/eds/config — публично: вход по ЭЦП включён', async () => {
    const res = await request(server).get('/api/v1/auth/eds/config').expect(200)
    expect(res.body.data).toEqual({ enabled: true })
  })

  it('привязка → вход по ЭЦП → /users/me показывает привязку только владельцу', async () => {
    const dean = await deanWithTwoFactor()

    const linked = await link(dean.token, DEAN_IIN, dean.codes[0] as string)
    expect(linked.status).toBe(201)
    expect(linked.body.data).toMatchObject({
      iinLast4: '0123',
      subjectCn: 'ДЕКАНОВА АЙГУЛЬ',
      nameMismatch: false,
      lastUsedAt: null,
    })
    // Полного ИИН и его хэша в ответе нет.
    expect(JSON.stringify(linked.body)).not.toContain(DEAN_IIN)
    expect(linked.body.data).not.toHaveProperty('iinHash')
    // Владелец получил письмо о новом способе входа.
    expect(emails).toContainEqual(
      expect.objectContaining({
        name: 'send-eds-linked',
        payload: expect.objectContaining({ to: 'dean@eds.e2e', subjectCn: 'ДЕКАНОВА АЙГУЛЬ' }),
      }),
    )

    const { challengeId, nonce } = await loginChallenge()
    const login = await request(server)
      .post('/api/v1/auth/eds/login')
      .send({ challengeId, cms: sign(nonce, DEAN_IIN) })
    expect(login.status).toBe(201)
    expect(login.body.data.accessToken).toEqual(expect.any(String))
    // Сессия — как у входа по паролю: refresh в httpOnly-cookie и role-cookie.
    expect(getCookie(login, 'sh_refresh')).toBeTruthy()
    expect(getCookie(login, 'sh_role')).toBeTruthy()

    const me = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken as string}`)
      .expect(200)
    expect(me.body.data.id).toBe(dean.id)
    expect(me.body.data.eds).toMatchObject({ iinLast4: '0123', subjectCn: 'ДЕКАНОВА АЙГУЛЬ' })
    expect(me.body.data.eds.lastUsedAt).toEqual(expect.any(String))
    expect(JSON.stringify(me.body)).not.toContain(DEAN_IIN)

    // /auth/me отдаёт тот же профиль — и то же поле.
    const authMe = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken as string}`)
      .expect(200)
    expect(authMe.body.data.eds).toMatchObject({ iinLast4: '0123' })

    // Вход пишется в журнал с пометкой способа.
    const audit = await prisma.auditLog.findFirst({
      where: { userId: dean.id, action: 'login', metadata: { path: ['method'], equals: 'eds' } },
    })
    expect(audit).not.toBeNull()

    // В чужой карточке привязки нет вовсе.
    await makeUser(Role.UNIVERSITY_ADMIN, 'admin@eds.e2e', 'Админова')
    const adminToken = await passwordLogin('admin@eds.e2e')
    const card = await request(server)
      .get(`/api/v1/users/${dean.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect(card.body.data).not.toHaveProperty('eds')
  })

  it('challenge одноразовый: повторный вход тем же challenge → 401 EDS_SIGNATURE_INVALID', async () => {
    const dean = await deanWithTwoFactor()
    await link(dean.token, DEAN_IIN, dean.codes[0] as string).then((r) =>
      expect(r.status).toBe(201),
    )

    const { challengeId, nonce } = await loginChallenge()
    const cms = sign(nonce, DEAN_IIN)
    await request(server).post('/api/v1/auth/eds/login').send({ challengeId, cms }).expect(201)

    const replay = await request(server).post('/api/v1/auth/eds/login').send({ challengeId, cms })
    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('EDS_SIGNATURE_INVALID')
  })

  it('ключ, не привязанный ни к кому → 401 EDS_NOT_LINKED, сессии нет', async () => {
    const { challengeId, nonce } = await loginChallenge()
    const res = await request(server)
      .post('/api/v1/auth/eds/login')
      .send({ challengeId, cms: sign(nonce, STRANGER_IIN, 'ПРОХОЖИЙ ИВАН') })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('EDS_NOT_LINKED')
    expect(getCookie(res, 'sh_refresh')).toBeNull()
    expect(JSON.stringify(res.body)).not.toContain(STRANGER_IIN)
  })

  it('неверный код 2FA при привязке → 401 INVALID_2FA_CODE, привязки нет', async () => {
    const dean = await deanWithTwoFactor()
    const res = await link(dean.token, DEAN_IIN, 'ZZZZZZZZ')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_2FA_CODE')
    expect(await prisma.userEdsCredential.count()).toBe(0)
  })

  it('тот же ИИН к другой учётке → 409 EDS_ALREADY_LINKED', async () => {
    const dean = await deanWithTwoFactor()
    await link(dean.token, DEAN_IIN, dean.codes[0] as string).then((r) =>
      expect(r.status).toBe(201),
    )

    await makeUser(Role.UNIVERSITY_MODERATOR, 'moder@eds.e2e', 'Модераторова')
    const moderToken = await passwordLogin('moder@eds.e2e')
    const moderCodes = await enableTwoFactor(moderToken)
    const res = await link(moderToken, DEAN_IIN, moderCodes[0] as string)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EDS_ALREADY_LINKED')
  })

  it('студенту вход по ЭЦП недоступен: challenge привязки → 403 FORBIDDEN', async () => {
    await makeUser(Role.STUDENT, 'student@eds.e2e', 'Студентова')
    const token = await passwordLogin('student@eds.e2e')
    const res = await request(server)
      .post('/api/v1/auth/eds/link/challenge')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('админ вуза сбрасывает привязку декана своим кодом 2FA → вход по ЭЦП закрыт', async () => {
    const dean = await deanWithTwoFactor()
    await link(dean.token, DEAN_IIN, dean.codes[0] as string).then((r) =>
      expect(r.status).toBe(201),
    )

    await makeUser(Role.UNIVERSITY_ADMIN, 'admin@eds.e2e', 'Админова')
    const adminToken = await passwordLogin('admin@eds.e2e')
    const adminCodes = await enableTwoFactor(adminToken)

    await request(server)
      .post(`/api/v1/users/${dean.id}/eds/reset`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: adminCodes[0] })
      .expect(201)

    expect(await prisma.userEdsCredential.count({ where: { userId: dean.id } })).toBe(0)
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user_eds_reset', entityId: dean.id },
    })
    expect(audit).not.toBeNull()
    // Сессии декана не погашены: его прежний токен работает.
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${dean.token}`)
      .expect(200)

    const { challengeId, nonce } = await loginChallenge()
    const res = await request(server)
      .post('/api/v1/auth/eds/login')
      .send({ challengeId, cms: sign(nonce, DEAN_IIN) })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('EDS_NOT_LINKED')

    // Повторный сброс — привязки уже нет.
    const again = await request(server)
      .post(`/api/v1/users/${dean.id}/eds/reset`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: adminCodes[1] })
    expect(again.status).toBe(400)
  })

  it('владелец отвязывает свою ЭЦП → 204, в /users/me eds: null', async () => {
    const dean = await deanWithTwoFactor()
    await link(dean.token, DEAN_IIN, dean.codes[0] as string).then((r) =>
      expect(r.status).toBe(201),
    )

    await request(server)
      .delete('/api/v1/auth/eds')
      .set('Authorization', `Bearer ${dean.token}`)
      .send({ code: dean.codes[1] })
      .expect(204)

    const me = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${dean.token}`)
      .expect(200)
    expect(me.body.data.eds).toBeNull()
    const audit = await prisma.auditLog.findFirst({
      where: { userId: dean.id, action: 'eds_unlink' },
    })
    expect(audit).not.toBeNull()
  })
})
