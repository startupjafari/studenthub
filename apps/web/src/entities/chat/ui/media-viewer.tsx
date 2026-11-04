'use client'

import { useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Copy, Eye, Forward, ImageDown, Trash2 } from 'lucide-react'
import { MediaViewer as BaseMediaViewer, VIEWER_ICON_BUTTON } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { srcSetOf, useBodyScrollLock } from '../../../shared/lib'
import { useAttachmentLinkSource } from './attachment-link-source'
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

const attachmentKey = (scope: string, fileId: string | undefined): (string | undefined)[] => [
  scope,
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
// добавляет чат-контекст (отправитель, подпись) и действия (перейти/копировать/переслать/удалить).
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
  // Второй аргумент — запрет выделения на всей странице: оверлей перетаскивают,
  // и без него браузер выделяет текст, лежащий ПОД ним (см. хук).
  useBodyScrollLock(true, true)
  const cur = items[index]

  const qc = useQueryClient()
  const source = useAttachmentLinkSource()

  const { data: link } = useQuery({
    queryKey: attachmentKey(source.scope, cur?.id),
    queryFn: () => source.fetch(cur?.id as string),
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
          queryKey: attachmentKey(source.scope, it.id),
          queryFn: () => source.fetch(it.id),
          staleTime: URL_STALE_MS,
          gcTime: URL_GC_MS,
        })
        .then((next) => {
          // Видео целиком тянуть незачем — браузер возьмёт его потоком; греем только снимки.
          if (!next || !it.mime.startsWith('image/')) return
          // Греем ту же копию, что выберет просмотрщик (srcset + sizes=100vw), а не оригинал.
          const img = new Image()
          img.sizes = '100vw'
          const srcset = srcSetOf(next.sources, { url: next.url, width: next.width })
          if (srcset) img.srcset = srcset
          img.src = next.url
        })
        .catch(() => undefined)
    }
  }, [items, index, qc, source])

  if (!cur) return null
  // Оптимистичное вложение играет из локального файла; у отправленного — подписанная ссылка.
  const url = cur.localUrl ?? link?.url

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

  // Действия — иконками в верхней панели, слева от поворота, «скачать» и «закрыть»: без
  // всплывающего меню, всё видно сразу (как в Telegram). Подпись — в title и aria-label.
  const icon = (
    label: string,
    Icon: typeof Eye,
    onClick: () => void,
    tone?: 'danger',
  ): ReactNode => (
    <button
      key={label}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(VIEWER_ICON_BUTTON, tone === 'danger' && 'text-red-400 hover:text-red-300')}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  )
  const topActions = actions ? (
    <>
      {icon(t('goToMessage'), Eye, run(actions.onGoTo))}
      {icon(t('copyText'), Copy, run(actions.onCopy))}
      {/* Копировать сам снимок — отдельно от «копировать текст»: в буфер кладут либо
          подпись, либо картинку, и одна кнопка на оба случая всегда не та. */}
      {cur.mime.startsWith('image/') &&
        url &&
        icon(t('copyImage'), ImageDown, () => {
          void copyImageToClipboard(url).then(
            () => actions.onCopiedImage?.(true),
            () => actions.onCopiedImage?.(false),
          )
        })}
      {icon(t('forward'), Forward, run(actions.onForward))}
      {meta?.mine && icon(t('delete'), Trash2, run(actions.onDelete), 'danger')}
      {/* Отбивка между действиями над сообщением и управлением просмотром. */}
      <span className="mx-1 h-5 w-px bg-white/15" aria-hidden />
    </>
  ) : undefined

  return (
    <BaseMediaViewer
      items={items.map((a) => ({ mime: a.mime, name: a.name }))}
      index={index}
      src={url}
      // Заглушка из списка сообщений видна сразу, варианты и HLS — когда пришла ссылка.
      media={{
        placeholder: cur.placeholder,
        width: link?.width ?? cur.width,
        height: link?.height ?? cur.height,
        sources: link?.sources,
        poster: link?.poster,
        hls: link?.hls,
      }}
      onIndexChange={onIndexChange}
      onClose={onClose}
      topLeft={topLeft}
      caption={caption}
      actions={topActions}
      downloadName={cur.name}
      downloadKey={cur.id ? `file:${cur.id}` : undefined}
    />
  )
}
