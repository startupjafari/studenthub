'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Camera, Delete, FolderOpen, Plus, Settings2, Smile, Star, Sticker } from 'lucide-react'
import {
  addFavoriteStickerRequest,
  composerKeys,
  fetchCatalogStickerSet,
  fetchFavoriteStickers,
  fetchStickerSetsSummary,
  removeFavoriteStickerRequest,
  type CatalogSticker,
  type StickerSetSummary,
} from '../../../entities/chat'
import {
  fetchAddedStickerSets,
  openMyStickerSets,
  pickStickerSource,
  userStickerKeys,
} from '../../../entities/sticker-set'
import {
  AnimatedImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../shared/ui'
import { MOTION, prefersReducedMotion } from '../../../shared/lib'
import { useRealtimeEvent } from '../../../shared/realtime'
import { cn } from '../../../shared/lib/utils'
import { sectionAt } from '../lib/emoji-catalog'
import { useNearView } from '../lib/use-near-view'
import { ComposerEmojiTab } from './composer-emoji-tab'
import { GifsTab, type PickedGif } from './composer-gifs-tab'

export type SymbolTab = 'emoji' | 'stickers' | 'gifs'

// Вкладка GIF живёт в composer-gifs-tab.tsx: «Сохранённые», «Недавние», каталог GIPHY.
export type { PickedGif } from './composer-gifs-tab'

// Ссылки на стикеры и GIF подписаны на час и больше: держать выдачу свежей дольше незачем,
// а повторное открытие панели не должно каждый раз перезапрашивать каталог.
const CATALOG_STALE_MS = 10 * 60 * 1000

/**
 * Панель на экране с учётом ухода: после `open = false` она ещё `MOTION.exit` мс видна с
 * анимацией исчезновения (Telegram гасит меню, а не выдёргивает его). Повторное открытие
 * посреди ухода просто отменяет уход.
 */
export function useSymbolMenuPresence(open: boolean): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open || !mounted) return
    const id = setTimeout(() => setMounted(false), MOTION.exit)
    return () => clearTimeout(id)
  }, [open, mounted])
  return { mounted: open || mounted, closing: !open && mounted }
}

