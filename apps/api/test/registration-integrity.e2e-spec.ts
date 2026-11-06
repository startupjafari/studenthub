import { createHash } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import request from 'supertest'
import { Role } from '@studenthub/shared-types'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'
import { throttlerStorageStub } from './throttler-storage.stub'

const PASSWORD = 'Passw0rd!'
/** Сколько регистраций по одной ссылке пускаем одновременно. */
const RACERS = 5
/**
 * Сколько раз повторяем гонку на свежих ссылках. Неудачное чередование транзакций случается
 * не на каждом прогоне: с одним раундом тест на сломанном коде проходил через раз.
 */
const ROUNDS = 5

/**
 * Целостность регистрации (21.E4, пункты приёмки Ф1 и 21.D2).
 *
 * 1. Гонка: несколько одновременных регистраций по одной ссылке — инвайту вуза или
 *    приглашению в компанию — создают ровно одного пользователя, остальные получают `410`.
 *    Защита держится на условной записи «PENDING → USED/ACCEPTED» в транзакции; проверяем
 *    её настоящими параллельными запросами к настоящему Postgres, а не моками.
 * 2. Подмена: роль и scope (`role`, `universityId`, `facultyId`, `groupId`) берутся только из
 *    инвайта или из JWT выдавшего. Лишние поля в теле регистрации отвергаются схемой
 *    (`.strict()` → `422`), а при создании инвайта чужой scope даёт `403`, свой — молча
 *    заменяется scope выдавшего. Фиксируем фактическое поведение.
 */
