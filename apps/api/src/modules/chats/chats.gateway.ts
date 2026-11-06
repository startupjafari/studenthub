import { Inject, Logger } from '@nestjs/common'
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
import { Role, isRestrictedRole } from '@studenthub/shared-types'
import type { ZodSchema } from 'zod'
import { captureUnexpected, isExpectedBusinessError } from '../../common/monitoring'
import { RealtimeGateway } from '../../common/realtime/realtime.gateway'
import { PLATFORM_STATE, type PlatformStateReader } from '../platform/platform.constants'
import { ChatsService } from './chats.service'
import { takeToken, type TokenBucketLimit } from './ws-rate-limit'

/**
 * Общий лимит событий одного сокета (F-F15). Запас корзины — под массовые действия самого
 * человека: удаление выделенных сообщений шлёт по событию на сообщение разом. Устойчивый
 * темп с большим запасом выше живого: прочтение уходит не чаще раза в секунду, «печатает» —
 * раз в три секунды.
 */
const EVENT_LIMIT: TokenBucketLimit = { capacity: 120, refillPerSecond: 20 }

/**
 * Действия в чате («печатает», «записывает голосовое») — строже: каждое расходится веером до
 * 64 сокетов, а живой клиент повторяет его раз в три секунды. Сверх лимита действие молча
 * отбрасывается — подпись и так живёт по таймауту, ошибка клиенту тут ничего не даст.
 */
const ACTION_LIMIT: TokenBucketLimit = { capacity: 20, refillPerSecond: 2 }

/**
 * Кто пишет в чаты и во время техработ (A-F28) — те же роли, что пропускает
 * MaintenanceGuard на HTTP: команда платформы и есть те, кто чинит.
 */
