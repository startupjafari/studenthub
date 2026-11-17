'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Copy, Eye, Forward, ImageDown, Trash2 } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  MediaViewer as BaseMediaViewer,
  type MediaViewerAction,
} from '../../../shared/ui'
import { downloadedUrl, srcSetOf, useBodyScrollLock, useFileDownload } from '../../../shared/lib'
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
  /** Аватар автора в шапке просмотрщика (как в Telegram); нет — инициалы. */
  senderAvatarUrl?: string | null
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
  getOrigin,
}: {
  items: MessageAttachment[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  meta?: MediaViewerMeta
  actions?: MediaViewerActions
  /** Миниатюра кадра в пузыре — из неё просмотрщик вырастает и в неё же садится. */
  getOrigin?: (index: number) => HTMLElement | null
}) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
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

  // Ролик, скачанный заранее при прокрутке ленты (автозагрузка), играет из памяти: открытие
  // мгновенное, без второй загрузки и без потокового HLS.
  const dlKey = `file:${cur?.id ?? 'pending'}`
  const dl = useFileDownload(dlKey, {
    url: link?.url ?? '',
    name: cur?.name ?? '',
    mime: cur?.mime ?? '',
  })
  const local =
    cur?.mime.startsWith('video/') && dl.state.status === 'ready' ? downloadedUrl(dlKey) : null

  if (!cur) return null
  // Оптимистичное вложение играет из локального файла; у отправленного — подписанная ссылка.
  const url = cur.localUrl ?? local ?? link?.url

  const counter =
    items.length > 1
      ? tCommon('tgMedia.counter', { current: index + 1, total: items.length })
      : null
  const when = meta
    ? `${new Date(meta.createdAt).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
      })}, ${new Date(meta.createdAt).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : ''

  // Шапка как в Telegram: аватар, имя и «дата · N из M». Нажатие ведёт к сообщению — так же,
  // как в Telegram, где это и есть «перейти к сообщению». На телефоне аватара нет: место
  // нужнее имени.
  const senderInfo = meta
    ? (close: () => void) => (
        <SenderInfo
          name={meta.senderName}
          avatarUrl={meta.senderAvatarUrl}
          subtitle={counter ? `${when} · ${counter}` : when}
          label={actions ? t('goToMessage') : undefined}
          onClick={
            actions
              ? () => {
                  actions.onGoTo()
                  close()
                }
              : undefined
          }
        />
      )
    : undefined

  // Подпись — до трёх строк по центру, длинная прокручивается внутри (Telegram: 4,25rem).
  const caption = meta?.caption ? (
    <p
      dir="auto"
      className="max-h-[4.25rem] max-w-2xl overflow-y-auto px-2 text-center text-[0.9375rem] leading-snug break-words whitespace-pre-wrap text-white/90 select-text"
    >
      {meta.caption}
    </p>
  ) : undefined

  // Действия: на ПК — иконками в шапке, на телефоне — в меню «⋮» (раскладку решает
  // общий просмотрщик). Пересылка — поверх просмотрщика, как в Telegram: закрыли окно
  // пересылки или отправили — снова смотрим тот же снимок, а не ленту.
  const menu: MediaViewerAction[] | undefined = actions
    ? [
        {
          key: 'goto',
          label: t('goToMessage'),
          icon: Eye,
          onSelect: actions.onGoTo,
          closes: true,
        },
        // Копировать подпись — только если она есть: пустая строка в буфере — не действие.
        ...(meta?.caption
          ? [{ key: 'copy', label: t('copyText'), icon: Copy, onSelect: actions.onCopy }]
          : []),
        // Копировать сам снимок — отдельно от «копировать текст»: в буфер кладут либо
        // подпись, либо картинку, и одна кнопка на оба случая всегда не та.
        ...(cur.mime.startsWith('image/') && url
          ? [
              {
                key: 'copy-image',
                label: t('copyImage'),
                icon: ImageDown,
                onSelect: () => {
                  void copyImageToClipboard(url).then(
                    () => actions.onCopiedImage?.(true),
                    () => actions.onCopiedImage?.(false),
                  )
                },
              },
            ]
          : []),
        { key: 'forward', label: t('forward'), icon: Forward, onSelect: actions.onForward },
        ...(meta?.mine
          ? [
              {
                key: 'delete',
                label: t('delete'),
                icon: Trash2,
                onSelect: actions.onDelete,
                tone: 'danger' as const,
                closes: true,
              },
            ]
          : []),
      ]
    : undefined

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
        hls: local ? null : link?.hls,
      }}
      onIndexChange={onIndexChange}
      onClose={onClose}
      topLeft={senderInfo}
      caption={caption}
      menu={menu}
      downloadName={cur.name}
      downloadKey={cur.id ? `file:${cur.id}` : undefined}
      getOrigin={getOrigin}
    />
  )
}

/** Автор кадра в шапке просмотрщика: аватар, имя и подпись «когда · N из M». */
function SenderInfo({
  name,
  avatarUrl,
  subtitle,
  label,
  onClick,
}: {
  name: string
  avatarUrl?: string | null
  subtitle: string
  /** Подпись для скринридера, если блок нажимается (перейти к сообщению). */
  label?: string
  onClick?: () => void
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
  const body = (
    <>
      <Avatar className="hidden size-10 sm:flex">
        {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
        <AvatarFallback className="bg-white/15 text-white">{initials}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col text-left leading-tight">
        <span className="truncate text-sm font-medium text-white">{name}</span>
        <span className="truncate text-xs text-white/60 tabular-nums">{subtitle}</span>
      </span>
    </>
  )
  if (!onClick) return <div className="flex min-w-0 items-center gap-3 px-1">{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={`${label}: ${name}, ${subtitle}`}
      // Telegram приглушает автора и проявляет при наведении — нажимаемость видна, а шапка
      // не спорит со снимком.
      className="flex max-w-full min-w-0 items-center gap-3 rounded-lg px-1 py-0.5 opacity-80 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
    >
      {body}
    </button>
  )
}
