import { createHash } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import type {
  ChatGifExternalSendInput,
  ChatGifSearchQueryInput,
  ChatGifTrendingQueryInput,
} from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import type { EnvVars } from '../../config/env.schema'
import { FileService } from '../files/file.service'
import { ChatsService, type MessageRow } from './chats.service'

/** GIF каталога в выдаче поиска: размеры оригинала и маленькая анимированная копия. */
export interface GifSearchItem {
  id: string
  title: string
  width: number
  height: number
  previewUrl: string
  previewWidth: number
  previewHeight: number
}

export interface GifSearchPage {
  items: GifSearchItem[]
  nextOffset: number | null
}

/** Одна копия GIF в ответе GIPHY: числа приходят строками. */
interface GiphyRendition {
  url?: string
  width?: string
  height?: string
  size?: string
}

interface GiphyGif {
  id?: string
  title?: string
  images?: Record<string, GiphyRendition | undefined>
}

interface GiphyListResponse {
  data?: GiphyGif[]
  pagination?: { total_count?: number; count?: number; offset?: number }
}

interface GiphyOneResponse {
  data?: GiphyGif | unknown[]
}

const GIPHY_API = 'https://api.giphy.com/v1/gifs'
// Детский рейтинг каталога: платформа учебная, в ней школьники-первокурсники.
const GIPHY_RATING = 'pg'
const GIPHY_LANG = 'ru'
// GIPHY не отдаёт выдачу глубже 4999-го элемента.
const GIPHY_OFFSET_MAX = 4999
// Выдача каталога меняется медленно: пять минут кэша снимают повторные запросы при наборе.
const SEARCH_CACHE_TTL_SECONDS = 300
const API_TIMEOUT_MS = 5000
const DOWNLOAD_TIMEOUT_MS = 15_000
/** Потолок скачиваемого GIF — лимит картинки чата (BACKEND_RULES §8). */
const GIF_MAX_BYTES = FILE_UPLOAD.MAX_BYTES.IMAGE
// Копии для превью в сетке: маленькие и анимированные.
const PREVIEW_RENDITIONS = ['fixed_width_downsampled', 'fixed_width'] as const
// Копии для отправки — от лучшей к худшей; берётся первая, что влезает в лимит.
const SEND_RENDITIONS = [
  'original',
  'downsized_large',
  'downsized_medium',
  'downsized',
  'fixed_width',
] as const

/**
 * Адрес копии GIF, которому можно доверять: только https и только хосты GIPHY. Ответ API
 * мы не контролируем — без этой сверки сервер скачал бы что угодно по ссылке из него (SSRF).
 */
export function isGiphyMediaUrl(raw: string | undefined): raw is string {
  if (!raw) return false
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      (url.hostname === 'giphy.com' || url.hostname.endsWith('.giphy.com'))
    )
  } catch {
    return false
  }
}

/** GIF87a / GIF89a — подпись формата в первых шести байтах. */
export function isGifBytes(buffer: Buffer): boolean {
  if (buffer.length < 6) return false
  const head = buffer.subarray(0, 6).toString('latin1')
  return head === 'GIF87a' || head === 'GIF89a'
}

