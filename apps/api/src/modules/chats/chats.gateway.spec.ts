import { ChatGateway } from './chats.gateway'
import type { ChatsService } from './chats.service'
import type { PlatformStateReader } from '../platform/platform.constants'
import type { Server, Socket } from 'socket.io'
import type { RealtimeGateway } from '../../common/realtime/realtime.gateway'

// Мок socket.io: client с data.userId, join/leave/emit; client.to(room).emit и server.to(room).emit.
function makeClient(userId: string | null) {
  const roomEmit = jest.fn()
  const client = {
    data: userId ? { userId } : {},
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: roomEmit }),
  }
  return { client, roomEmit }
}

function setup(
  chats: Partial<Record<keyof ChatsService, jest.Mock>>,
  maintenance: jest.Mock = jest.fn().mockResolvedValue(false),
  admitSocket: jest.Mock = jest.fn().mockResolvedValue(true),
) {
  const platform = { maintenanceActive: maintenance }
  const realtime = { admitSocket }
  const gateway = new ChatGateway(
    chats as unknown as ChatsService,
    platform as unknown as PlatformStateReader,
    realtime as unknown as RealtimeGateway,
  )
  const serverEmit = jest.fn()
  const server = { to: jest.fn().mockReturnValue({ emit: serverEmit }) }
  ;(gateway as unknown as { server: Server }).server = server as unknown as Server
  return { gateway, server, serverEmit }
}

describe('ChatGateway.onJoin — членство (9.8)', () => {
  it('не участник → error, без join', async () => {
    const { gateway } = setup({ isMember: jest.fn().mockResolvedValue(false) })
    const { client } = makeClient('u1')
    await gateway.onJoin(client as unknown as Socket, { chatId: 'c1' })
    expect(client.join).not.toHaveBeenCalled()
    expect(client.emit).toHaveBeenCalledWith('error', { event: 'chat:join', code: 'WRONG_SCOPE' })
  })

  it('участник → вход в комнату chat:', async () => {
    const { gateway } = setup({ isMember: jest.fn().mockResolvedValue(true) })
    const { client } = makeClient('u1')
    await gateway.onJoin(client as unknown as Socket, { chatId: 'c1' })
    expect(client.join).toHaveBeenCalledWith('chat:c1')
  })

  it('неаутентифицированный сокет → игнор', async () => {
    const isMember = jest.fn()
    const { gateway } = setup({ isMember })
    const { client } = makeClient(null)
    await gateway.onJoin(client as unknown as Socket, { chatId: 'c1' })
    expect(isMember).not.toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
  })

  it('невалидный payload → VALIDATION_ERROR', async () => {
    const { gateway } = setup({ isMember: jest.fn() })
    const { client } = makeClient('u1')
    await gateway.onJoin(client as unknown as Socket, { chatId: 123 })
    expect(client.emit).toHaveBeenCalledWith('error', {
      event: 'chat:join',
      code: 'VALIDATION_ERROR',
    })
  })
})

// BUG-028: RestrictedRoleGuard стоит только на HTTP — охрана и библиотекарь, оказавшись
// участниками чата, читали и писали бы в него через сокет.
describe('ChatGateway — запрет по умолчанию для охраны и библиотекаря', () => {
  it('chat:join и message:send → FORBIDDEN, без проверки членства и записи', async () => {
    const isMember = jest.fn().mockResolvedValue(true)
    const createMessage = jest.fn()
    const { gateway } = setup({ isMember, createMessage })
    const { client } = makeClient('guard1')
    Object.assign(client.data, { role: 'SECURITY_GUARD' })

    await gateway.onJoin(client as unknown as Socket, { chatId: 'c1' })
    await gateway.onMessageSend(client as unknown as Socket, { chatId: 'c1', content: 'hi' })

    expect(isMember).not.toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
    expect(createMessage).not.toHaveBeenCalled()
    expect(client.emit).toHaveBeenCalledWith('error', { event: 'chat:join', code: 'FORBIDDEN' })
    expect(client.emit).toHaveBeenCalledWith('error', { event: 'message:send', code: 'FORBIDDEN' })
  })
})

