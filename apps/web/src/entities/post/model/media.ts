import { toMediaLink, type MediaLink } from '../../../shared/api'
import type { PostMedia } from './types'

// Ссылку, которая истечёт меньше чем через минуту, не показываем, а сразу продлеваем:
// картинка с `loading="lazy"` начнёт грузиться позже, чем отрисована.
const EXPIRY_MARGIN_MS = 60_000

/**
 * Ссылка на медиа, пришедшая в самой выдаче (лента и пост по id подписывают медиа пачкой).
 * `null` — её нет (ответ старого API) или она вот-вот истечёт: выдача могла пролежать в кэше
 * дольше срока подписи. Тогда ссылку даёт ручка продления (`fetchPostMediaLink`).
 */
export function inlineMediaLink(media: PostMedia, now = Date.now()): MediaLink | null {
  if (!media.url) return null
  if (media.expiresAt) {
    const expires = Date.parse(media.expiresAt)
    if (!Number.isFinite(expires) || expires - now < EXPIRY_MARGIN_MS) return null
  }
  return toMediaLink({
    url: media.url,
    expiresAt: media.expiresAt ?? undefined,
    status: media.status ?? media.mediaStatus,
    placeholder: media.placeholder,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
    sources: media.sources,
    poster: media.poster,
    hls: media.hls,
  })
}
