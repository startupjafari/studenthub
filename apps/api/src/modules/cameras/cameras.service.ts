import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  CameraCredentialsInput,
  CameraListQueryInput,
  CameraStatusValue,
  CreateCameraInput,
  UpdateCameraInput,
  UpdateCameraSettingsInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { seal } from '../../common/crypto/sealed-box'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { RoomService } from '../rooms/rooms.service'
import { CameraAgentsService } from './camera-agents.service'
import { CameraAgentSignal } from './camera-agent-signal'
import { managedUniversity, viewedUniversity } from './camera-scope'

const CAMERA_SELECT = {
  id: true,
  name: true,
  agentId: true,
  streamUrl: true,
  credentialsSealed: true,
  enabled: true,
  status: true,
  lastSeenAt: true,
  createdAt: true,
  agent: { select: { id: true, name: true } },
  room: { select: { id: true, name: true } },
} satisfies Prisma.CameraSelect

type CameraRow = Prisma.CameraGetPayload<{ select: typeof CAMERA_SELECT }>

/** Камера глазами охраны: что и где, без адреса в сети вуза и без сведений об агенте. */
export interface CameraView {
  id: string
  name: string
  room: { id: string; name: string } | null
  enabled: boolean
  status: CameraStatusValue
  lastSeenAt: Date | null
}

/** Камера глазами админа: плюс агент, адрес потока и есть ли пароль (сам пароль — никогда). */
export interface CameraAdminView extends CameraView {
  agent: { id: string; name: string }
  streamUrl: string
  hasCredentials: boolean
  createdAt: Date
}

function toView(row: CameraRow): CameraView {
  return {
    id: row.id,
    name: row.name,
    room: row.room,
    enabled: row.enabled,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
  }
}

function toAdminView(row: CameraRow): CameraAdminView {
  return {
    ...toView(row),
    agent: row.agent,
    streamUrl: row.streamUrl,
    hasCredentials: row.credentialsSealed !== null,
    createdAt: row.createdAt,
  }
}

/**
 * Камеры вуза и выключатель модуля (docs/PROJECT.md §3.10).
 *
 * Пароль камеры приходит сюда один раз и тут же запечатывается открытым ключом агента
 * (`sealed-box`): в базу ложится конверт, который платформа вскрыть не может. Поэтому
 * камеру с паролем можно добавить только к агенту, который уже выходил на связь и
 * прислал свой ключ.
 */
