'use client'

import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, Search, X } from 'lucide-react'
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
import { cn } from '../../../shared/lib/utils'

/** Что выбрали в панели GIF: запись каталога (по id) или свой файл (недавний, сохранённый). */
export type PickedGif = { kind: 'catalog'; id: string } | { kind: 'recent'; fileId: string }

// Ссылки подписаны на 15 минут и дольше: держать выдачу свежей дольше десяти незачем, а
// повторное открытие панели не должно каждый раз перезапрашивать каталог.
const CATALOG_STALE_MS = 10 * 60 * 1000

/** Сколько держать палец на плитке, чтобы сохранить GIF или убрать его из сохранённых. */
const ALT_PRESS_MS = 450

/** Сетка GIF — три квадратные колонки, как в Telegram. */
export const GIF_COLUMNS = 3

/**
 * Какие углы плитки скруглить: сетка читается одной карточкой, поэтому скругляются только
 * внешние углы всего блока. Неполный последний ряд — правый нижний угол достаётся последней
 * плитке, а правый край предпоследнего ряда тоже становится нижним углом блока.
 */
export function gridCorners(
  index: number,
  total: number,
  columns = GIF_COLUMNS,
): { topStart: boolean; topEnd: boolean; bottomStart: boolean; bottomEnd: boolean } {
  const lastRowStart = Math.floor((total - 1) / columns) * columns
  const lastRowFull = total - lastRowStart === columns
  return {
    topStart: index === 0,
    topEnd: index === Math.min(columns, total) - 1,
    bottomStart: index === lastRowStart,
    bottomEnd:
      index === total - 1 || (!lastRowFull && lastRowStart > 0 && index === lastRowStart - 1),
  }
}

function cornerClass(index: number, total: number): string {
  const c = gridCorners(index, total)
  return cn(
    c.topStart && 'rounded-ss-xl',
    c.topEnd && 'rounded-se-xl',
    c.bottomStart && 'rounded-es-xl',
    c.bottomEnd && 'rounded-ee-xl',
  )
}

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
 * Плитка GIF: квадрат сетки, ролик обрезается по центру (Telegram). Нажатие отправляет;
 * правый клик или долгое нажатие — второе действие (сохранить или убрать), как у стикеров:
 * меню из одного пункта было бы лишним шагом.
 */
function GifTile({
  className,
  label,
  hint,
  onPick,
  onAlt,
  children,
}: {
  className?: string
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
      className={cn(
        'block aspect-square w-full cursor-pointer overflow-hidden bg-muted outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Заголовок раздела — как у эмодзи и стикеров (Telegram `symbol-set-title`). */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="truncate px-1 pb-0.5 text-base font-medium leading-[1.6875rem] text-muted-foreground/75">
      {children}
    </h3>
  )
}

/** Сетка GIF: три колонки, щель 2 px. */
const gridClass = 'grid grid-cols-3 gap-0.5'

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
        // Поиск — капсула, как у эмодзи (Telegram). В отличие от Telegram, она не уезжает с
        // лентой: в ней же подпись «Powered by GIPHY» — условие каталога, она видна всегда,
        // пока на экране его выдача.
        <div className="mx-2 mb-3 mt-1.5 flex h-[2.375rem] shrink-0 items-center rounded-full bg-foreground/[0.06] pl-3">
          <Search className="pointer-events-none size-5 shrink-0 text-foreground/80" aria-hidden />
          <input
            type="search"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t('tgGifs.search')}
            aria-label={t('tgGifs.search')}
            className="h-full min-w-0 flex-1 bg-transparent pl-2 pr-2 text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
          />
          {raw && (
            <button
              type="button"
              aria-label={t('tgEmoji.clearSearch')}
              title={t('tgEmoji.clearSearch')}
              onClick={() => setRaw('')}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground/70 outline-none hover:bg-muted-foreground/[0.08] focus-visible:ring-4 focus-visible:ring-ring/20"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
          <span className="shrink-0 pl-1 pr-3 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('tgGifs.poweredBy')}
          </span>
        </div>
      )}
      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-1 [scrollbar-gutter:stable]',
          disabled && 'pt-1.5',
        )}
      >
        {savedItems.length > 0 && (
          <section aria-label={t('tgGifs.saved')} className="mb-3">
            <SectionTitle>{t('tgGifs.saved')}</SectionTitle>
            <div className={gridClass}>
              {savedItems.map((g, i) => (
                <GifTile
                  key={g.id}
                  className={cornerClass(i, savedItems.length)}
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
          <section aria-label={t('tgGifs.recent')} className="mb-3">
            <SectionTitle>{t('tgGifs.recent')}</SectionTitle>
            <div className={gridClass}>
              {recentItems.map((g, i) => (
                <GifTile
                  key={g.fileId}
                  className={cornerClass(i, recentItems.length)}
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
          <div className={gridClass} aria-busy>
            {Array.from({ length: 9 }, (_, i) => (
              <div
                key={i}
                className={cn(
                  'aspect-square animate-pulse bg-muted motion-reduce:animate-none',
                  cornerClass(i, 9),
                )}
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
            {!searching && own > 0 && <SectionTitle>{t('tgGifs.trending')}</SectionTitle>}
            <div className={gridClass}>
              {catalogItems.map((g, i) => (
                <GifTile
                  key={g.id}
                  className={cornerClass(i, catalogItems.length)}
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
