import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './log.js'
import {
  PlatformError,
  sync,
  type CameraConfig,
  type CameraStatus,
  type SyncResponse,
} from './api.js'
import type { AgentConfig } from './config.js'
import type { AgentKey } from './keys.js'
import { probeCamera, type ProbeStatus } from './probe.js'
import { Publisher, type PublishTarget } from './publisher.js'
import { redactUrl, withCredentials } from './rtsp.js'
import { openCredentials, type CameraCredentials } from './sealed.js'
import { AGENT_VERSION } from './version.js'

// Агент камер (docs/PROJECT.md §3.10). Два независимых цикла:
//   • синхронизация — длинный опрос платформы: отдаём состояние камер, берём конфигурацию
//     и список камер, которые сейчас смотрят (их поток уходит на ретранслятор);
//   • проверка камер — раз в интервал ffprobe на каждую камеру.
// Входящих соединений агент не принимает: всё, что ему нужно, он забирает сам.

/** Камера, как её знает агент: адрес и пароль (только в памяти). */
interface KnownCamera {
  id: string
  streamUrl: string
  credentials: CameraCredentials | null
  /** Конверт не вскрылся — ключ не тот, пароль ввели для прежнего ключа. */
  sealBroken: boolean
}

// Пауза после ошибки опроса растёт ступенями: платформа на обновлении не должна получать
// от сотни агентов залп повторов каждую секунду.
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]
// Токен отозван или ключ не совпадает — без вмешательства админа это не пройдёт.
const STUCK_RETRY_MS = 5 * 60_000
const PROBE_CONCURRENCY = 4

export class Agent {
  private cameras = new Map<string, KnownCamera>()
  private statuses = new Map<string, CameraStatus>()
  private revision: string | undefined
  private enabled = false
  private stopped = false
  private probeTimer: NodeJS.Timeout | null = null
  private relayCaPem: string | null = null

  constructor(
    private readonly config: AgentConfig,
    private readonly key: AgentKey,
    private readonly probe: (url: string) => Promise<ProbeStatus> = probeCamera,
    private readonly publisher: Publisher = new Publisher(),
  ) {}

  async run(): Promise<void> {
    log.info('Агент запущен', { version: AGENT_VERSION, api: this.config.apiUrl })
    this.scheduleProbes(0)
    let failures = 0
    while (!this.stopped) {
      try {
        const response = await sync(this.config.apiUrl, this.config.token, {
          version: AGENT_VERSION,
          publicKey: this.key.publicRaw,
          revision: this.revision,
          cameras: [...this.statuses].map(([id, status]) => ({ id, status })),
        })
        failures = 0
        this.apply(response)
      } catch (error) {
        await this.sleep(this.retryDelay(error, failures++))
      }
    }
  }

  stop(): void {
    this.stopped = true
    if (this.probeTimer) clearTimeout(this.probeTimer)
    this.publisher.stopAll()
  }

  /**
   * Ответ платформы. Конфигурация меняется, только если сменилась ревизия, а потоки на
   * ретранслятор сверяются на каждом ответе: в нём свежие токены публикации.
   */
  apply(response: SyncResponse): void {
    this.applyCameras(response.revision, response.enabled, response.cameras)
    this.applyPublishing(response)
  }

  /** Новая конфигурация: запоминаем камеры, вскрываем пароли, новые камеры проверяем сразу. */
  private applyCameras(revision: string, enabled: boolean, cameras: CameraConfig[]): void {
    if (revision === this.revision) return
    const fresh: string[] = []
    const next = new Map<string, KnownCamera>()
    for (const camera of enabled ? cameras : []) {
      const known = this.cameras.get(camera.id)
      if (!known || known.streamUrl !== camera.streamUrl) fresh.push(camera.id)
      next.set(camera.id, this.unseal(camera))
    }
    this.cameras = next
    for (const id of [...this.statuses.keys()]) if (!next.has(id)) this.statuses.delete(id)
    if (this.enabled !== enabled)
      log.info(enabled ? 'Камеры вуза включены' : 'Камеры вуза выключены')
    this.enabled = enabled
    this.revision = revision
    log.info('Конфигурация получена', { cameras: next.size })
    if (fresh.length > 0) void this.probeAll(fresh)
  }

