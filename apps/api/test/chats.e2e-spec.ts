import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { throttlerStorageStub } from './throttler-storage.stub'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'
import { Client as MinioClient } from 'minio'
import { FILE_UPLOAD } from '@studenthub/shared-config'

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
      // Счётчики rate limit — в Redis (ResilientThrottlerStorage), внутренней Map больше нет.
      .overrideProvider(ThrottlerStorage)
      .useValue(throttlerStorageStub)
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

  // Прямая загрузка идёт в настоящий MinIO мимо приложения — иначе проверять нечего:
  // весь смысл пути в том, что байты через API не проходят.
  const minio = new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
  })
  const chatBucket = process.env.MINIO_BUCKET_CHAT ?? 'chat-media'
  // TRUNCATE чистит БД, но не хранилище: объекты за собой убираем сами, иначе dev-бакет
  // обрастает мусором от каждого прогона.
  const createdKeys: string[] = []

  /** PUT по подписанной ссылке и ETag из ответа — то же самое делает браузер. */
  async function putSigned(url: string, body: Buffer): Promise<string> {
    const res = await fetch(url, { method: 'PUT', body: new Uint8Array(body) })
    expect(res.status).toBe(200)
    return (res.headers.get('etag') ?? '').replace(/"/g, '')
  }

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

  // Крупные вложения (Ф19.0): байты идут в хранилище напрямую, сообщение создаётся по ключам.
  describe('Прямая загрузка вложений', () => {
    // Валидный 1×1 PNG: тип определяется по magic bytes, а не по объявленному mime.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )

    afterAll(async () => {
      if (createdKeys.length) {
        await minio.removeObjects(chatBucket, createdKeys).catch(() => undefined)
      }
    })

    async function chatFor(): Promise<{ token: string; chatId: string }> {
      const memberId = await makeStudent('dm@a.io')
      await makeStudent('du@a.io')
      const token = await login('dm@a.io')
      const chatId = await createGroupChat(token, [memberId])
      return { token, chatId }
    }

    it('одиночный PUT: объект попадает в хранилище, сообщение создаётся по ключу', async () => {
      const { token, chatId } = await chatFor()

      const presign = await request(server)
        .post(`/api/v1/chats/${chatId}/attachments/presign`)
        .set(auth(token))
        .send({ mime: 'image/png' })
        .expect(201)
      const { key, url } = presign.body.data as { key: string; url: string }
      createdKeys.push(key)
      await putSigned(url, PNG)

      const sent = await request(server)
        .post(`/api/v1/chats/${chatId}/messages/uploaded`)
        .set(auth(token))
        .send({ content: 'снимок', attachments: [{ key, name: 'shot.png' }] })
        .expect(201)

      const media = sent.body.data.media as { mime: string; size: number; name: string }[]
      expect(media).toHaveLength(1)
      // Тип определён по содержимому объекта, а не по тому, что объявил клиент.
      expect(media[0]?.mime).toBe('image/png')
      expect(media[0]?.size).toBe(PNG.byteLength)
      expect(media[0]?.name).toBe('shot.png')
    })

    it('многочастная: части склеиваются, объект проходит проверку типа', async () => {
      const { token, chatId } = await chatFor()
      // PDF, а не картинка: 12 МБ переваливают лимит IMAGE, а для DOCUMENT это в пределах.
      // Две части — минимальный честный многочастный случай (минимум части у S3 — 5 МиБ).
      const body = Buffer.concat([
        Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
        Buffer.alloc(12 * 1024 * 1024 - 45, 0x20),
      ])

      const started = await request(server)
        .post(`/api/v1/chats/${chatId}/attachments/multipart/start`)
        .set(auth(token))
        .send({ mime: 'application/pdf', size: body.byteLength })
        .expect(201)
      const { key, uploadId, partSize, partCount } = started.body.data as {
        key: string
        uploadId: string
        partSize: number
        partCount: number
      }
      createdKeys.push(key)
      expect(partSize).toBe(FILE_UPLOAD.MULTIPART_PART_BYTES)
      expect(partCount).toBe(2)

      const urls = await request(server)
        .post(`/api/v1/chats/${chatId}/attachments/multipart/urls`)
        .set(auth(token))
        .send({ key, uploadId, from: 1, to: partCount })
        .expect(201)
      const signed = urls.body.data.parts as { part: number; url: string }[]
      expect(signed).toHaveLength(2)

      const parts: { part: number; etag: string }[] = []
      for (const item of signed) {
        const offset = (item.part - 1) * partSize
        const etag = await putSigned(item.url, body.subarray(offset, offset + partSize))
        // Без ETag сборка невозможна — именно его браузеру закрывает отсутствие CORS-настройки.
        expect(etag).not.toBe('')
        parts.push({ part: item.part, etag })
      }

      const sent = await request(server)
        .post(`/api/v1/chats/${chatId}/messages/uploaded`)
        .set(auth(token))
        .send({ attachments: [{ key, uploadId, name: 'lecture.pdf', parts }] })
        .expect(201)

      const media = sent.body.data.media as { mime: string; size: number }[]
      expect(media).toHaveLength(1)
      expect(media[0]?.mime).toBe('application/pdf')
      // Собранный объект — ровно исходный файл, а не последняя часть.
      expect(media[0]?.size).toBe(body.byteLength)
    })

    it('не участник не получает подписанную ссылку в чужой чат', async () => {
      const { chatId } = await chatFor()
      const outsiderTok = await login('du@a.io')

      await request(server)
        .post(`/api/v1/chats/${chatId}/attachments/presign`)
        .set(auth(outsiderTok))
        .send({ mime: 'image/png' })
        .expect(403)
    })

    it('чужой ключ не привязывается к сообщению', async () => {
      const { token, chatId } = await chatFor()
      const presign = await request(server)
        .post(`/api/v1/chats/${chatId}/attachments/presign`)
        .set(auth(token))
        .send({ mime: 'image/png' })
        .expect(201)
      const { key, url } = presign.body.data as { key: string; url: string }
      createdKeys.push(key)
      await putSigned(url, PNG)

      // Второй участник знает ключ (он виден в подписанной ссылке), но объект не его.
      const otherId = await makeStudent('thief@a.io')
      await request(server)
        .post(`/api/v1/chats/${chatId}/members`)
        .set(auth(token))
        .send({ userId: otherId })
      const thiefTok = await login('thief@a.io')

      const res = await request(server)
        .post(`/api/v1/chats/${chatId}/messages/uploaded`)
        .set(auth(thiefTok))
        .send({ attachments: [{ key }] })
        .expect(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })
  })
})
