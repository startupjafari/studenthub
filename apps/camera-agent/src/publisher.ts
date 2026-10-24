import { spawn, type ChildProcess } from 'node:child_process'
import { log } from './log.js'
import { redactText, redactUrl } from './rtsp.js'

// Отдача потока камеры на ретранслятор (docs/PROJECT.md §3.10) — только пока камеру смотрят.
//
// RTMPS, а не RTSPS: в RTSP учётные данные уходят лишь в ответ на вызов сервера, а
// ретранслятор в режиме JWT его не присылает — ffmpeg так и не отдаёт токен. В RTMP токен
// идёт параметром адреса (`?pass=`), а TLS с закреплённым сертификатом ретранслятора
// (`-tls_verify 1 -ca_file`) не даёт отдать поток тому, кто им не является.
//
// Видео копируется как есть, без перекодирования (агент не грузит процессор), звук
// вырезается: платформа звук не передаёт вовсе.

// Сколько ffmpeg ждёт данных от камеры, прежде чем счесть её пропавшей.
const INPUT_TIMEOUT_US = 10_000_000

export interface PublishTarget {
  url: string
  token: string
}

export function publishArgs(
  cameraUrl: string,
  target: PublishTarget,
  caFile: string | null,
): string[] {
  const secure = target.url.startsWith('rtmps://')
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-rtsp_transport',
    'tcp',
    // Таймаут сокета камеры в микросекундах (как у ffprobe в probe.ts): камера пропала без
    // разрыва соединения — ffmpeg выходит с ошибкой и перезапускается, а не ждёт вечно.
    '-timeout',
    String(INPUT_TIMEOUT_US),
    '-i',
    cameraUrl,
    '-map',
    '0:v:0',
    '-c:v',
    'copy',
    '-an',
    '-f',
    'flv',
    ...(secure && caFile ? ['-tls_verify', '1', '-ca_file', caFile] : []),
    `${target.url}?user=agent&pass=${encodeURIComponent(target.token)}`,
  ]
}

type Spawner = (args: string[]) => ChildProcess

const defaultSpawner: Spawner = (args) =>
  spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })

// Камера пропала или ретранслятор перезапускается — повторяем, пока её смотрят, но не чаще.
const RESTART_MS = [2_000, 5_000, 10_000, 30_000]

interface Running {
  process: ChildProcess | null
  cameraUrl: string
  target: PublishTarget
  failures: number
  timer: NodeJS.Timeout | null
}

/** Потоки на ретранслятор: по одному ffmpeg на просматриваемую камеру. */
export class Publisher {
  private running = new Map<string, Running>()

  constructor(private readonly spawner: Spawner = defaultSpawner) {}

  /**
   * Привести набор потоков к нужному: запустить новые, оставить идущие, погасить лишние.
   * Свежий токен для идущего потока не нужен — ретранслятор проверяет его при подключении;
   * он пригодится при перезапуске.
   */
  sync(
    wanted: Map<string, { cameraUrl: string; target: PublishTarget }>,
    caFile: string | null,
  ): void {
    for (const [id, run] of this.running) {
      const next = wanted.get(id)
      if (!next || next.cameraUrl !== run.cameraUrl) this.stop(id)
    }
    for (const [id, next] of wanted) {
      const run = this.running.get(id)
      if (run) {
        run.target = next.target
        continue
      }
      this.running.set(id, { process: null, ...next, failures: 0, timer: null })
      this.start(id, caFile)
    }
  }

  active(): string[] {
    return [...this.running.keys()]
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id)
  }

  private start(id: string, caFile: string | null): void {
    const run = this.running.get(id)
    if (!run) return
    const child = this.spawner(publishArgs(run.cameraUrl, run.target, caFile))
    run.process = child
    run.timer = null
    log.info('Поток на ретранслятор', { id, from: redactUrl(run.cameraUrl) })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 2048) stderr += chunk.toString()
    })
    const startedAt = Date.now()
    // Конец процесса — и `close`, и `error`: ffmpeg не запустился (нет бинарника, кончились
    // процессы) — Node шлёт `error`, и без обработчика он ронял бы весь агент. Что пришло
    // первым, то и планирует повтор; второе событие того же процесса ничего не делает.
    const ended = (code: number | null, reason: string): void => {
      const current = this.running.get(id)
      if (!current || current.process !== child) return
      current.process = null
      // Поток шёл дольше минуты — это обрыв, а не отказ на старте: счётчик с нуля.
      current.failures = Date.now() - startedAt > 60_000 ? 0 : current.failures + 1
      const delay = RESTART_MS[Math.min(current.failures, RESTART_MS.length - 1)] ?? 30_000
      log.warn('Поток прервался, повтор', {
        id,
        code,
        in: delay,
        error: redactText(reason).slice(0, 300),
      })
      current.timer = setTimeout(() => this.start(id, caFile), delay)
    }
    child.on('error', (error) => ended(null, error.message))
    child.on('close', (code) => ended(code, stderr))
  }

  private stop(id: string): void {
    const run = this.running.get(id)
    if (!run) return
    this.running.delete(id)
    if (run.timer) clearTimeout(run.timer)
    if (run.process) {
      run.process.kill('SIGTERM')
      log.info('Поток остановлен: камеру больше не смотрят', { id })
    }
  }
}
