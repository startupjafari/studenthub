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
  ChatActionPayloadSchema,
  ChatJoinSchema,
  MessageDeleteSchema,
  MessageEditSchema,
  MessageReadSchema,
  MessageSendSchema,
  TypingSchema,
  type ChatAction,
} from '@studenthub/shared-schemas'
import type { ZodSchema } from 'zod'
import { captureUnexpected, isExpectedBusinessError } from '../../common/monitoring'
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

    // Ф13.8: до этого сбой WS-обработчика был виден только клиенту (одно `error`-событие),
    // в логах и трекере — ничего. Бизнес-отказы (нет прав, не найдено) не шумят;
    // неожиданные — в лог и в Sentry. Содержимое сообщений в трекер не уходит.
    if (isExpectedBusinessError(error)) {
      return
    }
    const eventId = captureUnexpected(error, {
      source: 'ws',
      userId: this.userId(client) ?? undefined,
      path: event,
      code,
    })
    this.logger.error(
      { err: error, event, code, ...(eventId ? { sentryEventId: eventId } : {}) },
      `Сбой WS-обработчика ${event}`,
    )
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

  /**
   * Что человек делает в чате прямо сейчас (§9.1): набирает текст, записывает голосовое,
   * отправляет вложение. `action: null` — действие закончилось.
   */
  @SubscribeMessage('chat:action')
  async onChatAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    const data = this.parse(client, 'chat:action', ChatActionPayloadSchema, raw)
    if (!data) return
    await this.relayAction(client, 'chat:action', data.chatId, data.action)
  }

  // Старые имена событий остаются рабочими: §9.2a — именованные события не удаляются, клиенты
  // переезжают постепенно. Здесь это просто частный случай действия TYPING.
  @SubscribeMessage('typing:start')
  async onTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    const data = this.parse(client, 'typing:start', TypingSchema, raw)
    if (!data) return
    await this.relayAction(client, 'typing:start', data.chatId, 'TYPING')
  }

  @SubscribeMessage('typing:stop')
  async onTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    const data = this.parse(client, 'typing:stop', TypingSchema, raw)
    if (!data) return
    await this.relayAction(client, 'typing:stop', data.chatId, null)
  }

  /**
   * Действие уходит в личные комнаты участников, а не только в `chat:{id}`: подпись нужна и
   * в строке списка чатов, а в комнату чата входят только с открытой перепиской (§1 карты
   * интерфейса). В больших чатах служба возвращает `room` — там подпись остаётся прежней,
   * видимой только с открытым чатом; причины — в `ChatsService.actionAudience`.
   *
   * Отправитель исключён в обоих путях: `client.to(...)` не шлёт самому себе, а в веерном
   * списке его id отфильтрован — иначе своя же подпись встала бы в свою строку.
   *
   * Рядом с `chat:action` шлём и старые `typing:started`/`typing:stopped` — ровно для действия
   * TYPING. Клиент прошлой версии продолжает показывать «печатает…», не зная про новые
   * действия; на остальные действия он просто ничего не получает, и это лучше, чем подпись,
   * которую он не сумеет перевести.
   */
  private async relayAction(
    client: Socket,
    event: string,
    chatId: string,
    action: ChatAction | null,
  ): Promise<void> {
    const uid = this.userId(client)
    if (!uid) return
    try {
      const payload = { chatId, userId: uid, action }
      const audience = await this.chats.actionAudience(uid, chatId)
      if (audience.kind === 'denied') return

      const legacy =
        action === 'TYPING' ? 'typing:started' : action === null ? 'typing:stopped' : null
      if (audience.kind === 'room') {
        const room = client.to(`chat:${chatId}`)
        room.emit('chat:action', payload)
        if (legacy) room.emit(legacy, { chatId, userId: uid })
        return
      }
      for (const userId of audience.userIds) {
        const target = this.server.to(`user:${userId}`)
        target.emit('chat:action', payload)
        if (legacy) target.emit(legacy, { chatId, userId: uid })
      }
    } catch (error) {
      this.fail(client, event, error)
    }
  }
}
