import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'

const PASSWORD = 'Passw0rd!'

// P3 плана чатов / DoD Ф11.5: доступ модератора к личному чату — ТОЛЬКО по жалобе,
// со scope вуза и обязательной записью moderator_chat_access в AuditLog.
describe('Complaints (e2e) — доступ к чату по жалобе (Ф11.5)', () => {
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
      'TRUNCATE TABLE complaints, audit_logs, message_reactions, messages, chat_members, chats, refresh_tokens, users, universities RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: 'uni-a', name: 'Uni A' } })
    await prisma.university.create({ data: { id: 'uni-b', name: 'Uni B' } })
  })

  async function makeUser(email: string, role: string, universityId: string): Promise<string> {
    const passwordHash = await passwords.hash(PASSWORD)
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Имя',
        lastName: 'Фам',
        role: role as never,
        universityId,
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

  const auth = (t: string): { Authorization: string } => ({ Authorization: `Bearer ${t}` })

  // Личный чат A↔B в uni-a с сообщением от A; возвращает id чата и сообщения.
  async function seedPrivateChatWithMessage(a: string, b: string) {
    const chat = await prisma.chat.create({
      data: { type: 'PRIVATE', members: { create: [{ userId: a }, { userId: b }] } },
    })
    const msg = await prisma.message.create({
      // seq обязателен: нумерацию в обход сервиса задаём вручную (в чате это единственное сообщение).
      data: { chatId: chat.id, seq: 1, senderId: a, content: 'спорное сообщение' },
    })
    return { chatId: chat.id, messageId: msg.id }
  }

  async function reportMessage(reporterEmail: string, messageId: string): Promise<string> {
    const tok = await login(reporterEmail)
    const res = await request(server)
      .post('/api/v1/complaints')
      .set(auth(tok))
      .send({ targetType: 'MESSAGE', targetId: messageId, reason: 'оскорбление' })
      .expect(201)
    return res.body.data.id as string
  }

  it('модератор своего вуза видит чат по жалобе + пишется moderator_chat_access', async () => {
    const a = await makeUser('a@a.io', 'STUDENT', 'uni-a')
    const b = await makeUser('b@a.io', 'STUDENT', 'uni-a')
    await makeUser('mod@a.io', 'UNIVERSITY_MODERATOR', 'uni-a')
    const { chatId, messageId } = await seedPrivateChatWithMessage(a, b)
    const complaintId = await reportMessage('b@a.io', messageId)

    const modTok = await login('mod@a.io')
    const res = await request(server)
      .get(`/api/v1/complaints/${complaintId}/messages`)
      .set(auth(modTok))
      .expect(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(
      (res.body.data as { content: string }[]).some((m) => m.content === 'спорное сообщение'),
    ).toBe(true)

    // Доступ зафиксирован в аудите (Ф11.5/§14.8).
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'moderator_chat_access', entityId: chatId },
    })
    expect(audit).toBeTruthy()
    expect((audit?.metadata as { complaintId?: string })?.complaintId).toBe(complaintId)
  })

  it('модератор другого вуза не видит жалобу (403 WRONG_SCOPE)', async () => {
    const a = await makeUser('a2@a.io', 'STUDENT', 'uni-a')
    const b = await makeUser('b2@a.io', 'STUDENT', 'uni-a')
    await makeUser('mod@b.io', 'UNIVERSITY_MODERATOR', 'uni-b')
    const { messageId } = await seedPrivateChatWithMessage(a, b)
    const complaintId = await reportMessage('b2@a.io', messageId)

    const modBTok = await login('mod@b.io')
    const res = await request(server)
      .get(`/api/v1/complaints/${complaintId}/messages`)
      .set(auth(modBTok))
      .expect(403)
    expect(res.body.error.code).toBe('WRONG_SCOPE')
  })

  it('жалоба не на сообщение → 400, доступа к чату нет', async () => {
    const a = await makeUser('a3@a.io', 'STUDENT', 'uni-a')
    await makeUser('reporter@a.io', 'STUDENT', 'uni-a')
    await makeUser('mod3@a.io', 'UNIVERSITY_MODERATOR', 'uni-a')
    const repTok = await login('reporter@a.io')
    const complaint = await request(server)
      .post('/api/v1/complaints')
      .set(auth(repTok))
      .send({ targetType: 'USER', targetId: a, reason: 'спам' })
      .expect(201)

    const modTok = await login('mod3@a.io')
    await request(server)
      .get(`/api/v1/complaints/${complaint.body.data.id}/messages`)
      .set(auth(modTok))
      .expect(400)
  })

  it('иного пути нет: модератор не читает личный чат напрямую (не участник → 403)', async () => {
    const a = await makeUser('a4@a.io', 'STUDENT', 'uni-a')
    const b = await makeUser('b4@a.io', 'STUDENT', 'uni-a')
    await makeUser('mod4@a.io', 'UNIVERSITY_MODERATOR', 'uni-a')
    const { chatId } = await seedPrivateChatWithMessage(a, b)

    const modTok = await login('mod4@a.io')
    const res = await request(server)
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(auth(modTok))
      .expect(403)
    expect(res.body.error.code).toBe('WRONG_SCOPE')
  })
})
