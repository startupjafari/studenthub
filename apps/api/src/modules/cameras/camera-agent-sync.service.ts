import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type {
  CameraAgentSyncInput,
  CameraAgentSyncResponse,
  CameraStatusValue,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { AgentPrincipal } from './agent-auth.guard'
import { CameraAgentSignal } from './camera-agent-signal'

// Сколько держим длинный опрос без изменений. Меньше типичных таймаутов прокси (30–60 с),
// чтобы соединение не рвал никто посередине.
export const SYNC_HOLD_MS = 25_000
// Как часто во время ожидания сверяем счётчик изменений.
const SYNC_CHECK_MS = 1_000
// Камер на агента в конфигурации — предохранитель выборки (BACKEND_RULES §5.3).
const MAX_CAMERAS_PER_AGENT = 200

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Синхронизация агента камер (docs/PROJECT.md §3.10): агент рассказывает о себе и о
 * камерах, получает конфигурацию. Ревизия — хэш содержимого конфигурации: совпала с той,
 * что у агента, — ответ ждёт изменений (длинный опрос), иначе уходит сразу.
 *
 * Ключ агента принимается один раз — пока его нет. Пришёл другой ключ при уже известном —
 * 409: значит, агент потерял ключ (пересоздали контейнер без тома) или токен у кого-то
 * ещё. Конверты паролей запечатаны прежним ключом, и молча принять новый значило бы
 * отдать управление камерами тому, кто предъявил токен. Выход — перевыпуск токена.
 */
@Injectable()
export class CameraAgentSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signal: CameraAgentSignal,
  ) {}

  async sync(
    agent: AgentPrincipal,
    input: CameraAgentSyncInput,
    holdMs = SYNC_HOLD_MS,
  ): Promise<CameraAgentSyncResponse> {
    if (agent.publicKey && agent.publicKey !== input.publicKey) {
      throw new AppException(
        'CONFLICT',
        'Ключ агента не совпадает с известным: перевыпустите токен агента',
        [{ field: 'publicKey', message: 'KEY_MISMATCH' }],
      )
    }
    const now = new Date()
    await this.prisma.cameraAgent.update({
      where: { id: agent.id },
      data: {
        lastSeenAt: now,
        version: input.version,
        ...(agent.publicKey ? {} : { publicKey: input.publicKey }),
      },
    })
    await this.saveStatuses(agent.id, input.cameras, now)

    // Счётчик берём ДО сборки конфигурации: изменение, случившееся между ними, поднимет
    // счётчик, и ожидание его заметит.
    let seen = await this.signal.current(agent.id)
    let config = await this.config(agent)
    if (input.revision !== config.revision) return config

    const deadline = Date.now() + holdMs
    while (Date.now() < deadline) {
      await sleep(Math.min(SYNC_CHECK_MS, Math.max(deadline - Date.now(), 0)))
      const current = await this.signal.current(agent.id)
      if (current === seen) continue
      seen = current
      config = await this.config(agent)
      if (config.revision !== input.revision) return config
    }
    return config
  }

  /** Конфигурация агента: только его камеры; модуль выключен — пустой список. */
  async config(agent: AgentPrincipal): Promise<CameraAgentSyncResponse> {
    const settings = await this.prisma.cameraSettings.findUnique({
      where: { universityId: agent.universityId },
      select: { enabled: true },
    })
    const enabled = settings?.enabled ?? false
    const cameras = enabled
      ? await this.prisma.camera.findMany({
          where: { agentId: agent.id, enabled: true },
          orderBy: { id: 'asc' },
          take: MAX_CAMERAS_PER_AGENT,
          select: { id: true, streamUrl: true, credentialsSealed: true },
        })
      : []
    const body = { enabled, cameras }
    const revision = createHash('sha256').update(JSON.stringify(body)).digest('base64url')
    return { revision, ...body }
  }

  /**
   * Состояние камер по отчёту агента. Чужие id молча пропускаются: условие `agentId` в
   * запросе не даёт агенту переписать камеру другого агента или вуза.
   */
  private async saveStatuses(
    agentId: string,
    reports: CameraAgentSyncInput['cameras'],
    now: Date,
  ): Promise<void> {
    const byStatus = new Map<CameraStatusValue, string[]>()
    for (const report of reports) {
      const ids = byStatus.get(report.status) ?? []
      ids.push(report.id)
      byStatus.set(report.status, ids)
    }
    await Promise.all(
      [...byStatus].map(([status, ids]) =>
        this.prisma.camera.updateMany({
          where: { agentId, id: { in: ids } },
          data: { status, ...(status === 'ONLINE' ? { lastSeenAt: now } : {}) },
        }),
      ),
    )
  }
}