  /** Камеры, которые сейчас смотрят, — их поток уходит на ретранслятор. */
  private applyPublishing(response: SyncResponse): void {
    const caFile = this.writeRelayCa(response.relayCaPem)
    const wanted = new Map<string, { cameraUrl: string; target: PublishTarget }>()
    for (const camera of response.enabled ? response.cameras : []) {
      const known = this.cameras.get(camera.id)
      if (!camera.publish || !known || known.sealBroken) continue
      wanted.set(camera.id, {
        cameraUrl: withCredentials(known.streamUrl, known.credentials),
        target: camera.publish,
      })
    }
    this.publisher.sync(wanted, caFile)
  }

  /** Сертификат ретранслятора — в файл для ffmpeg (`-ca_file`); пишем, только если сменился. */
  private writeRelayCa(pem: string | null): string | null {
    if (!pem) return null
    const path = join(this.config.stateDir, 'relay-ca.pem')
    if (pem !== this.relayCaPem) {
      writeFileSync(path, pem, { mode: 0o644 })
      this.relayCaPem = pem
    }
    return path
  }

  /** Потоки, которые сейчас идут на ретранслятор (для тестов). */
  publishing(): string[] {
    return this.publisher.active()
  }

  /** Состояние камер для отчёта платформе (и для тестов). */
  snapshot(): Record<string, CameraStatus> {
    return Object.fromEntries(this.statuses)
  }

  /** Проверить камеры: все или перечисленные. */
  async probeAll(ids: string[] = [...this.cameras.keys()]): Promise<void> {
    const queue = ids.map((id) => this.cameras.get(id)).filter((c): c is KnownCamera => !!c)
    const worker = async (): Promise<void> => {
      for (let camera = queue.shift(); camera; camera = queue.shift()) {
        const status: CameraStatus = camera.sealBroken
          ? 'AUTH_FAILED'
          : await this.probe(withCredentials(camera.streamUrl, camera.credentials))
        if (this.statuses.get(camera.id) !== status) {
          log.info('Камера', { id: camera.id, url: redactUrl(camera.streamUrl), status })
        }
        // Камеру могли убрать из конфигурации, пока шла проверка.
        if (this.cameras.has(camera.id)) this.statuses.set(camera.id, status)
      }
    }
    await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker))
  }

  private unseal(camera: CameraConfig): KnownCamera {
    if (!camera.credentialsSealed) {
      return { id: camera.id, streamUrl: camera.streamUrl, credentials: null, sealBroken: false }
    }
    try {
      const credentials = openCredentials(camera.credentialsSealed, this.key.privateJwk, camera.id)
      return { id: camera.id, streamUrl: camera.streamUrl, credentials, sealBroken: false }
    } catch {
      log.warn('Пароль камеры не расшифровать: задайте его заново в разделе «Камеры»', {
        id: camera.id,
      })
      return { id: camera.id, streamUrl: camera.streamUrl, credentials: null, sealBroken: true }
    }
  }

  private scheduleProbes(delayMs: number): void {
    if (this.stopped) return
    this.probeTimer = setTimeout(() => {
      void (this.enabled ? this.probeAll() : Promise.resolve()).finally(() =>
        this.scheduleProbes(this.config.probeIntervalMs),
      )
    }, delayMs)
  }

  private retryDelay(error: unknown, failures: number): number {
    if (error instanceof PlatformError && error.unauthorized) {
      log.error('Токен агента не принят платформой: возьмите новый в разделе «Камеры»')
      return STUCK_RETRY_MS
    }
    if (error instanceof PlatformError && error.keyMismatch) {
      log.error('Платформа знает другой ключ этого агента: перевыпустите токен в разделе «Камеры»')
      return STUCK_RETRY_MS
    }
    const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 60_000
    log.warn('Платформа недоступна, повтор', {
      in: delay,
      error: error instanceof Error ? error.message : String(error),
    })
    return delay
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
