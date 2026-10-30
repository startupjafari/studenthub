import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { HLS_SEGMENT_SECONDS } from './media.constants'
import type { HlsRendition } from './media-plan'

// Тонкая обёртка над бинарниками ffmpeg/ffprobe: spawn без оболочки (аргументы массивом —
// подстановки из имени файла в команду быть не может), таймаут с SIGKILL и хвост stderr
// в ошибке, чтобы в логе было видно, на чём споткнулся кодек.

const STDERR_TAIL_BYTES = 4096

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderrTail: string,
  ) {
    super(stderrTail ? `${message}: ${stderrTail}` : message)
    this.name = 'FfmpegError'
  }
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_BYTES)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new FfmpegError(`${bin} не запустился (${err.message})`, ''))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) return resolve(Buffer.concat(stdout).toString())
      const why = signal === 'SIGKILL' ? `превышен таймаут ${timeoutMs} мс` : `код ${code}`
      reject(new FfmpegError(`${bin}: ${why}`, stderr.trim()))
    })
  })
}

/** Есть ли бинарник: воркер без ffmpeg не тратит попытки на заведомо проваленные видео. */
export async function isAvailable(bin: string): Promise<boolean> {
  try {
    await run(bin, ['-version'], 10_000)
    return true
  } catch {
    return false
  }
}

export interface ProbeResult {
  /** Размеры кадра с учётом поворота (матрица дисплея / тег rotate). */
  width: number
  height: number
  durationMs: number | null
  hasAudio: boolean
}

interface ProbeJson {
  streams?: {
    codec_type?: string
    width?: number
    height?: number
    tags?: { rotate?: string }
    side_data_list?: { rotation?: number }[]
  }[]
  format?: { duration?: string }
}

// Входные опции HTTP: источник — подписанная ссылка на объект во внутреннем MinIO;
// при обрыве ffmpeg переподключается с нужного байта, а не роняет перекодирование.
const HTTP_INPUT = [
  '-reconnect',
  '1',
  '-reconnect_on_network_error',
  '1',
  '-reconnect_delay_max',
  '5',
]

// Какие контейнеры разбираем (F-F26). Вход — файл пользователя, а демультиплексоры ffmpeg
// умеют больше, чем нужно видео: плейлист HLS или concat, загруженный «как видео», открыл бы
// по ссылкам внутри себя другие файлы и адреса. Принимаются только контейнеры допустимых
// видео (video/mp4, video/quicktime — `mov`; video/webm — `matroska`). Белый список, а не
// `-f` по объявленному mime: контейнер ffmpeg определит сам, но из этих двух — и mp4,
// присланный с типом quicktime, по-прежнему перекодируется.
const SAFE_DEMUXERS = 'mov,matroska'

/**
 * Входные опции: протоколы и контейнеры по белому списку. Протоколы — ровно те, которыми
 * читается сам вход: подписанная ссылка MinIO — http(s) поверх tcp/tls, локальный файл —
 * только `file`. Ссылка изнутри файла на `file:///…` или во внутреннюю сеть не откроется.
 */
function inputArgs(input: string): string[] {
  const remote = /^https?:\/\//.test(input)
  return [
    '-protocol_whitelist',
    remote ? 'http,https,tcp,tls' : 'file',
    '-format_whitelist',
    SAFE_DEMUXERS,
    ...(remote ? HTTP_INPUT : []),
    '-i',
    input,
  ]
}

export async function probe(ffprobe: string, input: string): Promise<ProbeResult> {
  const out = await run(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', ...inputArgs(input)],
    60_000,
  )
  const json = JSON.parse(out) as ProbeJson
  const video = json.streams?.find((s) => s.codec_type === 'video')
  const hasAudio = !!json.streams?.some((s) => s.codec_type === 'audio')
  const seconds = Number(json.format?.duration)
  const durationMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
  if (!video?.width || !video.height) return { width: 0, height: 0, durationMs, hasAudio }
  const rotation = Math.abs(
    video.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ??
      Number(video.tags?.rotate ?? 0),
  )
  const quarter = rotation % 180 === 90
  return {
    width: quarter ? video.height : video.width,
    height: quarter ? video.width : video.height,
    durationMs,
    hasAudio,
  }
}

/** Один кадр в JPEG. ffmpeg сам кладёт его по матрице поворота. */
export async function extractFrame(
  ffmpeg: string,
  input: string,
  atSeconds: number,
  outPath: string,
): Promise<void> {
  await run(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      atSeconds.toFixed(3),
      ...inputArgs(input),
      '-frames:v',
      '1',
      '-q:v',
      '2',
      outPath,
    ],
    120_000,
  )
}

/**
 * Перекодирование в HLS одним проходом: вход читается один раз, `split` раздаёт кадры на
 * все ступени. Рендишн `<short>` пишется в `<outDir>/<short>/index.m3u8` + `seg-NNNN.ts`.
 *
 * Ключевые кадры принудительно каждые `HLS_SEGMENT_SECONDS`: сегменты всех ступеней тогда
 * начинаются в одни и те же моменты, и плеер переключает качество без рывка.
 */
export async function transcodeHls(params: {
  ffmpeg: string
  input: string
  outDir: string
  renditions: HlsRendition[]
  hasAudio: boolean
  timeoutMs: number
}): Promise<void> {
  const { renditions, hasAudio } = params
  for (const r of renditions) await mkdir(join(params.outDir, String(r.short)), { recursive: true })

  const n = renditions.length
  const split = `[0:v]split=${n}${renditions.map((_, i) => `[s${i}]`).join('')}`
  const scales = renditions.map(
    (r, i) => `[s${i}]scale=${r.width}:${r.height}:flags=bicubic,setsar=1[v${i}]`,
  )
  const args: string[] = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputArgs(params.input),
    '-filter_complex',
    [split, ...scales].join(';'),
  ]
  renditions.forEach((r, i) => {
    args.push(
      '-map',
      `[v${i}]`,
      `-c:v:${i}`,
      'libx264',
      `-maxrate:v:${i}`,
      `${r.videoKbps}k`,
      `-bufsize:v:${i}`,
      `${r.videoKbps * 2}k`,
    )
    if (hasAudio) {
      args.push('-map', '0:a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, `${r.audioKbps}k`)
    }
  })
  args.push(
    '-preset',
    'veryfast',
    '-profile:v',
    'main',
    '-level',
    '4.0',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-sc_threshold',
    '0',
    '-force_key_frames',
    `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
  )
  if (hasAudio) args.push('-ac', '2')
  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(HLS_SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_type',
    'mpegts',
    '-hls_segment_filename',
    join(params.outDir, '%v', 'seg-%04d.ts'),
    '-var_stream_map',
    renditions
      .map((r, i) => (hasAudio ? `v:${i},a:${i},name:${r.short}` : `v:${i},name:${r.short}`))
      .join(' '),
    join(params.outDir, '%v', 'index.m3u8'),
  )
  await run(params.ffmpeg, args, params.timeoutMs)
}
