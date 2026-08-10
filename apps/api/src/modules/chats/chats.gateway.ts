import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'
import {
  ChatJoinSchema,
  MessageDeleteSchema,
  MessageEditSchema,
  MessageReadSchema,
  MessageSendSchema,
  TypingSchema,
} from '@studenthub/shared-schemas'
import type { ZodSchema } from 'zod'
import { ChatsService } from './chats.service'

// WS-обработчики чата (docs/PROJECT.md §9, задачи 9.3–9.4). Подключение/handshake-аутентификацию
// и авто-вход в user/group/university-комнаты делает RealtimeGateway; здесь — чат-события на том же
// соединении. Каждый payload валидируется Zod (WS — не доверенный канал, §10). Рассылка только адресно.
@WebSocketGateway()
export class ChatGateway {
  @WebSocketServer() private readonly server!: Server
  private readonly logger = new Logger(ChatGateway.name)

  constructor(private readonly chats: ChatsService) {}

  private userId(client: Socket): string | null {
    const id = client.data?.userId as string | undefined
    return typeof id === 'string' && id.length > 0 ? id : null
  }

  // Валидация payload; при ошибке шлём клиенту error-событие и возвращаем null.
  private parse<T>(client: Socket, event: string, schema: ZodSchema<T>, raw: unknown): T | null {
    const result = schema.safeParse(raw)
    if (!result.success) {
      client.emit('error', { event, code: 'VALIDATION_ERROR' })
      return null
    }
    return result.data
  }

  private fail(client: Socket, event: string, error: unknown): void {
    const code = (error as { code?: string }).code ?? 'INTERNAL_ERROR'
    client.emit('error', { event, code })
  }

  @SubscribeMessage('chat:join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() raw: unknown): Promise<void> {
    const uid = this.userId(client)
    const data = this.parse(client, 'chat:join', ChatJoinSchema, raw)
    if (!uid || !data) return
    // В комнату chat: — только после проверки членства в БД (§10).
    if (!(await this.chats.isMember(uid, data.chatId))) {
      client.emit('error', { event: 'chat:join', code: 'WRONG_SCOPE' })
      return
    }
    await client.join(`chat:${data.chatId}`)
  }

  @SubscribeMessage('chat:leave')
  async onLeave(@ConnectedSocket() client: Socket, @MessageBody() raw: unknown): Promise<void> {
    const data = this.parse(client, 'chat:leave', ChatJoinSchema, raw)
    if (!data) return
    await client.leave(`chat:${data.chatId}`)
  }

  @SubscribeMessage('message:send')
  async onMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    const uid = this.userId(client)
    const data = this.parse(client, 'message:send', MessageSendSchema, raw)
    if (!uid || !data) return
    try {
      const { message } = await this.chats.createMessage(uid, data)
      // Всем участникам в комнате чата (включая отправителя) ровно один раз. nonce эхом —
      // отправитель заменит свой оптимистичный «pending» пузырь (#1); остальные его игнорируют.
      this.server
        .to(`chat:${data.chatId}`)
        .emit('message:new', { message, chatId: data.chatId, nonce: data.nonce })
    } catch (error) {
      this.fail(client, 'message:send', error)
    }
  }

  @SubscribeMessage('message:edit')
  async onMessageEdit(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    const uid = this.userId(client)
    const data = this.parse(client, 'message:edit', MessageEditSchema, raw)
    if (!uid || !data) return
    try {
      const message = await this.chats.editMessage(uid, data.messageId, data.content)
      this.server
        .to(`chat:${message.chatId}`)
        .emit('message:updated', { message, chatId: message.chatId })
    } catch (error) {
      this.fail(client, 'message:edit', error)
    }
  }

  @SubscribeMessage('message:delete')
  async onMessageDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    const uid = this.userId(client)
    const data = this.parse(client, 'message:delete', MessageDeleteSchema, raw)
    if (!uid || !data) return
    try {
      const { chatId } = await this.chats.deleteMessage(uid, data.messageId)
      this.server
        .to(`chat:${chatId}`)
        .emit('message:deleted', { messageId: data.messageId, chatId })
    } catch (error) {
      this.fail(client, 'message:delete', error)
    }
  }

  @SubscribeMessage('message:read')
  async onMessageRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    const uid = this.userId(client)
    const data = this.parse(client, 'message:read', MessageReadSchema, raw)
    if (!uid || !data) return
    try {
      const payload = await this.chats.markRead(uid, data.chatId, data.messageId)
      this.server.to(`chat:${data.chatId}`).emit('message:read', payload)
    } catch (error) {
      this.fail(client, 'message:read', error)
    }
  }

  @SubscribeMessage('typing:start')
  onTypingStart(@ConnectedSocket() client: Socket, @MessageBody() raw: unknown): void {
    const uid = this.userId(client)
    const data = this.parse(client, 'typing:start', TypingSchema, raw)
    if (!uid || !data) return
    // Остальным участникам комнаты (кроме себя).
    client.to(`chat:${data.chatId}`).emit('typing:started', { chatId: data.chatId, userId: uid })
  }

  @SubscribeMessage('typing:stop')
  onTypingStop(@ConnectedSocket() client: Socket, @MessageBody() raw: unknown): void {
    const uid = this.userId(client)
    const data = this.parse(client, 'typing:stop', TypingSchema, raw)
    if (!uid || !data) return
    client.to(`chat:${data.chatId}`).emit('typing:stopped', { chatId: data.chatId, userId: uid })
  }
}