/** Кнопка нижней полосы и ⌫ — круг 34 px, как в Telegram. */
const footerButton =
  'flex size-[2.125rem] shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/20'

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
            icon: <GifIcon />,
          },
        ]
      : []),
  ]

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden bg-popover',
        variant === 'popover'
          ? 'h-[22.375rem] w-[24rem] rounded-xl border border-border shadow-lg'
          : // Telegram на телефоне: панель 17,6875rem на месте клавиатуры, во всю ширину.
            'h-[min(50dvh,17.6875rem)] w-full',
      )}
    >
      <div
        className="min-h-0 flex-1"
        role="tabpanel"
        aria-label={tabs.find((x) => x.key === active)?.label}
      >
        {active === 'emoji' ? (
          <ComposerEmojiTab variant={variant} onPick={onEmoji} />
        ) : active === 'stickers' ? (
          <StickersTab onPick={onSticker} />
        ) : (
          <GifsTab onPick={onGif} />
        )}
      </div>
      {(tabs.length > 1 || showBackspace) && (
        // Нижняя полоса 48 px: вкладки по центру с широким шагом, ⌫ — у правого края, как в
        // Telegram. Активная вкладка не подсвечивается подложкой — только цветом значка.
        <div className="relative flex h-12 shrink-0 items-center justify-center border-t border-border">
          {tabs.length > 1 && (
            <div
              role="tablist"
              aria-label={t('tgComposer.symbolTabs')}
              className="flex items-center justify-center"
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
                    footerButton,
                    'mx-3',
                    active === x.key
                      ? 'text-foreground'
                      : 'text-foreground/60 hover:bg-muted-foreground/[0.08] hover:text-foreground',
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

/** Значок вкладки GIF: подпись в скруглённой рамке, как у Telegram (у lucide такого нет). */
function GifIcon() {
  return (
    <span
      aria-hidden
      className="rounded-[0.3125rem] border-[1.5px] border-current px-[0.1875rem] text-[0.5625rem] font-extrabold leading-[0.875rem] tracking-tight"
    >
      GIF
    </span>
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
      className={cn(
        footerButton,
        'absolute right-1 top-1/2 -translate-y-1/2 touch-none text-foreground/60 hover:bg-muted-foreground/[0.08] hover:text-foreground',
      )}
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
      className="flex size-[4.5rem] cursor-pointer select-none items-center justify-center rounded-md p-1 outline-none [-webkit-touch-callout:none] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 motion-safe:active:scale-95"
    >
      <AnimatedImage
        src={sticker.url}
        animated={!!sticker.animated}
        alt=""
        loading="lazy"
        draggable={false}
        className="size-full object-contain"
      />
    </button>
  )
}

/** Обложка в полосе наборов (Telegram): квадрат 36 px, активная — серая подложка. */
const coverButton =
  'my-1.5 mx-0.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
const coverIdle = 'text-foreground/70 hover:bg-muted-foreground/[0.08] hover:text-foreground'

/**
 * «Создать стикер» и «Мои наборы» в конце полосы наборов — там же, где шестерёнка настроек
 * стикеров у Telegram Desktop. Создание прямо в приложении — как в Telegram 2024, без бота;
 * файл или снимок с камеры открывают редактор поверх чата.
 */
function StickerTools() {
  const t = useTranslations('Chats')
  const toolClass = cn(coverButton, coverIdle)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('tgStickers.create')}
            title={t('tgStickers.create')}
            onMouseDown={(e) => e.preventDefault()}
            className={toolClass}
          >
            <Plus className="size-5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => pickStickerSource()}>
            <FolderOpen aria-hidden />
            {t('tgStickers.createFromFile')}
          </DropdownMenuItem>
          {/* На телефоне сразу открывает камеру, на ПК — обычный выбор файла. */}
          <DropdownMenuItem onSelect={() => pickStickerSource({ camera: true })}>
            <Camera aria-hidden />
            {t('tgStickers.createFromCamera')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={t('tgStickers.manageTitle')}
        title={t('tgStickers.manageTitle')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={openMyStickerSets}
        className={toolClass}
      >
        <Settings2 className="size-5" aria-hidden />
      </button>
    </>
  )
}

/**
 * Раздел панели стикеров. У избранного и своих наборов стикеры приходят сразу; набор каталога
 * знает только обложку и число стикеров — стикеры он догружает сам (`CatalogStickerGrid`).
 */
type StickerSection =
  | { id: string; title: string; cover: CatalogSticker | null; stickers: CatalogSticker[] }
  | { id: string; title: string; cover: CatalogSticker | null; catalog: StickerSetSummary }

/** Сетка стикеров: Telegram — клетки по 72 px, лишнее место поровну между ними. */
const stickerGrid =
  'grid auto-rows-[4.5rem] grid-cols-[repeat(auto-fill,4.5rem)] justify-between gap-1'

interface StickerGridProps {
  favoriteIds: ReadonlySet<string>
  onPick: (sticker: CatalogSticker) => void
  onToggleFavorite: (id: string, on: boolean) => void
}

function StickerGrid({
  stickers,
  sectionId,
  favoriteIds,
  onPick,
  onToggleFavorite,
}: StickerGridProps & { stickers: CatalogSticker[]; sectionId: string }) {
  return (
    <div className={stickerGrid}>
      {stickers.map((sticker) => (
        <StickerCell
          key={`${sectionId}-${sticker.id}`}
          sticker={sticker}
          favorite={favoriteIds.has(sticker.id)}
          onPick={() => onPick(sticker)}
          onToggleFavorite={() => onToggleFavorite(sticker.id, !favoriteIds.has(sticker.id))}
        />
      ))}
    </div>
  )
}

/**
 * Стикеры набора каталога — по требованию, как в Telegram: пока набор не подъехал к окну,
 * на его месте заглушки по числу стикеров. Высота раздела от загрузки не меняется, и переход
 * по обложке попадает точно в набор.
 */
function CatalogStickerGrid({
  set,
  rootRef,
  ...grid
}: StickerGridProps & { set: StickerSetSummary; rootRef: RefObject<HTMLDivElement | null> }) {
  const t = useTranslations('Chats')
  const { ref, near } = useNearView<HTMLDivElement>(rootRef)
  const query = useQuery({
    queryKey: composerKeys.stickerSet(set.id),
    queryFn: () => fetchCatalogStickerSet(set.id),
    enabled: near,
    staleTime: CATALOG_STALE_MS,
  })
  return (
    <div ref={ref}>
      {query.data ? (
        <StickerGrid stickers={query.data.stickers} sectionId={set.id} {...grid} />
      ) : query.isError ? (
        <div className="flex h-[4.5rem] items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>{t('tgComposer.stickersLoadError')}</span>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="cursor-pointer font-medium text-primary hover:underline"
          >
            {t('tgComposer.retry')}
          </button>
        </div>
      ) : (
        <div className={stickerGrid} aria-busy>
          {Array.from({ length: set.count }, (_, i) => (
            <div key={i} className="size-[4.5rem] rounded-md bg-muted/60" />
          ))}
        </div>
      )}
    </div>
  )
}

function StickersTab({ onPick }: { onPick: (s: CatalogSticker) => void }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [activeSet, setActiveSet] = useState<string | null>(null)
  const [atTop, setAtTop] = useState(true)
  // Пока лента едет к набору по нажатию, подсветка уже стоит на нём и не мигает по пути.
  const jumpingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (jumpingRef.current) clearTimeout(jumpingRef.current)
    },
    [],
  )

  // Лёгкий каталог: обложки и число стикеров. Стикеры каждого набора — CatalogStickerGrid.
  const sets = useQuery({
    queryKey: composerKeys.stickerSets(),
    queryFn: fetchStickerSetsSummary,
    staleTime: CATALOG_STALE_MS,
  })
  const favorites = useQuery({
    queryKey: composerKeys.stickerFavorites(),
    queryFn: fetchFavoriteStickers,
    staleTime: CATALOG_STALE_MS,
  })
  // Свои и добавленные по ссылке наборы — между избранным и каталогом платформы.
  const added = useQuery({
    queryKey: userStickerKeys.added(),
    queryFn: fetchAddedStickerSets,
    staleTime: CATALOG_STALE_MS,
  })
  const favoriteIds = new Set((favorites.data ?? []).map((s) => s.id))
  // Наборы и избранное поменялись на другом устройстве (или в «Моих наборах») — перечитать.
  useRealtimeEvent('stickers:sets-changed', () => {
    void qc.invalidateQueries({ queryKey: userStickerKeys.all })
  })
  useRealtimeEvent('stickers:favorites-changed', () => {
    void qc.invalidateQueries({ queryKey: composerKeys.stickerFavorites() })
  })

  const toggleFavorite = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      on ? addFavoriteStickerRequest(id) : removeFavoriteStickerRequest(id),
    onSuccess: (_d, { on }) => {
      void qc.invalidateQueries({ queryKey: composerKeys.stickerFavorites() })
      toast.success(on ? t('tgComposer.stickerFavorited') : t('tgComposer.stickerUnfavorited'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })
  const grid: StickerGridProps = {
    favoriteIds,
    onPick,
    onToggleFavorite: (id, on) => toggleFavorite.mutate({ id, on }),
  }

  const sections: StickerSection[] = [
    ...((favorites.data?.length ?? 0) > 0
      ? [
          {
            id: 'favorites',
            title: t('tgComposer.stickersFavorites'),
            cover: null,
            stickers: favorites.data ?? [],
          },
        ]
      : []),
    ...(added.data ?? [])
      .filter((s) => s.stickers.length > 0)
      .map((s) => ({
        id: s.id,
        title: s.title,
        cover: s.stickers[0] ?? null,
        stickers: s.stickers,
      })),
    ...(sets.data ?? [])
      .filter((s) => s.count > 0 && s.cover)
      .map((s) => ({ id: s.id, title: s.title, cover: s.cover, catalog: s })),
  ]

  const current = activeSet ?? sections[0]?.id ?? null

  // Активная обложка не уходит за край полосы: Telegram подкручивает её к центру.
  useEffect(() => {
    const header = headerRef.current
    const cover = current
      ? header?.querySelector<HTMLElement>(`[data-cover="${CSS.escape(current)}"]`)
      : null
    if (!header || !cover) return
    const left = cover.offsetLeft - (header.clientWidth - cover.offsetWidth) / 2
    header.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [current])

  function onScroll(): void {
    const vp = scrollRef.current
    if (!vp) return
    setAtTop(vp.scrollTop <= 0)
    if (jumpingRef.current) return
    const blocks = vp.querySelectorAll<HTMLElement>('[data-set]')
    const tops = Array.from(blocks, (b) => ({ id: b.dataset.set ?? '', top: b.offsetTop }))
    const next = sectionAt(tops, vp.scrollTop)
    if (next) setActiveSet(next)
  }

  function jumpTo(id: string): void {
    const vp = scrollRef.current
    const block = vp?.querySelector<HTMLElement>(`[data-set="${CSS.escape(id)}"]`)
    if (!vp || !block) return
    setActiveSet(id)
    if (jumpingRef.current) clearTimeout(jumpingRef.current)
    jumpingRef.current = setTimeout(() => {
      jumpingRef.current = null
    }, 600)
    vp.scrollTo({
      top: block.offsetTop - 8,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }

  if (sets.isPending) {
    return (
      <div
        className="grid grid-cols-[repeat(auto-fill,4.5rem)] justify-between gap-1 px-1 pt-14"
        aria-busy
      >
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="size-[4.5rem] animate-pulse rounded-md bg-muted motion-reduce:animate-none"
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

  return (
    <div className="flex h-full flex-col">
      {/* Обложки наборов — переход к разделу; первый стикер набора и есть обложка. */}
      <div
        ref={headerRef}
        className={cn(
          'flex h-12 shrink-0 items-center overflow-x-auto border-b px-1.5 transition-colors [scrollbar-width:none]',
          // Разделитель — только когда лента уехала под полосу, как в Telegram.
          atTop ? 'border-transparent' : 'border-border',
        )}
        onWheel={(e) => {
          const header = headerRef.current
          if (!header || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
          header.scrollLeft += e.deltaY
        }}
      >
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            data-cover={s.id}
            aria-label={s.title}
            title={s.title}
            aria-pressed={current === s.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => jumpTo(s.id)}
            className={cn(
              coverButton,
              current === s.id ? 'bg-muted-foreground/[0.08] text-foreground' : coverIdle,
            )}
          >
            {s.id === 'favorites' ? (
              <Star className="size-5" aria-hidden />
            ) : s.cover ? (
              <img
                src={s.cover.url}
                alt=""
                loading="lazy"
                draggable={false}
                className="size-[1.875rem] object-contain"
              />
            ) : null}
          </button>
        ))}
        <StickerTools />
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-2 [scrollbar-gutter:stable]"
      >
        {sections.length === 0 && (
          <PanelMessage text={t('tgComposer.stickersEmpty')}>
            <span className="text-xs">{t('tgStickers.emptyPanelHint')}</span>
          </PanelMessage>
        )}
        {sections.map((s) => (
          <section key={s.id} data-set={s.id} aria-label={s.title} className="mb-3">
            <h3 className="truncate px-1 pb-0.5 text-base font-medium leading-[1.6875rem] text-muted-foreground/75">
              {s.title}
            </h3>
            {'catalog' in s ? (
              <CatalogStickerGrid set={s.catalog} rootRef={scrollRef} {...grid} />
            ) : (
              <StickerGrid stickers={s.stickers} sectionId={s.id} {...grid} />
            )}
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
