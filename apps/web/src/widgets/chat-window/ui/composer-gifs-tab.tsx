'use client'

import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Bookmark, Clock, Loader2, Search, TrendingUp } from 'lucide-react'
import {
  GifVideo,
  composerKeys,
  fetchRecentGifs,
  fetchTrendingGifs,
  searchGifs,
  useSavedGifActions,
  useSavedGifs,
  type CatalogGif,
  type RecentGif,
} from '../../../entities/chat'
import { useInfiniteScroll } from '../../../shared/lib'

/** Что выбрали в панели GIF: запись каталога (по id) или свой файл (недавний, сохранённый). */
export type PickedGif = { kind: 'catalog'; id: string } | { kind: 'recent'; fileId: string }

// Ссылки подписаны на 15 минут и дольше: держать выдачу свежей дольше десяти незачем, а
// повторное открытие панели не должно каждый раз перезапрашивать каталог.
const CATALOG_STALE_MS = 10 * 60 * 1000

/** Сколько держать палец на плитке, чтобы сохранить GIF или убрать его из сохранённых. */
const ALT_PRESS_MS = 450

/** Плитка «своего» GIF: старый image/gif — картинкой, MP4-анимация — роликом по кругу. */
function FileGif({ gif }: { gif: RecentGif }) {
  if (gif.mime?.startsWith('video/')) {
    return (
      <GifVideo src={gif.url} poster={gif.poster ?? undefined} className="size-full object-cover" />
    )
  }
  return (
    <img src={gif.url} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
  )
}

/**
 * Плитка GIF: соотношение сторон резервируется заранее, чтобы колонка не прыгала. Нажатие
 * отправляет; правый клик или долгое нажатие — второе действие (сохранить или убрать), как у
 * стикеров: меню из одного пункта было бы лишним шагом.
 */
