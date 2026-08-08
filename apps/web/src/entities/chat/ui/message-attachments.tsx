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
function useAttachmentUrl(fileId: string) {
  return useQuery({
    queryKey: ['chat-attachment', fileId],
    queryFn: () => fetchAttachmentUrl(fileId),
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
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
  const { data: url, isLoading } = useAttachmentUrl(att.id)

  if (isLoading || !url) {
    return (
      <div className="flex h-10 w-40 items-center justify-center rounded-lg bg-black/10">
        <Loader2 className="size-4 animate-spin opacity-60" aria-hidden />
      </div>
    )
  }

  if (isVoice(att)) {
    return <VoiceMessage url={url} seed={att.id} mine={mine} />
  }

  if (att.mime.startsWith('image/')) {
    return (
      <img
        src={url}
        alt={t('attachment')}
        className="max-h-64 max-w-full cursor-pointer rounded-lg object-cover"
        onClick={onOpen}
      />
    )
  }
  if (att.mime.startsWith('video/')) {
    // Превью-кадр с кнопкой play; клик открывает полноэкранный просмотрщик (как в Telegram).
    return (
      <button
        type="button"
        onClick={onOpen}
        className="relative block max-w-full overflow-hidden rounded-lg"
      >
        <video src={url} preload="metadata" muted className="max-h-64 max-w-full" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30">
          <span className="flex size-12 items-center justify-center rounded-full bg-black/50 text-white">
            <Play className="size-6 translate-x-0.5" aria-hidden />
          </span>
        </span>
      </button>
    )
  }
  // Карточка файла в стиле Telegram: круглая иконка + имя + размер, клик — скачать.
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download
      className="flex min-w-[220px] items-center gap-2.5 py-0.5"
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          mine ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
        )}
      >
        <FileText className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{att.name || t('attachment')}</span>
        <span className={cn('block text-xs', mine ? 'opacity-70' : 'text-muted-foreground')}>
          {humanSize(att.size)}
        </span>
      </span>
    </a>
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
  const viewable = media.filter(isViewable)
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {media.map((att) => (
        <Single
          key={att.id}
          att={att}
          mine={mine}
          onOpen={
            isViewable(att)
              ? () => setViewerIndex(viewable.findIndex((v) => v.id === att.id))
              : undefined
          }
        />
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
