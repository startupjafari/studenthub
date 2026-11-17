'use client'

import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Clock, Delete, Loader2, Search, Smile, Star, Sticker } from 'lucide-react'
import {
  addFavoriteStickerRequest,
  composerKeys,
  fetchFavoriteStickers,
  fetchRecentGifs,
  fetchStickerSets,
  fetchTrendingGifs,
  removeFavoriteStickerRequest,
  searchGifs,
  type CatalogGif,
  type CatalogSticker,
  type RecentGif,
} from '../../../entities/chat'
import { EmojiPicker } from '../../../shared/ui'
import { prefersReducedMotion, useInfiniteScroll } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

export type SymbolTab = 'emoji' | 'stickers' | 'gifs'

/** Что выбрали в панели GIF: запись каталога (по id) или свой уже отправленный файл. */
export type PickedGif = { kind: 'catalog'; id: string } | { kind: 'recent'; fileId: string }

// Ссылки на стикеры и GIF подписаны на час и больше: держать выдачу свежей дольше незачем,
// а повторное открытие панели не должно каждый раз перезапрашивать каталог.
const CATALOG_STALE_MS = 10 * 60 * 1000

/**
 * Панель символов поля ввода в духе Telegram: эмодзи, стикеры и GIF под одной кнопкой, вкладки
 * внизу. Эмодзи вставляются в текст и панель остаётся открытой; стикер и GIF уходят сразу
 * отдельным сообщением.
 *
 * Два вида: `popover` — над кнопкой смайла на ПК, `dock` — на месте клавиатуры на телефоне.
 * Стикеров и GIF нет в режиме правки: правят текст, а не тип сообщения.
 */
export function ComposerSymbolMenu({
  variant,
  tab,
  onTabChange,
  allowMedia,
  onEmoji,
  onSticker,
  onGif,
  onBackspace,
}: {
  variant: 'popover' | 'dock'
  tab: SymbolTab
  onTabChange: (tab: SymbolTab) => void
  /** Можно ли отправить стикер и GIF (нельзя при правке сообщения). */
  allowMedia: boolean
  onEmoji: (emoji: string) => void
  onSticker: (sticker: CatalogSticker) => void
  onGif: (gif: PickedGif) => void
  /** Кнопка ⌫ на вкладке эмодзи (Telegram): стереть знак перед курсором поля ввода. */
  onBackspace?: () => void
}) {
  const t = useTranslations('Chats')
  const active: SymbolTab = allowMedia ? tab : 'emoji'
  const showBackspace = active === 'emoji' && !!onBackspace
  const tabs: { key: SymbolTab; label: string; icon: React.ReactNode }[] = [
    { key: 'emoji', label: t('emoji'), icon: <Smile className="size-5" aria-hidden /> },
    ...(allowMedia
      ? [
          {
            key: 'stickers' as const,
            label: t('tgComposer.stickersTab'),
            icon: <Sticker className="size-5" aria-hidden />,
          },
          {
            key: 'gifs' as const,
            label: t('tgComposer.gifsTab'),
            // У lucide нет значка GIF — подписью, как на кнопке Telegram.
            icon: <span className="text-[0.7rem] font-bold leading-none tracking-tight">GIF</span>,
          },
        ]
      : []),
  ]

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden bg-popover',
        variant === 'popover'
          ? 'h-[26rem] w-[21rem] rounded-xl border border-border shadow-lg'
          : 'h-[min(45dvh,20rem)] w-full',
      )}
    >
      <div
        className="min-h-0 flex-1"
        role="tabpanel"
        aria-label={tabs.find((x) => x.key === active)?.label}
      >
        {active === 'emoji' ? (
          <EmojiPicker
            size={variant === 'popover' ? 'lg' : 'dock'}
            searchPlaceholder={t('emojiSearch')}
            onPick={onEmoji}
            className="h-full w-full rounded-none border-0 shadow-none"
          />
        ) : active === 'stickers' ? (
          <StickersTab onPick={onSticker} />
        ) : (
          <GifsTab onPick={onGif} />
        )}
      </div>
      {(tabs.length > 1 || showBackspace) && (
        // Нижняя полоса: вкладки по центру, ⌫ — у правого края, как в Telegram.
        <div className="relative flex min-h-11 shrink-0 items-center justify-center border-t border-border px-2 py-1">
          {tabs.length > 1 && (
            <div
              role="tablist"
              aria-label={t('tgComposer.symbolTabs')}
              className="flex items-center justify-center gap-1"
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                e.preventDefault()
                const i = tabs.findIndex((x) => x.key === active)
                const next =
                  tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
                if (next) onTabChange(next.key)
              }}
            >
              {tabs.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  role="tab"
                  aria-selected={active === x.key}
                  aria-label={x.label}
                  title={x.label}
                  tabIndex={active === x.key ? 0 : -1}
                  // Нажатие по вкладке не уводит фокус из поля ввода: на телефоне иначе
                  // поднималась бы и сразу пряталась клавиатура.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onTabChange(x.key)}
                  className={cn(
                    'flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-ring/20',
                    active === x.key
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {x.icon}
                </button>
              ))}
            </div>
          )}
          {showBackspace && onBackspace && (
            <BackspaceButton label={t('tgComposer2.backspace')} onPress={onBackspace} />
          )}
        </div>
      )}
    </div>
  )
}

