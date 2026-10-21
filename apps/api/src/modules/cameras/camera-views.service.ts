import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { viewedUniversity } from './camera-scope'
import { CameraDemand } from './camera-demand'
import { CameraAgentSignal } from './camera-agent-signal'
import { MediaTokenService, type RelaySettings } from './media-token.service'

// Токен просмотра живёт две минуты, плеер продлевает его каждые полминуты: отозвать доступ
// (выключили камеры, заблокировали человека) можно быстрее, чем через срок токена.
export const VIEW_TOKEN_TTL_S = 120
export const VIEW_HEARTBEAT_S = 30
// Просмотр «идёт», если подтверждался за последние две с половиной паузы.
export const VIEW_ACTIVE_WINDOW_MS = 75_000
// Не больше четырёх камер одновременно на человека: охране для сетки хватает, а скачать
// весь вуз разом одной учётной записью — нет.
export const MAX_ACTIVE_VIEWS = 4

export interface CameraViewTicket {
  sessionId: string
  cameraId: string
  /** LL-HLS ретранслятора; токен — в заголовке Authorization: Bearer. */
  hlsUrl: string
  token: string
  expiresInSec: number
  heartbeatInSec: number
}

/** Отказ с указанием, что именно мешает: клиент показывает понятную причину. */
function conflict(field: 'relay' | 'module' | 'camera' | 'views', message: string): AppException {
  return new AppException('CONFLICT', message, [{ field, message }])
}

/**
 * Просмотр камер (docs/PROJECT.md §3.10). Сессия просмотра — это и запись журнала. Видео
 * идёт не через API: здесь выдаётся короткий токен на путь `cam/<id>` ретранслятора и
 * отмечается спрос, по которому агент начинает отдавать поток.
 */
@Injectable()
export class CameraViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: MediaTokenService,
    private readonly demand: CameraDemand,
    private readonly signal: CameraAgentSignal,
  ) {}

  async start(actor: JwtPayload, cameraId: string, ctx: RequestContext): Promise<CameraViewTicket> {
    const universityId = viewedUniversity(actor)
    const relay = this.relay()
    await this.assertModuleEnabled(universityId)
    const camera = await this.prisma.camera.findUnique({
      where: { id: cameraId },
      select: { id: true, name: true, universityId: true, agentId: true, enabled: true },
    })
    if (!camera || camera.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Камера не найдена')
    }
    if (!camera.enabled) throw conflict('camera', 'Камера отключена')
    const active = await this.prisma.cameraViewSession.count({
      where: {
        userId: actor.sub,
        endedAt: null,
        lastSeenAt: { gte: new Date(Date.now() - VIEW_ACTIVE_WINDOW_MS) },
      },
    })
    if (active >= MAX_ACTIVE_VIEWS) {
      throw conflict('views', `Одновременно можно смотреть не больше ${MAX_ACTIVE_VIEWS} камер`)
    }
    const viewer = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { firstName: true, lastName: true },
    })
    const session = await this.prisma.cameraViewSession.create({
      data: {
        universityId,
        cameraId: camera.id,
        cameraName: camera.name,
        userId: actor.sub,
        userName: viewer ? `${viewer.lastName} ${viewer.firstName}` : actor.sub,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 500),
      },
      select: { id: true },
    })
    await this.demand.mark(camera.id)
    // Агент держит длинный опрос — пусть узнает о зрителе сразу, а не через 25 с.
    await this.signal.bump(camera.agentId)
    return this.ticket(session.id, camera.id, actor.sub, relay)
  }

  /**
   * Плеер подтверждает просмотр и получает свежий токен. Модуль выключили или камеру
   * отключили — сессия закрывается, и токен больше не выдаётся: просмотр гаснет не позже,
   * чем истечёт последний токен.
   */
  async heartbeat(actor: JwtPayload, sessionId: string): Promise<CameraViewTicket> {
    const universityId = viewedUniversity(actor)
    const relay = this.relay()
    const session = await this.ownSession(actor, sessionId)
    const camera = session.cameraId
      ? await this.prisma.camera.findUnique({
          where: { id: session.cameraId },
          select: { id: true, enabled: true, agentId: true },
        })
      : null
    const settings = await this.prisma.cameraSettings.findUnique({
      where: { universityId },
      select: { enabled: true },
    })
    if (!camera || !camera.enabled || !settings?.enabled) {
      await this.close(session.id)
      throw conflict(settings?.enabled ? 'camera' : 'module', 'Просмотр этой камеры закрыт')
    }
    await this.prisma.cameraViewSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    })
    await this.demand.mark(camera.id)
    return this.ticket(session.id, camera.id, actor.sub, relay)
  }

  /**
   * Закончить просмотр. Если камеру больше никто не смотрит, спрос снимается сразу и агент
   * узнаёт об этом в ту же секунду — поток не идёт ещё минуту впустую.
   */
  async end(actor: JwtPayload, sessionId: string): Promise<void> {
    const session = await this.ownSession(actor, sessionId)
    await this.close(session.id)
    if (!session.cameraId) return
    const others = await this.prisma.cameraViewSession.count({
      where: {
        cameraId: session.cameraId,
        endedAt: null,
        lastSeenAt: { gte: new Date(Date.now() - VIEW_ACTIVE_WINDOW_MS) },
      },
    })
    if (others > 0) return
    await this.demand.clear(session.cameraId)
    const camera = await this.prisma.camera.findUnique({
      where: { id: session.cameraId },
      select: { agentId: true },
    })
    if (camera) await this.signal.bump(camera.agentId)
  }

  private ticket(
    sessionId: string,
    cameraId: string,
    userId: string,
    relay: RelaySettings,
  ): CameraViewTicket {
    const path = `cam/${cameraId}`
    return {
      sessionId,
      cameraId,
      hlsUrl: `${relay.hlsUrl}/${path}/index.m3u8`,
      token: this.tokens.sign(`user:${userId}`, [{ action: 'read', path }], VIEW_TOKEN_TTL_S),
      expiresInSec: VIEW_TOKEN_TTL_S,
      heartbeatInSec: VIEW_HEARTBEAT_S,
    }
  }

  private relay(): RelaySettings {
    const relay = this.tokens.relaySettings()
    if (!relay) throw conflict('relay', 'Просмотр камер не настроен на платформе')
    return relay
  }

  private async assertModuleEnabled(universityId: string): Promise<void> {
    const settings = await this.prisma.cameraSettings.findUnique({
      where: { universityId },
      select: { enabled: true },
    })
    if (!settings?.enabled) throw conflict('module', 'Камеры вуза выключены')
  }

  /** Своя незакрытая сессия; чужая и закрытая — одинаковый NOT_FOUND. */
  private async ownSession(
    actor: JwtPayload,
    sessionId: string,
  ): Promise<{ id: string; cameraId: string | null }> {
    const session = await this.prisma.cameraViewSession.findUnique({
      where: { id: sessionId },
      select: { id: true, cameraId: true, userId: true, endedAt: true },
    })
    if (!session || session.userId !== actor.sub || session.endedAt) {
      throw new AppException('NOT_FOUND', 'Сессия просмотра не найдена')
    }
    return session
  }

  private async close(sessionId: string): Promise<void> {
    await this.prisma.cameraViewSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    })
  }
}
