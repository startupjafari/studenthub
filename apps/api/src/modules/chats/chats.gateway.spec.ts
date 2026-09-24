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
    const typingAudience = jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2', 'u3'] })
    const { gateway, server, serverEmit } = setup({ typingAudience })
    const { client } = makeClient('u1')
    await gateway.onTypingStart(client as unknown as Socket, { chatId: 'c1' })
    expect(typingAudience).toHaveBeenCalledWith('u1', 'c1')
    expect(server.to).toHaveBeenCalledWith('user:u2')
    expect(server.to).toHaveBeenCalledWith('user:u3')
    expect(server.to).not.toHaveBeenCalledWith('user:u1')
    expect(serverEmit).toHaveBeenCalledWith('typing:started', { chatId: 'c1', userId: 'u1' })
  })

  it('большой чат → прежняя рассылка по комнате чата', async () => {
    const { gateway, server } = setup({
      typingAudience: jest.fn().mockResolvedValue({ kind: 'room' }),
    })
    const { client, roomEmit } = makeClient('u1')
    await gateway.onTypingStart(client as unknown as Socket, { chatId: 'c1' })
    expect(client.to).toHaveBeenCalledWith('chat:c1')
    expect(roomEmit).toHaveBeenCalledWith('typing:started', { chatId: 'c1', userId: 'u1' })
    expect(server.to).not.toHaveBeenCalled()
  })

  it('не участник → молчим', async () => {
    const { gateway, server } = setup({
      typingAudience: jest.fn().mockResolvedValue({ kind: 'denied' }),
    })
    const { client, roomEmit } = makeClient('u1')
    await gateway.onTypingStart(client as unknown as Socket, { chatId: 'c1' })
    expect(roomEmit).not.toHaveBeenCalled()
    expect(server.to).not.toHaveBeenCalled()
  })

  it('typing:stop идёт тем же путём', async () => {
    const { gateway, server, serverEmit } = setup({
      typingAudience: jest.fn().mockResolvedValue({ kind: 'users', userIds: ['u2'] }),
    })
    const { client } = makeClient('u1')
    await gateway.onTypingStop(client as unknown as Socket, { chatId: 'c1' })
    expect(server.to).toHaveBeenCalledWith('user:u2')
    expect(serverEmit).toHaveBeenCalledWith('typing:stopped', { chatId: 'c1', userId: 'u1' })
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
