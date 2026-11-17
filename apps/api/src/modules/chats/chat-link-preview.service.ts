import { Inject, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import {
  LinkPreviewService,
  type LinkPreview,
} from '../../common/link-preview/link-preview.service'

/** Удачное превью живёт час: заголовки страниц меняются редко, а повторы частые. */
const HIT_TTL_SECONDS = 60 * 60
/**
 * Пустой ответ (сайт недоступен, не HTML, приватный адрес) — десять минут. Короче, чем
 * удачный: сайт мог лежать минуту, и превью его ссылки не должно пропасть на час.
 */
const MISS_TTL_SECONDS = 10 * 60
const CACHE_PREFIX = 'chat:link-preview:'
/** Метка «превью нет» в кеше: пустую строку Redis вернул бы так же, как отсутствие ключа. */
const MISS = '-'

/**
 * Превью ссылки для чатов: черновик над полем ввода (`GET /chats/link-preview`) и карточка
 * отправленного сообщения (job `link-preview`). Один путь у обоих — человек видит под
 * сообщением ту же карточку, что видел над полем, и сеть второй раз не трогается.
 *
 * Сама выборка — `LinkPreviewService` со всеми его защитами (SSRF: только http(s), приватные
 * и служебные адреса, IPv6-литералы в скобках, DNS rebinding, редиректы с повторной проверкой,
 * общий срок, потолок тела). Здесь — кеш в Redis и склейка одновременных запросов одной
 * ссылки: пока человек допечатывает адрес, клиент спрашивает его не раз.
 *
 * Картинка OG не отдаётся (F-F29): это адрес на чужом сайте, и браузер, загрузив её,
 * отдал бы владельцу ссылки IP и время. Пока копии в своём хранилище нет, карточка —
 * заголовок, описание и сайт; поле `image` остаётся в форме и всегда `null`.
 */
@Injectable()
export class ChatLinkPreviewService {
  private readonly logger = new Logger(ChatLinkPreviewService.name)
  /** Выборки в процессе: вторая такая же ссылка ждёт первую, а не идёт в сеть сама. */
  private readonly inflight = new Map<string, Promise<LinkPreview | null>>()

  constructor(
    private readonly links: LinkPreviewService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async preview(url: string): Promise<LinkPreview | null> {
    const key = CACHE_PREFIX + createHash('sha256').update(url).digest('hex')
    const cached = await this.read(key)
    if (cached !== undefined) return cached

    const pending = this.inflight.get(key)
    if (pending) return pending
    const task = this.fetchAndStore(key, url).finally(() => this.inflight.delete(key))
    this.inflight.set(key, task)
    return task
  }

  private async fetchAndStore(key: string, url: string): Promise<LinkPreview | null> {
    const fetched = await this.links.fetch(url)
    // Без заголовка карточку не рисуем: строка «example.com» над полем ничего не сообщает.
    const preview: LinkPreview | null = fetched?.title ? { ...fetched, image: null } : null
    await this.redis
      .set(
        key,
        preview ? JSON.stringify(preview) : MISS,
        'EX',
        preview ? HIT_TTL_SECONDS : MISS_TTL_SECONDS,
      )
      .catch((error: unknown) => {
        this.logger.warn(`Не удалось запомнить превью ссылки: ${String(error)}`)
      })
    return preview
  }

  /** `undefined` — в кеше нет (или Redis недоступен: тогда идём в сеть, fail-open). */
  private async read(key: string): Promise<LinkPreview | null | undefined> {
    let raw: string | null
    try {
      raw = await this.redis.get(key)
    } catch (error) {
      this.logger.warn(`Redis недоступен, превью без кеша: ${String(error)}`)
      return undefined
    }
    if (raw === null) return undefined
    if (raw === MISS) return null
    try {
      return { ...(JSON.parse(raw) as LinkPreview), image: null }
    } catch {
      return undefined
    }
  }
}
