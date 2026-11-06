import { spawn } from 'node:child_process'

// Проверка камеры: ffprobe открывает поток и читает описание дорожек. Это и есть ответ на
// вопрос «камера жива и пароль верный» — без декодирования видео и без нагрузки на камеру.

export type ProbeStatus = 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'

/** Итог проверки по коду выхода и stderr ffprobe. */
export function classifyProbe(exitCode: number | null, stderr: string): ProbeStatus {
  if (exitCode === 0) return 'ONLINE'
  if (/\b401\b|Unauthorized|authorization failed/i.test(stderr)) return 'AUTH_FAILED'
  return 'OFFLINE'
}

export function probeCamera(url: string, timeoutMs = 10_000): Promise<ProbeStatus> {
  return new Promise((resolve) => {
    const child = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        // TCP: через сеть вуза и прокси UDP часто не проходит.
        '-rtsp_transport',
        'tcp',
        // Таймаут сокета в микросекундах — чтобы недоступная камера не держала проверку.
        '-timeout',
        String(timeoutMs * 1000),
        '-show_entries',
        'stream=codec_name',
        '-of',
        'csv=p=0',
        '-i',
        url,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString()
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs + 2_000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve('OFFLINE')
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(classifyProbe(code, stderr))
    })
  })
}