describe('ChatGateway.onMessageSend — рассылка по комнате (9.4)', () => {
  it('сохраняет и шлёт message:new в комнату чата', async () => {
    const message = { id: 'm1', chatId: 'c1', senderId: 'u1', content: 'hi' }
    const createMessage = jest.fn().mockResolvedValue({ message, recipientIds: ['u2'] })
    const { gateway, server, serverEmit } = setup({ createMessage })
    const { client } = makeClient('u1')
    await gateway.onMessageSend(client as unknown as Socket, { chatId: 'c1', content: 'hi' })
    expect(createMessage).toHaveBeenCalledWith('u1', { chatId: 'c1', content: 'hi' })
    expect(server.to).toHaveBeenCalledWith('chat:c1')
    expect(serverEmit).toHaveBeenCalledWith('message:new', { message, chatId: 'c1' })
  })

  it('эхом возвращает nonce в message:new (оптимистичная отправка, #1)', async () => {
    const message = { id: 'm1', chatId: 'c1', senderId: 'u1', content: 'hi' }
    const createMessage = jest.fn().mockResolvedValue({ message, recipientIds: ['u2'] })
    const { gateway, serverEmit } = setup({ createMessage })
    const { client } = makeClient('u1')
    await gateway.onMessageSend(client as unknown as Socket, {
      chatId: 'c1',
      content: 'hi',
      nonce: 'n-123',
    })
    expect(serverEmit).toHaveBeenCalledWith('message:new', {
      message,
      chatId: 'c1',
      nonce: 'n-123',
    })
  })

  it('ошибка сервиса (не участник) → error клиенту, без рассылки', async () => {
    const createMessage = jest.fn().mockRejectedValue({ code: 'WRONG_SCOPE' })
    const { gateway, serverEmit } = setup({ createMessage })
    const { client } = makeClient('u1')
    await gateway.onMessageSend(client as unknown as Socket, { chatId: 'c1', content: 'hi' })
    expect(client.emit).toHaveBeenCalledWith('error', {
      event: 'message:send',
      code: 'WRONG_SCOPE',
    })
    expect(serverEmit).not.toHaveBeenCalled()
  })
})

describe('ChatGateway.typing — только другим участникам', () => {
  it('небольшой чат → в личные комнаты остальных, себе не шлём', async () => {
    const actionAudience = jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2', 'u3'] })
    const { gateway, server, serverEmit } = setup({ actionAudience })
    const { client } = makeClient('u1')
    await gateway.onTypingStart(client as unknown as Socket, { chatId: 'c1' })
    expect(actionAudience).toHaveBeenCalledWith('u1', 'c1')
    expect(server.to).toHaveBeenCalledWith('user:u2')
    expect(server.to).toHaveBeenCalledWith('user:u3')
    expect(server.to).not.toHaveBeenCalledWith('user:u1')
    expect(serverEmit).toHaveBeenCalledWith('typing:started', { chatId: 'c1', userId: 'u1' })
  })

  it('большой чат → прежняя рассылка по комнате чата', async () => {
    const { gateway, server } = setup({
      actionAudience: jest.fn().mockResolvedValue({ kind: 'room' }),
    })
    const { client, roomEmit } = makeClient('u1')
    await gateway.onTypingStart(client as unknown as Socket, { chatId: 'c1' })
    expect(client.to).toHaveBeenCalledWith('chat:c1')
    expect(roomEmit).toHaveBeenCalledWith('typing:started', { chatId: 'c1', userId: 'u1' })
    expect(server.to).not.toHaveBeenCalled()
  })

  it('не участник → молчим', async () => {
    const { gateway, server } = setup({
      actionAudience: jest.fn().mockResolvedValue({ kind: 'denied' }),
    })
    const { client, roomEmit } = makeClient('u1')
    await gateway.onTypingStart(client as unknown as Socket, { chatId: 'c1' })
    expect(roomEmit).not.toHaveBeenCalled()
    expect(server.to).not.toHaveBeenCalled()
  })

  it('typing:stop идёт тем же путём', async () => {
    const { gateway, server, serverEmit } = setup({
      actionAudience: jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2'] }),
    })
    const { client } = makeClient('u1')
    await gateway.onTypingStop(client as unknown as Socket, { chatId: 'c1' })
    expect(server.to).toHaveBeenCalledWith('user:u2')
    expect(serverEmit).toHaveBeenCalledWith('typing:stopped', { chatId: 'c1', userId: 'u1' })
  })
})

