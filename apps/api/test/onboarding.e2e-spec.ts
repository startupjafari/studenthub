import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { throttlerStorageStub } from './throttler-storage.stub'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'

const PASSWORD = 'Passw0rd!'
const UNIVERSITY_NAME = 'Алатауский технический университет'
const APPLICANT_EMAIL = 'rector@alatau-e2e.kz'
// Письмо об одобрении тест не читает: токен приглашения в базе — хэш, поэтому после
// одобрения подменяем его известным открытым значением (поиск такие токены понимает).
const ADMIN_INVITE_TOKEN = 'e2e-onboarding-admin'

/**
 * Приход вуза целиком (B-01 → B-03): демо-заявка → одобрение платформой → регистрация
 * админа вуза по приглашению → мастер → запуск.
 *
 * Юнит-тесты закрывают каждый шаг по отдельности; здесь — что шаги сцеплены через
 * настоящие маршруты, guard'ы и базу: одобрение заводит ровно один вуз даже при двойном
 * клике, приглашение из одобрения ведёт в этот вуз, мастер считает шаги по данным, а
 * запуск переводит вуз в ACTIVE только из PENDING.
 *
 * Шаги идут по порядку и опираются на состояние предыдущих (jest исполняет `it` файла
 * последовательно).
 */
describe('Приход вуза: заявка → одобрение → админ → мастер → запуск (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let passwords: PasswordService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>

  let platformToken: string
  let platformAdminId: string
  let requestId: string
  let universityId: string
  let inviteId: string
  let adminToken: string

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
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    prisma = app.get(PrismaService)
    passwords = app.get(PasswordService)
    server = app.getHttpServer()

    await seed()
  })

  afterAll(async () => {
    await app.close()
  })

  async function seed(): Promise<void> {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE university_demo_requests, university_onboarding, audit_logs, refresh_tokens, invites, terms, groups, faculties, users, universities RESTART IDENTITY CASCADE',
    )
    const admin = await prisma.user.create({
      data: {
        email: 'platform-admin@studenthub.e2e',
        passwordHash: await passwords.hash(PASSWORD),
        firstName: 'Платформа',
        lastName: 'Админ',
        role: 'PLATFORM_ADMIN',
      },
    })
    platformAdminId = admin.id
    platformToken = await login('platform-admin@studenthub.e2e')

    // Заявка уже прошла подтверждение адреса и ждёт решения платформы.
    const demo = await prisma.universityDemoRequest.create({
      data: {
        universityName: UNIVERSITY_NAME,
        city: 'Алматы',
        country: 'Казахстан',
        contactName: 'Аружан Оспанова',
        email: APPLICANT_EMAIL,
        status: 'NEW',
        consentAt: new Date(),
        consentVersion: 'e2e',
      },
    })
    requestId = demo.id
  }

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(201)
    return res.body.data.accessToken as string
  }

  const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` })

  const approve = () =>
    request(server)
      .post(`/api/v1/demo-requests/${requestId}/approve`)
      .set(auth(platformToken))
      .send({})

  const onboarding = (path = '', body?: Record<string, unknown>) => {
    const req = path
      ? request(server).post(`/api/v1/onboarding/${path}`).set(auth(adminToken))
      : request(server).get('/api/v1/onboarding').set(auth(adminToken))
    return body ? req.send(body) : req
  }

  it('два одновременных «Одобрить» заводят один вуз, один мастер и одно приглашение', async () => {
    const [first, second] = await Promise.all([approve(), approve()])

    expect([first.status, second.status].sort()).toEqual([200, 409])
    const loser = first.status === 409 ? first : second
    expect(loser.body.error.code).toBe('CONFLICT')

    const universities = await prisma.university.findMany({
      where: { name: UNIVERSITY_NAME },
      select: { id: true, status: true },
      take: 5,
    })
    expect(universities).toHaveLength(1)
    expect(universities[0]!.status).toBe('PENDING')
    universityId = universities[0]!.id

    const invites = await prisma.invite.findMany({
      where: { email: APPLICANT_EMAIL, role: 'UNIVERSITY_ADMIN' },
      select: { id: true, universityId: true, status: true, token: true },
      take: 5,
    })
    expect(invites).toHaveLength(1)
    expect(invites[0]).toMatchObject({ universityId, status: 'PENDING' })
    // В базе — хэш, а не сам токен из письма.
    expect(invites[0]!.token).toMatch(/^[0-9a-f]{64}$/)
    inviteId = invites[0]!.id

    await expect(prisma.universityOnboarding.count({ where: { universityId } })).resolves.toBe(1)
    const decided = await prisma.universityDemoRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true, universityId: true, inviteId: true, reviewedById: true },
    })
    expect(decided).toEqual({
      status: 'APPROVED',
      universityId,
      inviteId,
      reviewedById: platformAdminId,
    })
  })

  it('по решённой заявке ни повторное одобрение, ни отказ не проходят', async () => {
    const again = await approve()
    expect(again.status).toBe(409)

    const reject = await request(server)
      .post(`/api/v1/demo-requests/${requestId}/reject`)
      .set(auth(platformToken))
      .send({ reason: 'DUPLICATE' })
    expect(reject.status).toBe(409)

    await expect(prisma.university.count({ where: { name: UNIVERSITY_NAME } })).resolves.toBe(1)
    await expect(
      prisma.universityDemoRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'APPROVED' })
  })

  it('админ вуза регистрируется по приглашению из одобрения и попадает в свой вуз', async () => {
    await prisma.invite.update({ where: { id: inviteId }, data: { token: ADMIN_INVITE_TOKEN } })

    const res = await request(server).post('/api/v1/auth/register-by-invite').send({
      token: ADMIN_INVITE_TOKEN,
      username: 'alatau_admin',
      firstName: 'Аружан',
      lastName: 'Оспанова',
      password: PASSWORD,
      birthDate: '1985-03-12',
      consent: true,
    })
    expect([200, 201]).toContain(res.status)
    adminToken = res.body.data.accessToken as string

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: APPLICANT_EMAIL },
      select: { role: true, universityId: true },
    })
    expect(user).toEqual({ role: 'UNIVERSITY_ADMIN', universityId })
    await expect(
      prisma.invite.findUniqueOrThrow({ where: { id: inviteId }, select: { status: true } }),
    ).resolves.toEqual({ status: 'USED' })
  })

  it('новый вуз открывает мастер на первом шаге, запуск закрыт', async () => {
    const state = await onboarding().expect(200)
    expect(state.body.data.university).toMatchObject({ id: universityId, status: 'PENDING' })
    expect(state.body.data.currentStep).toBe('profile')
    expect(state.body.data.canLaunch).toBe(false)

    // Сервер не верит кнопке: незаполненные шаги держат запуск.
    const launch = await onboarding('launch')
    expect(launch.status).toBe(400)
    // Без групп платформа не работает — этот шаг пропустить нельзя: схема не пускает
    // непропускаемый шаг дальше валидации.
    const skip = await onboarding('skip', { step: 'groups' })
    expect(skip.status).toBe(422)
    expect(skip.body.error.code).toBe('VALIDATION_ERROR')

    await expect(
      prisma.university.findUniqueOrThrow({
        where: { id: universityId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PENDING' })
  })

  it('шаги закрываются данными вуза и пропуском необязательных', async () => {
    await onboarding('confirm-profile').expect(200)

    const faculty = await prisma.faculty.create({
      data: { name: 'Факультет информационных технологий', universityId },
    })
    await prisma.group.create({ data: { name: 'ИТ-26-1', facultyId: faculty.id } })
    await prisma.term.create({
      data: {
        universityId,
        name: 'Осенний семестр 2026',
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2026-12-31'),
      },
    })
    // Выписанное приглашение декану закрывает шаг наравне с принятым.
    await prisma.invite.create({
      data: {
        token: `e2e-dean-${randomUUID()}`,
        role: 'DEAN',
        universityId,
        facultyId: faculty.id,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdById: platformAdminId,
      },
    })
    for (const step of ['specialties', 'rooms', 'subjects']) {
      await onboarding('skip', { step }).expect(200)
    }

    const state = await onboarding().expect(200)
    expect(state.body.data.blocking).toEqual([])
    expect(state.body.data.currentStep).toBe('launch')
    expect(state.body.data.canLaunch).toBe(true)
  })

  it('запуск переводит вуз в ACTIVE и закрывает мастер; повторный запуск → 409', async () => {
    const launched = await onboarding('launch').expect(200)
    expect(launched.body.data.university.status).toBe('ACTIVE')
    expect(launched.body.data.canLaunch).toBe(false)

    const record = await prisma.universityOnboarding.findUniqueOrThrow({
      where: { universityId },
      select: { completedAt: true },
    })
    expect(record.completedAt).toBeInstanceOf(Date)

    const again = await onboarding('launch')
    expect(again.status).toBe(409)
  })

  it('заблокированный платформой вуз админ запуском не разблокирует', async () => {
    await prisma.university.update({ where: { id: universityId }, data: { status: 'BLOCKED' } })

    const res = await onboarding('launch')

    // 403 — доступ вуза уже закрыт на входе; 409 — статус ещё в памяти процесса как
    // ACTIVE, и отказывает сам запуск. В обоих случаях блокировка остаётся.
    expect([403, 409]).toContain(res.status)
    await expect(
      prisma.university.findUniqueOrThrow({
        where: { id: universityId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'BLOCKED' })
  })
})
