import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'
import { REALTIME_CHANNEL, type RealtimeEnvelope } from '@studenthub/shared-schemas'
import type { JwtPayload } from '../auth/jwt-payload.type'

// CORS для WS читаем из env на этапе загрузки модуля (декоратор вычисляется при импорте).
const WS_CORS_ORIGIN = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',')

// Единый транспорт реального времени поверх socket.io (docs/PROJECT.md §9).
// Отвечает за аутентификацию в handshake и автоматический вход в комнаты
// user/group/university. События уведомлений (Ф3.4) рассылаются адресно по user-комнатам;
// чат-события (Ф9) будут добавлены к этому же соединению.
@WebSocketGateway({ cors: { origin: WS_CORS_ORIGIN, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server!: Server
  private readonly logger = new Logger(RealtimeGateway.name)
  // Счётчик активных соединений на пользователя: онлайн, пока > 0 (несколько вкладок/устройств).
  private readonly connections = new Map<string, number>()

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client)
    if (!token) {
      client.disconnect()
      return
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token)
      client.data.userId = payload.sub
      client.data.role = payload.role
      // §9.3: автоматический вход в свои комнаты при подключении.
      await client.join(`user:${payload.sub}`)
      if (payload.groupId) await client.join(`group:${payload.groupId}`)
      if (payload.universityId) await client.join(`university:${payload.universityId}`)
      this.trackOnline(payload.sub)
      this.logger.debug(`WS connected user=${payload.sub} socket=${client.id}`)
    } catch {
      // Невалидный/просроченный токен → немедленный разрыв (docs/BACKEND_RULES.md §10).
      client.disconnect()
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.userId as string | undefined
    if (userId) {
      this.trackOffline(userId)
      this.logger.debug(`WS disconnected user=${userId} socket=${client.id}`)
    }
  }

  // Переход оффлайн→онлайн (первое соединение) — широковещательно оповещаем присутствие (Ф9+).
  private trackOnline(userId: string): void {
    const next = (this.connections.get(userId) ?? 0) + 1
    this.connections.set(userId, next)
    if (next === 1) this.server.emit('presence:changed', { userId, online: true })
  }

  // Переход онлайн→оффлайн (последнее соединение закрыто).
  private trackOffline(userId: string): void {
    const next = (this.connections.get(userId) ?? 1) - 1
    if (next <= 0) {
      this.connections.delete(userId)
      this.server.emit('presence:changed', { userId, online: false })
    } else {
      this.connections.set(userId, next)
    }
  }

  /** Онлайн ли пользователь (есть активные соединения). */
  isOnline(userId: string): boolean {
    return (this.connections.get(userId) ?? 0) > 0
  }

  /** Подмножество онлайн-пользователей из переданных id (по счётчику соединений). */
  onlineAmong(userIds: string[]): string[] {
    return userIds.filter((id) => this.isOnline(id))
  }

  // Access-токен живёт 15 мин: клиент присылает новый токен, обновляем сессию соединения
  // без разрыва (docs/BACKEND_RULES.md §10). Просроченный новый токен не рвёт связь — ждём следующего.
  @SubscribeMessage('auth:refresh')
  async handleAuthRefresh(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { token?: string } | undefined,
  ): Promise<void> {
    const token = payload?.token
    if (typeof token !== 'string' || token.length === 0) return
    try {
      const p = await this.jwt.verifyAsync<JwtPayload>(token)
      client.data.userId = p.sub
      client.data.role = p.role
    } catch {
      this.logger.debug(`WS auth:refresh отклонён (невалидный токен) socket=${client.id}`)
    }
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth
    const header = client.handshake.headers.authorization
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7)
    return null
  }

  /** Адресная отправка события в личную комнату пользователя. */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload)
  }

  /** Адресная отправка в произвольную комнату (group:{id}, university:{id}, chat:{id}). */
  emitToRoom(room: string, event: string, payload: unknown): void {
    this.server.to(room).emit(event, payload)
  }

  // ── Единый конверт (docs/PROJECT.md §9, PR-8/#12) ──────────────────────────
  // Канал REALTIME_CHANNEL, конверт { type, entityId, version, ts, data }. Вводится
  // параллельно к именованным событиям; вызывать РЯДОМ с существующим emit, не вместо.

  private envelope(
    type: string,
    entityId: string,
    data: unknown,
    version: number,
  ): RealtimeEnvelope {
    return { type, entityId, version, ts: new Date().toISOString(), data }
  }

  /** Конверт в личную комнату пользователя. */
  emitEventToUser(
    userId: string,
    type: string,
    entityId: string,
    data: unknown,
    version = 1,
  ): void {
    this.server
      .to(`user:${userId}`)
      .emit(REALTIME_CHANNEL, this.envelope(type, entityId, data, version))
  }

  /** Конверт в произвольную комнату (group:{id}, university:{id}, chat:{id}). */
  emitEventToRoom(room: string, type: string, entityId: string, data: unknown, version = 1): void {
    this.server.to(room).emit(REALTIME_CHANNEL, this.envelope(type, entityId, data, version))
  }

  /** Подмножество переданных id, у которых есть хотя бы одно активное соединение. */
  async getOnlineUserIds(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set()
    const wanted = new Set(userIds)
    const online = new Set<string>()
    const sockets = await this.server.fetchSockets()
    for (const socket of sockets) {
      const uid = socket.data?.userId as string | undefined
      if (uid && wanted.has(uid)) online.add(uid)
    }
    return online
  }

  /** id пользователей, находящихся сейчас в комнате (напр. chat:{id}) — активно её просматривают. */
  async usersInRoom(room: string): Promise<Set<string>> {
    const ids = new Set<string>()
    const sockets = await this.server.in(room).fetchSockets()
    for (const socket of sockets) {
      const uid = socket.data?.userId as string | undefined
      if (uid) ids.add(uid)
    }
    return ids
  }
}
