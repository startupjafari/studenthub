import { randomUUID } from 'node:crypto'
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

const PASSWORD = 'Passw0rd!'

// PNG 1×1 — минимальная настоящая картинка для стикера (тип проверяется по содержимому).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// Функции чатов Telegram-уровня на настоящей БД: особые сообщения, повтор по nonce,
// пересылка пачкой, «удалить у себя», пачкой у всех, закрытие опроса, чек-листы, стикеры.
describe('Chats (e2e) — функции Telegram-уровня', () => {
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
      'TRUNCATE TABLE stickers, sticker_sets, message_reactions, messages, chat_members, chats, notifications, refresh_tokens, files, audit_logs, users, universities RESTART IDENTITY CASCADE',
    )
    await prisma.university.create({ data: { id: 'uni-a', name: 'Uni A' } })
  })

  async function makeUser(email: string, role = 'STUDENT'): Promise<string> {
    const passwordHash = await passwords.hash(PASSWORD)
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Имя',
        lastName: 'Фам',
        role: role as 'STUDENT',
        universityId: role === 'PLATFORM_ADMIN' ? null : 'uni-a',
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

  async function groupOf(token: string, memberIds: string[]): Promise<string> {
    const res = await request(server)
      .post('/api/v1/chats')
      .set(auth(token))
      .send({ type: 'GROUP', title: 'Группа', memberIds })
      .expect(201)
    return res.body.data.id as string
  }

  async function pair(): Promise<{ a: string; b: string; bId: string; chatId: string }> {
    await makeUser('a@a.io')
    const bId = await makeUser('b@a.io')
    const a = await login('a@a.io')
    const b = await login('b@a.io')
    const chatId = await groupOf(a, [bId])
    return { a, b, bId, chatId }
  }

  it('геопозиция, контакт и чек-лист приходят в истории своими полями', async () => {
    const { a, chatId } = await pair()
    const loc = await request(server)
      .post(`/api/v1/chats/${chatId}/location`)
      .set(auth(a))
      .send({ lat: 43.238, lng: 76.945, title: 'КазНУ' })
      .expect(201)
    expect(loc.body.data).toEqual(
      expect.objectContaining({
        content: '',
        location: {
          lat: 43.238,
          lng: 76.945,
          title: 'КазНУ',
          address: null,
          liveUntil: null,
          liveUpdatedAt: null,
          heading: null,
          accuracy: null,
        },
      }),
    )
    await request(server)
      .post(`/api/v1/chats/${chatId}/contact`)
      .set(auth(a))
      .send({ name: 'Деканат' })
      .expect(422)
    await request(server)
      .post(`/api/v1/chats/${chatId}/contact`)
      .set(auth(a))
      .send({ name: 'Деканат', phones: ['+7 700 000 00 00'] })
      .expect(201)
    const cl = await request(server)
      .post(`/api/v1/chats/${chatId}/checklist`)
      .set(auth(a))
      .send({ title: 'Сдать', items: ['Курсовая', 'Отчёт'] })
      .expect(201)
    expect(cl.body.data.checklist.items).toEqual([
      expect.objectContaining({ text: 'Курсовая', order: 0, done: false, doneBy: null }),
      expect.objectContaining({ text: 'Отчёт', order: 1, done: false }),
    ])

    const hist = await request(server)
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(auth(a))
      .expect(200)
    const kinds = (hist.body.data as Record<string, unknown>[]).map((m) =>
      m.location ? 'location' : m.contact ? 'contact' : m.checklist ? 'checklist' : 'other',
    )
    expect(kinds).toEqual(['checklist', 'contact', 'location'])
  })

  it('чек-лист: отметка участником зависит от othersCanMark', async () => {
    const { a, b, chatId } = await pair()
    const locked = await request(server)
      .post(`/api/v1/chats/${chatId}/checklist`)
      .set(auth(a))
      .send({ title: 'Только я', items: ['x'], othersCanMark: false })
      .expect(201)
    const { id, items } = locked.body.data.checklist as { id: string; items: { id: string }[] }
    const denied = await request(server)
      .post(`/api/v1/chats/checklists/${id}/items/${items[0]!.id}/toggle`)
      .set(auth(b))
      .send({ done: true })
      .expect(403)
    expect(denied.body.error.code).toBe('FORBIDDEN')

    const open = await request(server)
      .post(`/api/v1/chats/${chatId}/checklist`)
      .set(auth(a))
      .send({ title: 'Все', items: ['y'] })
      .expect(201)
    const openList = open.body.data.checklist as { id: string; items: { id: string }[] }
    const toggled = await request(server)
      .post(`/api/v1/chats/checklists/${openList.id}/items/${openList.items[0]!.id}/toggle`)
      .set(auth(b))
      .send({ done: true })
      .expect(201)
    expect(toggled.body.data.items[0]).toEqual(
      expect.objectContaining({
        done: true,
        doneBy: expect.objectContaining({ id: expect.any(String) }),
      }),
    )
    const added = await request(server)
      .post(`/api/v1/chats/checklists/${openList.id}/items`)
      .set(auth(b))
      .send({ text: 'z' })
      .expect(201)
    expect(added.body.data.items).toHaveLength(2)
  })

  it('повтор REST-отправки с тем же nonce не создаёт второе сообщение', async () => {
    const { a, chatId } = await pair()
    const first = await request(server)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(auth(a))
      .field('content', 'один раз')
      .field('nonce', 'nonce-1')
      .expect(201)
    const second = await request(server)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(auth(a))
      .field('content', 'один раз')
      .field('nonce', 'nonce-1')
      .expect(201)
    expect(second.body.data.id).toBe(first.body.data.id)
    expect(await prisma.message.count({ where: { chatId } })).toBe(1)
  })

  it('пересылка пачкой: комментарий и сообщения по порядку, повтор по requestId', async () => {
    const { a, bId, chatId } = await pair()
    const target = await groupOf(a, [bId])
    const m1 = await request(server)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(auth(a))
      .field('content', 'первое')
      .expect(201)
    const m2 = await request(server)
      .post(`/api/v1/chats/${chatId}/location`)
      .set(auth(a))
      .send({ lat: 1, lng: 2 })
      .expect(201)
    const body = {
      messageIds: [m2.body.data.id, m1.body.data.id],
      chatIds: [target, 'no-such-chat'],
      comment: 'смотри',
      requestId: randomUUID(),
    }
    const res = await request(server)
      .post('/api/v1/chats/forward')
      .set(auth(a))
      .send(body)
      .expect(201)
    expect(res.body.data.results[0]).toEqual(expect.objectContaining({ chatId: target, ok: true }))
    expect(res.body.data.results[0].messageIds).toHaveLength(3)
    expect(res.body.data.results[1]).toEqual({
      chatId: 'no-such-chat',
      ok: false,
      messageIds: [],
      code: 'WRONG_SCOPE',
    })
    const copies = await prisma.message.findMany({
      where: { chatId: target },
      orderBy: { seq: 'asc' },
      select: { content: true, forwardedFromId: true, location: { select: { lat: true } } },
      take: 10,
    })
    expect(copies).toEqual([
      { content: 'смотри', forwardedFromId: null, location: null },
      { content: 'первое', forwardedFromId: m1.body.data.id, location: null },
      { content: '', forwardedFromId: m2.body.data.id, location: { lat: 1 } },
    ])

    const again = await request(server)
      .post('/api/v1/chats/forward')
      .set(auth(a))
      .send(body)
      .expect(201)
    expect(again.body.data).toEqual(res.body.data)
    expect(await prisma.message.count({ where: { chatId: target } })).toBe(3)
  })

  it('«удалить у себя» прячет только у себя: история, превью списка, догон', async () => {
    const { a, b, chatId } = await pair()
    const m1 = await request(server)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(auth(b))
      .field('content', 'раньше')
      .expect(201)
    const m2 = await request(server)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(auth(b))
      .field('content', 'позже')
      .expect(201)
    const since = new Date().toISOString()
    const hidden = await request(server)
      .post(`/api/v1/chats/${chatId}/messages/hide`)
      .set(auth(a))
      .send({ messageIds: [m2.body.data.id, 'foreign-id'] })
      .expect(201)
    expect(hidden.body.data).toEqual({ hiddenIds: [m2.body.data.id] })

    const mine = await request(server)
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(auth(a))
      .expect(200)
    expect((mine.body.data as { id: string }[]).map((m) => m.id)).toEqual([m1.body.data.id])
    const theirs = await request(server)
      .get(`/api/v1/chats/${chatId}/messages`)
      .set(auth(b))
      .expect(200)
    expect(theirs.body.data).toHaveLength(2)

    const list = await request(server).get('/api/v1/chats').set(auth(a)).expect(200)
    const row = (list.body.data as { id: string; lastMessage: { id: string } | null }[]).find(
      (c) => c.id === chatId,
    )
    expect(row?.lastMessage?.id).toBe(m1.body.data.id)
    // Скрытое не числится непрочитанным: в списке и в сводке бейджа — только m1.
    expect((row as unknown as { unreadCount: number }).unreadCount).toBe(1)
    const unread = await request(server).get('/api/v1/chats/unread').set(auth(a)).expect(200)
    expect(unread.body.data).toMatchObject({ chats: 1, messages: 1 })

    const updates = await request(server)
      .get(`/api/v1/chats/${chatId}/updates`)
      .query({ since: m2.body.data.seq, sinceTs: since })
      .set(auth(a))
      .expect(200)
    expect(updates.body.data.deletedIds).toEqual([m2.body.data.id])

    const search = await request(server)
      .get('/api/v1/chats/search')
      .query({ q: 'позже' })
      .set(auth(a))
      .expect(200)
    expect(search.body.data).toHaveLength(0)
  })

  it('удалить у всех пачкой — только свои; REST-удаление одного', async () => {
    const { a, b, chatId } = await pair()
    const mine = await request(server)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(auth(a))
      .field('content', 'моё')
      .expect(201)
    const theirs = await request(server)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(auth(b))
      .field('content', 'чужое')
      .expect(201)
    const res = await request(server)
      .post(`/api/v1/chats/${chatId}/messages/delete`)
      .set(auth(a))
      .send({ messageIds: [mine.body.data.id, theirs.body.data.id] })
      .expect(201)
    expect(res.body.data).toEqual({
      deletedIds: [mine.body.data.id],
      skippedIds: [theirs.body.data.id],
    })
    await request(server)
      .delete(`/api/v1/chats/messages/${theirs.body.data.id}`)
      .set(auth(a))
      .expect(403)
    await request(server)
      .delete(`/api/v1/chats/messages/${theirs.body.data.id}`)
      .set(auth(b))
      .expect(200)
    expect(await prisma.message.count({ where: { chatId, deletedAt: null } })).toBe(0)
  })

  it('опрос: пояснение, закрытие автором, голос после закрытия — POLL_CLOSED, список опросов', async () => {
    const { a, b, chatId } = await pair()
    const poll = await request(server)
      .post(`/api/v1/chats/${chatId}/poll`)
      .set(auth(a))
      .send({ question: 'Когда?', description: 'Пересдача', options: ['Пн', 'Вт'] })
      .expect(201)
    const pollId = poll.body.data.poll.id as string
    expect(poll.body.data.poll.description).toBe('Пересдача')

    await request(server).post(`/api/v1/chats/polls/${pollId}/close`).set(auth(b)).expect(403)
    const closed = await request(server)
      .post(`/api/v1/chats/polls/${pollId}/close`)
      .set(auth(a))
      .expect(201)
    expect(closed.body.data).toEqual(
      expect.objectContaining({ closed: true, description: 'Пересдача' }),
    )
    const optionId = poll.body.data.poll.options[0].id as string
    const vote = await request(server)
      .post(`/api/v1/chats/polls/${pollId}/vote`)
      .set(auth(b))
      .send({ optionIds: [optionId] })
      .expect(409)
    expect(vote.body.error.code).toBe('POLL_CLOSED')

    const polls = await request(server)
      .get(`/api/v1/chats/${chatId}/polls`)
      .set(auth(b))
      .expect(200)
    expect((polls.body.data as { id: string }[]).map((m) => m.id)).toEqual([poll.body.data.id])
  })

  it('реакция — любой один эмодзи, но не текст', async () => {
    const { a, chatId } = await pair()
    const m = await request(server)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set(auth(a))
      .field('content', 'реакции')
      .expect(201)
    const ok = await request(server)
      .post(`/api/v1/chats/messages/${m.body.data.id}/reactions`)
      .set(auth(a))
      .send({ emoji: '🧑🏽‍💻' })
      .expect(201)
    expect(ok.body.data.reactions).toEqual([expect.objectContaining({ emoji: '🧑🏽‍💻' })])
    await request(server)
      .post(`/api/v1/chats/messages/${m.body.data.id}/reactions`)
      .set(auth(a))
      .send({ emoji: 'ок' })
      .expect(422)
  })

  it('стикеры: админ заводит и публикует набор, студент видит каталог и отправляет', async () => {
    await makeUser('root@p.io', 'PLATFORM_ADMIN')
    const root = await login('root@p.io')
    const { a, chatId } = await pair()

    await request(server)
      .post('/api/v1/admin/sticker-sets')
      .set(auth(a))
      .send({ title: 'Нет', slug: 'no' })
      .expect(403)
    const set = await request(server)
      .post('/api/v1/admin/sticker-sets')
      .set(auth(root))
      .send({ title: 'Кампус', slug: 'campus' })
      .expect(201)
    const setId = set.body.data.id as string
    const withSticker = await request(server)
      .post(`/api/v1/admin/sticker-sets/${setId}/stickers`)
      .set(auth(root))
      .field('emoji', '🎓')
      .attach('file', PNG_1X1, { filename: 's.png', contentType: 'image/png' })
      .expect(201)
    const stickerId = withSticker.body.data.stickers[0].id as string

    // Неопубликованный набор каталогу не виден и отправить из него нельзя.
    const hidden = await request(server).get('/api/v1/chats/stickers/sets').set(auth(a)).expect(200)
    expect(hidden.body.data).toEqual([])
    await request(server)
      .post(`/api/v1/chats/${chatId}/sticker`)
      .set(auth(a))
      .send({ stickerId })
      .expect(404)

    await request(server)
      .patch(`/api/v1/admin/sticker-sets/${setId}`)
      .set(auth(root))
      .send({ isPublished: true })
      .expect(200)
    const sets = await request(server).get('/api/v1/chats/stickers/sets').set(auth(a)).expect(200)
    expect(sets.body.data[0]).toEqual(
      expect.objectContaining({
        slug: 'campus',
        stickers: [
          expect.objectContaining({
            id: stickerId,
            emoji: '🎓',
            width: 1,
            height: 1,
            url: expect.any(String),
            expiresAt: expect.any(String),
          }),
        ],
      }),
    )
    const sent = await request(server)
      .post(`/api/v1/chats/${chatId}/sticker`)
      .set(auth(a))
      .send({ stickerId })
      .expect(201)
    expect(sent.body.data.sticker).toEqual(
      expect.objectContaining({ id: stickerId, setId, emoji: '🎓' }),
    )

    // Удалили набор — у отправленного сообщения стикер «недоступен».
    await request(server).delete(`/api/v1/admin/sticker-sets/${setId}`).set(auth(root)).expect(204)
    const after = await prisma.message.findUniqueOrThrow({
      where: { id: sent.body.data.id },
      select: { stickerId: true },
    })
    expect(after.stickerId).toBeNull()
    expect(await prisma.file.count()).toBe(0)
  })
  it('трансляция геопозиции: точка, частота, догон, остановка, пересылка снимком', async () => {
    const { a, b, chatId } = await pair()
    const sent = await request(server)
      .post(`/api/v1/chats/${chatId}/location`)
      .set(auth(a))
      .send({ lat: 43.2, lng: 76.9, livePeriod: 900, accuracy: 12, heading: 90 })
      .expect(201)
    const messageId = sent.body.data.id as string
    const loc = sent.body.data.location
    expect(loc).toMatchObject({ lat: 43.2, lng: 76.9, accuracy: 12, heading: 90 })
    expect(new Date(loc.liveUntil).getTime() - new Date(loc.liveUpdatedAt).getTime()).toBe(900_000)
    // Срок только из списка 15 мин / 1 ч / 8 ч.
    await request(server)
      .post(`/api/v1/chats/${chatId}/location`)
      .set(auth(a))
      .send({ lat: 1, lng: 1, livePeriod: 60 })
      .expect(422)

    // Чужую трансляцию не двигают.
    await request(server)
      .post(`/api/v1/chats/messages/${messageId}/live-location`)
      .set(auth(b))
      .send({ lat: 1, lng: 1 })
      .expect(403)

    // Точка раньше 3 с после предыдущей — ответ текущим состоянием, без записи.
    const early = await request(server)
      .post(`/api/v1/chats/messages/${messageId}/live-location`)
      .set(auth(a))
      .send({ lat: 50, lng: 50 })
      .expect(200)
    expect(early.body.data).toMatchObject({ lat: 43.2, lng: 76.9 })

    // Отметка последней точки — в прошлое: следующая принимается.
    const sinceSeq = sent.body.data.seq as number
    const since = new Date().toISOString()
    await prisma.chatLocation.update({
      where: { messageId },
      data: { liveUpdatedAt: new Date(Date.now() - 10_000) },
    })
    const moved = await request(server)
      .post(`/api/v1/chats/messages/${messageId}/live-location`)
      .set(auth(a))
      .send({ lat: 43.25, lng: 76.95, heading: 180 })
      .expect(200)
    expect(moved.body.data).toMatchObject({
      lat: 43.25,
      lng: 76.95,
      heading: 180,
      accuracy: null,
      title: null,
      address: null,
    })
    expect(new Date(moved.body.data.liveUpdatedAt).getTime()).toBeGreaterThan(
      new Date(since).getTime() - 1000,
    )

    // Переподключившийся клиент получает сообщение в mutated.
    const updates = await request(server)
      .get(`/api/v1/chats/${chatId}/updates`)
      .query({ since: sinceSeq, sinceTs: since })
      .set(auth(b))
      .expect(200)
    const mutated = updates.body.data.mutated as { id: string; location: { lat: number } }[]
    expect(mutated.map((m) => m.id)).toEqual([messageId])
    expect(mutated[0]?.location.lat).toBe(43.25)

    // Пересылка трансляции — статичный снимок.
    const forwarded = await request(server)
      .post('/api/v1/chats/forward')
      .set(auth(b))
      .send({ messageIds: [messageId], chatIds: [chatId], requestId: randomUUID() })
      .expect(201)
    const copyId = forwarded.body.data.results[0].messageIds[0] as string
    const copy = await prisma.chatLocation.findUniqueOrThrow({ where: { messageId: copyId } })
    expect(copy).toMatchObject({ lat: 43.25, lng: 76.95, liveUntil: null, liveUpdatedAt: null })

    // Остановка: чужому — 403, автору — liveUntil = сейчас; дальше точки не принимаются.
    await request(server)
      .post(`/api/v1/chats/messages/${messageId}/live-location/stop`)
      .set(auth(b))
      .expect(403)
    const stopped = await request(server)
      .post(`/api/v1/chats/messages/${messageId}/live-location/stop`)
      .set(auth(a))
      .expect(200)
    expect(new Date(stopped.body.data.liveUntil).getTime()).toBeLessThanOrEqual(Date.now())
    const ended = await request(server)
      .post(`/api/v1/chats/messages/${messageId}/live-location`)
      .set(auth(a))
      .send({ lat: 1, lng: 1 })
      .expect(409)
    expect(ended.body.error.code).toBe('LIVE_LOCATION_ENDED')

    // Статичная точка — не трансляция.
    await request(server)
      .post(`/api/v1/chats/messages/${copyId}/live-location/stop`)
      .set(auth(b))
      .expect(404)
  })

  it('поиск GIF без GIPHY_API_KEY — 503 FEATURE_DISABLED', async () => {
    const { a, chatId } = await pair()
    const trending = await request(server)
      .get('/api/v1/chats/gifs/trending')
      .set(auth(a))
      .expect(503)
    expect(trending.body.error.code).toBe('FEATURE_DISABLED')
    await request(server)
      .get('/api/v1/chats/gifs/search')
      .query({ q: 'кот' })
      .set(auth(a))
      .expect(503)
    await request(server).get('/api/v1/chats/gifs/search').query({ q: '' }).set(auth(a)).expect(422)
    await request(server)
      .post(`/api/v1/chats/${chatId}/gif/external`)
      .set(auth(a))
      .send({ provider: 'giphy', id: 'abc123' })
      .expect(503)
    await request(server)
      .post(`/api/v1/chats/${chatId}/gif/external`)
      .set(auth(a))
      .send({ provider: 'giphy', id: '../../x' })
      .expect(422)
  })
})