/** Задержка до автоповтора и его шаг — как у клавиши Backspace на клавиатуре. */
const REPEAT_DELAY_MS = 400
const REPEAT_EVERY_MS = 70

/**
 * ⌫ панели эмодзи. Нажатие стирает один знак, удержание — стирает подряд, как клавиша на
 * клавиатуре. Фокус из поля не уводит: на телефоне иначе спрятавшаяся клавиатура тут же
 * поднималась бы снова, а курсор терял место.
 */
function BackspaceButton({ label, onPress }: { label: string; onPress: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressRef = useRef(onPress)
  pressRef.current = onPress
  const stop = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])
  const repeat = (): void => {
    pressRef.current()
    timer.current = setTimeout(repeat, REPEAT_EVERY_MS)
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        stop()
        pressRef.current()
        timer.current = setTimeout(repeat, REPEAT_DELAY_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // Клавиатура: Enter/Space дают click без pointerdown — стираем по нему.
      onClick={(e) => {
        if (e.detail === 0) pressRef.current()
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer touch-none items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20"
    >
      <Delete className="size-5" aria-hidden />
    </button>
  )
}

/** Сколько держать палец на стикере, чтобы добавить его в избранное (или убрать). */
const FAVORITE_PRESS_MS = 450

/**
 * Клетка стикера. Нажатие отправляет; правый клик или долгое нажатие — в избранное и обратно
 * (в Telegram это пункт меню стикера; здесь меню из одного пункта было бы лишним шагом).
 * Картинка — подписанная ссылка на приватный бакет, поэтому обычный img.
 */
function StickerCell({
  sticker,
  favorite,
  onPick,
  onToggleFavorite,
}: {
  sticker: CatalogSticker
  favorite: boolean
  onPick: () => void
  onToggleFavorite: () => void
}) {
  const t = useTranslations('Chats')
  const press = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swallowClick = useRef(false)
  const clear = (): void => {
    if (press.current) clearTimeout(press.current)
    press.current = null
  }
  useEffect(() => clear, [])
  const alt = sticker.emoji
    ? t('tgComposer.stickerAlt', { emoji: sticker.emoji })
    : t('previewSticker')
  const hint = favorite
    ? t('tgComposer.stickerUnfavoriteHint')
    : t('tgComposer.stickerFavoriteHint')
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
      onContextMenu={(e) => {
        e.preventDefault()
        clear()
        onToggleFavorite()
      }}
      onPointerDown={(e) => {
        swallowClick.current = false
        if (e.pointerType === 'mouse') return
        clear()
        press.current = setTimeout(() => {
          press.current = null
          swallowClick.current = true
          onToggleFavorite()
        }, FAVORITE_PRESS_MS)
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      aria-label={alt}
      title={hint}
      className="flex aspect-square cursor-pointer select-none items-center justify-center rounded-lg p-1 outline-none [-webkit-touch-callout:none] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 motion-safe:active:scale-95"
    >
      <img
        src={sticker.url}
        alt=""
        loading="lazy"
        draggable={false}
        className="size-full object-contain"
      />
    </button>
  )
}

function StickersTab({ onPick }: { onPick: (s: CatalogSticker) => void }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)

  const sets = useQuery({
    queryKey: composerKeys.stickerSets(),
    queryFn: fetchStickerSets,
    staleTime: CATALOG_STALE_MS,
  })
  const favorites = useQuery({
    queryKey: composerKeys.stickerFavorites(),
    queryFn: fetchFavoriteStickers,
    staleTime: CATALOG_STALE_MS,
  })
  const favoriteIds = new Set((favorites.data ?? []).map((s) => s.id))

  const toggleFavorite = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      on ? addFavoriteStickerRequest(id) : removeFavoriteStickerRequest(id),
    onSuccess: (_d, { on }) => {
      void qc.invalidateQueries({ queryKey: composerKeys.stickerFavorites() })
      toast.success(on ? t('tgComposer.stickerFavorited') : t('tgComposer.stickerUnfavorited'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  if (sets.isPending) {
    return (
      <div className="grid grid-cols-5 gap-1 p-2" aria-busy>
        {Array.from({ length: 15 }, (_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
    )
  }
  if (sets.isError) {
    return (
      <PanelMessage text={t('tgComposer.stickersLoadError')}>
        <button
          type="button"
          onClick={() => void sets.refetch()}
          className="cursor-pointer text-sm font-medium text-primary hover:underline"
        >
          {t('tgComposer.retry')}
        </button>
      </PanelMessage>
    )
  }
  const sections = [
    ...((favorites.data?.length ?? 0) > 0
      ? [
          {
            id: 'favorites',
            title: t('tgComposer.stickersFavorites'),
            stickers: favorites.data ?? [],
          },
        ]
      : []),
    ...sets.data.filter((s) => s.stickers.length > 0),
  ]
  if (sections.length === 0) return <PanelMessage text={t('tgComposer.stickersEmpty')} />

  return (
    <div className="flex h-full flex-col">
      {/* Обложки наборов — переход к разделу; первый стикер набора и есть обложка. */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1 [scrollbar-width:none]">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-label={s.title}
            title={s.title}
            onClick={() =>
              scrollRef.current?.querySelector(`[data-set="${s.id}"]`)?.scrollIntoView({
                block: 'start',
                behavior: prefersReducedMotion() ? 'auto' : 'smooth',
              })
            }
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {s.id === 'favorites' ? (
              <Star className="size-5" aria-hidden />
            ) : s.stickers[0] ? (
              <img src={s.stickers[0].url} alt="" className="size-7 object-contain" />
            ) : null}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {sections.map((s) => (
          <section key={s.id} data-set={s.id} aria-label={s.title} className="scroll-mt-1">
            <h3 className="sticky top-0 z-10 bg-popover px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
              {s.title}
            </h3>
            <div className="grid grid-cols-5 gap-0.5">
              {s.stickers.map((sticker) => (
                <StickerCell
                  key={`${s.id}-${sticker.id}`}
                  sticker={sticker}
                  favorite={favoriteIds.has(sticker.id)}
                  onPick={() => onPick(sticker)}
                  onToggleFavorite={() =>
                    toggleFavorite.mutate({ id: sticker.id, on: !favoriteIds.has(sticker.id) })
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
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

/** Плитка GIF: соотношение сторон резервируется заранее, чтобы колонка не прыгала. */
function GifTile({
  src,
  width,
  height,
  label,
  onPick,
}: {
  src: string
  width: number | null
  height: number | null
  label: string
  onPick: () => void
}) {
  const ratio = width && height ? `${width} / ${height}` : '1 / 1'
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={label}
      className="mb-1 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      style={{ aspectRatio: ratio }}
    >
      <img src={src} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
    </button>
  )
}

function GifsTab({ onPick }: { onPick: (gif: PickedGif) => void }) {
  const t = useTranslations('Chats')
  const [raw, setRaw] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQuery(raw.trim()), 350)
    return () => clearTimeout(id)
  }, [raw])

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

  const catalogItems: CatalogGif[] = catalog.data?.pages.flatMap((p) => p.items) ?? []
  const recentItems: RecentGif[] = query ? [] : (recent.data ?? [])
  const disabled = (catalog.error as { code?: string } | null)?.code === 'FEATURE_DISABLED'

  return (
    <div className="flex h-full flex-col">
      <div className="relative m-2 shrink-0">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t('tgComposer.gifsSearch')}
          aria-label={t('tgComposer.gifsSearch')}
          className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {recentItems.length > 0 && (
          <>
            <h3 className="flex items-center gap-1 pb-1 text-xs font-medium text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              {t('tgComposer.gifsRecent')}
            </h3>
            <div className="mb-2 columns-2 gap-1">
              {recentItems.map((g) => (
                <GifTile
                  key={g.fileId}
                  src={g.url}
                  width={g.width}
                  height={g.height}
                  label={t('tgComposer.gifSend')}
                  onPick={() => onPick({ kind: 'recent', fileId: g.fileId })}
                />
              ))}
            </div>
          </>
        )}
        {catalog.isPending ? (
          <div className="columns-2 gap-1" aria-busy>
            {[120, 90, 140, 100, 80, 130].map((h, i) => (
              <div
                key={i}
                className="mb-1 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
                style={{ height: h }}
              />
            ))}
          </div>
        ) : disabled ? (
          recentItems.length === 0 && <PanelMessage text={t('tgComposer.gifsDisabled')} />
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
          <>
            {!query && recentItems.length > 0 && (
              <h3 className="pb-1 text-xs font-medium text-muted-foreground">
                {t('tgComposer.gifsTrending')}
              </h3>
            )}
            <div className="columns-2 gap-1">
              {catalogItems.map((g) => (
                <GifTile
                  key={g.id}
                  src={g.previewUrl}
                  width={g.previewWidth}
                  height={g.previewHeight}
                  label={g.title || t('tgComposer.gifSend')}
                  onPick={() => onPick({ kind: 'catalog', id: g.id })}
                />
              ))}
            </div>
            <div ref={sentinel} className="h-px" />
            {catalog.isFetchingNextPage && (
              <div className="flex justify-center py-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