const MAINTENANCE_STAFF: readonly string[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

// WS-обработчики чата (docs/PROJECT.md §9, задачи 9.3–9.4). Подключение/handshake-аутентификацию
// и авто-вход в user/group/university-комнаты делает RealtimeGateway; здесь — чат-события на том же
// соединении. Каждый payload валидируется Zod (WS — не доверенный канал, §10). Рассылка только адресно.
@WebSocketGateway()
export class ChatGateway {
  @WebSocketServer() private readonly server!: Server
  private readonly logger = new Logger(ChatGateway.name)

  constructor(
    private readonly chats: ChatsService,
    // По токену, как в MaintenanceGuard: класс PlatformService втянул бы домен auth.
    @Inject(PLATFORM_STATE) private readonly platform: PlatformStateReader,
    // Допуск по статусу вуза для уже открытого сокета (§8.2 UNIVERSITY_BLOCKED).
    private readonly realtime: RealtimeGateway,
  ) {}

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

  /**
   * Пропустить событие по лимиту сокета. Об отказе клиенту сообщаем один раз на серию: ответ
   * на каждое отброшенное событие удвоил бы трафик флудера, а живому клиенту хватит одного.
   */
  private admit(client: Socket, event: string): boolean {
    const store = this.socketStore(client)
    if (takeToken(store, 'wsEvents', EVENT_LIMIT)) {
      store.wsLimited = false
      return true
    }
    if (store.wsLimited !== true) {
      store.wsLimited = true
      client.emit('error', { event, code: 'RATE_LIMIT' })
    }
    return false
  }

  /**
   * Режим техработ для записи через сокет (A-F28). MaintenanceGuard стоит только на HTTP —
   * WS-событие он не видит, и сообщения во время техработ продолжали ложиться в базу: ровно
   * то, ради чего режим включают перед миграцией или восстановлением данных.
   *
   * Останавливается только запись — отправка, правка, удаление. Вход в комнату, «печатает»
   * и отметка о прочтении идут как шли: первые два в базу не пишут, а отказ в прочтении
   * клиенту нечем показать — он лишь шумел бы ошибками.
   *
   * Сбой самой проверки = «техработ нет», как в guard'е: отказ из-за недоступного
   * состояния остановил бы чаты у всех, включая тех, кто пришёл чинить.
   */
  private async halted(client: Socket, event: string): Promise<boolean> {
    const role = client.data?.role as string | undefined
    if (role && MAINTENANCE_STAFF.includes(role)) return false
    const active = await this.platform.maintenanceActive().catch(() => false)
    if (!active) return false
    client.emit('error', { event, code: 'MAINTENANCE' })
    return true
  }

  /**
   * Запрет по умолчанию для охраны и библиотекаря (§2.1) — и на сокете. RestrictedRoleGuard
   * стоит только на HTTP: оказавшись участником чата, такая роль читала и писала бы в него
   * через `chat:join` и `message:send`.
   */
  private restricted(client: Socket, event: string): boolean {
    if (!isRestrictedRole(client.data?.role as Role | undefined)) return false
    client.emit('error', { event, code: 'FORBIDDEN' })
    return true
  }

  private socketStore(client: Socket): Record<string, unknown> {
    if (!client.data) client.data = {}
    return client.data as Record<string, unknown>
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
    if (!this.admit(client, 'chat:join')) return
    if (this.restricted(client, 'chat:join')) return
    const uid = this.userId(client)
    const data = this.parse(client, 'chat:join', ChatJoinSchema, raw)
    if (!uid || !data) return
    if (!(await this.realtime.admitSocket(client, 'chat:join'))) return
    // В комнату chat: — только после проверки членства в БД (§10).
    if (!(await this.chats.isMember(uid, data.chatId))) {
      client.emit('error', { event: 'chat:join', code: 'WRONG_SCOPE' })
      return
    }
    await client.join(`chat:${data.chatId}`)
  }

  // Выход из комнаты не лимитируется: он ничего не стоит базе и только снимает нагрузку, а
  // отброшенный выход оставил бы сокет слушать чат, который человек уже закрыл.
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
    if (!this.admit(client, 'message:send')) return
    if (this.restricted(client, 'message:send')) return
    const uid = this.userId(client)
    const data = this.parse(client, 'message:send', MessageSendSchema, raw)
    if (!uid || !data) return
    if (!(await this.realtime.admitSocket(client, 'message:send'))) return
    if (await this.halted(client, 'message:send')) return
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
    if (!this.admit(client, 'message:edit')) return
    if (this.restricted(client, 'message:edit')) return
    const uid = this.userId(client)
    const data = this.parse(client, 'message:edit', MessageEditSchema, raw)
    if (!uid || !data) return
    if (!(await this.realtime.admitSocket(client, 'message:edit'))) return
    if (await this.halted(client, 'message:edit')) return
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
    if (!this.admit(client, 'message:delete')) return
    if (this.restricted(client, 'message:delete')) return
    const uid = this.userId(client)
    const data = this.parse(client, 'message:delete', MessageDeleteSchema, raw)
    if (!uid || !data) return
    if (!(await this.realtime.admitSocket(client, 'message:delete'))) return
    if (await this.halted(client, 'message:delete')) return
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
    if (!this.admit(client, 'message:read')) return
    if (this.restricted(client, 'message:read')) return
    const uid = this.userId(client)
    const data = this.parse(client, 'message:read', MessageReadSchema, raw)
    if (!uid || !data) return
    if (!(await this.realtime.admitSocket(client, 'message:read'))) return
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
    if (!this.admit(client, 'chat:action')) return
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
    if (!this.admit(client, 'typing:start')) return
    const data = this.parse(client, 'typing:start', TypingSchema, raw)
    if (!data) return
    await this.relayAction(client, 'typing:start', data.chatId, 'TYPING')
  }

  @SubscribeMessage('typing:stop')
  async onTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    if (!this.admit(client, 'typing:stop')) return
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
    if (!takeToken(this.socketStore(client), 'wsActions', ACTION_LIMIT)) return
    if (this.restricted(client, event)) return
    if (!(await this.realtime.admitSocket(client, event))) return
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
