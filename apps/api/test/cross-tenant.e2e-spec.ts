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

/**
 * Межвузовая изоляция: пользователь вуза Б не достаёт ресурсы вуза А.
 *
 * Зачем матрицей, а не по случаю. `ScopeGuard` включается декоратором `@Scope` и проверяет
 * только идентификатор, который виден в самом запросе. Всё остальное — фильтрация по
 * `universityId` внутри каждого сервиса, и держится она на внимательности при код-ревью.
 * Такой инвариант ревью не гарантирует: достаточно одного `findUnique({ where: { id } })`
 * без сверки вуза в новом разделе, чтобы админ одного вуза читал чужие данные по угаданному
 * идентификатору. Ошибка тихая — ответ 200, в логах ничего.
 *
 * Здесь заведомо не все эндпоинты платформы: цель — закрепить сам инвариант и дать место,
 * куда дописывается строка при добавлении раздела. Актёр во всех случаях —
 * UNIVERSITY_ADMIN чужого вуза: роль с максимальными правами В СВОЁМ вузе, то есть худший
 * случай для проверки границы. Если её проходит он, то не пройдёт и студент.
 *
 * 404 считается таким же правильным ответом, как 403: «не нашли» не подтверждает
 * существование чужого ресурса и потому даже предпочтительнее.
 */