describe('ChatGateway.onChatAction — действия в чате', () => {
  it('действие уходит адресно участникам, себе не шлём', async () => {
    const actionAudience = jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2', 'u3'] })
    const { gateway, server, serverEmit } = setup({ actionAudience })
    const { client } = makeClient('u1')
    await gateway.onChatAction(client as unknown as Socket, {
      chatId: 'c1',
      action: 'RECORDING_VOICE',
    })
    expect(actionAudience).toHaveBeenCalledWith('u1', 'c1')
    expect(server.to).toHaveBeenCalledWith('user:u2')
    expect(server.to).toHaveBeenCalledWith('user:u3')
    expect(server.to).not.toHaveBeenCalledWith('user:u1')
    expect(serverEmit).toHaveBeenCalledWith('chat:action', {
      chatId: 'c1',
      userId: 'u1',
      action: 'RECORDING_VOICE',
    })
  })

  it('большой чат → рассылка по комнате чата', async () => {
    const { gateway, server } = setup({
      actionAudience: jest.fn().mockResolvedValue({ kind: 'room' }),
    })
    const { client, roomEmit } = makeClient('u1')
    await gateway.onChatAction(client as unknown as Socket, {
      chatId: 'c1',
      action: 'UPLOADING_PHOTO',
    })
    expect(client.to).toHaveBeenCalledWith('chat:c1')
    expect(roomEmit).toHaveBeenCalledWith('chat:action', {
      chatId: 'c1',
      userId: 'u1',
      action: 'UPLOADING_PHOTO',
    })
    expect(server.to).not.toHaveBeenCalled()
  })

  it('не участник → молчим', async () => {
    const { gateway, server } = setup({
      actionAudience: jest.fn().mockResolvedValue({ kind: 'denied' }),
    })
    const { client, roomEmit } = makeClient('u1')
    await gateway.onChatAction(client as unknown as Socket, { chatId: 'c1', action: 'TYPING' })
    expect(roomEmit).not.toHaveBeenCalled()
    expect(server.to).not.toHaveBeenCalled()
  })

  it('action: null — конец действия', async () => {
    const { gateway, serverEmit } = setup({
      actionAudience: jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2'] }),
    })
    const { client } = makeClient('u1')
    await gateway.onChatAction(client as unknown as Socket, { chatId: 'c1', action: null })
    expect(serverEmit).toHaveBeenCalledWith('chat:action', {
      chatId: 'c1',
      userId: 'u1',
      action: null,
    })
  })

  it.each([
    ['неизвестное действие', { chatId: 'c1', action: 'DANCING' }],
    ['лишнее поле', { chatId: 'c1', action: 'TYPING', expiresAt: 1 }],
    ['нет chatId', { action: 'TYPING' }],
  ])('%s → VALIDATION_ERROR, рассылки нет', async (_label, payload) => {
    const actionAudience = jest.fn()
    const { gateway, serverEmit } = setup({ actionAudience })
    const { client } = makeClient('u1')
    await gateway.onChatAction(client as unknown as Socket, payload)
    expect(actionAudience).not.toHaveBeenCalled()
    expect(serverEmit).not.toHaveBeenCalled()
    expect(client.emit).toHaveBeenCalledWith('error', {
      event: 'chat:action',
      code: 'VALIDATION_ERROR',
    })
  })

  // Клиент прошлой версии не знает про chat:action и ждёт typing:started/typing:stopped.
  describe('совместимость со старым клиентом', () => {
    it('TYPING дублируется как typing:started', async () => {
      const { gateway, serverEmit } = setup({
        actionAudience: jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2'] }),
      })
      const { client } = makeClient('u1')
      await gateway.onChatAction(client as unknown as Socket, { chatId: 'c1', action: 'TYPING' })
      expect(serverEmit).toHaveBeenCalledWith('typing:started', { chatId: 'c1', userId: 'u1' })
    })

    it('конец действия дублируется как typing:stopped', async () => {
      const { gateway, serverEmit } = setup({
        actionAudience: jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2'] }),
      })
      const { client } = makeClient('u1')
      await gateway.onChatAction(client as unknown as Socket, { chatId: 'c1', action: null })
      expect(serverEmit).toHaveBeenCalledWith('typing:stopped', { chatId: 'c1', userId: 'u1' })
    })

    it('остальные действия старому клиенту не шлются вовсе', async () => {
      const { gateway, serverEmit } = setup({
        actionAudience: jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2'] }),
      })
      const { client } = makeClient('u1')
      await gateway.onChatAction(client as unknown as Socket, {
        chatId: 'c1',
        action: 'UPLOADING_FILE',
      })
      const events = serverEmit.mock.calls.map(([event]) => event)
      expect(events).toEqual(['chat:action'])
    })

    it('старый typing:start превращается в действие TYPING', async () => {
      const { gateway, serverEmit } = setup({
        actionAudience: jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2'] }),
      })
      const { client } = makeClient('u1')
      await gateway.onTypingStart(client as unknown as Socket, { chatId: 'c1' })
      expect(serverEmit).toHaveBeenCalledWith('chat:action', {
        chatId: 'c1',
        userId: 'u1',
        action: 'TYPING',
      })
    })
  })
})