function GifTile({
  width,
  height,
  label,
  hint,
  onPick,
  onAlt,
  children,
}: {
  width: number | null
  height: number | null
  label: string
  hint?: string
  onPick: () => void
  onAlt?: () => void
  children: React.ReactNode
}) {
  const press = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swallowClick = useRef(false)
  const clear = (): void => {
    if (press.current) clearTimeout(press.current)
    press.current = null
  }
  useEffect(() => clear, [])
  const ratio = width && height ? `${width} / ${height}` : '1 / 1'
  return (
    <button
      type="button"
      onClick={() => {
        if (swallowClick.current) {
          swallowClick.current = false
          return
        }
        onPick()
      }}
      onContextMenu={
        onAlt
          ? (e) => {
              e.preventDefault()
              clear()
              onAlt()
            }
          : undefined
      }
      onPointerDown={(e) => {
        swallowClick.current = false
        if (!onAlt || e.pointerType === 'mouse') return
        clear()
        press.current = setTimeout(() => {
          press.current = null
          swallowClick.current = true
          onAlt()
        }, ALT_PRESS_MS)
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      aria-label={label}
      title={hint}
      className="mb-1 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-lg bg-muted outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring/40"
      style={{ aspectRatio: ratio }}
    >
      {children}
    </button>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1 pb-1 pt-1 text-xs font-medium text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {children}
    </h3>
  )
}

function PanelMessage({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
      <span>{text}</span>
      {children}
    </div>
  )
}

/**
 * Вкладка GIF панели символов, как в Telegram: «Сохранённые» первыми, затем «Недавние», затем
 * каталог GIPHY (популярные или поиск). Сохранённые и недавние — свои файлы и работают всегда;
 * каталог без ключа на сервере (`503 FEATURE_DISABLED`) просто не показывается — вместе с
 * полем поиска. Подпись «Powered by GIPHY» — условие каталога: она видна всякий раз, когда
 * на экране его выдача.
 */
export function GifsTab({ onPick }: { onPick: (gif: PickedGif) => void }) {
  const t = useTranslations('Chats')
  const [raw, setRaw] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQuery(raw.trim()), 350)
    return () => clearTimeout(id)
  }, [raw])

  const saved = useSavedGifs()
  const { save, remove } = useSavedGifActions()
  const recent = useQuery({
    queryKey: composerKeys.gifsRecent(),
    queryFn: fetchRecentGifs,
    staleTime: CATALOG_STALE_MS,
  })
  const catalog = useInfiniteQuery({
    queryKey: query ? composerKeys.gifsSearch(query) : composerKeys.gifsTrending(),
    queryFn: ({ pageParam }) =>
      query ? searchGifs(query, pageParam) : fetchTrendingGifs(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    staleTime: CATALOG_STALE_MS,
    retry: (count, e) => (e as { code?: string }).code !== 'FEATURE_DISABLED' && count < 2,
  })
  const sentinel = useInfiniteScroll<HTMLDivElement>({
    hasNext: !!catalog.hasNextPage,
    loading: catalog.isFetchingNextPage,
    onLoad: () => void catalog.fetchNextPage(),
  })

  // Каталога нет (сервер без GIPHY_API_KEY) — прячем и поиск: искать всё равно негде.
  const disabled = (catalog.error as { code?: string } | null)?.code === 'FEATURE_DISABLED'
  const searching = !!query && !disabled
  const savedItems = searching ? [] : (saved.data ?? [])
  // Недавние без уже сохранённых: один и тот же GIF дважды подряд — шум.
  const savedPrints = new Set(savedItems.map((g) => g.fingerprint))
  const recentItems = searching
    ? []
    : (recent.data ?? []).filter((g) => !g.fingerprint || !savedPrints.has(g.fingerprint))
  const catalogItems: CatalogGif[] = catalog.data?.pages.flatMap((p) => p.items) ?? []
  const own = savedItems.length + recentItems.length

  return (
    <div className="flex h-full flex-col">
      {!disabled && (
        <div className="m-2 mb-1 shrink-0">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t('tgGifs.search')}
              aria-label={t('tgGifs.search')}
              className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
            />
          </div>
          {/* Атрибуция — условие использования каталога GIPHY: видна, пока виден поиск. */}
          <p className="pt-1 text-right text-[0.65rem] font-medium tracking-wide text-muted-foreground">
            {t('tgGifs.poweredBy')}
          </p>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {savedItems.length > 0 && (
          <section aria-label={t('tgGifs.saved')}>
            <SectionTitle icon={Bookmark}>{t('tgGifs.saved')}</SectionTitle>
            <div className="mb-2 columns-2 gap-1">
              {savedItems.map((g) => (
                <GifTile
                  key={g.id}
                  width={g.width}
                  height={g.height}
                  label={t('tgComposer.gifSend')}
                  hint={t('tgGifs.savedHint')}
                  onPick={() => onPick({ kind: 'recent', fileId: g.fileId })}
                  onAlt={() => remove.mutate(g.id)}
                >
                  <FileGif gif={g} />
                </GifTile>
              ))}
            </div>
          </section>
        )}
        {recentItems.length > 0 && (
          <section aria-label={t('tgGifs.recent')}>
            <SectionTitle icon={Clock}>{t('tgGifs.recent')}</SectionTitle>
            <div className="mb-2 columns-2 gap-1">
              {recentItems.map((g) => (
                <GifTile
                  key={g.fileId}
                  width={g.width}
                  height={g.height}
                  label={t('tgComposer.gifSend')}
                  hint={t('tgGifs.recentHint')}
                  onPick={() => onPick({ kind: 'recent', fileId: g.fileId })}
                  onAlt={() => save.mutate(g.fileId)}
                >
                  <FileGif gif={g} />
                </GifTile>
              ))}
            </div>
          </section>
        )}
        {disabled ? (
          own === 0 && <PanelMessage text={t('tgGifs.empty')} />
        ) : catalog.isPending ? (
          <div className="columns-2 gap-1" aria-busy>
            {[120, 90, 140, 100, 80, 130].map((h, i) => (
              <div
                key={i}
                className="mb-1 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
                style={{ height: h }}
              />
            ))}
          </div>
        ) : catalog.isError ? (
          <PanelMessage text={t('tgComposer.gifsLoadError')}>
            <button
              type="button"
              onClick={() => void catalog.refetch()}
              className="cursor-pointer text-sm font-medium text-primary hover:underline"
            >
              {t('tgComposer.retry')}
            </button>
          </PanelMessage>
        ) : catalogItems.length === 0 ? (
          <PanelMessage text={t('tgComposer.gifsEmpty')} />
        ) : (
          <section aria-label={searching ? t('tgGifs.search') : t('tgGifs.trending')}>
            {!searching && own > 0 && (
              <SectionTitle icon={TrendingUp}>{t('tgGifs.trending')}</SectionTitle>
            )}
            <div className="columns-2 gap-1">
              {catalogItems.map((g) => (
                <GifTile
                  key={g.id}
                  width={g.previewWidth}
                  height={g.previewHeight}
                  label={g.title || t('tgComposer.gifSend')}
                  onPick={() => onPick({ kind: 'catalog', id: g.id })}
                >
                  <img
                    src={g.previewUrl}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="size-full object-cover"
                  />
                </GifTile>
              ))}
            </div>
            <div ref={sentinel} className="h-px" />
            {catalog.isFetchingNextPage && (
              <div className="flex justify-center py-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