describe('Межвузовая изоляция (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let passwords: PasswordService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>

  /** Ресурсы вуза А, до которых не должен дотянуться вуз Б. */
  let alien: {
    facultyId: string
    groupId: string
    roomId: string
    courseId: string
    subjectId: string
    eventId: string
    userId: string
  }
  /** Токен администратора ЧУЖОГО вуза (Б) и своего (А) — второй нужен как контроль. */
  let tokenB: string
  let tokenA: string

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
      'TRUNCATE TABLE event_participants, events, courses, subjects, rooms, groups, faculties, refresh_tokens, users, universities RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: 'uni-a', name: 'Вуз А' } })
    await prisma.university.create({ data: { id: 'uni-b', name: 'Вуз Б' } })

    const faculty = await prisma.faculty.create({
      data: { name: 'Факультет А', universityId: 'uni-a' },
    })
    const group = await prisma.group.create({
      data: { name: 'ГР-А-101', facultyId: faculty.id },
    })
    const room = await prisma.room.create({
      data: { name: 'Ауд. 101 (А)', universityId: 'uni-a' },
    })
    const subject = await prisma.subject.create({
      data: { name: 'Матанализ А', universityId: 'uni-a' },
    })
    const student = await makeUser('student-a@vuz.kz', 'STUDENT', 'uni-a', {
      facultyId: faculty.id,
      groupId: group.id,
    })
    const course = await prisma.course.create({
      data: { subjectId: subject.id, groupId: group.id },
    })
    const event = await prisma.event.create({
      data: {
        organizerId: student,
        audience: 'UNIVERSITY',
        title: 'Событие вуза А',
        description: 'только для вуза А',
        universityId: 'uni-a',
        startsAt: new Date(Date.now() + 86_400_000),
      },
    })

    alien = {
      facultyId: faculty.id,
      groupId: group.id,
      roomId: room.id,
      courseId: course.id,
      subjectId: subject.id,
      eventId: event.id,
      userId: student,
    }

    await makeUser('admin-a@vuz.kz', 'UNIVERSITY_ADMIN', 'uni-a')
    await makeUser('admin-b@vuz.kz', 'UNIVERSITY_ADMIN', 'uni-b')
    tokenA = await login('admin-a@vuz.kz')
    tokenB = await login('admin-b@vuz.kz')
  }

  async function makeUser(
    email: string,
    role: string,
    universityId: string,
    extra: { facultyId?: string; groupId?: string } = {},
  ): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(PASSWORD),
        firstName: 'Имя',
        lastName: 'Фамилия',
        role: role as never,
        universityId,
        ...extra,
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

  const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` })

  /**
   * Матрица. `path` — функция, потому что идентификаторы известны только после сидирования.
   * `body` есть только у изменяющих запросов.
   */
  const CASES: {
    name: string
    method: 'get' | 'patch' | 'delete'
    path: () => string
    body?: Record<string, unknown>
  }[] = [
    { name: 'факультет чужого вуза', method: 'get', path: () => `/faculties/${alien.facultyId}` },
    {
      name: 'переименование чужого факультета',
      method: 'patch',
      path: () => `/faculties/${alien.facultyId}`,
      body: { name: 'Захвачено' },
    },
    {
      name: 'удаление чужого факультета',
      method: 'delete',
      path: () => `/faculties/${alien.facultyId}`,
    },
    { name: 'группа чужого вуза', method: 'get', path: () => `/groups/${alien.groupId}` },
    { name: 'состав чужой группы', method: 'get', path: () => `/groups/${alien.groupId}/members` },
    {
      name: 'переименование чужой группы',
      method: 'patch',
      path: () => `/groups/${alien.groupId}`,
      body: { name: 'Захвачено' },
    },
    { name: 'аудитория чужого вуза', method: 'get', path: () => `/rooms/${alien.roomId}` },
    { name: 'удаление чужой аудитории', method: 'delete', path: () => `/rooms/${alien.roomId}` },
    { name: 'курс чужого вуза', method: 'get', path: () => `/courses/${alien.courseId}` },
    { name: 'событие чужого вуза', method: 'get', path: () => `/events/${alien.eventId}` },
  ]

  describe.each(CASES)('$name', ({ method, path, body }) => {
    it('админу чужого вуза закрыт (403 или 404)', async () => {
      const req = request(server)[method](`/api/v1${path()}`).set(auth(tokenB))
      const res = await (body ? req.send(body) : req)

      expect([403, 404]).toContain(res.status)
      // И тело не должно случайно содержать данные: отказ отдаётся конвертом ошибки.
      expect(res.body?.success).not.toBe(true)
    })
  })

  // Профиль — особый случай, и поэтому он не в матрице выше. `GET /users/:id` отвечает 200
  // кому угодно на платформе намеренно: это «визитка» (имя, аватар, роль), без неё не
  // работают дружба и чаты между вузами. Инвариант здесь не «закрыто», а «чужому вузу
  // достаётся только визитка»: полномочия UNIVERSITY_ADMIN действуют внутри своего вуза
  // (hasAuthorityOver требует sameUni), и за его границей администратор — обычный зритель.
  describe('профиль человека из чужого вуза', () => {
    it('админу чужого вуза — только визитка, без персональных данных', async () => {
      const res = await request(server)
        .get(`/api/v1/users/${alien.userId}`)
        .set(auth(tokenB))
        .expect(200)

      expect(res.body.data.access).toBe('limited')
      expect(res.body.data.email).toBeNull()
      expect(res.body.data.phone).toBeNull()
      expect(res.body.data.gpa ?? null).toBeNull()
    })

    it('админу своего вуза — полная карточка', async () => {
      const res = await request(server)
        .get(`/api/v1/users/${alien.userId}`)
        .set(auth(tokenA))
        .expect(200)

      expect(res.body.data.access).toBe('full')
    })
  })

  // Контроль: те же маршруты своему админу открыты. Без него зелёная матрица ничего не
  // значит — она была бы зелёной и на опечатке в путях, и на сломанной авторизации.
  describe('контроль: свой вуз видит свои ресурсы', () => {
    it.each([
      ['факультет', () => `/faculties/${alien.facultyId}`],
      ['группа', () => `/groups/${alien.groupId}`],
      ['аудитория', () => `/rooms/${alien.roomId}`],
      ['курс', () => `/courses/${alien.courseId}`],
      ['событие', () => `/events/${alien.eventId}`],
    ])('%s открыт администратору своего вуза', async (_label, path) => {
      const res = await request(server).get(`/api/v1${path()}`).set(auth(tokenA)).expect(200)

      expect(res.body.success).toBe(true)
    })
  })

  // Списки — вторая половина того же инварианта: закрытая карточка бесполезна, если
  // соседний вуз виден в перечислении.
  describe('списки не показывают чужой вуз', () => {
    it.each([
      ['факультеты', '/faculties'],
      ['группы', '/groups'],
      ['аудитории', '/rooms'],
    ])('%s: в выдаче вуза Б нет ресурсов вуза А', async (_label, path) => {
      const res = await request(server).get(`/api/v1${path}`).set(auth(tokenB)).expect(200)

      const raw = JSON.stringify(res.body)
      expect(raw).not.toContain(alien.facultyId)
      expect(raw).not.toContain(alien.groupId)
      expect(raw).not.toContain(alien.roomId)
    })
  })
})