describe('ChatGateway.onMessageSend — «пустой» текст', () => {
  // Проверка нормализации из MessageSendSchema: композер обрезает текст сам, и в браузере
  // правило соблюдалось, но по WS напрямую проходили и строка из пробелов, и один U+200B.
  it.each([
    ['только пробелы', '     '],
    ['неразрывные пробелы и табы', ' \t  '],
    ['нулевой ширины пробел', '​'],
    ['word joiner и BOM', '⁠﻿'],
    ['одни переводы строки', '\n\n\n'],
  ])('%s → VALIDATION_ERROR, сообщение не создаётся', async (_label, content) => {
    const createMessage = jest.fn()
    const { gateway, serverEmit } = setup({ createMessage })
    const { client } = makeClient('u1')
    await gateway.onMessageSend(client as unknown as Socket, { chatId: 'c1', content })
    expect(createMessage).not.toHaveBeenCalled()
    expect(client.emit).toHaveBeenCalledWith('error', {
      event: 'message:send',
      code: 'VALIDATION_ERROR',
    })
    expect(serverEmit).not.toHaveBeenCalled()
  })

  it('пробелы по краям обрезаются до сохранения', async () => {
    const message = { id: 'm1', chatId: 'c1', senderId: 'u1', content: 'привет' }
    const createMessage = jest.fn().mockResolvedValue({ message, recipientIds: [] })
    const { gateway } = setup({ createMessage })
    const { client } = makeClient('u1')
    await gateway.onMessageSend(client as unknown as Socket, {
      chatId: 'c1',
      content: '   привет   ',
    })
    expect(createMessage).toHaveBeenCalledWith('u1', { chatId: 'c1', content: 'привет' })
  })

  it('текст на 4000 символов с пробелами по краям проходит: длина считается после обрезки', async () => {
    const message = { id: 'm1', chatId: 'c1', senderId: 'u1', content: 'x'.repeat(4000) }
    const createMessage = jest.fn().mockResolvedValue({ message, recipientIds: [] })
    const { gateway } = setup({ createMessage })
    const { client } = makeClient('u1')
    await gateway.onMessageSend(client as unknown as Socket, {
      chatId: 'c1',
      content: `  ${'x'.repeat(4000)}  `,
    })
    expect(createMessage).toHaveBeenCalledWith('u1', { chatId: 'c1', content: 'x'.repeat(4000) })
  })

  it('правка сообщения подчиняется тому же правилу', async () => {
    const editMessage = jest.fn()
    const { gateway } = setup({ editMessage })
    const { client } = makeClient('u1')
    await gateway.onMessageEdit(client as unknown as Socket, { messageId: 'm1', content: '  ​ ' })
    expect(editMessage).not.toHaveBeenCalled()
    expect(client.emit).toHaveBeenCalledWith('error', {
      event: 'message:edit',
      code: 'VALIDATION_ERROR',
    })
  })
})