function toInt(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function toItem(gif: GiphyGif): GifSearchItem | null {
  const images = gif.images ?? {}
  const original = images.original
  const preview = PREVIEW_RENDITIONS.map((name) => images[name]).find((r) =>
    isGiphyMediaUrl(r?.url),
  )
  if (!gif.id || !preview?.url) return null
  return {
    id: gif.id,
    title: gif.title?.trim() ?? '',
    width: toInt(original?.width) || toInt(preview.width),
    height: toInt(original?.height) || toInt(preview.height),
    previewUrl: preview.url,
    previewWidth: toInt(preview.width),
    previewHeight: toInt(preview.height),
  }
}

/**
 * Поиск GIF во внешнем каталоге (GIPHY) — прокси на сервере.
 *
 * Ключ GIPHY клиентам не уходит: приложения ходят только в наш API. Отправка выбранного GIF
 * (`POST /chats/:id/gif/external`) берёт у клиента только id — адрес картинки сервер узнаёт у
 * каталога сам, качает её лишь с хостов GIPHY с потолком размера и сроком и сохраняет обычным
 * вложением чата (запись File, image/gif). Сообщение дальше живёт без GIPHY: ссылка не протухнет,
 * а приватный бакет отдаёт её подписанной, как любое вложение.
 *
 * Нет `GIPHY_API_KEY` — поиск выключен целиком, все три ручки отвечают `503 FEATURE_DISABLED`.
 */
@Injectable()
export class ChatGifsService {
  private readonly logger = new Logger(ChatGifsService.name)

  constructor(
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly files: FileService,
    private readonly chats: ChatsService,
  ) {}

  /** Популярные GIF (`GET /chats/gifs/trending`). */
  async trending(query: ChatGifTrendingQueryInput): Promise<GifSearchPage> {
    const key = this.apiKey()
    return this.cached(`chat:gifs:trending:${query.offset}:${query.limit}`, () =>
      this.list('trending', key, { limit: query.limit, offset: query.offset }),
    )
  }

  /** Поиск GIF (`GET /chats/gifs/search`). Запрос в ключе кэша — хэшем, без регистра. */
  async search(query: ChatGifSearchQueryInput): Promise<GifSearchPage> {
    const key = this.apiKey()
    const q = query.q.trim()
    const digest = createHash('sha1').update(q.toLowerCase()).digest('hex')
    return this.cached(`chat:gifs:search:${digest}:${query.offset}:${query.limit}`, () =>
      this.list('search', key, { q, limit: query.limit, offset: query.offset, lang: GIPHY_LANG }),
    )
  }

  /**
   * Отправить GIF каталога (`POST /chats/:id/gif/external`). Проверки отправки (членство,
   * блокировка, антифлуд, потолок запроса, повтор по nonce) — общие с остальными особыми
   * сообщениями; каталог и скачивание — уже после них, чтобы отказ не тратил квоту и трафик.
   */
  async sendExternal(
    senderId: string,
    chatId: string,
    input: ChatGifExternalSendInput,
  ): Promise<MessageRow> {
    const key = this.apiKey()
    return this.chats.sendRichMessage(senderId, chatId, {
      replyToId: input.replyToId,
      nonce: input.nonce,
      data: {},
      attachments: async () => {
        const gif = await this.lookup(key, input.id)
        const buffer = await this.downloadBest(gif)
        const file = await this.files.upload({
          buffer,
          bucket: this.config.get('MINIO_BUCKET_CHAT', { infer: true }),
          ownerId: senderId,
          name: `giphy-${input.id}.gif`,
        })
        return [{ id: file.id }]
      },
    })
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────────

  private apiKey(): string {
    const key = this.config.get('GIPHY_API_KEY', { infer: true })
    if (!key) throw new AppException('FEATURE_DISABLED', 'Поиск GIF не настроен на сервере')
    return key
  }

  /** Кэш выдачи в Redis. Redis недоступен — идём в каталог напрямую. */
  private async cached(key: string, load: () => Promise<GifSearchPage>): Promise<GifSearchPage> {
    const hit = await this.redis.get(key).catch(() => null)
    if (hit) {
      try {
        return JSON.parse(hit) as GifSearchPage
      } catch {
        // Битая запись — перечитываем из каталога и перезаписываем.
      }
    }
    const page = await load()
    await this.redis
      .set(key, JSON.stringify(page), 'EX', SEARCH_CACHE_TTL_SECONDS)
      .catch((error: unknown) => {
        this.logger.warn(`Кэш выдачи GIF не записан: ${String(error)}`)
      })
    return page
  }

  private async list(
    path: 'trending' | 'search',
    apiKey: string,
    params: Record<string, string | number>,
  ): Promise<GifSearchPage> {
    const url = new URL(`${GIPHY_API}/${path}`)
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('rating', GIPHY_RATING)
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value))
    const body = (await this.callApi(url)) as GiphyListResponse
    const data = Array.isArray(body.data) ? body.data : []
    const items = data.flatMap((gif) => toItem(gif) ?? [])
    const offset = Number(params.offset) || 0
    const count = body.pagination?.count ?? data.length
    const total = body.pagination?.total_count ?? 0
    const next = offset + count
    return {
      items,
      nextOffset: count > 0 && next < total && next <= GIPHY_OFFSET_MAX ? next : null,
    }
  }

  /** GIF по id. Неизвестный id — `404`. */
  private async lookup(apiKey: string, id: string): Promise<GiphyGif> {
    const url = new URL(`${GIPHY_API}/${encodeURIComponent(id)}`)
    url.searchParams.set('api_key', apiKey)
    const body = (await this.callApi(url, { notFoundAs404: true })) as GiphyOneResponse
    const gif = body.data
    if (!gif || Array.isArray(gif) || !gif.id) {
      throw new AppException('NOT_FOUND', 'GIF не найден')
    }
    return gif
  }

  private async callApi(url: URL, opts: { notFoundAs404?: boolean } = {}): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      })
    } catch (error) {
      this.logger.warn(`Каталог GIF не ответил: ${String(error)}`)
      throw new AppException('INTERNAL_ERROR', 'Каталог GIF недоступен', undefined, 502)
    }
    if (opts.notFoundAs404 && (res.status === 404 || res.status === 400)) {
      throw new AppException('NOT_FOUND', 'GIF не найден')
    }
    if (!res.ok) {
      // Ключ в адресе — в лог уходит только путь и статус.
      this.logger.warn(`Каталог GIF ответил ${res.status} на ${url.pathname}`)
      throw new AppException('INTERNAL_ERROR', 'Каталог GIF недоступен', undefined, 502)
    }
    try {
      return await res.json()
    } catch {
      throw new AppException('INTERNAL_ERROR', 'Каталог GIF ответил непонятно', undefined, 502)
    }
  }

  /**
   * Скачать лучшую копию, что влезает в лимит картинки чата. Размер, заявленный каталогом,
   * отсеивает заведомо большие копии заранее; фактический — проверяется при чтении.
   */
  private async downloadBest(gif: GiphyGif): Promise<Buffer> {
    const images = gif.images ?? {}
    const candidates = SEND_RENDITIONS.flatMap((name) => {
      const r = images[name]
      if (!isGiphyMediaUrl(r?.url)) return []
      const size = toInt(r.size)
      return size > GIF_MAX_BYTES ? [] : [r.url]
    })
    // Копии без ссылки на хост GIPHY не рассматриваются вовсе: тогда «нечего скачать», а не
    // «слишком большой».
    if (candidates.length === 0) {
      const anyUrl = SEND_RENDITIONS.some((name) => isGiphyMediaUrl(images[name]?.url))
      if (anyUrl) throw this.tooBig()
      throw new AppException('NOT_FOUND', 'GIF не найден')
    }
    for (const url of [...new Set(candidates)]) {
      const buffer = await this.download(url)
      if (buffer) return buffer
    }
    throw this.tooBig()
  }

  /** Байты копии с потолком и сроком. `null` — копия оказалась больше лимита. */
  private async download(url: string): Promise<Buffer | null> {
    let res: Response
    try {
      // Редиректы не следуем: за ними мог бы оказаться чужой хост.
      res = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
    } catch (error) {
      this.logger.warn(`GIF не скачался: ${String(error)}`)
      throw new AppException('INTERNAL_ERROR', 'Не удалось скачать GIF', undefined, 502)
    }
    if (!res.ok || !res.body) {
      this.logger.warn(`GIF не скачался: статус ${res.status}`)
      throw new AppException('INTERNAL_ERROR', 'Не удалось скачать GIF', undefined, 502)
    }
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > GIF_MAX_BYTES) {
      await res.body.cancel().catch(() => undefined)
      return null
    }
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > GIF_MAX_BYTES) {
          await reader.cancel().catch(() => undefined)
          return null
        }
        chunks.push(value)
      }
    } catch (error) {
      this.logger.warn(`GIF не дочитался: ${String(error)}`)
      throw new AppException('INTERNAL_ERROR', 'Не удалось скачать GIF', undefined, 502)
    }
    const buffer = Buffer.concat(chunks)
    if (!isGifBytes(buffer)) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Каталог отдал не GIF')
    }
    return buffer
  }

  private tooBig(): AppException {
    return new AppException('VALIDATION_ERROR', 'GIF больше лимита картинки чата (10 МБ)', [
      { field: 'id', message: 'GIF больше 10 МБ' },
    ])
  }
}
