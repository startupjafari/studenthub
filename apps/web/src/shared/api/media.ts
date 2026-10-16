// Контракт единой медиа-системы (docs/PROJECT.md «Медиа»): одно описание медиа на все
// разделы — вложения чата, медиа постов, сторис, профиля и учебных материалов.

export type MediaStatus = 'NONE' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'

/** Уменьшенная копия (WebP) или кадр-постер. */
export interface MediaSource {
  width: number
  height: number
  url: string
}

/**
 * Описание медиа. Приходит рядом с `url` оригинала в ответах «дай ссылку на файл» и в
 * объектах медиа сторис и профиля. Пустые `sources`/`poster` и `hls: null` — варианты ещё
 * не готовы (или файл старше медиа-системы): показывается оригинал, как раньше.
 */
export interface MediaInfo {
  status: MediaStatus
  /** LQIP: data-URI крошечной копии — рисуется размытым, пока не пришли байты. */
  placeholder: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  /** По возрастанию ширины — готовый srcset. */
  sources: MediaSource[]
  poster: MediaSource[]
  /** Мастер-плейлист HLS — путь от корня сервера API (см. `resolveApiPath`). */
  hls: string | null
  expiresAt: string | null
}

/** Ответ «ссылка на файл»: оригинал и описание его вариантов. */
export type MediaLink = MediaInfo & { url: string; expiresAt: string }

/**
 * Поля превью в списках (сообщения, лента, материалы): приходят без подписанных ссылок,
 * поэтому заглушку и размеры можно показать ещё до запроса за `MediaLink`.
 */
export interface MediaPreview {
  width?: number | null
  height?: number | null
  placeholder?: string | null
  mediaStatus?: MediaStatus
  durationMs?: number | null
}

/**
 * Путь от корня сервера API → адрес, по которому до него дойдёт браузер. На проде веб
 * проксирует `/api/v1` сам (путь годится как есть), в dev API живёт на своём origin.
 */
export function resolveApiPath(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL
  if (!base || !/^https?:\/\//.test(base)) return path
  return new URL(path, base).toString()
}
