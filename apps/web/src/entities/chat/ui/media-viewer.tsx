'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Copy, Eye, Forward, ImageDown, MoreVertical, Trash2 } from 'lucide-react'
import { MediaViewer as BaseMediaViewer } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useBodyScrollLock } from '../../../shared/lib'
import { fetchAttachmentUrl } from '../api/chat-api'
import type { MessageAttachment } from '../model/types'

/** Ссылка на вложение живёт дольше показа: вернулись к тому же кадру — второй раз не просим. */
const URL_STALE_MS = 10 * 60 * 1000
const URL_GC_MS = 15 * 60 * 1000

/**
 * Положить сам снимок в буфер обмена (§6 карты).
 *
 * Через canvas и всегда в PNG: буфер обмена браузера принимает узкий список типов, и JPEG или
 * WebP в него не кладутся — а вставляют снимок обычно в письмо или в документ, где формат
 * исходника значения не имеет. Отказ возможен (нет разрешения, Safari вне жеста) — зовущий
 * сообщает о нём сам.
 */
async function copyImageToClipboard(url: string): Promise<void> {
  const blob = await fetch(url).then((r) => r.blob())
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!png) throw new Error('canvas')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

const attachmentKey = (fileId: string | undefined): (string | undefined)[] => [
  'chat-attachment',
  fileId,
]

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
  /** Сообщить об исходе копирования снимка: тост принадлежит приложению, а не просмотрщику. */
  onCopiedImage?: (ok: boolean) => void
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
  useBodyScrollLock()
  const [menuOpen, setMenuOpen] = useState(false)
  const cur = items[index]

  const qc = useQueryClient()

  const { data: url } = useQuery({
    queryKey: attachmentKey(cur?.id),
    queryFn: () => fetchAttachmentUrl(cur?.id as string),
    enabled: !!cur,
    staleTime: URL_STALE_MS,
    gcTime: URL_GC_MS,
  })

  /**
   * Готовим соседние кадры заранее.
   *
   * Листание упиралось не в жест, а в сеть: у каждого вложения свой подписанный URL, и
   * запрашивали мы его только когда кадр уже стал текущим. На мобильном интернете это
   * означало запрос за ссылкой, потом загрузку самой картинки — и пустой экран со спиннером
   * вместо мгновенного перелистывания. Ссылку соседей берём заранее, а картинку тут же
   * прогреваем в кэш браузера, чтобы к моменту свайпа она уже лежала готовой.
   */
  useEffect(() => {
    const around = [items[index - 1], items[index + 1]].filter(
      (it): it is MessageAttachment => !!it,
    )
    for (const it of around) {
      void qc
        .fetchQuery({
          queryKey: attachmentKey(it.id),
          queryFn: () => fetchAttachmentUrl(it.id),
          staleTime: URL_STALE_MS,
          gcTime: URL_GC_MS,
        })
        .then((next) => {
          // Видео целиком тянуть незачем — браузер возьмёт его потоком; греем только снимки.
          if (!next || !it.mime.startsWith('image/')) return
          const img = new Image()
          img.src = next
        })
        .catch(() => undefined)
    }
  }, [items, index, qc])

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
          className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-white/10"
        >
          <Eye className="size-4 shrink-0 opacity-80" aria-hidden />
          {t('goToMessage')}
        </button>
        <button
          type="button"
          onClick={run(actions.onCopy)}
          className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-white/10"
        >
          <Copy className="size-4 shrink-0 opacity-80" aria-hidden />
          {t('copyText')}
        </button>
        {/* Копировать сам снимок — отдельным пунктом от «копировать текст»: в буфер кладут
            либо подпись, либо картинку, и одна кнопка на оба случая всегда не та. */}
        {cur.mime.startsWith('image/') && url && (
          <button
            type="button"
            onClick={() => {
              void copyImageToClipboard(url).then(
                () => actions.onCopiedImage?.(true),
                () => actions.onCopiedImage?.(false),
              )
              setMenuOpen(false)
            }}
            className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-white/10"
          >
            <ImageDown className="size-4 shrink-0 opacity-80" aria-hidden />
            {t('copyImage')}
          </button>
        )}
        <button
          type="button"
          onClick={run(actions.onForward)}
          className="flex h-9 w-full items-center gap-2 px-3 text-sm transition-colors hover:bg-white/10"
        >
          <Forward className="size-4 shrink-0 opacity-80" aria-hidden />
          {t('forward')}
        </button>
        {meta?.mine && (
          <button
            type="button"
            onClick={run(actions.onDelete)}
            className="flex h-9 w-full items-center gap-2 px-3 text-sm text-red-400 transition-colors hover:bg-white/10"
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
