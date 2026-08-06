'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Copy, Eye, Forward, MoreVertical, Trash2 } from 'lucide-react'
import { MediaViewer as BaseMediaViewer } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { fetchAttachmentUrl } from '../api/chat-api'
import type { MessageAttachment } from '../model/types'

export interface MediaViewerMeta {
  senderName: string
  createdAt: string
  mine: boolean
  /** Подпись к медиа (текст сообщения) — показывается внизу по центру. */
  caption?: string
}

export interface MediaViewerActions {
  onGoTo: () => void
  onCopy: () => void
  onForward: () => void
  onDelete: () => void
}

// Просмотр медиа сообщений (Ф9+). Тонкая обёртка над общим shared/ui MediaViewer:
// добавляет чат-контекст (отправитель, подпись) и меню действий (перейти/копировать/переслать/удалить).
export function MediaViewer({
  items,
  index,
  onIndexChange,
  onClose,
  meta,
  actions,
}: {
  items: MessageAttachment[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  meta?: MediaViewerMeta
  actions?: MediaViewerActions
}) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const cur = items[index]

  const { data: url } = useQuery({
    queryKey: ['chat-attachment', cur?.id],
    queryFn: () => fetchAttachmentUrl(cur?.id as string),
    enabled: !!cur,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })

  if (!cur) return null

  const run =
    (fn?: () => void): (() => void) =>
    () => {
      fn?.()
      onClose()
    }

  const topLeft = meta ? (
    <div className="flex shrink-0 flex-col leading-tight text-white">
      <span className="truncate text-sm font-medium">{meta.senderName}</span>
      <span className="text-xs text-white/60">
        {new Date(meta.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'long' })},{' '}
        {new Date(meta.createdAt).toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  ) : undefined

  const caption = meta?.caption ? (
    <p className="max-w-2xl truncate rounded-xl bg-black/50 px-4 py-2 text-center text-sm text-white">
      {meta.caption}
    </p>
  ) : undefined

  const trailing = actions ? (
    <div
      className="relative"
      onMouseEnter={() => setMenuOpen(true)}
      onMouseLeave={() => setMenuOpen(false)}
    >
      <button
        type="button"
        aria-label={t('messageActions')}
        className={cn(
          'flex size-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white',
          menuOpen && 'bg-white/10 text-white',
        )}
      >
        <MoreVertical className="size-5" aria-hidden />
      </button>
      <div
        className={cn(
          'absolute bottom-full right-0 z-20 min-w-52 overflow-hidden rounded-xl border border-white/10 bg-zinc-800 py-1 text-white shadow-lg',
          menuOpen ? 'block' : 'hidden',
        )}
      >
        <button
          type="button"
          onClick={run(actions.onGoTo)}
          className="flex h-9 w-full items-center gap-2.5 px-3 text-sm transition-colors hover:bg-white/10"
        >
          <Eye className="size-4 shrink-0 opacity-80" aria-hidden />
          {t('goToMessage')}
        </button>
        <button
          type="button"
          onClick={run(actions.onCopy)}
          className="flex h-9 w-full items-center gap-2.5 px-3 text-sm transition-colors hover:bg-white/10"
        >
          <Copy className="size-4 shrink-0 opacity-80" aria-hidden />
          {t('copyText')}
        </button>
        <button
          type="button"
          onClick={run(actions.onForward)}
          className="flex h-9 w-full items-center gap-2.5 px-3 text-sm transition-colors hover:bg-white/10"
        >
          <Forward className="size-4 shrink-0 opacity-80" aria-hidden />
          {t('forward')}
        </button>
        {meta?.mine && (
          <button
            type="button"
            onClick={run(actions.onDelete)}
            className="flex h-9 w-full items-center gap-2.5 px-3 text-sm text-red-400 transition-colors hover:bg-white/10"
          >
            <Trash2 className="size-4 shrink-0" aria-hidden />
            {t('delete')}
          </button>
        )}
      </div>
    </div>
  ) : undefined

  return (
    <BaseMediaViewer
      items={items.map((a) => ({ mime: a.mime, name: a.name }))}
      index={index}
      src={url}
      onIndexChange={onIndexChange}
      onClose={onClose}
      topLeft={topLeft}
      caption={caption}
      trailing={trailing}
      downloadName={cur.name}
    />
  )
}
