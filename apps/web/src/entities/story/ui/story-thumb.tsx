import { pickSource } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { MediaImage } from '../../../shared/ui'
import { storyBackgroundClass } from '../model/backgrounds'
import type { StoryMedia } from '../model/types'

/**
 * Миниатюра кадра: фото, постер видео или текстовый кадр на своём фоне. Обложки
 * «Актуального», превью соседних колец и выбор обложки. Размер задаёт родитель.
 *
 * Постера у видео может не быть: обработка ещё идёт или на машине нет ffmpeg (видео тогда
 * остаётся в PENDING и играет оригинал). Тогда показываем первый кадр самого ролика —
 * браузер достаёт его из метаданных, не скачивая видео целиком.
 */
export function StoryThumb({
  media,
  text,
  background,
  sizes = '96px',
  className,
}: {
  media: StoryMedia | null
  text: string | null
  background: string | null
  sizes?: string
  className?: string
}) {
  const isVideo = media?.mime.startsWith('video/') ?? false
  const poster = isVideo && media ? pickSource(media.poster, 320)?.url : undefined
  return (
    <span className={cn('relative block overflow-hidden bg-muted', className)}>
      {media && !isVideo ? (
        <MediaImage
          src={media.url}
          media={media}
          alt=""
          fit="cover"
          sizes={sizes}
          className="size-full"
        />
      ) : poster ? (
        <MediaImage src={poster} alt="" fit="cover" sizes={sizes} className="size-full" />
      ) : media && isVideo ? (
        <video
          // `#t=0.1` — не чёрный нулевой кадр, а первый настоящий.
          src={`${media.url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          disablePictureInPicture
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none size-full object-cover"
        />
      ) : (
        <span
          className={cn(
            'flex size-full items-center justify-center p-1.5',
            storyBackgroundClass(media ? null : background),
          )}
        >
          {/* Текст кадра в миниатюре — намёком, а не для чтения: строки обрезаются. */}
          <span
            aria-hidden
            className="line-clamp-3 text-center text-[0.55rem] leading-tight font-medium text-white"
          >
            {text}
          </span>
        </span>
      )}
    </span>
  )
}