describe('Регистрация: гонка и подмена роли/scope (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let passwords: PasswordService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>

  /** Идентификаторы оргструктуры: вуз A (свой) с двумя факультетами и вуз B (чужой). */
  const ids = {
    uniA: 'uni-a',
    uniB: 'uni-b',
    facA1: '',
    facA2: '',
    facB: '',
    groupA1: '',
    groupA2: '',
    groupB: '',
  }
  const tokens: Partial<Record<'platform' | 'uniAdmin' | 'dean' | 'starosta' | 'student', string>> =
    {}

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
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE audit_logs, refresh_tokens, invites, company_invites, company_members, companies, groups, faculties, universities, users RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: ids.uniA, name: 'Вуз A' } })
    await prisma.university.create({ data: { id: ids.uniB, name: 'Вуз B' } })
    const facA1 = await prisma.faculty.create({ data: { name: 'Ф A1', universityId: ids.uniA } })
    const facA2 = await prisma.faculty.create({ data: { name: 'Ф A2', universityId: ids.uniA } })
    const facB = await prisma.faculty.create({ data: { name: 'Ф B', universityId: ids.uniB } })
    ids.facA1 = facA1.id
    ids.facA2 = facA2.id
    ids.facB = facB.id
    ids.groupA1 = (await prisma.group.create({ data: { name: 'A1-101', facultyId: facA1.id } })).id
    ids.groupA2 = (await prisma.group.create({ data: { name: 'A2-101', facultyId: facA2.id } })).id
    ids.groupB = (await prisma.group.create({ data: { name: 'B-101', facultyId: facB.id } })).id

    await makeUser('platform@t.io', Role.PLATFORM_ADMIN, {})
    await makeUser('uniadmin@t.io', Role.UNIVERSITY_ADMIN, { universityId: ids.uniA })
    await makeUser('dean@t.io', Role.DEAN, { universityId: ids.uniA, facultyId: ids.facA1 })
    await makeUser('starosta@t.io', Role.STAROSTA, {
      universityId: ids.uniA,
      facultyId: ids.facA1,
      groupId: ids.groupA1,
    })
    await makeUser('student@t.io', Role.STUDENT, {
      universityId: ids.uniA,
      facultyId: ids.facA1,
      groupId: ids.groupA1,
    })
    tokens.platform = await login('platform@t.io')
    tokens.uniAdmin = await login('uniadmin@t.io')
    tokens.dean = await login('dean@t.io')
    tokens.starosta = await login('starosta@t.io')
    tokens.student = await login('student@t.io')
  })

  async function makeUser(
    email: string,
    role: Role,
    scope: { universityId?: string; facultyId?: string; groupId?: string },
  ): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(PASSWORD),
        firstName: 'Имя',
        lastName: 'Фамилия',
        role,
        ...scope,
      },
    })
    return user.id
  }

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(201)
    return res.body.data.accessToken as string
  }

  const auth = (token: string | undefined) => ({ Authorization: `Bearer ${token}` })

  /** Инвайт студента в группу декана — через API, как в жизни: в ответе сырой токен. */
  async function deanInvitesStudent(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/invites')
      .set(auth(tokens.dean))
      .send({ role: Role.STUDENT, email, groupId: ids.groupA1 })
      .expect(201)
    return res.body.data.token as string
  }

  function registerBody(token: string, username: string) {
    return {
      token,
      username,
      firstName: 'Новый',
      lastName: 'Студент',
      password: PASSWORD,
      birthDate: '2000-01-15',
      consent: true,
    }
  }

  // ── Гонка ─────────────────────────────────────────────────────────────────

  describe('гонка двойной регистрации', () => {
    it('инвайт вуза: из параллельных регистраций проходит одна, остальные 410 INVITE_USED', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const email = `racer${round}@t.io`
        const token = await deanInvitesStudent(email)

        const responses = await Promise.all(
          Array.from({ length: RACERS }, (_, i) =>
            request(server)
              .post('/api/v1/auth/register-by-invite')
              .send(registerBody(token, `racer_${round}_${i}`)),
          ),
        )

        expect(responses.filter((r) => r.status === 201)).toHaveLength(1)
        expect(
          responses.filter((r) => r.status !== 201).map((r) => `${r.status} ${r.body.error?.code}`),
        ).toEqual(Array(RACERS - 1).fill('410 INVITE_USED'))

        const users = await prisma.user.findMany({
          where: { email },
          select: { id: true },
          take: 10,
        })
        expect(users).toHaveLength(1)
        const invite = await prisma.invite.findFirst({
          where: { email },
          select: { status: true, usedById: true },
        })
        expect(invite).toEqual({ status: 'USED', usedById: users[0].id })
      }
    })

    it('приглашение компании: из параллельных регистраций проходит одна, остальные 410 INVITE_USED', async () => {
      const owner = await makeUser('owner@company.kz', Role.EMPLOYER, {})
      const company = await prisma.company.create({
        data: { name: 'ТОО Гонка', slug: 'race-co', status: 'ACTIVE', createdById: owner },
      })
      await prisma.companyMember.create({
        data: { companyId: company.id, userId: owner, role: 'OWNER' },
      })

      const recruiters: string[] = []
      for (let round = 0; round < ROUNDS; round += 1) {
        const email = `colleague${round}@company.kz`
        const raw = `race-company-invite-token-${round}`
        await prisma.companyInvite.create({
          data: {
            companyId: company.id,
            email,
            tokenHash: createHash('sha256').update(raw).digest('hex'),
            expiresAt: new Date(Date.now() + 3_600_000),
            invitedById: owner,
          },
        })

        const responses = await Promise.all(
          Array.from({ length: RACERS }, (_, i) =>
            request(server)
              .post('/api/v1/auth/register-by-company-invite')
              .send({ token: raw, password: PASSWORD, firstName: `Гонщик${i}`, lastName: 'Тест' }),
          ),
        )

        expect(responses.filter((r) => r.status === 201)).toHaveLength(1)
        // Именно 410, а не 409 «адрес занят»: проигравший запрос не должен отвечать так,
        // будто у человека уже был аккаунт до приглашения.
        expect(
          responses.filter((r) => r.status !== 201).map((r) => `${r.status} ${r.body.error?.code}`),
        ).toEqual(Array(RACERS - 1).fill('410 INVITE_USED'))

        const users = await prisma.user.findMany({
          where: { email },
          select: { id: true, role: true },
          take: 10,
        })
        expect(users).toEqual([{ id: expect.any(String), role: Role.EMPLOYER }])
        recruiters.push(users[0].id)
      }

      const members = await prisma.companyMember.findMany({
        where: { companyId: company.id, role: 'RECRUITER' },
        select: { userId: true },
        take: 50,
      })
      expect(members.map((m) => m.userId).sort()).toEqual([...recruiters].sort())
    })
  })

  // ── Подмена в теле регистрации ─────────────────────────────────────────────

  describe('подмена роли и scope в теле регистрации', () => {
    const SPOOFS: [string, () => Record<string, unknown>][] = [
      ['role', () => ({ role: Role.UNIVERSITY_ADMIN })],
      ['universityId', () => ({ universityId: ids.uniB })],
      ['facultyId', () => ({ facultyId: ids.facB })],
      ['groupId', () => ({ groupId: ids.groupB })],
    ]

    it.each(SPOOFS)(
      'по инвайту вуза: лишнее поле %s → 422, инвайт не израсходован',
      async (_field, spoof) => {
        const token = await deanInvitesStudent('spoof@t.io')
        const res = await request(server)
          .post('/api/v1/auth/register-by-invite')
          .send({ ...registerBody(token, 'spoofer'), ...spoof() })
        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')

        expect(await prisma.user.count({ where: { email: 'spoof@t.io' } })).toBe(0)
        const invite = await prisma.invite.findFirst({ where: { email: 'spoof@t.io' } })
        expect(invite?.status).toBe('PENDING')
      },
    )

    it('чистая регистрация по тому же инвайту берёт роль и scope только из инвайта', async () => {
      const token = await deanInvitesStudent('clean@t.io')
      await request(server)
        .post('/api/v1/auth/register-by-invite')
        .send(registerBody(token, 'clean_student'))
        .expect(201)
      const user = await prisma.user.findFirst({
        where: { email: 'clean@t.io' },
        select: { role: true, universityId: true, facultyId: true, groupId: true },
      })
      expect(user).toEqual({
        role: Role.STUDENT,
        universityId: ids.uniA,
        facultyId: ids.facA1,
        groupId: ids.groupA1,
      })
    })

    it.each(SPOOFS)(
      'по приглашению компании: лишнее поле %s → 422, приглашение не израсходовано',
      async (_field, spoof) => {
        const owner = await makeUser('owner@company.kz', Role.EMPLOYER, {})
        const company = await prisma.company.create({
          data: { name: 'ТОО Подмена', slug: 'spoof-co', status: 'ACTIVE', createdById: owner },
        })
        const raw = 'spoof-company-invite-token-0001'
        await prisma.companyInvite.create({
          data: {
            companyId: company.id,
            email: 'spoofer@company.kz',
            tokenHash: createHash('sha256').update(raw).digest('hex'),
            expiresAt: new Date(Date.now() + 3_600_000),
            invitedById: owner,
          },
        })
        const res = await request(server)
          .post('/api/v1/auth/register-by-company-invite')
          .send({ token: raw, password: PASSWORD, firstName: 'А', lastName: 'Б', ...spoof() })
        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(await prisma.user.count({ where: { email: 'spoofer@company.kz' } })).toBe(0)
        const invite = await prisma.companyInvite.findFirst({
          where: { email: 'spoofer@company.kz' },
        })
        expect(invite?.status).toBe('PENDING')
      },
    )

    it.each(SPOOFS)('саморегистрация работодателя: лишнее поле %s → 422', async (_field, spoof) => {
      const res = await request(server)
        .post('/api/v1/career/companies/signup')
        .send({
          email: 'self@company.kz',
          password: PASSWORD,
          firstName: 'А',
          lastName: 'Б',
          companyName: 'ТОО Сама',
          ...spoof(),
        })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(await prisma.user.count({ where: { email: 'self@company.kz' } })).toBe(0)
    })
  })

  // ── Подмена при создании инвайта ───────────────────────────────────────────

  describe('подмена роли и scope при создании инвайта', () => {
    type Issuer = 'platform' | 'uniAdmin' | 'dean' | 'starosta' | 'student'

    /** Отказы: роль не ниже своей / не своя цепочка / чужой scope. */
    const DENIED: {
      name: string
      issuer: Issuer
      body: () => Record<string, unknown>
      status: number
      code: string
    }[] = [
      {
        name: 'админ вуза выдаёт PLATFORM_ADMIN',
        issuer: 'uniAdmin',
        body: () => ({ role: Role.PLATFORM_ADMIN }),
        status: 403,
        code: 'FORBIDDEN',
      },
      {
        name: 'админ вуза выдаёт UNIVERSITY_ADMIN чужому вузу',
        issuer: 'uniAdmin',
        body: () => ({ role: Role.UNIVERSITY_ADMIN, universityId: ids.uniB }),
        status: 403,
        code: 'FORBIDDEN',
      },
      {
        name: 'админ вуза выдаёт преподавателя на факультет чужого вуза',
        issuer: 'uniAdmin',
        body: () => ({ role: Role.TEACHER, facultyId: ids.facB }),
        status: 403,
        code: 'WRONG_SCOPE',
      },
      {
        name: 'декан выдаёт DEAN',
        issuer: 'dean',
        body: () => ({ role: Role.DEAN, facultyId: ids.facA1 }),
        status: 403,
        code: 'FORBIDDEN',
      },
      {
        name: 'декан выдаёт преподавателя на чужой факультет своего вуза',
        issuer: 'dean',
        body: () => ({ role: Role.TEACHER, facultyId: ids.facA2 }),
        status: 403,
        code: 'WRONG_SCOPE',
      },
      {
        name: 'декан выдаёт студента в группу чужого факультета',
        issuer: 'dean',
        body: () => ({ role: Role.STUDENT, groupId: ids.groupA2 }),
        status: 403,
        code: 'WRONG_SCOPE',
      },
      {
        name: 'декан выдаёт студента в группу чужого вуза',
        issuer: 'dean',
        body: () => ({ role: Role.STUDENT, groupId: ids.groupB, universityId: ids.uniB }),
        status: 403,
        code: 'WRONG_SCOPE',
      },
      {
        name: 'староста выдаёт студента в чужую группу',
        issuer: 'starosta',
        body: () => ({ role: Role.STUDENT, groupId: ids.groupA2 }),
        status: 403,
        code: 'WRONG_SCOPE',
      },
      {
        name: 'староста выдаёт преподавателя',
        issuer: 'starosta',
        body: () => ({ role: Role.TEACHER }),
        status: 403,
        code: 'FORBIDDEN',
      },
      {
        name: 'кто угодно выдаёт EMPLOYER (работодатель регистрируется сам)',
        issuer: 'uniAdmin',
        body: () => ({ role: Role.EMPLOYER }),
        status: 403,
        code: 'FORBIDDEN',
      },
      {
        name: 'студент выдаёт студента',
        issuer: 'student',
        body: () => ({ role: Role.STUDENT, groupId: ids.groupA1 }),
        status: 403,
        code: 'FORBIDDEN',
      },
    ]

    it.each(DENIED)('$name → $status $code', async ({ issuer, body, status, code }) => {
      const res = await request(server)
        .post('/api/v1/invites')
        .set(auth(tokens[issuer]))
        .send(body())
      expect(res.status).toBe(status)
      expect(res.body.error.code).toBe(code)
      expect(await prisma.invite.count()).toBe(0)
    })

    /** Принятые запросы: подставленный scope молча заменяется scope выдавшего. */
    const OVERRIDDEN: {
      name: string
      issuer: Issuer
      body: () => Record<string, unknown>
      expected: () => {
        role: Role
        universityId: string
        facultyId: string | null
        groupId: string | null
      }
    }[] = [
      {
        name: 'админ вуза: библиотекарь с universityId чужого вуза — вуз берётся из JWT',
        issuer: 'uniAdmin',
        body: () => ({ role: Role.LIBRARIAN, universityId: ids.uniB, facultyId: ids.facB }),
        expected: () => ({
          role: Role.LIBRARIAN,
          universityId: ids.uniA,
          facultyId: null,
          groupId: null,
        }),
      },
      {
        name: 'декан: студент своей группы с чужими universityId и facultyId — scope декана',
        issuer: 'dean',
        body: () => ({
          role: Role.STUDENT,
          groupId: ids.groupA1,
          universityId: ids.uniB,
          facultyId: ids.facA2,
        }),
        expected: () => ({
          role: Role.STUDENT,
          universityId: ids.uniA,
          facultyId: ids.facA1,
          groupId: ids.groupA1,
        }),
      },
      {
        name: 'староста: студент без группы, с чужими universityId и facultyId — группа старосты',
        issuer: 'starosta',
        body: () => ({ role: Role.STUDENT, universityId: ids.uniB, facultyId: ids.facB }),
        expected: () => ({
          role: Role.STUDENT,
          universityId: ids.uniA,
          facultyId: ids.facA1,
          groupId: ids.groupA1,
        }),
      },
    ]

    it.each(OVERRIDDEN)('$name', async ({ issuer, body, expected }) => {
      const res = await request(server)
        .post('/api/v1/invites')
        .set(auth(tokens[issuer]))
        .send(body())
        .expect(201)
      const invite = await prisma.invite.findUnique({
        where: { id: res.body.data.id as string },
        select: { role: true, universityId: true, facultyId: true, groupId: true },
      })
      expect(invite).toEqual(expected())
    })

    it('приглашение в компанию: роль и компанию в теле не принять (422)', async () => {
      const owner = await makeUser('owner@company.kz', Role.EMPLOYER, {})
      const company = await prisma.company.create({
        data: { name: 'ТОО Владелец', slug: 'owner-co', status: 'ACTIVE', createdById: owner },
      })
      const foreign = await prisma.company.create({
        data: { name: 'ТОО Чужая', slug: 'foreign-co', status: 'ACTIVE' },
      })
      await prisma.companyMember.create({
        data: { companyId: company.id, userId: owner, role: 'OWNER' },
      })
      const ownerToken = await login('owner@company.kz')

      for (const spoof of [{ role: 'OWNER' }, { companyId: foreign.id }]) {
        const res = await request(server)
          .post('/api/v1/career/companies/me/invites')
          .set(auth(ownerToken))
          .send({ email: 'hire@company.kz', ...spoof })
        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
      }
      expect(await prisma.companyInvite.count()).toBe(0)

      // Контроль: то же без лишних полей проходит, и приглашение — RECRUITER своей компании.
      await request(server)
        .post('/api/v1/career/companies/me/invites')
        .set(auth(ownerToken))
        .send({ email: 'hire@company.kz' })
        .expect(201)
      const invite = await prisma.companyInvite.findFirst({
        select: { companyId: true, role: true },
      })
      expect(invite).toEqual({ companyId: company.id, role: 'RECRUITER' })
    })
  })
})
