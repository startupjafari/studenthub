import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { CreateCameraAgentInput, UpdateCameraAgentInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { hashAgentToken, newAgentToken } from './agent-token'
import { managedUniversity } from './camera-scope'
import { CameraAgentSignal } from './camera-agent-signal'

// Агент считается на связи, если отчитывался за это окно. Агент держит с платформой
// длинный опрос и приходит не реже раза в полминуты — полторы минуты переживают и
// перезапуск агента, и короткий обрыв сети.
export const AGENT_ONLINE_WINDOW_MS = 90_000

// Потолок агентов на вуз — предохранитель списка (BACKEND_RULES §5.3), а не тариф: агент
// обычно один на корпус.
const MAX_AGENTS_PER_UNIVERSITY = 50

const AGENT_SELECT = {
  id: true,
  name: true,
  publicKey: true,
  version: true,
  lastSeenAt: true,
  createdAt: true,
  _count: { select: { cameras: true } },
} satisfies Prisma.CameraAgentSelect

type AgentRow = Prisma.CameraAgentGetPayload<{ select: typeof AGENT_SELECT }>

export type AgentConnection = 'NEVER' | 'ONLINE' | 'OFFLINE'

export interface CameraAgentView {
  id: string
  name: string
  connection: AgentConnection
  /** Агент прислал свой открытый ключ — камерам с паролем есть чем его зашифровать. */
  ready: boolean
  version: string | null
  lastSeenAt: Date | null
  createdAt: Date
  cameraCount: number
}

export function agentConnection(lastSeenAt: Date | null, now = Date.now()): AgentConnection {
  if (!lastSeenAt) return 'NEVER'
  return now - lastSeenAt.getTime() <= AGENT_ONLINE_WINDOW_MS ? 'ONLINE' : 'OFFLINE'
}

function toView(row: AgentRow): CameraAgentView {
  return {
    id: row.id,
    name: row.name,
    connection: agentConnection(row.lastSeenAt),
    ready: row.publicKey !== null,
    version: row.version,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    cameraCount: row._count.cameras,
  }
}

/**
 * Агенты камер вуза (docs/PROJECT.md §3.10). Токен агента выдаётся при создании и при
 * перевыпуске — один раз, в ответе; в базе только его хэш. Удаление агента удаляет и его
 * камеры: без агента до них не дотянуться.
 */
@Injectable()
export class CameraAgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly signal: CameraAgentSignal,
  ) {}

  async list(actor: JwtPayload): Promise<CameraAgentView[]> {
    const universityId = managedUniversity(actor)
    const rows = await this.prisma.cameraAgent.findMany({
      where: { universityId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: MAX_AGENTS_PER_UNIVERSITY,
      select: AGENT_SELECT,
    })
    return rows.map(toView)
  }

  async create(
    actor: JwtPayload,
    input: CreateCameraAgentInput,
    ctx: RequestContext,
  ): Promise<{ agent: CameraAgentView; token: string }> {
    const universityId = managedUniversity(actor)
    const count = await this.prisma.cameraAgent.count({ where: { universityId } })
    if (count >= MAX_AGENTS_PER_UNIVERSITY) {
      throw new AppException('CONFLICT', `Не больше ${MAX_AGENTS_PER_UNIVERSITY} агентов на вуз`)
    }
    const token = newAgentToken()
    const row = await this.prisma.cameraAgent.create({
      data: {
        universityId,
        name: input.name,
        tokenHash: hashAgentToken(token),
        createdById: actor.sub,
      },
      select: AGENT_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'camera_agent_created',
      entity: 'CameraAgent',
      entityId: row.id,
      metadata: { universityId },
      ...ctx,
    })
    return { agent: toView(row), token }
  }

  async rename(
    actor: JwtPayload,
    id: string,
    input: UpdateCameraAgentInput,
  ): Promise<CameraAgentView> {
    await this.findOwned(actor, id)
    const row = await this.prisma.cameraAgent.update({
      where: { id },
      data: { name: input.name },
      select: AGENT_SELECT,
    })
    return toView(row)
  }

  /**
   * Новый токен взамен прежнего: прежний перестаёт работать сразу (утёк конфиг, переставили
   * сервер). Ключ агента сбрасывается вместе с токеном, а пароли камер — нет: их конверты
   * запечатаны прежним ключом, и агент на новом месте их не вскроет. Камеры остаются, но
   * пароли к ним админу придётся ввести заново.
   */
  async rotateToken(
    actor: JwtPayload,
    id: string,
    ctx: RequestContext,
  ): Promise<{ agent: CameraAgentView; token: string }> {
    const agent = await this.findOwned(actor, id)
    const token = newAgentToken()
    const [row] = await this.prisma.$transaction([
      this.prisma.cameraAgent.update({
        where: { id },
        data: { tokenHash: hashAgentToken(token), publicKey: null, lastSeenAt: null },
        select: AGENT_SELECT,
      }),
      this.prisma.camera.updateMany({
        where: { agentId: id },
        data: { credentialsSealed: null, status: 'UNKNOWN' },
      }),
    ])
    await this.audit.record({
      userId: actor.sub,
      action: 'camera_agent_token_rotated',
      entity: 'CameraAgent',
      entityId: agent.id,
      metadata: { universityId: agent.universityId },
      ...ctx,
    })
    // Держащий опрос со старым токеном отпускаем: он сверит токен и ответит 401, а не
    // отдаст отозванному агенту свежие токены публикации.
    await this.signal.bump(agent.id)
    return { agent: toView(row), token }
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const agent = await this.findOwned(actor, id)
    await this.prisma.cameraAgent.delete({ where: { id } })
    await this.audit.record({
      userId: actor.sub,
      action: 'camera_agent_deleted',
      entity: 'CameraAgent',
      entityId: agent.id,
      metadata: { universityId: agent.universityId },
      ...ctx,
    })
    // Опрос, который держит удалённый агент, — отпустить сразу: он ответит 401.
    await this.signal.bump(agent.id)
  }

  /** Агент своего вуза; чужой и несуществующий — одинаковый NOT_FOUND (не оракул для id). */
  async findOwned(
    actor: JwtPayload,
    id: string,
  ): Promise<{ id: string; universityId: string; publicKey: string | null }> {
    const universityId = managedUniversity(actor)
    const agent = await this.prisma.cameraAgent.findUnique({
      where: { id },
      select: { id: true, universityId: true, publicKey: true },
    })
    if (!agent || agent.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Агент не найден')
    }
    return agent
  }
}
