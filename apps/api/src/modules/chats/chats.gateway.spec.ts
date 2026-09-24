import { ChatGateway } from './chats.gateway'
import type { ChatsService } from './chats.service'
import type { Server, Socket } from 'socket.io'

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

function setup(chats: Partial<Record<keyof ChatsService, jest.Mock>>) {
  const gateway = new ChatGateway(chats as unknown as ChatsService)
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
