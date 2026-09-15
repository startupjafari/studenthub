import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'
import { QueueService } from '../src/common/queue'

const PASSWORD = 'Passw0rd!'

/** Перехваченный job очереди — из него достаём ссылку подтверждения вместо чтения почты. */
interface CapturedJob {
  queue: string
  name: string
  payload: Record<string, unknown>
}

/**
 * Карьера (Ф18) — сквозной поток, который до сих пор не был закрыт ни одним тестом:
 * регистрация работодателя → подтверждение email → допуск вуза → публикация вакансии →
 * модерация вузом → отклик студента → воронка компании.
 *
 * Именно здесь цепочка из шести шагов ломается молча: каждый сервис по отдельности
 * покрыт unit-спеками, но ни одна из них не проверяет, что шаги стыкуются друг с другом
 * и что видимость данных считается на каждом стыке заново.
 */
describe('Career (e2e) — сквозной поток работодателя (Ф18)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let passwords: PasswordService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>
  let jobs: CapturedJob[]

  const UNI_A = randomUUID()
  const UNI_B = randomUUID()

  beforeAll(async () => {
    jobs = []
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      // Хранилище throttler'а подменяем на безтаймерное. Штатное на каждый инкремент
      // заводит setTimeout, который позже читает запись из Map; чистка Map между
      // тестами роняла этот таймер уже после самого теста — TypeError прилетал в
      // случайный следующий тест и выглядел как его падение.
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      // Очередь подменяем целиком: письмо подтверждения нужно прочитать, а не отправить,
      // и e2e не должен зависеть от живого SMTP.
      .overrideProvider(QueueService)
      .useValue({
        enqueue: async (queue: string, name: string, payload: Record<string, unknown>) => {
          jobs.push({ queue, name, payload })
          return 'job-id'
        },
        counts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0 }),
        lastFailedReason: async () => null,
      })
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
    jobs.length = 0
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE career_application_events, career_applications, vacancy_university_reviews, vacancies, career_consents, career_profiles, resumes, company_university_access, company_members, companies, audit_logs, refresh_tokens, users, universities RESTART IDENTITY CASCADE',
    )
    // Вуз обязан быть ACTIVE: в PENDING заявку на допуск подать нельзя.
    await prisma.university.createMany({
      data: [
        { id: UNI_A, name: 'Университет А', status: 'ACTIVE' },
        { id: UNI_B, name: 'Университет Б', status: 'ACTIVE' },
      ],
    })
  })

  // ── Хелперы ────────────────────────────────────────────────────────────────

  async function makeUser(
    email: string,
    role: string,
    universityId: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const passwordHash = await passwords.hash(PASSWORD)
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Имя',
        lastName: 'Фамилия',
        role: role as never,
        universityId,
        ...extra,
      },
      select: { id: true },
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

  const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` })

  /** Регистрация работодателя + подтверждение email по ссылке из перехваченного письма. */
  async function signupAndVerify(
    email: string,
    companyName: string,
    website?: string,
  ): Promise<string> {
    await request(server)
      .post('/api/v1/career/companies/signup')
      .send({
        email,
        password: PASSWORD,
        firstName: 'Ержан',
        lastName: 'Сериков',
        companyName,
        ...(website ? { website } : {}),
      })
      .expect(202)

    // Именно письмо этого адресата: в одном тесте регистрируются две компании,
    // и первое попавшееся письмо дало бы чужой — уже погашенный — токен.
    const job = jobs.find((j) => j.name === 'send-company-verification' && j.payload.to === email)
    if (!job) throw new Error(`Письмо подтверждения для ${email} не поставлено в очередь`)
    const token = new URL(job.payload.verifyUrl as string).searchParams.get('token')

    const res = await request(server)
      .post('/api/v1/career/companies/verify-email')
      .send({ token })
      .expect(200)
    return res.body.data.companyId as string
  }

  /** Заявка компании в вуз + одобрение администратором этого вуза. */
  async function grantAccess(employerToken: string, adminToken: string, universityId: string) {
    await request(server)
      .post('/api/v1/career/companies/me/access')
      .set(auth(employerToken))
      .send({ universityId, message: 'Ищем стажёров' })
      .expect(201)

    const queue = await request(server)
      .get('/api/v1/career/university/companies')
      .set(auth(adminToken))
      .expect(200)
    const accessId = queue.body.data[0].id as string

    await request(server)
      .patch(`/api/v1/career/university/companies/${accessId}`)
      .set(auth(adminToken))
      .send({ status: 'APPROVED' })
      .expect(204)
    return accessId
  }

  const VACANCY = {
    title: 'Стажёр-разработчик',
    description:
      'Работа с React и TypeScript в команде из четырёх человек. Обучение за счёт компании.',
    employmentType: 'INTERNSHIP',
    workFormat: 'REMOTE',
    experienceLevel: 'NO_EXPERIENCE',
    skills: ['React', 'TypeScript'],
  }

  /** Вакансия, опубликованная и одобренная вузом — исходное состояние для откликов. */
  async function publishAndApprove(employerToken: string, adminToken: string): Promise<string> {
    const created = await request(server)
      .post('/api/v1/career/employer/vacancies')
      .set(auth(employerToken))
      .send(VACANCY)
      .expect(201)
    const vacancyId = created.body.data.id as string

    await request(server)
      .post(`/api/v1/career/employer/vacancies/${vacancyId}/publish`)
      .set(auth(employerToken))
      .expect(204)

    const queue = await request(server)
      .get('/api/v1/career/university/vacancies')
      .set(auth(adminToken))
      .expect(200)
    const reviewId = queue.body.data[0].id as string

    await request(server)
      .patch(`/api/v1/career/university/vacancies/${reviewId}`)
      .set(auth(adminToken))
      .send({ status: 'APPROVED' })
      .expect(204)

    return vacancyId
  }

  // ── Регистрация работодателя ───────────────────────────────────────────────

  describe('регистрация и подтверждение email', () => {
    it('создаёт компанию PENDING_EMAIL и пользователя EMPLOYER без скоупа вуза', async () => {
      await request(server)
        .post('/api/v1/career/companies/signup')
        .send({
          email: 'hr@company.kz',
          password: PASSWORD,
          firstName: 'Ержан',
          lastName: 'Сериков',
          companyName: 'ТОО Прогресс',
        })
        .expect(202)

      const company = await prisma.company.findFirst({ where: { name: 'ТОО Прогресс' } })
      expect(company?.status).toBe('PENDING_EMAIL')
      // Токен подтверждения в БД лежит только хэшем.
      expect(company?.emailVerificationHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/))

      const user = await prisma.user.findUnique({ where: { email: 'hr@company.kz' } })
      expect(user?.role).toBe('EMPLOYER')
      // Работодатель вне вуза: пустой скоуп — это и есть граница инвайт-онли.
      expect(user?.universityId).toBeNull()
      expect(user?.profileVisibility).toBe('PRIVATE')

      const member = await prisma.companyMember.findFirst({ where: { userId: user!.id } })
      expect(member?.role).toBe('OWNER')
    })

    it('на занятый email отвечает так же и второй компании не создаёт', async () => {
      await makeUser('taken@company.kz', 'STUDENT', UNI_A)

      await request(server)
        .post('/api/v1/career/companies/signup')
        .send({
          email: 'taken@company.kz',
          password: PASSWORD,
          firstName: 'Чужой',
          lastName: 'Человек',
          companyName: 'ТОО Подбор',
        })
        .expect(202)

      expect(await prisma.company.count()).toBe(0)
      expect(jobs.filter((j) => j.name === 'send-company-verification')).toHaveLength(0)
    })

    it('подтверждение переводит компанию в ACTIVE и гасит одноразовый токен', async () => {
      const companyId = await signupAndVerify('hr@company.kz', 'ТОО Прогресс')

      const company = await prisma.company.findUnique({ where: { id: companyId } })
      expect(company?.status).toBe('ACTIVE')
      expect(company?.emailVerificationHash).toBeNull()
    })

    it('повторный переход по той же ссылке ничего не даёт', async () => {
      await request(server)
        .post('/api/v1/career/companies/signup')
        .send({
          email: 'hr@company.kz',
          password: PASSWORD,
          firstName: 'Ержан',
          lastName: 'Сериков',
          companyName: 'ТОО Прогресс',
        })
        .expect(202)
      const job = jobs.find((j) => j.name === 'send-company-verification')!
      const token = new URL(job.payload.verifyUrl as string).searchParams.get('token')

      await request(server)
        .post('/api/v1/career/companies/verify-email')
        .send({ token })
        .expect(200)
      await request(server)
        .post('/api/v1/career/companies/verify-email')
        .send({ token })
        .expect(404)
    })

    it('неподтверждённая компания не может подать заявку в вуз', async () => {
      await request(server)
        .post('/api/v1/career/companies/signup')
        .send({
          email: 'hr@company.kz',
          password: PASSWORD,
          firstName: 'Ержан',
          lastName: 'Сериков',
          companyName: 'ТОО Прогресс',
        })
        .expect(202)

      const token = await login('hr@company.kz')
      await request(server)
        .post('/api/v1/career/companies/me/access')
        .set(auth(token))
        .send({ universityId: UNI_A })
        .expect(403)
    })
  })

  // ── Допуск к вузу ──────────────────────────────────────────────────────────

  describe('допуск компании к вузу', () => {
    let employerToken: string
    let adminAToken: string

    beforeEach(async () => {
      await signupAndVerify('hr@company.kz', 'ТОО Прогресс')
      employerToken = await login('hr@company.kz')
      await makeUser('admin-a@uni.kz', 'UNIVERSITY_ADMIN', UNI_A)
      adminAToken = await login('admin-a@uni.kz')
    })

    it('заявка видна администратору своего вуза и не видна чужому', async () => {
      await request(server)
        .post('/api/v1/career/companies/me/access')
        .set(auth(employerToken))
        .send({ universityId: UNI_A, message: 'Ищем стажёров' })
        .expect(201)

      const own = await request(server)
        .get('/api/v1/career/university/companies')
        .set(auth(adminAToken))
        .expect(200)
      expect(own.body.data).toHaveLength(1)
      expect(own.body.data[0].status).toBe('REQUESTED')

      await makeUser('admin-b@uni.kz', 'UNIVERSITY_ADMIN', UNI_B)
      const foreign = await request(server)
        .get('/api/v1/career/university/companies')
        .set(auth(await login('admin-b@uni.kz')))
        .expect(200)
      expect(foreign.body.data).toHaveLength(0)
    })

    it('повторная заявка при нерассмотренной — 409', async () => {
      await request(server)
        .post('/api/v1/career/companies/me/access')
        .set(auth(employerToken))
        .send({ universityId: UNI_A })
        .expect(201)
      await request(server)
        .post('/api/v1/career/companies/me/access')
        .set(auth(employerToken))
        .send({ universityId: UNI_A })
        .expect(409)
    })

    it('модератор вуза очередь читает, но решение принять не может', async () => {
      await request(server)
        .post('/api/v1/career/companies/me/access')
        .set(auth(employerToken))
        .send({ universityId: UNI_A })
        .expect(201)
      const access = await prisma.companyUniversityAccess.findFirst()

      await makeUser('mod-a@uni.kz', 'UNIVERSITY_MODERATOR', UNI_A)
      const modToken = await login('mod-a@uni.kz')

      await request(server)
        .get('/api/v1/career/university/companies')
        .set(auth(modToken))
        .expect(200)
      await request(server)
        .patch(`/api/v1/career/university/companies/${access!.id}`)
        .set(auth(modToken))
        .send({ status: 'APPROVED' })
        .expect(403)
    })

    it('админ чужого вуза не решает по чужой заявке', async () => {
      await request(server)
        .post('/api/v1/career/companies/me/access')
        .set(auth(employerToken))
        .send({ universityId: UNI_A })
        .expect(201)
      const access = await prisma.companyUniversityAccess.findFirst()

      await makeUser('admin-b@uni.kz', 'UNIVERSITY_ADMIN', UNI_B)
      await request(server)
        .patch(`/api/v1/career/university/companies/${access!.id}`)
        .set(auth(await login('admin-b@uni.kz')))
        .send({ status: 'APPROVED' })
        .expect(403)
    })

    it('отказ без причины отклоняется валидацией', async () => {
      await request(server)
        .post('/api/v1/career/companies/me/access')
        .set(auth(employerToken))
        .send({ universityId: UNI_A })
        .expect(201)
      const access = await prisma.companyUniversityAccess.findFirst()

      await request(server)
        .patch(`/api/v1/career/university/companies/${access!.id}`)
        .set(auth(adminAToken))
        .send({ status: 'REJECTED' })
        .expect(422)
    })

    it('недопустимый переход статуса — 409', async () => {
      const accessId = await grantAccess(employerToken, adminAToken, UNI_A)
      // APPROVED → APPROVED в state-machine нет.
      await request(server)
        .patch(`/api/v1/career/university/companies/${accessId}`)
        .set(auth(adminAToken))
        .send({ status: 'APPROVED' })
        .expect(409)
    })
  })

  // ── Вакансии и модерация ───────────────────────────────────────────────────

  describe('публикация и модерация вакансии', () => {
    let employerToken: string
    let adminAToken: string

    beforeEach(async () => {
      await signupAndVerify('hr@company.kz', 'ТОО Прогресс')
      employerToken = await login('hr@company.kz')
      await makeUser('admin-a@uni.kz', 'UNIVERSITY_ADMIN', UNI_A)
      adminAToken = await login('admin-a@uni.kz')
    })

    it('без единого допуска публиковать нечего — 403', async () => {
      const created = await request(server)
        .post('/api/v1/career/employer/vacancies')
        .set(auth(employerToken))
        .send(VACANCY)
        .expect(201)

      await request(server)
        .post(`/api/v1/career/employer/vacancies/${created.body.data.id}/publish`)
        .set(auth(employerToken))
        .expect(403)
    })

    it('публикация заводит ревью по каждому допустившему вузу', async () => {
      await grantAccess(employerToken, adminAToken, UNI_A)
      const created = await request(server)
        .post('/api/v1/career/employer/vacancies')
        .set(auth(employerToken))
        .send(VACANCY)
        .expect(201)
      const vacancyId = created.body.data.id as string

      // Черновик студенту не виден и до публикации.
      await makeUser('student-a@uni.kz', 'STUDENT', UNI_A)
      const studentToken = await login('student-a@uni.kz')
      const before = await request(server)
        .get('/api/v1/career/vacancies')
        .set(auth(studentToken))
        .expect(200)
      expect(before.body.data).toHaveLength(0)

      await request(server)
        .post(`/api/v1/career/employer/vacancies/${vacancyId}/publish`)
        .set(auth(employerToken))
        .expect(204)

      const reviews = await prisma.vacancyUniversityReview.findMany()
      expect(reviews).toHaveLength(1)
      expect(reviews[0]).toMatchObject({ universityId: UNI_A, status: 'PENDING' })

      // Опубликована, но вузом ещё не одобрена — на витрине её нет.
      const afterPublish = await request(server)
        .get('/api/v1/career/vacancies')
        .set(auth(studentToken))
        .expect(200)
      expect(afterPublish.body.data).toHaveLength(0)
    })

    it('одобрение вузом открывает вакансию его студентам и только им', async () => {
      await grantAccess(employerToken, adminAToken, UNI_A)
      const vacancyId = await publishAndApprove(employerToken, adminAToken)

      await makeUser('student-a@uni.kz', 'STUDENT', UNI_A)
      const visible = await request(server)
        .get('/api/v1/career/vacancies')
        .set(auth(await login('student-a@uni.kz')))
        .expect(200)
      expect(visible.body.data).toHaveLength(1)
      expect(visible.body.data[0].id).toBe(vacancyId)

      // Студент другого вуза той же вакансии не видит: решение принимал не его вуз.
      await makeUser('student-b@uni.kz', 'STUDENT', UNI_B)
      const studentBToken = await login('student-b@uni.kz')
      const hidden = await request(server)
        .get('/api/v1/career/vacancies')
        .set(auth(studentBToken))
        .expect(200)
      expect(hidden.body.data).toHaveLength(0)
      await request(server)
        .get(`/api/v1/career/vacancies/${vacancyId}`)
        .set(auth(studentBToken))
        .expect(404)
    })

    it('отказ вуза оставляет вакансию скрытой, причина обязательна', async () => {
      await grantAccess(employerToken, adminAToken, UNI_A)
      const created = await request(server)
        .post('/api/v1/career/employer/vacancies')
        .set(auth(employerToken))
        .send(VACANCY)
        .expect(201)
      await request(server)
        .post(`/api/v1/career/employer/vacancies/${created.body.data.id}/publish`)
        .set(auth(employerToken))
        .expect(204)
      const review = await prisma.vacancyUniversityReview.findFirst()

      await request(server)
        .patch(`/api/v1/career/university/vacancies/${review!.id}`)
        .set(auth(adminAToken))
        .send({ status: 'REJECTED' })
        .expect(422)

      await request(server)
        .patch(`/api/v1/career/university/vacancies/${review!.id}`)
        .set(auth(adminAToken))
        .send({ status: 'REJECTED', reason: 'Не соответствует профилю вуза' })
        .expect(204)

      await makeUser('student-a@uni.kz', 'STUDENT', UNI_A)
      const list = await request(server)
        .get('/api/v1/career/vacancies')
        .set(auth(await login('student-a@uni.kz')))
        .expect(200)
      expect(list.body.data).toHaveLength(0)
    })

    it('чужую вакансию работодатель не редактирует', async () => {
      await grantAccess(employerToken, adminAToken, UNI_A)
      const vacancyId = await publishAndApprove(employerToken, adminAToken)

      await signupAndVerify('hr2@rival.kz', 'ТОО Конкурент')
      const rivalToken = await login('hr2@rival.kz')

      await request(server)
        .patch(`/api/v1/career/employer/vacancies/${vacancyId}`)
        .set(auth(rivalToken))
        .send({ title: 'Перехвачено' })
        .expect(404)
    })
  })

  // ── Отклики ────────────────────────────────────────────────────────────────

  describe('отклики и воронка', () => {
    let employerToken: string
    let adminAToken: string
    let studentToken: string
    let studentId: string
    let vacancyId: string

    beforeEach(async () => {
      await signupAndVerify('hr@company.kz', 'ТОО Прогресс')
      employerToken = await login('hr@company.kz')
      await makeUser('admin-a@uni.kz', 'UNIVERSITY_ADMIN', UNI_A)
      adminAToken = await login('admin-a@uni.kz')
      await grantAccess(employerToken, adminAToken, UNI_A)
      vacancyId = await publishAndApprove(employerToken, adminAToken)
      studentId = await makeUser('student-a@uni.kz', 'STUDENT', UNI_A)
      studentToken = await login('student-a@uni.kz')
    })

    it('отклик создаётся вместе с первой записью истории', async () => {
      const res = await request(server)
        .post('/api/v1/career/applications')
        .set(auth(studentToken))
        .send({ vacancyId, coverLetter: 'Хочу к вам стажироваться' })
        .expect(201)

      const application = await prisma.careerApplication.findUnique({
        where: { id: res.body.data.id },
      })
      expect(application).toMatchObject({
        status: 'SUBMITTED',
        studentId,
        // Вуз фиксируется на момент отклика, а не читается из профиля позже.
        universityId: UNI_A,
      })

      const history = await request(server)
        .get(`/api/v1/career/applications/${res.body.data.id}/history`)
        .set(auth(studentToken))
        .expect(200)
      expect(history.body.data).toEqual([
        expect.objectContaining({ fromStatus: null, toStatus: 'SUBMITTED' }),
      ])
    })

    it('повторный отклик на ту же вакансию — 409', async () => {
      await request(server)
        .post('/api/v1/career/applications')
        .set(auth(studentToken))
        .send({ vacancyId })
        .expect(201)
      await request(server)
        .post('/api/v1/career/applications')
        .set(auth(studentToken))
        .send({ vacancyId })
        .expect(409)
    })

    it('студент чужого вуза откликнуться не может', async () => {
      await makeUser('student-b@uni.kz', 'STUDENT', UNI_B)
      await request(server)
        .post('/api/v1/career/applications')
        .set(auth(await login('student-b@uni.kz')))
        .send({ vacancyId })
        .expect(404)
    })

    it('компания ведёт отклик по воронке, каждый переход попадает в историю', async () => {
      const created = await request(server)
        .post('/api/v1/career/applications')
        .set(auth(studentToken))
        .send({ vacancyId })
        .expect(201)
      const applicationId = created.body.data.id as string

      for (const status of ['VIEWED', 'SHORTLISTED', 'INTERVIEW']) {
        await request(server)
          .patch(`/api/v1/career/employer/applications/${applicationId}`)
          .set(auth(employerToken))
          .send({ status })
          .expect(204)
      }

      const history = await request(server)
        .get(`/api/v1/career/applications/${applicationId}/history`)
        .set(auth(employerToken))
        .expect(200)
      expect(history.body.data.map((e: { toStatus: string }) => e.toStatus)).toEqual([
        'SUBMITTED',
        'VIEWED',
        'SHORTLISTED',
        'INTERVIEW',
      ])
    })

    it('перескок через шаг воронки — 409', async () => {
      const created = await request(server)
        .post('/api/v1/career/applications')
        .set(auth(studentToken))
        .send({ vacancyId })
        .expect(201)

      await request(server)
        .patch(`/api/v1/career/employer/applications/${created.body.data.id}`)
        .set(auth(employerToken))
        .send({ status: 'HIRED' })
        .expect(409)
    })

    it('отказ без причины отклоняется валидацией', async () => {
      const created = await request(server)
        .post('/api/v1/career/applications')
        .set(auth(studentToken))
        .send({ vacancyId })
        .expect(201)

      await request(server)
        .patch(`/api/v1/career/employer/applications/${created.body.data.id}`)
        .set(auth(employerToken))
        .send({ status: 'REJECTED' })
        .expect(422)
    })

    it('отозванный студентом отклик дальше не двигается', async () => {
      const created = await request(server)
        .post('/api/v1/career/applications')
        .set(auth(studentToken))
        .send({ vacancyId })
        .expect(201)
      const applicationId = created.body.data.id as string

      await request(server)
        .post(`/api/v1/career/applications/${applicationId}/withdraw`)
        .set(auth(studentToken))
        .expect(204)

      await request(server)
        .patch(`/api/v1/career/employer/applications/${applicationId}`)
        .set(auth(employerToken))
        .send({ status: 'VIEWED' })
        .expect(409)
    })

    it('историю чужого отклика не видит ни студент, ни чужая компания', async () => {
      const created = await request(server)
        .post('/api/v1/career/applications')
        .set(auth(studentToken))
        .send({ vacancyId })
        .expect(201)
      const applicationId = created.body.data.id as string

      await makeUser('other@uni.kz', 'STUDENT', UNI_A)
      await request(server)
        .get(`/api/v1/career/applications/${applicationId}/history`)
        .set(auth(await login('other@uni.kz')))
        .expect(403)

      await signupAndVerify('hr2@rival.kz', 'ТОО Конкурент')
      await request(server)
        .get(`/api/v1/career/applications/${applicationId}/history`)
        .set(auth(await login('hr2@rival.kz')))
        .expect(403)
    })
  })

  // ── Данные студента ────────────────────────────────────────────────────────

  describe('карточка кандидата и согласия', () => {
    let employerToken: string
    let adminAToken: string
    let studentId: string

    beforeEach(async () => {
      await signupAndVerify('hr@company.kz', 'ТОО Прогресс')
      employerToken = await login('hr@company.kz')
      await makeUser('admin-a@uni.kz', 'UNIVERSITY_ADMIN', UNI_A)
      adminAToken = await login('admin-a@uni.kz')
      studentId = await makeUser('student-a@uni.kz', 'STUDENT', UNI_A, {
        gpa: 3.7,
        phone: '+7 700 111 22 33',
      })
    })

    /** Профиль открыт работодателям — иначе карточка не отдаётся вовсе. */
    async function openProfile() {
      await request(server)
        .patch('/api/v1/career/profile')
        .set(auth(await login('student-a@uni.kz')))
        .send({ visibility: 'EMPLOYERS', employmentStatus: 'LOOKING' })
        .expect(200)
    }

    it('без допуска к вузу карточка не отдаётся', async () => {
      await openProfile()
      await request(server)
        .get(`/api/v1/career/profile/candidates/${studentId}`)
        .set(auth(employerToken))
        .expect(403)
    })

    it('скрытый профиль отвечает как несуществующий', async () => {
      await grantAccess(employerToken, adminAToken, UNI_A)
      await request(server)
        .get(`/api/v1/career/profile/candidates/${studentId}`)
        .set(auth(employerToken))
        .expect(404)
    })

    it('GPA и телефон приходят null, пока студент не дал согласие', async () => {
      await grantAccess(employerToken, adminAToken, UNI_A)
      await openProfile()

      const card = await request(server)
        .get(`/api/v1/career/profile/candidates/${studentId}`)
        .set(auth(employerToken))
        .expect(200)
      expect(card.body.data.gpa).toBeNull()
      expect(card.body.data.phone).toBeNull()
    })

    it('согласие открывает поле, отзыв закрывает его снова', async () => {
      await grantAccess(employerToken, adminAToken, UNI_A)
      await openProfile()
      const studentToken = await login('student-a@uni.kz')

      await request(server)
        .post('/api/v1/career/profile/consents')
        .set(auth(studentToken))
        .send({ field: 'GPA', granted: true })
        .expect(201)

      const granted = await request(server)
        .get(`/api/v1/career/profile/candidates/${studentId}`)
        .set(auth(employerToken))
        .expect(200)
      expect(granted.body.data.gpa).toBe(3.7)
      // Телефон отдельным согласием — одно не открывает другое.
      expect(granted.body.data.phone).toBeNull()

      await request(server)
        .post('/api/v1/career/profile/consents')
        .set(auth(studentToken))
        .send({ field: 'GPA', granted: false })
        .expect(201)

      const revoked = await request(server)
        .get(`/api/v1/career/profile/candidates/${studentId}`)
        .set(auth(employerToken))
        .expect(200)
      expect(revoked.body.data.gpa).toBeNull()
    })

    it('отзыв допуска закрывает доступ к студентам сразу, не дожидаясь истечения токена', async () => {
      const accessId = await grantAccess(employerToken, adminAToken, UNI_A)
      await openProfile()
      await request(server)
        .get(`/api/v1/career/profile/candidates/${studentId}`)
        .set(auth(employerToken))
        .expect(200)

      await request(server)
        .patch(`/api/v1/career/university/companies/${accessId}`)
        .set(auth(adminAToken))
        .send({ status: 'REVOKED', reason: 'Нарушение правил' })
        .expect(204)

      // Тот же access-токен: набор вузов считается по БД на каждый запрос, а не из JWT.
      await request(server)
        .get(`/api/v1/career/profile/candidates/${studentId}`)
        .set(auth(employerToken))
        .expect(403)
    })
  })

  // ── Отзыв допуска ──────────────────────────────────────────────────────────

  /**
   * Решение по Ф18: отзыв допуска закрывает вакансии компании в этом вузе, но уже поданные
   * отклики и связь с работодателем вне платформы сохраняются — человек мог дойти до
   * интервью, и обрывать ему контакт на середине нельзя.
   */
  describe('отзыв допуска закрывает вакансии, но не отклики', () => {
    let employerToken: string
    let adminAToken: string
    let accessId: string
    let vacancyId: string

    beforeEach(async () => {
      await signupAndVerify('hr@company.kz', 'ТОО Прогресс', 'https://progress.kz')
      employerToken = await login('hr@company.kz')
      await makeUser('admin-a@uni.kz', 'UNIVERSITY_ADMIN', UNI_A)
      adminAToken = await login('admin-a@uni.kz')
      accessId = await grantAccess(employerToken, adminAToken, UNI_A)
      vacancyId = await publishAndApprove(employerToken, adminAToken)
    })

    async function revoke() {
      await request(server)
        .patch(`/api/v1/career/university/companies/${accessId}`)
        .set(auth(adminAToken))
        .send({ status: 'REVOKED', reason: 'Нарушение правил' })
        .expect(204)
    }

    it('вакансия уходит с витрины вуза и перестаёт открываться по прямой ссылке', async () => {
      await makeUser('student-a@uni.kz', 'STUDENT', UNI_A)
      const studentToken = await login('student-a@uni.kz')

      const before = await request(server)
        .get('/api/v1/career/vacancies')
        .set(auth(studentToken))
        .expect(200)
      expect(before.body.data).toHaveLength(1)

      await revoke()

      const after = await request(server)
        .get('/api/v1/career/vacancies')
        .set(auth(studentToken))
        .expect(200)
      expect(after.body.data).toHaveLength(0)
      await request(server)
        .get(`/api/v1/career/vacancies/${vacancyId}`)
        .set(auth(studentToken))
        .expect(404)
    })

    it('решение вуза по вакансии закрывается с понятной компании причиной', async () => {
      await revoke()

      const review = await prisma.vacancyUniversityReview.findFirst({
        where: { vacancyId, universityId: UNI_A },
      })
      expect(review?.status).toBe('REJECTED')
      expect(review?.reason).toContain('отозвал допуск')
    })

    it('вакансия на модерации тоже закрывается — вуз её больше не рассматривает', async () => {
      const draft = await request(server)
        .post('/api/v1/career/employer/vacancies')
        .set(auth(employerToken))
        .send({ ...VACANCY, title: 'Второй стажёр' })
        .expect(201)
      await request(server)
        .post(`/api/v1/career/employer/vacancies/${draft.body.data.id}/publish`)
        .set(auth(employerToken))
        .expect(204)

      await revoke()

      const queue = await request(server)
        .get('/api/v1/career/university/vacancies?status=PENDING')
        .set(auth(adminAToken))
        .expect(200)
      expect(queue.body.data).toHaveLength(0)
    })

    it('вуз, где допуск остался, вакансию видит по-прежнему', async () => {
      // Та же компания допущена во второй вуз, и вакансия одобрена там же.
      await makeUser('admin-b@uni.kz', 'UNIVERSITY_ADMIN', UNI_B)
      const adminBToken = await login('admin-b@uni.kz')
      await grantAccess(employerToken, adminBToken, UNI_B)
      // Публикуем заново: решения заводятся в момент публикации, по одному на допустивший вуз.
      await request(server)
        .post(`/api/v1/career/employer/vacancies/${vacancyId}/publish`)
        .set(auth(employerToken))
        .expect(204)
      const queueB = await request(server)
        .get('/api/v1/career/university/vacancies')
        .set(auth(adminBToken))
        .expect(200)
      await request(server)
        .patch(`/api/v1/career/university/vacancies/${queueB.body.data[0].id}`)
        .set(auth(adminBToken))
        .send({ status: 'APPROVED' })
        .expect(204)

      await revoke()

      await makeUser('student-b@uni.kz', 'STUDENT', UNI_B)
      const visible = await request(server)
        .get('/api/v1/career/vacancies')
        .set(auth(await login('student-b@uni.kz')))
        .expect(200)
      expect(visible.body.data).toHaveLength(1)
      expect(visible.body.data[0].id).toBe(vacancyId)
    })

    it('поданный отклик остаётся у студента вместе с контактом работодателя', async () => {
      await makeUser('student-a@uni.kz', 'STUDENT', UNI_A)
      const studentToken = await login('student-a@uni.kz')
      const created = await request(server)
        .post('/api/v1/career/applications')
        .set(auth(studentToken))
        .send({ vacancyId })
        .expect(201)

      await revoke()

      const mine = await request(server)
        .get('/api/v1/career/applications')
        .set(auth(studentToken))
        .expect(200)
      expect(mine.body.data).toHaveLength(1)
      expect(mine.body.data[0].vacancy.company).toMatchObject({
        name: 'ТОО Прогресс',
        // Связь вне платформы: вакансии уже нет, а написать работодателю по-прежнему есть куда.
        website: 'https://progress.kz',
      })

      // История переписки тоже на месте.
      const history = await request(server)
        .get(`/api/v1/career/applications/${created.body.data.id}/history`)
        .set(auth(studentToken))
        .expect(200)
      expect(history.body.data).toHaveLength(1)
    })

    it('новых откликов на закрытую вакансию уже не принимает', async () => {
      await revoke()

      await makeUser('late@uni.kz', 'STUDENT', UNI_A)
      await request(server)
        .post('/api/v1/career/applications')
        .set(auth(await login('late@uni.kz')))
        .send({ vacancyId })
        .expect(404)
    })
  })
})
