import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'

const PASSWORD = 'Passw0rd!'

// P0 (план чатов): изоляция комнат/членства, доставка-персистентность без дублей,
// стабильность истории (эквивалент «история корректна после reconnect + рефетч»),
// и кросс-вузовая изоляция официальных чатов. Транспорт socket.io здесь не проверяем
// (это плоскость библиотеки); проверяем авторизацию и корректность данных через REST.
describe('Chats (e2e) — изоляция и доставка', () => {
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
    await app.register(multipart, { limits: { files: 10 } })
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
      'TRUNCATE TABLE message_reactions, messages, chat_members, chats, notifications, refresh_tokens, files, groups, faculties, universities, users RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: 'uni-a', name: 'Uni A' } })
    await prisma.university.create({ data: { id: 'uni-b', name: 'Uni B' } })
  })

  async function makeStudent(email: string, universityId = 'uni-a'): Promise<string> {
    const passwordHash = await passwords.hash(PASSWORD)
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Имя',
        lastName: 'Фам',
        role: 'STUDENT',
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

  async function createGroupChat(token: string, memberIds: string[]): Promise<string> {
    const res = await request(server)
      .post('/api/v1/chats')
      .set(auth(token))
      .send({ type: 'GROUP', title: 'Тест-группа', memberIds })
      .expect(201)
    return res.body.data.id as string
  }

  function send(token: string, chatId: string, content: string): request.Test {
    return request(server)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(auth(token))
      .field('content', content)
  }

  describe('Изоляция комнат/членства', () => {
    it('не участник не читает историю чужого чата (403 WRONG_SCOPE)', async () => {
      const ownerId = await makeStudent('owner@a.io')
      const memberId = await makeStudent('member@a.io')
      await makeStudent('outsider@a.io')
      const ownerTok = await login('owner@a.io')
      const chatId = await createGroupChat(ownerTok, [memberId])

      const outsiderTok = await login('outsider@a.io')
      const res = await request(server)
        .get(`/api/v1/chats/${chatId}/messages`)
        .set(auth(outsiderTok))
        .expect(403)
      expect(res.body.error.code).toBe('WRONG_SCOPE')
      void ownerId
    })

    it('не участник не может писать в чужой чат (403) и сообщение не создаётся', async () => {
      const memberId = await makeStudent('m2@a.io')
      await makeStudent('intruder@a.io')
      const ownerTok = await login('m2@a.io')
      const otherMember = await makeStudent('rm2@a.io')
      const chatId = await createGroupChat(ownerTok, [otherMember])
      void memberId

      const intruderTok = await login('intruder@a.io')
      const res = await send(intruderTok, chatId, 'взлом').expect(403)
      expect(res.body.error.code).toBe('WRONG_SCOPE')
      const count = await prisma.message.count({ where: { chatId } })
      expect(count).toBe(0)
    })

    it('не участник не видит список участников чужого чата (403)', async () => {
      const otherId = await makeStudent('u1@a.io')
      await makeStudent('u2@a.io')
      const ownerTok = await login('u1@a.io')
      const otherMember = await makeStudent('u3@a.io')
      const chatId = await createGroupChat(ownerTok, [otherMember])
      void otherId
      const strangerTok = await login('u2@a.io')
      await request(server)
        .get(`/api/v1/chats/${chatId}/members`)
        .set(auth(strangerTok))
        .expect(403)
    })
  })

  describe('Доставка и персистентность (без дублей)', () => {
    it('отправленное сообщение попадает в историю ровно один раз', async () => {
      const memberId = await makeStudent('b@a.io')
      const ownerTok = await login('b@a.io')
      const chatId = await createGroupChat(ownerTok, [memberId])

      await send(ownerTok, chatId, 'привет').expect(201)

      const hist = await request(server)
        .get(`/api/v1/chats/${chatId}/messages`)
        .set(auth(ownerTok))
        .expect(200)
      const matching = (hist.body.data as { id: string; content: string }[]).filter(
        (m) => m.content === 'привет',
      )
      expect(matching).toHaveLength(1)
      expect(await prisma.message.count({ where: { chatId } })).toBe(1)
    })
  })

  describe('Стабильность истории (reconnect = рефетч)', () => {
    it('cursor-пагинация не теряет и не дублирует сообщения', async () => {
      const ownerId = await makeStudent('c@a.io')
      const ownerTok = await login('c@a.io')
      const otherMember = await makeStudent('c2@a.io')
      const chatId = await createGroupChat(ownerTok, [otherMember])
      // Сеем историю напрямую (минуя анти-флуд): 25 сообщений, часть — с одинаковым createdAt,
      // чтобы проверить устойчивость составного курсора (createdAt, id).
      // seq обязателен и уникален в пределах чата (аллокатор Chat.lastSeq живёт в сервисе,
      // а здесь пишем напрямую) — нумеруем сами, порядок совпадает с порядком вставки.
      await prisma.message.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          chatId,
          seq: i + 1,
          senderId: ownerId,
          content: `msg-${i}`,
        })),
      })

      const seen = new Set<string>()
      let cursor: string | undefined
      let pages = 0
      do {
        const url = `/api/v1/chats/${chatId}/messages?limit=10${cursor ? `&cursor=${cursor}` : ''}`
        const res = await request(server).get(url).set(auth(ownerTok)).expect(200)
        for (const m of res.body.data as { id: string }[]) {
          expect(seen.has(m.id)).toBe(false) // ни одного дубля между страницами
          seen.add(m.id)
        }
        cursor = res.body.meta?.hasNext ? (res.body.meta.cursor as string) : undefined
        pages++
      } while (cursor && pages < 10)

      expect(seen.size).toBe(25) // ничего не потеряно
    })
  })

  describe('Кросс-вузовая изоляция официальных чатов', () => {
    it('пользователь вуза A не читает официальный чат вуза B', async () => {
      await makeStudent('a-user@a.io', 'uni-a')
      await makeStudent('b-user@b.io', 'uni-b')
      const bTok = await login('b-user@b.io')
      // Открытие списка чатов лениво создаёт официальные чаты scope вуза B (SUPPORT и т.п.).
      const bList = await request(server).get('/api/v1/chats').set(auth(bTok)).expect(200)
      const bChat = (bList.body.data as { id: string; type: string }[]).find(
        (c) => c.type === 'SUPPORT',
      )
      expect(bChat).toBeTruthy()

      const aTok = await login('a-user@a.io')
      const res = await request(server)
        .get(`/api/v1/chats/${bChat!.id}/messages`)
        .set(auth(aTok))
        .expect(403)
      expect(res.body.error.code).toBe('WRONG_SCOPE')
    })
  })

  // Страховка рефактора N+1 → один groupBy: счётчик непрочитанных в списке чатов.
  describe('Непрочитанные в списке чатов', () => {
    type ChatRow = { id: string; unread: boolean; unreadCount: number }

    it('считает непрочитанные чужие сообщения (одним запросом на все чаты)', async () => {
      const viewerId = await makeStudent('reader@a.io')
      const senderId = await makeStudent('sender@a.io')
      const viewerTok = await login('reader@a.io')
      // Два чата: в первом 3 чужих сообщения (непрочитанные), второй — пустой.
      const withUnread = await createGroupChat(viewerTok, [senderId])
      const empty = await createGroupChat(viewerTok, [senderId])
      await prisma.message.createMany({
        data: Array.from({ length: 3 }, (_, i) => ({
          chatId: withUnread,
          seq: i + 1,
          senderId,
          content: `u${i}`,
        })),
      })
      void viewerId

      const list = await request(server).get('/api/v1/chats').set(auth(viewerTok)).expect(200)
      const rows = list.body.data as ChatRow[]
      const a = rows.find((c) => c.id === withUnread)
      const b = rows.find((c) => c.id === empty)
      expect(a?.unread).toBe(true)
      expect(a?.unreadCount).toBe(3)
      expect(b?.unreadCount).toBe(0)
    })

    it('свои сообщения не считаются непрочитанными', async () => {
      await makeStudent('self@a.io')
      const memberId = await makeStudent('self-mate@a.io')
      const viewerTok = await login('self@a.io')
      const chatId = await createGroupChat(viewerTok, [memberId])
      // сообщение от самого viewer
      await send(viewerTok, chatId, 'моё').expect(201)

      const list = await request(server).get('/api/v1/chats').set(auth(viewerTok)).expect(200)
      const row = (list.body.data as ChatRow[]).find((c) => c.id === chatId)
      expect(row?.unreadCount).toBe(0)
    })
  })

  describe('Серверные черновики', () => {
    it('PUT /draft сохраняет и очищает; черновик приходит в списке чатов', async () => {
      const memberId = await makeStudent('draft@a.io')
      const other = await makeStudent('draft-mate@a.io')
      const tok = await login('draft@a.io')
      const chatId = await createGroupChat(tok, [other])
      void memberId

      await request(server)
        .put(`/api/v1/chats/${chatId}/draft`)
        .set(auth(tok))
        .send({ text: 'недописанное сообщение' })
        .expect(200)

      let list = await request(server).get('/api/v1/chats').set(auth(tok)).expect(200)
      let row = (list.body.data as { id: string; draft: string | null }[]).find(
        (c) => c.id === chatId,
      )
      expect(row?.draft).toBe('недописанное сообщение')

      // Пустой текст очищает черновик.
      await request(server)
        .put(`/api/v1/chats/${chatId}/draft`)
        .set(auth(tok))
        .send({ text: '   ' })
        .expect(200)
      list = await request(server).get('/api/v1/chats').set(auth(tok)).expect(200)
      row = (list.body.data as { id: string; draft: string | null }[]).find((c) => c.id === chatId)
      expect(row?.draft).toBeNull()
    })

    it('черновик недоступен не-участнику (403)', async () => {
      const owner = await makeStudent('do@a.io')
      const mate = await makeStudent('dm@a.io')
      await makeStudent('dstranger@a.io')
      const tok = await login('do@a.io')
      const chatId = await createGroupChat(tok, [mate])
      void owner
      const strangerTok = await login('dstranger@a.io')
      await request(server)
        .put(`/api/v1/chats/${chatId}/draft`)
        .set(auth(strangerTok))
        .send({ text: 'x' })
        .expect(403)
    })
  })

  describe('Статусы прочтения в группах', () => {
    it('GET /reads возвращает участников (кроме себя) с их lastReadAt', async () => {
      const ownerId = await makeStudent('ro@a.io')
      const readerId = await makeStudent('rr@a.io')
      const tok = await login('ro@a.io')
      const chatId = await createGroupChat(tok, [readerId])
      // reader прочитал до текущего момента.
      const readAt = new Date()
      await prisma.chatMember.updateMany({
        where: { chatId, userId: readerId },
        data: { lastReadAt: readAt },
      })
      void ownerId

      const res = await request(server)
        .get(`/api/v1/chats/${chatId}/reads`)
        .set(auth(tok))
        .expect(200)
      const rows = res.body.data as { id: string; lastReadAt: string | null }[]
      // Себя в списке нет; reader есть с непустым lastReadAt.
      expect(rows.some((r) => r.id === ownerId)).toBe(false)
      const reader = rows.find((r) => r.id === readerId)
      expect(reader?.lastReadAt).toBeTruthy()
    })
  })
})
