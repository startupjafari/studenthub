import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { throttlerStorageStub } from './throttler-storage.stub'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'

// Фаза 21.C5: выдача без телефона на настоящей БД — поиск по номеру билета в своём вузе,
// выдача только с отметкой, отметка в выдаче, журнале удостоверений, фильтре и сводке.

const PASSWORD = 'Passw0rd!'
const UNI = 'uni-lib-nophone'

describe('Выдача без телефона (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let passwords: PasswordService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>

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
      'TRUNCATE TABLE library_id_access_logs, reservations, loans, book_copies, books, library_settings, notifications, audit_logs, refresh_tokens, universities, users RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: UNI, name: 'Библиотечный вуз' } })
    await prisma.university.create({ data: { id: 'uni-other', name: 'Чужой вуз' } })
    await prisma.librarySettings.create({ data: { universityId: UNI, enabled: true } })
  })

  async function makeUser(
    email: string,
    role: 'STUDENT' | 'LIBRARIAN',
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(PASSWORD),
        firstName: 'Нурлан',
        lastName: 'Оспанов',
        role,
        universityId: UNI,
        ...extra,
      },
    })
    return u.id
  }

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(201)
    return res.body.data.accessToken as string
  }

  it('поиск по билету → выдача только с отметкой → отметка в выдаче, журнале, фильтре, сводке', async () => {
    const readerId = await makeUser('reader@e2e.io', 'STUDENT', {
      studentCardNumber: 'ST-2023-0042',
      avatarUrl: 'https://cdn.example/a.webp',
    })
    // Тот же номер в чужом вузе — не находится.
    await makeUser('other@e2e.io', 'STUDENT', {
      studentCardNumber: 'ST-OTHER',
      universityId: 'uni-other',
    })
    await makeUser('lib@e2e.io', 'LIBRARIAN', { firstName: 'Гульнара', lastName: 'Сапарова' })
    const book = await prisma.book.create({ data: { universityId: UNI, title: 'Абай жолы' } })
    await prisma.bookCopy.create({
      data: { bookId: book.id, universityId: UNI, inventoryNumber: '101', code: 'NOPH0001' },
    })
    const lib = await login('lib@e2e.io')

    await request(server)
      .post('/api/v1/library/readers/lookup')
      .set('Authorization', `Bearer ${lib}`)
      .send({ studentCardNumber: 'ST-OTHER' })
      .expect(404)

    const lookup = await request(server)
      .post('/api/v1/library/readers/lookup')
      .set('Authorization', `Bearer ${lib}`)
      .send({ studentCardNumber: ' st-2023-0042 ' })
      .expect(201)
    const session = lookup.body.data
    expect(session).toMatchObject({
      via: 'card',
      reader: {
        id: readerId,
        firstName: 'Нурлан',
        lastName: 'Оспанов',
        avatarUrl: 'https://cdn.example/a.webp',
      },
    })
    // Карточка узкая: ни почты, ни телефона, ни даты рождения.
    expect(session.reader).not.toHaveProperty('email')
    expect(session.reader).not.toHaveProperty('phone')

    const noMark = await request(server)
      .post('/api/v1/library/loans')
      .set('Authorization', `Bearer ${lib}`)
      .send({ ticket: session.ticket, inventoryNumber: '101' })
      .expect(409)
    expect(noMark.body.error.details[0].field).toBe('noPhoneMark')

    const issued = await request(server)
      .post('/api/v1/library/loans')
      .set('Authorization', `Bearer ${lib}`)
      .send({ ticket: session.ticket, inventoryNumber: '101', withoutPhone: true })
      .expect(201)
    expect(issued.body.data.withoutPhone).toBe(true)
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: issued.body.data.id } })
    expect(loan.withoutPhone).toBe(true)

    const journal = await prisma.libraryIdAccessLog.findMany({
      where: { readerId },
      orderBy: { createdAt: 'asc' },
    })
    expect(journal).toEqual([
      expect.objectContaining({
        loanId: null,
        withoutPhone: true,
        librarianName: 'Сапарова Гульнара',
      }),
      expect.objectContaining({ loanId: loan.id, withoutPhone: true }),
    ])
    const journalApi = await request(server)
      .get('/api/v1/library/id-access')
      .set('Authorization', `Bearer ${lib}`)
      .expect(200)
    expect(journalApi.body.data.every((r: { withoutPhone: boolean }) => r.withoutPhone)).toBe(true)

    const onlyNoPhone = await request(server)
      .get('/api/v1/library/loans?filter=all&withoutPhone=true')
      .set('Authorization', `Bearer ${lib}`)
      .expect(200)
    expect(onlyNoPhone.body.data.map((l: { id: string }) => l.id)).toEqual([loan.id])
    const scanned = await request(server)
      .get('/api/v1/library/loans?filter=all&withoutPhone=false')
      .set('Authorization', `Bearer ${lib}`)
      .expect(200)
    expect(scanned.body.data).toEqual([])

    const summary = await request(server)
      .get('/api/v1/library/reports/summary')
      .set('Authorization', `Bearer ${lib}`)
      .expect(200)
    expect(summary.body.data.loans).toMatchObject({ issuedLast30: 1, withoutPhoneLast30: 1 })
  })

  it('номер билета у двоих читателей — 409 cardAmbiguous, в журнал ничего', async () => {
    await makeUser('a@e2e.io', 'STUDENT', { studentCardNumber: 'DUP-1' })
    await makeUser('b@e2e.io', 'STUDENT', { studentCardNumber: 'dup-1' })
    await makeUser('lib@e2e.io', 'LIBRARIAN')
    const lib = await login('lib@e2e.io')
    const res = await request(server)
      .post('/api/v1/library/readers/lookup')
      .set('Authorization', `Bearer ${lib}`)
      .send({ studentCardNumber: 'DUP-1' })
      .expect(409)
    expect(res.body.error.details[0].field).toBe('cardAmbiguous')
    expect(await prisma.libraryIdAccessLog.count()).toBe(0)
  })

  it('искать по билету может только библиотекарь', async () => {
    await makeUser('stu@e2e.io', 'STUDENT', { studentCardNumber: 'ST-1' })
    const token = await login('stu@e2e.io')
    await request(server)
      .post('/api/v1/library/readers/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ studentCardNumber: 'ST-1' })
      .expect(403)
  })
})
