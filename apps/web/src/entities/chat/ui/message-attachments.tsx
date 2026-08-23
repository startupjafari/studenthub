'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { FileText, Loader2, Play } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'
import { fetchAttachmentUrl } from '../api/chat-api'
import type { MessageAttachment } from '../model/types'
import { VoiceMessage } from './voice-message'
import { MediaViewer, type MediaViewerActions, type MediaViewerMeta } from './media-viewer'

// Голосовое сообщение (плеер-волна), а не обычное аудио/видео вложение.
// Основной признак — имя из встроенного рекордера (`voice-…`), т.к. mime по содержимому непредсказуем:
// webm → video/webm, iOS-запись → video/mp4. Для старых сообщений — запасная эвристика по mime.
function isVoice(att: MessageAttachment): boolean {
  if (att.name && /^voice-/i.test(att.name)) return true
  return att.mime.startsWith('audio/') || att.mime === 'video/webm'
}

// Открывается ли вложение в полноэкранном просмотрщике (картинка или реальное видео, не голосовое).
function isViewable(att: MessageAttachment): boolean {
  if (isVoice(att)) return false
  return att.mime.startsWith('image/') || att.mime.startsWith('video/')
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// presigned-URL живёт 15 мин — кэшируем 10, чтобы не дёргать API на каждый ререндер.
// Для оптимистичных (ещё не отправленных) вложений с localUrl запрос не делаем.
function useAttachmentUrl(att: MessageAttachment) {
  const hasLocal = !!att.localUrl
  const q = useQuery({
    queryKey: ['chat-attachment', att.id],
    queryFn: () => fetchAttachmentUrl(att.id),
    enabled: !hasLocal,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
  return { url: att.localUrl ?? q.data, isLoading: !hasLocal && q.isLoading }
}

// Полупрозрачный оверлей загрузки поверх медиа (Telegram-стиль): затемнение + круг прогресса.
function MediaUploadOverlay({ progress }: { progress?: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100)
  return (
    <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
      <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white">
        {pct > 0 ? (
          <span className="text-xs font-medium tabular-nums">{pct}%</span>
        ) : (
          <Loader2 className="size-6 animate-spin" aria-hidden />
        )}
      </span>
    </span>
  )
}

function Single({
  att,
  mine,
  onOpen,
}: {
  att: MessageAttachment
  mine: boolean
  onOpen?: () => void
}) {
  const t = useTranslations('Chats')
  const { url, isLoading } = useAttachmentUrl(att)
  const uploading = !!att.uploading
  // Спойлер (§34): размыто до клика.
  const [revealed, setRevealed] = useState(false)
  const blurred = !!att.spoiler && !revealed

  if (isLoading || !url) {
    return (
      <div className="flex h-10 w-40 items-center justify-center rounded-lg bg-black/10">
        <Loader2 className="size-4 animate-spin opacity-60" aria-hidden />
      </div>
    )
  }

  if (isVoice(att)) {
    return (
      <span className={cn('relative inline-flex', uploading && 'opacity-60')}>
        <VoiceMessage url={url} seed={att.id} mine={mine} />
        {uploading && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2">
            <Loader2 className="size-4 animate-spin opacity-70" aria-hidden />
          </span>
        )}
      </span>
    )
  }

  if (att.mime.startsWith('image/')) {
    // GIF (image/gif) автопроигрывается нативно как <img>; для остальных — lazy-загрузка (§30).
    const isGif = att.mime === 'image/gif'
    return (
      <span className="relative inline-block overflow-hidden rounded-lg">
        <img
          src={url}
          alt={t('attachment')}
          loading="lazy"
          className={cn(
            'max-h-64 max-w-full rounded-lg object-cover transition-[filter]',
            blurred && 'scale-105 blur-xl',
            uploading ? 'cursor-default' : 'cursor-pointer',
          )}
          onClick={uploading ? undefined : blurred ? () => setRevealed(true) : onOpen}
        />
        {blurred && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-white"
          >
            {t('spoiler')}
          </button>
        )}
        {isGif && !uploading && !blurred && (
          <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[0.6rem] font-semibold uppercase text-white">
            GIF
          </span>
        )}
        {uploading && <MediaUploadOverlay progress={att.progress} />}
      </span>
    )
  }
  if (att.mime.startsWith('video/')) {
    // Превью-кадр с кнопкой play; клик открывает полноэкранный просмотрщик (как в Telegram).
    return (
      <button
        type="button"
        onClick={uploading ? undefined : blurred ? () => setRevealed(true) : onOpen}
        disabled={uploading}
        className="relative block max-w-full overflow-hidden rounded-lg"
      >
        <video
          src={url}
          preload="metadata"
          muted
          className={cn('max-h-64 max-w-full', blurred && 'scale-105 blur-xl')}
        />
        {uploading ? (
          <MediaUploadOverlay progress={att.progress} />
        ) : blurred ? (
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-white">
            {t('spoiler')}
          </span>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30">
            <span className="flex size-12 items-center justify-center rounded-full bg-black/50 text-white">
              <Play className="size-6 translate-x-0.5" aria-hidden />
            </span>
          </span>
        )}
      </button>
    )
  }
  // Карточка файла в стиле Telegram: круглая иконка + имя + размер, клик — скачать.
  return (
    <a
      href={uploading ? undefined : url}
      target="_blank"
      rel="noopener noreferrer"
      download
      className={cn(
        'flex min-w-[220px] items-center gap-2 py-0.5',
        uploading && 'pointer-events-none',
      )}
    >
      <span
        className={cn(
          'relative flex size-10 shrink-0 items-center justify-center rounded-full',
          mine ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
        )}
      >
        {uploading ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : (
          <FileText className="size-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{att.name || t('attachment')}</span>
        <span className={cn('block text-xs', mine ? 'opacity-70' : 'text-muted-foreground')}>
          {uploading && att.progress != null
            ? `${humanSize(att.size)} · ${Math.round(att.progress * 100)}%`
            : humanSize(att.size)}
        </span>
      </span>
    </a>
  )
}

// Ячейка альбома-сетки (Telegram-стиль): квадратный кроп через object-cover, поверх — play у видео
// и оверлей загрузки у оптимистичных. Размер задаёт родитель через className (aspect/row-span).
function GridTile({
  att,
  onOpen,
  className,
}: {
  att: MessageAttachment
  onOpen?: () => void
  className?: string
}) {
  const { url, isLoading } = useAttachmentUrl(att)
  const uploading = !!att.uploading
  const isVid = att.mime.startsWith('video/')
  return (
    <button
      type="button"
      onClick={uploading ? undefined : onOpen}
      disabled={uploading}
      className={cn('relative block overflow-hidden bg-black/10', className)}
    >
      {isLoading || !url ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin opacity-60" aria-hidden />
        </span>
      ) : isVid ? (
        <>
          <video
            src={url}
            preload="metadata"
            muted
            className="absolute inset-0 size-full object-cover"
          />
          {!uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/15">
              <span className="flex size-10 items-center justify-center rounded-full bg-black/50 text-white">
                <Play className="size-5 translate-x-0.5" aria-hidden />
              </span>
            </span>
          )}
        </>
      ) : (
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
      )}
      {uploading && <MediaUploadOverlay progress={att.progress} />}
    </button>
  )
}

// Альбом изображений/видео сеткой-мозаикой (Telegram-стиль): 2 — рядом, 3 — крупное слева + два
// справа, 4 — 2×2, 5+ — по три в ряд. Клик по ячейке открывает полноэкранный просмотрщик.
function MediaGrid({
  items,
  onOpen,
}: {
  items: MessageAttachment[]
  onOpen: (att: MessageAttachment) => void
}) {
  const n = items.length
  const cols = n === 3 || n === 4 ? 'grid-cols-2' : n === 2 ? 'grid-cols-2' : 'grid-cols-3'
  const width = n >= 5 ? 300 : 260
  return (
    <div
      className={cn('grid gap-0.5 overflow-hidden rounded-lg', cols)}
      style={{ width, maxWidth: '100%' }}
    >
      {items.map((att, i) => (
        <GridTile
          key={att.id}
          att={att}
          onOpen={() => onOpen(att)}
          // 3 медиа: первое — высокое слева (span на 2 ряда), остальные — квадраты.
          className={n === 3 && i === 0 ? 'row-span-2' : 'aspect-square'}
        />
      ))}
    </div>
  )
}

export function MessageAttachments({
  media,
  mine,
  viewerMeta,
  viewerActions,
}: {
  media: MessageAttachment[]
  mine: boolean
  viewerMeta?: MediaViewerMeta
  viewerActions?: MediaViewerActions
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  if (media.length === 0) return null
  // Изображения/видео (viewable) — альбомом-сеткой; голосовые и файлы — отдельными строками.
  const viewable = media.filter(isViewable)
  const others = media.filter((a) => !isViewable(a))
  const openViewer = (att: MessageAttachment): void =>
    setViewerIndex(viewable.findIndex((v) => v.id === att.id))
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {viewable.length >= 2 ? (
        <MediaGrid items={viewable} onOpen={openViewer} />
      ) : (
        viewable.map((att) => (
          <Single key={att.id} att={att} mine={mine} onOpen={() => openViewer(att)} />
        ))
      )}
      {others.map((att) => (
        <Single key={att.id} att={att} mine={mine} />
      ))}
      {viewerIndex !== null && (
        <MediaViewer
          items={viewable}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          meta={viewerMeta}
          actions={viewerActions}
        />
      )}
    </div>
  )
}