// F-F15: события сокета не ограничивались ничем — тысячи запросов в базу в секунду с одного.
describe('ChatGateway — лимит событий сокета', () => {
  // Время стоит на месте: корзина не успевает восполниться между событиями цикла.
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(1_000_000))
  afterEach(() => jest.restoreAllMocks())

  it('сверх запаса событие отбрасывается, а отказ клиенту приходит один раз на серию', async () => {
    const markRead = jest.fn().mockResolvedValue({ chatId: 'c1', messageId: 'm1', userId: 'u1' })
    const { gateway } = setup({ markRead })
    const { client } = makeClient('u1')
    for (let i = 0; i < 125; i += 1) {
      await gateway.onMessageRead(client as unknown as Socket, { chatId: 'c1', messageId: 'm1' })
    }
    expect(markRead).toHaveBeenCalledTimes(120)
    const limited = client.emit.mock.calls.filter(
      ([event, payload]) => event === 'error' && payload?.code === 'RATE_LIMIT',
    )
    expect(limited).toEqual([['error', { event: 'message:read', code: 'RATE_LIMIT' }]])
  })

  it('лимит у каждого сокета свой', async () => {
    const isMember = jest.fn().mockResolvedValue(true)
    const { gateway } = setup({ isMember })
    const a = makeClient('u1').client
    const b = makeClient('u2').client
    for (let i = 0; i < 130; i += 1) {
      await gateway.onJoin(a as unknown as Socket, { chatId: 'c1' })
    }
    await gateway.onJoin(b as unknown as Socket, { chatId: 'c1' })
    expect(b.join).toHaveBeenCalledWith('chat:c1')
    expect(isMember).toHaveBeenCalledTimes(121)
  })

  it('выход из комнаты не лимитируется', async () => {
    const { gateway } = setup({ markRead: jest.fn().mockResolvedValue({}) })
    const { client } = makeClient('u1')
    for (let i = 0; i < 130; i += 1) {
      await gateway.onMessageRead(client as unknown as Socket, { chatId: 'c1', messageId: 'm1' })
    }
    await gateway.onLeave(client as unknown as Socket, { chatId: 'c1' })
    expect(client.leave).toHaveBeenCalledWith('chat:c1')
  })

  it('действия в чате — строже, лишние молча отбрасываются до запроса в базу', async () => {
    const actionAudience = jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2'] })
    const { gateway } = setup({ actionAudience })
    const { client } = makeClient('u1')
    for (let i = 0; i < 25; i += 1) {
      await gateway.onChatAction(client as unknown as Socket, { chatId: 'c1', action: 'TYPING' })
    }
    expect(actionAudience).toHaveBeenCalledTimes(20)
    expect(client.emit).not.toHaveBeenCalled()
  })
})