@Injectable()
export class CamerasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agents: CameraAgentsService,
    private readonly rooms: RoomService,
    private readonly signal: CameraAgentSignal,
  ) {}

  /** Список камер: админу — все и с подробностями, охране — только включённые. */
  async list(
    actor: JwtPayload,
    query: CameraListQueryInput,
  ): Promise<Paginated<CameraView | CameraAdminView>> {
    const universityId = viewedUniversity(actor)
    const admin = actor.role === Role.UNIVERSITY_ADMIN
    const where: Prisma.CameraWhereInput = {
      universityId,
      ...(admin ? {} : { enabled: true }),
      ...(admin && query.agentId ? { agentId: query.agentId } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.camera.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: CAMERA_SELECT,
      }),
      this.prisma.camera.count({ where }),
    ])
    return new Paginated(rows.map(admin ? toAdminView : toView), { total })
  }

  async create(
    actor: JwtPayload,
    input: CreateCameraInput,
    ctx: RequestContext,
  ): Promise<CameraAdminView> {
    const universityId = managedUniversity(actor)
    const agent = await this.agents.findOwned(actor, input.agentId)
    if (input.roomId) await this.rooms.assertRoomInUniversity(input.roomId, universityId)
    // id заранее: он входит в AAD конверта — так конверт этой камеры не подложить другой.
    const id = randomUUID()
    const row = await this.prisma.camera.create({
      data: {
        id,
        universityId,
        agentId: agent.id,
        roomId: input.roomId ?? null,
        name: input.name,
        streamUrl: input.streamUrl,
        credentialsSealed: input.credentials
          ? this.sealCredentials(input.credentials, agent.publicKey, id)
          : null,
      },
      select: CAMERA_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'camera_created',
      entity: 'Camera',
      entityId: row.id,
      metadata: { universityId, agentId: agent.id },
      ...ctx,
    })
    await this.signal.bump(agent.id)
    return toAdminView(row)
  }

  async update(
    actor: JwtPayload,
    id: string,
    input: UpdateCameraInput,
    ctx: RequestContext,
  ): Promise<CameraAdminView> {
    const camera = await this.findOwned(actor, id)
    if (input.roomId) await this.rooms.assertRoomInUniversity(input.roomId, camera.universityId)
    let credentialsSealed: string | null | undefined
    if (input.credentials === null) credentialsSealed = null
    else if (input.credentials) {
      const agent = await this.prisma.cameraAgent.findUnique({
        where: { id: camera.agentId },
        select: { publicKey: true },
      })
      credentialsSealed = this.sealCredentials(input.credentials, agent?.publicKey ?? null, id)
    }
    const row = await this.prisma.camera.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.streamUrl !== undefined ? { streamUrl: input.streamUrl } : {}),
        ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        // Новый адрес или пароль — прежний статус больше ничего не говорит о камере.
        ...(input.streamUrl !== undefined || credentialsSealed !== undefined
          ? { status: 'UNKNOWN' as const }
          : {}),
        ...(credentialsSealed !== undefined ? { credentialsSealed } : {}),
      },
      select: CAMERA_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'camera_updated',
      entity: 'Camera',
      entityId: id,
      // Какие поля менялись — без значений: пароль в журнал не попадает даже признаком длины.
      metadata: { universityId: camera.universityId, fields: Object.keys(input) },
      ...ctx,
    })
    await this.signal.bump(camera.agentId)
    return toAdminView(row)
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const camera = await this.findOwned(actor, id)
    await this.prisma.camera.delete({ where: { id } })
    await this.audit.record({
      userId: actor.sub,
      action: 'camera_deleted',
      entity: 'Camera',
      entityId: id,
      metadata: { universityId: camera.universityId },
      ...ctx,
    })
    await this.signal.bump(camera.agentId)
  }

  /** Включён ли модуль камер вуза. Нет записи — выключен: вуз включает камеры сам. */
  async settings(actor: JwtPayload): Promise<{ enabled: boolean }> {
    const universityId = viewedUniversity(actor)
    const row = await this.prisma.cameraSettings.findUnique({
      where: { universityId },
      select: { enabled: true },
    })
    return { enabled: row?.enabled ?? false }
  }

  async updateSettings(
    actor: JwtPayload,
    input: UpdateCameraSettingsInput,
    ctx: RequestContext,
  ): Promise<{ enabled: boolean }> {
    const universityId = managedUniversity(actor)
    const row = await this.prisma.cameraSettings.upsert({
      where: { universityId },
      create: { universityId, enabled: input.enabled, updatedById: actor.sub },
      update: { enabled: input.enabled, updatedById: actor.sub },
      select: { enabled: true },
    })
    await this.audit.record({
      userId: actor.sub,
      action: input.enabled ? 'cameras_enabled' : 'cameras_disabled',
      entity: 'CameraSettings',
      entityId: universityId,
      metadata: { universityId },
      ...ctx,
    })
    // Выключение доходит до агентов сразу: они гасят потоки, не дожидаясь опроса.
    await this.signal.bumpUniversity(universityId)
    return row
  }

  private sealCredentials(
    credentials: CameraCredentialsInput,
    agentPublicKey: string | null,
    cameraId: string,
  ): string {
    if (!agentPublicKey) {
      throw new AppException(
        'CONFLICT',
        'Агент ещё не выходил на связь: запустите его, затем укажите пароль камеры',
        [{ field: 'agentId', message: 'AGENT_NOT_READY' }],
      )
    }
    return seal(JSON.stringify(credentials), agentPublicKey, cameraId)
  }

  /** Камера своего вуза; чужая и несуществующая — одинаковый NOT_FOUND. */
  private async findOwned(
    actor: JwtPayload,
    id: string,
  ): Promise<{ id: string; universityId: string; agentId: string }> {
    const universityId = managedUniversity(actor)
    const camera = await this.prisma.camera.findUnique({
      where: { id },
      select: { id: true, universityId: true, agentId: true },
    })
    if (!camera || camera.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Камера не найдена')
    }
    return camera
  }
}
