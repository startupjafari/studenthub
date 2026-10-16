import type { MediaStatus, MediaVariantKind, Prisma } from '@prisma/client'

/**
 * Поля File, из которых собирается описание медиа. Модули добавляют этот select к своему
 * выбору файлов — варианты тогда приходят тем же запросом, без N+1.
 *
 * `take` у вариантов — потолок, а не пагинация: у файла их не больше дюжины
 * (4 копии + 2–3 постера + до 4 рендишнов), но `findMany` без `take` запрещён.
 */
export const MEDIA_FILE_SELECT = {
  id: true,
  bucket: true,
  mime: true,
  width: true,
  height: true,
  mediaStatus: true,
  placeholder: true,
  durationMs: true,
  variants: {
    select: { kind: true, width: true, height: true, key: true, mime: true, bitrate: true },
    orderBy: { width: 'asc' },
    take: 16,
  },
} satisfies Prisma.FileSelect

export type MediaFile = Prisma.FileGetPayload<{ select: typeof MEDIA_FILE_SELECT }>

/** Поля превью для списков, где ссылки не подписываются (лента сообщений чата). */
export const MEDIA_PREVIEW_SELECT = {
  mediaStatus: true,
  placeholder: true,
  durationMs: true,
} satisfies Prisma.FileSelect

export interface MediaSource {
  width: number
  height: number
  url: string
}

/**
 * Описание медиа для клиента — одно на все модули (чат, лента, сторисы, профиль, материалы).
 *
 * Поля только добавляются к прежним ответам: старый клиент, знающий лишь `url`, работает
 * как раньше, новый берёт отсюда заглушку, srcset и HLS.
 */
export interface MediaInfo {
  status: MediaStatus
  /** LQIP data-URI: показывается мгновенно, пока не пришли байты. */
  placeholder: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  /** Уменьшенные WebP-копии по возрастанию ширины — готовый srcset. Пусто — только оригинал. */
  sources: MediaSource[]
  /** Постер видео по возрастанию ширины (тоже srcset). */
  poster: MediaSource[]
  /**
   * Мастер-плейлист HLS — путь от корня сервера API (`/api/v1/media/…?t=…`), не полный URL:
   * веб ходит через свой прокси, мобильные клиенты подставляют свой адрес API.
   */
  hls: string | null
  /** Когда протухнут подписанные ссылки; `null` — ссылки постоянные (публичный бакет). */
  expiresAt: string | null
}

export interface VariantRow {
  kind: MediaVariantKind
  width: number
  height: number
  key: string
  mime: string
  size: number
  bitrate: number | null
}