// A-F28: MaintenanceGuard стоит только на HTTP — запись через сокет режим техработ
// останавливает сам гейтвей.
describe('ChatGateway — режим техработ', () => {
  const message = { id: 'm1', chatId: 'c1', senderId: 'u1', content: 'hi' }

  function staffClient(role: string) {
    const made = makeClient('u1')
    ;(made.client.data as Record<string, unknown>).role = role
    return made
  }

  it('отправка, правка и удаление не пишут в базу и отвечают MAINTENANCE', async () => {
    const createMessage = jest.fn()
    const editMessage = jest.fn()
    const deleteMessage = jest.fn()
    const { gateway, serverEmit } = setup(
      { createMessage, editMessage, deleteMessage },
      jest.fn().mockResolvedValue(true),
    )
    const { client } = makeClient('u1')
    const socket = client as unknown as Socket

    await gateway.onMessageSend(socket, { chatId: 'c1', content: 'hi' })
    await gateway.onMessageEdit(socket, { messageId: 'm1', content: 'new' })
    await gateway.onMessageDelete(socket, { messageId: 'm1' })

    expect(createMessage).not.toHaveBeenCalled()
    expect(editMessage).not.toHaveBeenCalled()
    expect(deleteMessage).not.toHaveBeenCalled()
    expect(serverEmit).not.toHaveBeenCalled()
    for (const event of ['message:send', 'message:edit', 'message:delete']) {
      expect(client.emit).toHaveBeenCalledWith('error', { event, code: 'MAINTENANCE' })
    }
  })

  it('команда платформы пишет и во время техработ', async () => {
    const createMessage = jest.fn().mockResolvedValue({ message, recipientIds: [] })
    const maintenance = jest.fn().mockResolvedValue(true)
    const { gateway, serverEmit } = setup({ createMessage }, maintenance)
    const { client } = staffClient('PLATFORM_MODERATOR')
    await gateway.onMessageSend(client as unknown as Socket, { chatId: 'c1', content: 'hi' })
    expect(createMessage).toHaveBeenCalled()
    expect(serverEmit).toHaveBeenCalledWith('message:new', { message, chatId: 'c1' })
    expect(maintenance).not.toHaveBeenCalled()
  })

  it('чтение идёт как шло: вход в комнату и отметка о прочтении', async () => {
    const isMember = jest.fn().mockResolvedValue(true)
    const markRead = jest.fn().mockResolvedValue({ chatId: 'c1', userId: 'u1' })
    const { gateway } = setup({ isMember, markRead }, jest.fn().mockResolvedValue(true))
    const { client } = makeClient('u1')
    await gateway.onJoin(client as unknown as Socket, { chatId: 'c1' })
    await gateway.onMessageRead(client as unknown as Socket, { chatId: 'c1', messageId: 'm1' })
    expect(client.join).toHaveBeenCalledWith('chat:c1')
    expect(markRead).toHaveBeenCalled()
  })

  it('сбой проверки техработ не останавливает чаты', async () => {
    const createMessage = jest.fn().mockResolvedValue({ message, recipientIds: [] })
    const { gateway } = setup({ createMessage }, jest.fn().mockRejectedValue(new Error('db down')))
    const { client } = makeClient('u1')
    await gateway.onMessageSend(client as unknown as Socket, { chatId: 'c1', content: 'hi' })
    expect(createMessage).toHaveBeenCalled()
  })
})

// Регрессия: message:send по уже открытому сокету работал в обход UNIVERSITY_BLOCKED (§8.2) —
// HTTP пользователю закрытого вуза отказывал, а сокет на соседнем инстансе жил дальше.
describe('ChatGateway — заблокированный вуз', () => {
  it('message:send: допуск вуза спрашивается до записи; отказ — сообщение не создаётся', async () => {
    const createMessage = jest.fn()
    const admitSocket = jest.fn().mockResolvedValue(false)
    const { gateway, server } = setup({ createMessage }, undefined, admitSocket)
    const { client } = makeClient('u1')
    await gateway.onMessageSend(client as unknown as Socket, {
      chatId: '11111111-1111-4111-8111-111111111111',
      content: 'привет',
    })
    expect(admitSocket).toHaveBeenCalledWith(client, 'message:send')
    expect(createMessage).not.toHaveBeenCalled()
    expect(server.to).not.toHaveBeenCalled()
  })

  it('chat:join: отказ вуза — в комнату чата не входит', async () => {
    const isMember = jest.fn().mockResolvedValue(true)
    const admitSocket = jest.fn().mockResolvedValue(false)
    const { gateway } = setup({ isMember }, undefined, admitSocket)
    const { client } = makeClient('u1')
    await gateway.onJoin(client as unknown as Socket, { chatId: 'c1' })
    expect(isMember).not.toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
  })

  it('message:edit и message:delete при отказе вуза в базу не идут', async () => {
    const editMessage = jest.fn()
    const deleteMessage = jest.fn()
    const admitSocket = jest.fn().mockResolvedValue(false)
    const { gateway } = setup({ editMessage, deleteMessage }, undefined, admitSocket)
    const { client } = makeClient('u1')
    const messageId = '22222222-2222-4222-8222-222222222222'
    await gateway.onMessageEdit(client as unknown as Socket, { messageId, content: 'x' })
    await gateway.onMessageDelete(client as unknown as Socket, { messageId })
    expect(editMessage).not.toHaveBeenCalled()
    expect(deleteMessage).not.toHaveBeenCalled()
  })
})
